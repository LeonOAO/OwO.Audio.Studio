/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Domain / Analysis
 * --------------------------------------------------------------------------
 * 針對解碼後 PCM 的分析工具：零交越點搜尋、峰值計算。
 * channels 為 Float32Array[]（每聲道一個陣列）。
 * ========================================================================== */

/**
 * 在 center ± radius 範圍內尋找最接近 center 的零交越點。
 * 判斷依據為所有聲道平均值的正負號變化。
 *
 * @param {Float32Array[]} channels
 * @param {number} center 來源取樣點位置
 * @param {number} radius 搜尋半徑（取樣點）
 * @returns {number} 找到的位置；找不到時回傳 center
 */
export function findZeroCrossing(channels, center, radius) {
  if (!channels.length) return center;
  const length = channels[0].length;
  const mono = (i) => {
    let sum = 0;
    for (const ch of channels) sum += ch[i];
    return sum / channels.length;
  };

  for (let d = 0; d <= radius; d += 1) {
    for (const i of [center + d, center - d]) {
      if (i <= 0 || i >= length) continue;
      const prev = mono(i - 1);
      const cur = mono(i);
      if (cur === 0 || (prev < 0 && cur > 0) || (prev > 0 && cur < 0)) return i;
    }
  }
  return center;
}

/**
 * 計算來源某一範圍內所有聲道的絕對峰值。
 * @param {Float32Array[]} channels
 * @param {number} start
 * @param {number} end
 * @returns {number} 0 ~ 1 以上
 */
export function peakOfRange(channels, start, end) {
  let peak = 0;
  for (const ch of channels) {
    const s = Math.max(0, start);
    const e = Math.min(ch.length, end);
    for (let i = s; i < e; i += 1) {
      const v = Math.abs(ch[i]);
      if (v > peak) peak = v;
    }
  }
  return peak;
}
