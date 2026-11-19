/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Engine / Peaks / PeakService
 * --------------------------------------------------------------------------
 * 管理 Peaks Worker，並提供繪圖時查詢指定範圍 min/max 的函式。
 *
 * 查詢策略：
 *   samplesPerPixel ≥ 256 → 使用峰值層級（選擇不大於每像素取樣數的最大層級）
 *   samplesPerPixel < 256 → 直接掃描原始 PCM
 * ========================================================================== */

const WORKER_URL = new URL('../../Workers/Peaks.worker.js', import.meta.url);

export class PeakService {
  constructor() {
    this.worker = null;
    this.jobs = new Map();
    this.seq = 0;
    /** @type {Map<string, { bucket:number, min:Float32Array, max:Float32Array }[]>} */
    this.cache = new Map();
  }

  /** 延遲建立 Worker */
  ensureWorker() {
    if (this.worker) return;
    this.worker = new Worker(WORKER_URL);
    this.worker.onmessage = (event) => {
      const { jobId, levels } = event.data;
      const job = this.jobs.get(jobId);
      if (!job) return;
      this.jobs.delete(jobId);
      job.resolve(levels);
    };
  }

  /**
   * 為來源建立峰值資料。channels 會被複製傳入 Worker，原陣列仍可使用。
   * @param {string} sourceId
   * @param {Float32Array[]} channels
   */
  build(sourceId, channels) {
    this.ensureWorker();
    const jobId = `pk${(this.seq += 1)}`;
    return new Promise((resolve) => {
      this.jobs.set(jobId, {
        resolve: (levels) => {
          this.cache.set(sourceId, levels);
          resolve(levels);
        }
      });
      this.worker.postMessage({ jobId, channels });
    });
  }

  /** 移除來源的峰值資料 */
  remove(sourceId) {
    this.cache.delete(sourceId);
  }

  /** 清空全部 */
  clear() {
    this.cache.clear();
  }

  /**
   * 查詢來源範圍 [s0, s1) 的 min/max。
   * @param {string} sourceId
   * @param {Float32Array[]|null} channels 原始 PCM（細部縮放時使用）
   * @param {number} s0
   * @param {number} s1
   * @param {number} samplesPerPixel
   * @returns {[number, number]}
   */
  range(sourceId, channels, s0, s1, samplesPerPixel) {
    const levels = this.cache.get(sourceId);

    if (levels && samplesPerPixel >= levels[0].bucket) {
      let level = levels[0];
      for (const l of levels) if (l.bucket <= samplesPerPixel) level = l;
      const b0 = Math.floor(s0 / level.bucket);
      const b1 = Math.max(b0 + 1, Math.ceil(s1 / level.bucket));
      let lo = 0;
      let hi = 0;
      for (let b = b0; b < b1 && b < level.min.length; b += 1) {
        if (level.min[b] < lo) lo = level.min[b];
        if (level.max[b] > hi) hi = level.max[b];
      }
      return [lo, hi];
    }

    if (!channels) return [0, 0];
    let lo = 0;
    let hi = 0;
    const end = Math.max(s0 + 1, s1);
    for (const ch of channels) {
      for (let i = Math.max(0, s0); i < end && i < ch.length; i += 1) {
        const v = ch[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    return [lo, hi];
  }
}
