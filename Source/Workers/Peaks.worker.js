/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Workers / Peaks.worker.js（Classic Worker）
 * --------------------------------------------------------------------------
 * 建立多層級波形峰值資料（min / max），供不同縮放程度快速繪製。
 *
 *   層級 0：每 256 個取樣點一組
 *   層級 1：每 1024 個取樣點一組
 *   層級 2：每 4096 個取樣點一組
 *   層級 3：每 16384 個取樣點一組
 *
 * 所有聲道合併為單一包絡（取各聲道最小值與最大值）。
 * 輸入：{ jobId, channels: Float32Array[] }
 * 輸出：{ jobId, levels: [{ bucket, min: Float32Array, max: Float32Array }] }
 * ========================================================================== */

const BUCKETS = [256, 1024, 4096, 16384];

self.onmessage = (event) => {
  const { jobId, channels } = event.data;
  const length = channels.length ? channels[0].length : 0;
  const levels = [];

  // 第 0 層直接由原始資料計算
  const base = BUCKETS[0];
  const count0 = Math.ceil(length / base);
  const min0 = new Float32Array(count0);
  const max0 = new Float32Array(count0);

  for (let b = 0; b < count0; b += 1) {
    const s = b * base;
    const e = Math.min(length, s + base);
    let lo = 0;
    let hi = 0;
    for (const ch of channels) {
      for (let i = s; i < e; i += 1) {
        const v = ch[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    min0[b] = lo;
    max0[b] = hi;
  }
  levels.push({ bucket: base, min: min0, max: max0 });

  // 其餘層級由上一層合併（每層縮小 4 倍）
  for (let l = 1; l < BUCKETS.length; l += 1) {
    const prev = levels[l - 1];
    const factor = BUCKETS[l] / BUCKETS[l - 1];
    const count = Math.ceil(prev.min.length / factor);
    const min = new Float32Array(count);
    const max = new Float32Array(count);
    for (let b = 0; b < count; b += 1) {
      let lo = 0;
      let hi = 0;
      const s = b * factor;
      const e = Math.min(prev.min.length, s + factor);
      for (let i = s; i < e; i += 1) {
        if (prev.min[i] < lo) lo = prev.min[i];
        if (prev.max[i] > hi) hi = prev.max[i];
      }
      min[b] = lo;
      max[b] = hi;
    }
    levels.push({ bucket: BUCKETS[l], min, max });
  }

  const transfer = [];
  for (const level of levels) transfer.push(level.min.buffer, level.max.buffer);
  self.postMessage({ jobId, levels }, transfer);
};
