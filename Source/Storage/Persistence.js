/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Storage / Persistence
 * --------------------------------------------------------------------------
 * 自動儲存與還原：
 *
 *   專案模型（JSON） → IndexedDB  OwOAudioStudio / kv / currentProject
 *   解碼後 PCM       → OPFS       Sources/{sourceId}.pcm
 *
 * PCM 檔案格式：各聲道 Float32 依序串接（聲道 0 全部、聲道 1 全部 …）。
 * OPFS 不可用時（例如部分瀏覽器或私密模式）自動停用，不影響編輯。
 * ========================================================================== */

const DB_NAME = 'OwOAudioStudio';
const STORE = 'kv';
const PROJECT_KEY = 'currentProject';
const SOURCE_DIR = 'Sources';

/** 開啟 IndexedDB */
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** IndexedDB 讀寫 */
async function kv(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export class Persistence {
  constructor() {
    this.opfsReady = false;
    this.root = null;
  }

  /** 初始化並檢查 OPFS 是否可寫入 */
  async init() {
    try {
      if (!navigator.storage || !navigator.storage.getDirectory) return false;
      const root = await navigator.storage.getDirectory();
      this.root = await root.getDirectoryHandle(SOURCE_DIR, { create: true });
      // 主執行緒需要 createWritable（Chromium 系列支援）
      const probe = await this.root.getFileHandle('.probe', { create: true });
      if (typeof probe.createWritable !== 'function') return false;
      const w = await probe.createWritable();
      await w.write(new Uint8Array([1]));
      await w.close();
      await this.root.removeEntry('.probe');
      if (navigator.storage.persist) navigator.storage.persist().catch(() => {});
      this.opfsReady = true;
    } catch {
      this.opfsReady = false;
    }
    return this.opfsReady;
  }

  /* ------------------------------ 專案 ------------------------------ */

  /** 儲存專案模型 */
  saveProject(project) {
    return kv('readwrite', (store) => store.put(project, PROJECT_KEY));
  }

  /** 讀取專案模型 */
  loadProject() {
    return kv('readonly', (store) => store.get(PROJECT_KEY));
  }

  /** 刪除專案模型 */
  clearProject() {
    return kv('readwrite', (store) => store.delete(PROJECT_KEY));
  }

  /* ------------------------------ PCM ------------------------------ */

  /**
   * 寫入來源 PCM。
   * @param {string} sourceId
   * @param {Float32Array[]} channels
   */
  async writeSource(sourceId, channels) {
    if (!this.opfsReady) return false;
    const handle = await this.root.getFileHandle(`${sourceId}.pcm`, { create: true });
    const writable = await handle.createWritable();
    for (const ch of channels) await writable.write(new Uint8Array(ch.buffer, ch.byteOffset, ch.byteLength));
    await writable.close();
    return true;
  }

  /**
   * 讀取來源 PCM。
   * @param {string} sourceId
   * @param {number} channelCount
   * @param {number} length
   * @returns {Promise<Float32Array[]|null>}
   */
  async readSource(sourceId, channelCount, length) {
    if (!this.opfsReady) return null;
    try {
      const handle = await this.root.getFileHandle(`${sourceId}.pcm`);
      const file = await handle.getFile();
      const buffer = await file.arrayBuffer();
      if (buffer.byteLength < channelCount * length * 4) return null;
      const channels = [];
      for (let c = 0; c < channelCount; c += 1) {
        channels.push(new Float32Array(buffer.slice(c * length * 4, (c + 1) * length * 4)));
      }
      return channels;
    } catch {
      return null;
    }
  }

  /** 刪除來源 PCM */
  async removeSource(sourceId) {
    if (!this.opfsReady) return;
    try {
      await this.root.removeEntry(`${sourceId}.pcm`);
    } catch {
      /* 不存在 */
    }
  }

  /** 刪除所有來源 PCM（開新專案時） */
  async clearSources() {
    if (!this.opfsReady) return;
    const names = [];
    for await (const name of this.root.keys()) names.push(name);
    for (const name of names) {
      try { await this.root.removeEntry(name); } catch { /* 忽略 */ }
    }
  }

  /** 取得儲存空間用量 */
  async usage() {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    return { usage, quota };
  }
}
