/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Engine / Export / WavEncoder
 * --------------------------------------------------------------------------
 * 內建 WAV 編碼器（不需要 ffmpeg 核心）。
 *
 *   16-bit PCM：加入 TPDF 抖動後量化，降低量化失真
 *   24-bit PCM
 *   32-bit Float（WAVE_FORMAT_IEEE_FLOAT，含 fact chunk）
 *
 * 輸入為交錯的 Float32Array。
 * ========================================================================== */

/**
 * 編碼 WAV。
 * @param {Float32Array} interleaved
 * @param {number} sampleRate
 * @param {number} channels
 * @param {16|24|32} bitDepth 32 表示 32-bit float
 * @returns {Uint8Array}
 */
export function encodeWav(interleaved, sampleRate, channels, bitDepth = 24) {
  const isFloat = bitDepth === 32;
  const bytesPerSample = bitDepth / 8;
  const frames = Math.floor(interleaved.length / channels);
  const dataSize = frames * channels * bytesPerSample;
  const fmtSize = isFloat ? 18 : 16;
  const factSize = isFloat ? 12 : 0;
  const headerSize = 12 + (8 + fmtSize) + factSize + 8;

  if (headerSize + dataSize > 0xffffffff) {
    throw new Error('輸出超過 WAV 4 GB 上限，請改用 FLAC 或縮短範圍。');
  }

  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);
  let o = 0;
  const writeTag = (text) => {
    for (let i = 0; i < 4; i += 1) view.setUint8(o + i, text.charCodeAt(i));
    o += 4;
  };

  // RIFF 標頭
  writeTag('RIFF');
  view.setUint32(o, headerSize + dataSize - 8, true); o += 4;
  writeTag('WAVE');

  // fmt chunk
  writeTag('fmt ');
  view.setUint32(o, fmtSize, true); o += 4;
  view.setUint16(o, isFloat ? 3 : 1, true); o += 2;            // 3 = IEEE float, 1 = PCM
  view.setUint16(o, channels, true); o += 2;
  view.setUint32(o, sampleRate, true); o += 4;
  view.setUint32(o, sampleRate * channels * bytesPerSample, true); o += 4;
  view.setUint16(o, channels * bytesPerSample, true); o += 2;
  view.setUint16(o, bitDepth, true); o += 2;
  if (isFloat) { view.setUint16(o, 0, true); o += 2; }           // cbSize

  // fact chunk（非 PCM 格式必要）
  if (isFloat) {
    writeTag('fact');
    view.setUint32(o, 4, true); o += 4;
    view.setUint32(o, frames, true); o += 4;
  }

  // data chunk
  writeTag('data');
  view.setUint32(o, dataSize, true); o += 4;

  const total = frames * channels;
  if (isFloat) {
    for (let i = 0; i < total; i += 1, o += 4) view.setFloat32(o, interleaved[i], true);
  } else if (bitDepth === 16) {
    for (let i = 0; i < total; i += 1, o += 2) {
      // TPDF 抖動：兩個均勻分布亂數相減，幅度 ±1 LSB
      const dither = (Math.random() - Math.random()) / 32768;
      const v = Math.max(-1, Math.min(1, interleaved[i] + dither));
      view.setInt16(o, v < 0 ? Math.round(v * 32768) : Math.round(v * 32767), true);
    }
  } else {
    for (let i = 0; i < total; i += 1, o += 3) {
      const v = Math.max(-1, Math.min(1, interleaved[i]));
      let int = v < 0 ? Math.round(v * 8388608) : Math.round(v * 8388607);
      if (int < 0) int += 0x1000000;
      view.setUint8(o, int & 0xff);
      view.setUint8(o + 1, (int >> 8) & 0xff);
      view.setUint8(o + 2, (int >> 16) & 0xff);
    }
  }

  return new Uint8Array(buffer);
}
