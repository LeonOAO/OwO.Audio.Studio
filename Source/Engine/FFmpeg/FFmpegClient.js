/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Engine / FFmpeg / FFmpegClient
 * --------------------------------------------------------------------------
 * 主執行緒端的 ffmpeg 代理：
 *   - 偵測 Engine/MT（多執行緒）或 Engine/ST（單執行緒）核心是否存在
 *   - 依需求延遲載入 Worker 與核心
 *   - 以 jobId 管理工作、回報進度、支援取消（terminate 後重建）
 *
 * 核心檔案由 GitHub Actions（.github/workflows/Deploy.yml）部署時自動放入：
 *   Engine/ST/ffmpeg-core.js、ffmpeg-core.wasm
 *   Engine/MT/ffmpeg-core.js、ffmpeg-core.wasm、ffmpeg-core.worker.js
 * ========================================================================== */

const WORKER_URL = new URL('../../Workers/FFmpeg.worker.js', import.meta.url);
const ENGINE_BASE = new URL('../../../Engine/', import.meta.url);

/** 找不到核心時的統一說明 */
export const ENGINE_MISSING_TEXT =
  '網站上找不到 ffmpeg 核心。請到 GitHub 儲存庫的 Actions 頁籤，確認「部署到 GitHub Pages」是否執行成功。';

/** 引擎模式 */
export const EngineMode = Object.freeze({
  None: 'none',
  Single: 'st',
  Multi: 'mt'
});

/** 檢查檔案是否存在（HEAD 失敗時改用 GET Range） */
async function exists(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (res.ok) return true;
    if (res.status === 405 || res.status === 501) {
      const alt = await fetch(url, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' });
      return alt.ok;
    }
    return false;
  } catch {
    return false;
  }
}

export class FFmpegClient {
  constructor() {
    this.mode = EngineMode.None;
    this.worker = null;
    this.loaded = false;
    this.loadingPromise = null;
    this.jobs = new Map();
    this.jobSeq = 0;
    this.detected = false;
  }

  /**
   * 偵測可用核心。多執行緒核心需要 crossOriginIsolated（SharedArrayBuffer）。
   * @returns {Promise<string>} EngineMode
   */
  async detect() {
    const mtCore = new URL('MT/ffmpeg-core.wasm', ENGINE_BASE).href;
    const stCore = new URL('ST/ffmpeg-core.wasm', ENGINE_BASE).href;

    if (self.crossOriginIsolated && (await exists(mtCore))) this.mode = EngineMode.Multi;
    else if (await exists(stCore)) this.mode = EngineMode.Single;
    else this.mode = EngineMode.None;

    this.detected = true;
    return this.mode;
  }

  /** 是否有可用核心 */
  get available() {
    return this.mode !== EngineMode.None;
  }

  /** 取得核心檔案網址 */
  coreUrls() {
    const folder = this.mode === EngineMode.Multi ? 'MT/' : 'ST/';
    const base = new URL(folder, ENGINE_BASE);
    return {
      coreURL: new URL('ffmpeg-core.js', base).href,
      wasmURL: new URL('ffmpeg-core.wasm', base).href,
      workerURL: new URL('ffmpeg-core.worker.js', base).href
    };
  }

  /** 建立 Worker 並載入核心（只執行一次） */
  async ensureLoaded() {
    if (!this.detected) await this.detect();
    if (!this.available) throw new Error(ENGINE_MISSING_TEXT);
    if (this.loaded) return;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = (async () => {
      this.worker = new Worker(WORKER_URL);
      this.worker.onmessage = (event) => this.handleMessage(event.data);
      this.worker.onerror = (event) => {
        const error = new Error(`ffmpeg Worker 發生錯誤：${event.message || '未知錯誤'}`);
        for (const job of this.jobs.values()) job.reject(error);
        this.jobs.clear();
      };
      await this.post('load', this.coreUrls());
      this.loaded = true;
    })();

    try {
      await this.loadingPromise;
    } catch (error) {
      this.reset();
      throw error;
    } finally {
      this.loadingPromise = null;
    }
  }

  /** 處理 Worker 回應 */
  handleMessage(msg) {
    const job = this.jobs.get(msg.jobId);
    if (!job) return;
    if (msg.type === 'progress') {
      if (job.onProgress) job.onProgress(msg.ratio, msg.stage);
      return;
    }
    this.jobs.delete(msg.jobId);
    if (msg.type === 'done') {
      job.resolve(msg.result);
    } else {
      const error = new Error(msg.message);
      error.logTail = msg.logTail;
      job.reject(error);
    }
  }

  /**
   * 送出工作。
   * @param {string} type
   * @param {object} payload
   * @param {object} [options]
   * @param {(ratio:number, stage:string)=>void} [options.onProgress]
   * @param {Transferable[]} [options.transfer]
   */
  post(type, payload, { onProgress = null, transfer = [] } = {}) {
    const jobId = `job${(this.jobSeq += 1)}`;
    return new Promise((resolve, reject) => {
      this.jobs.set(jobId, { resolve, reject, onProgress });
      this.worker.postMessage({ type, jobId, ...payload }, transfer);
    });
  }

  /** 取消所有工作：終止 Worker，下次使用時重新載入 */
  cancelAll() {
    const error = new Error('已取消。');
    error.cancelled = true;
    for (const job of this.jobs.values()) job.reject(error);
    this.jobs.clear();
    this.reset();
  }

  /** 重設 Worker 狀態 */
  reset() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.loaded = false;
  }

  /* ------------------------------ 公開 API ------------------------------ */

  /** 探測檔案資訊 */
  async probe(file) {
    await this.ensureLoaded();
    return this.post('probe', { file });
  }

  /** 解碼為指定取樣率與聲道數的 PCM */
  async decode(file, { audioIndex = 0, sampleRate, channels }, onProgress) {
    await this.ensureLoaded();
    return this.post('decode', { file, audioIndex, sampleRate, channels }, { onProgress });
  }

  /** 編碼交錯 PCM */
  async encode({ pcm, sampleRate, channels, args, outName, cover }, onProgress) {
    await this.ensureLoaded();
    return this.post(
      'encode',
      { pcm, sampleRate, channels, args, outName, cover },
      { onProgress, transfer: [pcm.buffer] }
    );
  }

  /** 快速裁切原始檔（不重新編碼） */
  async fastCut({ file, audioIndex = 0, start, end, outName }, onProgress) {
    await this.ensureLoaded();
    return this.post('fastcut', { file, audioIndex, start, end, outName }, { onProgress });
  }
}
