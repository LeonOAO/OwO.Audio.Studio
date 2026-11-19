/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Engine / Render / Mixer
 * --------------------------------------------------------------------------
 * 共用混音核心：播放與匯出使用同一份程式，保證「聽到的就是匯出的」。
 *
 * 處理順序（每個片段）：
 *   來源 PCM → 聲道對應 → 片段增益 × 淡入淡出包絡 → 音軌增益 × 聲相 → 累加
 *
 * 純函式模組，不依賴瀏覽器 API，可在主執行緒、Worker 或 Node.js 執行。
 * ========================================================================== */

import { clipEnd, dbToGain, isTrackAudible } from '../../Domain/Model.js';
import { clipEnvelopeAt } from '../../Domain/Fades.js';

/**
 * 聲相（平衡）增益：中央時左右皆為 1。
 * @param {number} pan -1（左）~ 1（右）
 * @returns {[number, number]}
 */
export function panGains(pan) {
  const p = Math.max(-1, Math.min(1, pan || 0));
  return [p > 0 ? 1 - p : 1, p < 0 ? 1 + p : 1];
}

/**
 * 混音一個區塊。
 *
 * @param {object} project
 * @param {Record<string, { channels: Float32Array[] }>} bank 來源 PCM 庫
 * @param {number} start  時間軸起點（取樣點）
 * @param {number} length 區塊長度（取樣點）
 * @param {object} [options]
 * @param {string[]|null} [options.trackIds] 只混指定音軌（分軌輸出用），忽略 solo/mute
 * @returns {Float32Array[]} 每聲道一個陣列，長度皆為 length
 */
export function renderBlock(project, bank, start, length, { trackIds = null } = {}) {
  const outCount = project.channelCount;
  const out = [];
  for (let c = 0; c < outCount; c += 1) out.push(new Float32Array(length));
  const end = start + length;

  for (const track of project.tracks) {
    if (trackIds) {
      if (!trackIds.includes(track.id)) continue;
    } else if (!isTrackAudible(project, track)) {
      continue;
    }

    const trackGain = dbToGain(track.gainDb);
    const [panL, panR] = panGains(track.pan);

    for (const clip of track.clips) {
      const cStart = clip.timelineStart;
      const cEnd = clipEnd(clip);
      if (cEnd <= start || cStart >= end) continue;

      const entry = bank[clip.sourceId];
      if (!entry) continue; // 來源尚未載入時以靜音處理

      const src = entry.channels;
      const from = Math.max(start, cStart);
      const to = Math.min(end, cEnd);
      const clipGain = dbToGain(clip.gainDb) * trackGain;
      const hasFade = clip.fadeIn.length > 0 || clip.fadeOut.length > 0;

      for (let oc = 0; oc < outCount; oc += 1) {
        // 聲道對應：來源聲道不足時重複使用第 0 聲道
        const input = src[oc < src.length ? oc : 0];
        const target = out[oc];
        let gain = clipGain;
        if (outCount === 2) gain *= oc === 0 ? panL : panR;
        if (gain === 0) continue;

        for (let t = from; t < to; t += 1) {
          const offset = t - cStart;
          let value = input[clip.sourceStart + offset];
          if (value === undefined) continue;
          if (hasFade) value *= clipEnvelopeAt(clip, offset);
          target[t - start] += value * gain;
        }
      }
    }
  }

  return out;
}

/**
 * 將多聲道陣列交錯成單一 Float32Array（ffmpeg f32le 輸入格式）。
 * @param {Float32Array[]} channels
 * @param {Float32Array} [target]
 * @param {number} [targetOffset] 交錯後的取樣框位置
 */
export function interleave(channels, target, targetOffset = 0) {
  const count = channels.length;
  const frames = channels[0].length;
  const out = target || new Float32Array(frames * count);
  let k = targetOffset * count;
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < count; c += 1) out[k++] = channels[c][i];
  }
  return out;
}

/**
 * 將交錯資料拆成多聲道陣列。
 * @param {Float32Array} data
 * @param {number} channelCount
 */
export function deinterleave(data, channelCount) {
  const frames = Math.floor(data.length / channelCount);
  const channels = [];
  for (let c = 0; c < channelCount; c += 1) channels.push(new Float32Array(frames));
  let k = 0;
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channelCount; c += 1) channels[c][i] = data[k++];
  }
  return channels;
}

/**
 * 離線渲染整段範圍，分塊處理並回呼進度。
 *
 * @param {object} project
 * @param {object} bank
 * @param {number} start
 * @param {number} end
 * @param {object} [options]
 * @param {string[]|null} [options.trackIds]
 * @param {(ratio: number) => void} [options.onProgress]
 * @param {number} [options.blockSize]
 * @returns {Promise<Float32Array>} 交錯後的 PCM
 */
export async function renderRangeInterleaved(project, bank, start, end, {
  trackIds = null,
  onProgress = null,
  blockSize = 65536
} = {}) {
  const total = Math.max(0, end - start);
  const output = new Float32Array(total * project.channelCount);

  for (let pos = 0; pos < total; pos += blockSize) {
    const len = Math.min(blockSize, total - pos);
    const block = renderBlock(project, bank, start + pos, len, { trackIds });
    interleave(block, output, pos);
    if (onProgress) onProgress((pos + len) / total);
    // 讓出執行緒，避免畫面凍結
    if ((pos / blockSize) % 8 === 7) await new Promise((r) => setTimeout(r, 0));
  }

  return output;
}
