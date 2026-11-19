/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Domain / Fades
 * --------------------------------------------------------------------------
 * 淡入淡出曲線與片段包絡計算。
 * 播放、匯出、波形繪製三者共用此處的公式，確保「聽到的＝匯出的＝看到的」。
 * ========================================================================== */

import { FadeCurve, clipLength } from './Model.js';

/**
 * 曲線函數：輸入進度 p (0~1)，回傳增益 (0~1)。
 * @param {string} curve
 * @param {number} p
 */
export function fadeShape(curve, p) {
  const x = p <= 0 ? 0 : p >= 1 ? 1 : p;
  switch (curve) {
    case FadeCurve.Linear:
      return x;
    case FadeCurve.Exponential:
      return x * x;
    case FadeCurve.EqualPower:
    default:
      return Math.sin((x * Math.PI) / 2);
  }
}

/**
 * 片段內某一相對位置（0 = 片段第一個取樣點）的淡入淡出增益。
 * @param {object} clip
 * @param {number} offset 片段內偏移（取樣點）
 */
export function clipEnvelopeAt(clip, offset) {
  const length = clipLength(clip);
  let gain = 1;

  const fadeIn = clip.fadeIn.length;
  if (fadeIn > 0 && offset < fadeIn) {
    gain *= fadeShape(clip.fadeIn.curve, (offset + 0.5) / fadeIn);
  }

  const fadeOut = clip.fadeOut.length;
  if (fadeOut > 0 && offset >= length - fadeOut) {
    const remain = length - offset; // 1 ~ fadeOut
    gain *= fadeShape(clip.fadeOut.curve, (remain - 0.5) / fadeOut);
  }

  return gain;
}

/**
 * 讓淡入淡出長度不超過片段長度（兩者總和 ≤ 片段長度）。
 * @param {object} clip
 * @returns {object} 新片段
 */
export function clampFades(clip) {
  const length = clipLength(clip);
  let fadeIn = Math.min(clip.fadeIn.length, length);
  let fadeOut = Math.min(clip.fadeOut.length, length);

  if (fadeIn + fadeOut > length) {
    // 依比例縮減
    const ratio = length / (fadeIn + fadeOut);
    fadeIn = Math.floor(fadeIn * ratio);
    fadeOut = Math.floor(fadeOut * ratio);
  }

  if (fadeIn === clip.fadeIn.length && fadeOut === clip.fadeOut.length) return clip;

  return {
    ...clip,
    fadeIn: { ...clip.fadeIn, length: fadeIn },
    fadeOut: { ...clip.fadeOut, length: fadeOut }
  };
}
