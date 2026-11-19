/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Domain / TimeCode
 * --------------------------------------------------------------------------
 * 時間系統的唯一轉換點。
 *
 *   - 專案內部所有時間一律為「整數取樣點」(Samples)。
 *   - 毫秒、HH:MM:SS.mmm 只是顯示與輸入格式。
 *   - 毫秒 → 取樣點的取整只發生在本模組 (Math.round)。
 *
 * 純函式模組，不依賴任何瀏覽器 API，可直接用 Node.js 單元測試。
 * ========================================================================== */

/** 支援的顯示單位 */
export const TimeUnit = Object.freeze({
  Time: 'time',       // HH:MM:SS.mmm
  Milliseconds: 'ms', // 總毫秒
  Samples: 'samples'  // 取樣點
});

/* --------------------------------------------------------------------------
 * 基本換算
 * ------------------------------------------------------------------------ */

/**
 * 毫秒轉取樣點（唯一取整位置）。
 * @param {number} ms
 * @param {number} sampleRate
 * @returns {number} 整數取樣點
 */
export function msToSamples(ms, sampleRate) {
  return Math.round((ms * sampleRate) / 1000);
}

/**
 * 秒轉取樣點。
 * @param {number} seconds
 * @param {number} sampleRate
 */
export function secondsToSamples(seconds, sampleRate) {
  return Math.round(seconds * sampleRate);
}

/**
 * 取樣點轉毫秒（浮點，不取整）。
 * @param {number} samples
 * @param {number} sampleRate
 */
export function samplesToMs(samples, sampleRate) {
  return (samples * 1000) / sampleRate;
}

/**
 * 取樣點轉秒（浮點）。
 * @param {number} samples
 * @param {number} sampleRate
 */
export function samplesToSeconds(samples, sampleRate) {
  return samples / sampleRate;
}

/* --------------------------------------------------------------------------
 * 格式化
 * ------------------------------------------------------------------------ */

/**
 * 依顯示單位格式化取樣點。
 * @param {number} samples
 * @param {number} sampleRate
 * @param {string} [unit=TimeUnit.Time]
 * @returns {string}
 */
export function formatTime(samples, sampleRate, unit = TimeUnit.Time) {
  const negative = samples < 0;
  const abs = Math.abs(samples);
  const sign = negative ? '-' : '';

  if (unit === TimeUnit.Samples) {
    return `${sign}${abs}`;
  }

  // 先轉成整數毫秒，避免 59.9996 秒顯示成 00:00:60.000
  const totalMs = Math.round(samplesToMs(abs, sampleRate));

  if (unit === TimeUnit.Milliseconds) {
    return `${sign}${totalMs}`;
  }

  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;

  return (
    sign +
    String(hours).padStart(2, '0') + ':' +
    String(minutes).padStart(2, '0') + ':' +
    String(seconds).padStart(2, '0') + '.' +
    String(millis).padStart(3, '0')
  );
}

/**
 * 時間尺用的精簡格式（依刻度大小決定小數位數）。
 * @param {number} samples
 * @param {number} sampleRate
 * @param {number} stepSamples 刻度間距
 */
export function formatRulerLabel(samples, sampleRate, stepSamples) {
  const seconds = samples / sampleRate;
  const stepSeconds = stepSamples / sampleRate;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;

  let decimals = 0;
  if (stepSeconds < 0.01) decimals = 3;
  else if (stepSeconds < 0.1) decimals = 2;
  else if (stepSeconds < 1) decimals = 1;

  const secText = rest.toFixed(decimals).padStart(decimals ? 3 + decimals : 2, '0');
  return `${minutes}:${secText}`;
}

/* --------------------------------------------------------------------------
 * 解析
 * ------------------------------------------------------------------------ */

/**
 * 解析使用者輸入的時間字串。
 *
 * 支援：
 *   "01:23.456"          分:秒.毫秒
 *   "00:01:23.456"       時:分:秒.毫秒
 *   "83.456s"            秒
 *   "83456ms"            毫秒
 *   "4005888smp"         取樣點
 *   "83456"              純數字 → 依 defaultUnit 解讀
 *   "+250ms" / "-1.5s"   相對值（relative = true）
 *
 * @param {string} text
 * @param {number} sampleRate
 * @param {string} [defaultUnit=TimeUnit.Time]
 * @returns {{ samples: number, relative: boolean } | null} 無法解析時回傳 null
 */
export function parseTime(text, sampleRate, defaultUnit = TimeUnit.Time) {
  if (typeof text !== 'string') return null;

  let src = text.trim().replace(/，/g, ',').replace(/：/g, ':').replace(/\s+/g, '');
  if (!src) return null;

  // 相對值判斷：開頭為 + 視為相對；開頭為 - 且帶單位時也視為相對
  let relative = false;
  let sign = 1;
  if (src.startsWith('+')) {
    relative = true;
    src = src.slice(1);
  } else if (src.startsWith('-')) {
    relative = true;
    sign = -1;
    src = src.slice(1);
  }

  let samples = null;
  let match;

  if ((match = /^(\d+(?:\.\d+)?)smp$/i.exec(src))) {
    samples = Math.round(Number(match[1]));
  } else if ((match = /^(\d+(?:\.\d+)?)ms$/i.exec(src))) {
    samples = msToSamples(Number(match[1]), sampleRate);
  } else if ((match = /^(\d+(?:\.\d+)?)s$/i.exec(src))) {
    samples = msToSamples(Number(match[1]) * 1000, sampleRate);
  } else if ((match = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(src))) {
    const ms = (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000;
    samples = msToSamples(ms, sampleRate);
  } else if ((match = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(src))) {
    const ms = (Number(match[1]) * 60 + Number(match[2])) * 1000;
    samples = msToSamples(ms, sampleRate);
  } else if ((match = /^(\d+(?:\.\d+)?)$/.exec(src))) {
    const value = Number(match[1]);
    if (defaultUnit === TimeUnit.Samples) samples = Math.round(value);
    else if (defaultUnit === TimeUnit.Milliseconds) samples = msToSamples(value, sampleRate);
    else samples = msToSamples(value * 1000, sampleRate); // Time 模式下純數字視為秒
  }

  if (samples === null || !Number.isFinite(samples)) return null;

  // 未帶 + 的負號在絕對時間沒有意義，一律視為相對
  return { samples: sign * samples, relative };
}

/**
 * 依刻度大小選出合適的時間尺間距（取樣點）。
 * @param {number} samplesPerPixel
 * @param {number} sampleRate
 * @param {number} [minPixels=90] 兩個主刻度之間的最小像素
 */
export function chooseRulerStep(samplesPerPixel, sampleRate, minPixels = 90) {
  const candidatesMs = [
    1, 2, 5, 10, 20, 50, 100, 200, 500,
    1000, 2000, 5000, 10000, 15000, 30000,
    60000, 120000, 300000, 600000, 1800000, 3600000
  ];
  const minSamples = samplesPerPixel * minPixels;
  for (const ms of candidatesMs) {
    const step = msToSamples(ms, sampleRate);
    if (step >= minSamples) return Math.max(1, step);
  }
  return msToSamples(3600000, sampleRate);
}
