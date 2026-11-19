/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Engine / Import / Importer
 * --------------------------------------------------------------------------
 * 匯入管線：
 *
 *   檔案 ─► 格式檢查 ─► 探測（ffmpeg）─► 選擇音軌 ─► 解碼成 f32 PCM
 *                                 │
 *                                 └─ 無 ffmpeg 核心時：瀏覽器 decodeAudioData 後備
 *
 * 第一個匯入的檔案決定專案取樣率與聲道數（之後鎖定），
 * 後續檔案在解碼時直接轉成專案規格，因此時間軸上所有來源取樣點一致。
 *
 * 注意：瀏覽器後備解碼會重新取樣到專案取樣率，且部分格式（WMA、AMR、AC-3 等）
 *       在多數瀏覽器無法解碼，因此網站部署時會一併放入 ffmpeg 核心。
 * ========================================================================== */

import { createId } from '../../Domain/Model.js';
import { ENGINE_MISSING_TEXT } from '../FFmpeg/FFmpegClient.js';

/** 依副檔名分類，用於提示與檔案選擇器 */
export const FORMAT_GROUPS = Object.freeze({
  audio: [
    'mp3', 'aac', 'adts', 'm4a', 'm4b', 'wav', 'wave', 'flac', 'ogg', 'oga', 'opus', 'webm',
    'aiff', 'aif', 'aifc', 'wma', 'asf', 'amr', 'awb', 'ac3', 'eac3', 'ec3', 'dts', 'au', 'snd',
    'caf', 'mka', 'w64', 'rf64', 'tta', 'wv', 'ape', 'mpc', 'spx', 'ra', 'rm', 'voc', 'gsm',
    'mp2', 'mpa', 'oma', 'at3', 'brstm', 'bcstm', 'dsf', 'dff', 'thd', 'mlp'
  ],
  video: ['mp4', 'm4v', 'mkv', 'mov', 'avi', 'ts', 'mts', 'm2ts', 'flv', '3gp', '3g2', 'wmv', 'mpg', 'mpeg', 'vob', 'ogv'],
  special: ['mid', 'midi', 'mod', 'xm', 's3m', 'it', 'pcm', 'raw']
});

/** 檔案選擇器 accept 屬性 */
export const ACCEPT_ATTRIBUTE = [
  'audio/*', 'video/*',
  ...FORMAT_GROUPS.audio.map((e) => `.${e}`),
  ...FORMAT_GROUPS.video.map((e) => `.${e}`)
].join(',');

/** 取得小寫副檔名 */
export function extensionOf(name) {
  const m = /\.([^.]+)$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

/**
 * 解析 WAV 標頭以取得原始取樣率與聲道數（瀏覽器後備解碼時使用）。
 * @param {ArrayBuffer} buffer
 * @returns {{ sampleRate:number, channels:number } | null}
 */
function readWavHeader(buffer) {
  if (buffer.byteLength < 44) return null;
  const view = new DataView(buffer);
  const tag = (o) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      return { channels: view.getUint16(offset + 10, true), sampleRate: view.getUint32(offset + 12, true) };
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

export class Importer {
  /**
   * @param {object} deps
   * @param {import('../FFmpeg/FFmpegClient.js').FFmpegClient} deps.ffmpeg
   * @param {(info: object) => Promise<number>} deps.chooseStream 多音軌檔案時讓使用者選擇
   * @param {(message: string, level?: string) => void} deps.log
   */
  constructor({ ffmpeg, chooseStream, log }) {
    this.ffmpeg = ffmpeg;
    this.chooseStream = chooseStream;
    this.log = log;
  }

  /**
   * 匯入單一檔案。
   *
   * @param {File} file
   * @param {object} project 目前專案（用於取得取樣率規格）
   * @param {(ratio:number, stage:string)=>void} [onProgress]
   * @returns {Promise<{ meta: object, channels: Float32Array[], projectPatch: object|null }>}
   */
  async importFile(file, project, onProgress) {
    const ext = extensionOf(file.name);

    if (['mid', 'midi', 'mod', 'xm', 's3m', 'it'].includes(ext)) {
      throw new Error(`「${file.name}」屬於 MIDI／Tracker 格式，需要額外的合成器套件，目前版本尚未內建。`);
    }
    if (['pcm', 'raw'].includes(ext)) {
      throw new Error(`「${file.name}」是沒有標頭的原始 PCM，請先轉成 WAV 再匯入。`);
    }

    if (this.ffmpeg.available) {
      return this.importWithFFmpeg(file, project, onProgress);
    }
    return this.importWithBrowser(file, project, onProgress);
  }

  /* ------------------------------ ffmpeg 路線 ------------------------------ */

  async importWithFFmpeg(file, project, onProgress) {
    if (onProgress) onProgress(0, 'probe');
    const info = await this.ffmpeg.probe(file);

    // 多條音軌時詢問使用者
    let audioIndex = 0;
    if (info.audioStreams.length > 1) {
      audioIndex = await this.chooseStream({ fileName: file.name, streams: info.audioStreams });
    }
    const stream = info.audioStreams[audioIndex];

    // 決定解碼規格
    let projectPatch = null;
    let sampleRate = project.sampleRate;
    let channels = project.channelCount;
    if (!project.rateLocked) {
      sampleRate = stream.sampleRate || project.sampleRate;
      channels = Math.min(2, Math.max(1, stream.channels || 2));
      projectPatch = { sampleRate, channelCount: channels, rateLocked: true };
    }

    const decoded = await this.ffmpeg.decode(file, { audioIndex, sampleRate, channels }, onProgress);

    const meta = {
      id: createId('src'),
      fileName: file.name,
      length: decoded.length,
      sampleRate,
      channelCount: channels,
      decoder: 'ffmpeg',
      originalFormat: {
        container: info.format,
        codec: stream.codec,
        sampleRate: stream.sampleRate,
        channels: stream.channels,
        channelLayout: stream.channelLayout,
        bitrateKbps: stream.bitrateKbps || info.bitrateKbps,
        durationSeconds: info.durationSeconds,
        hasVideo: info.hasVideo,
        hasCover: info.hasCover,
        metadata: info.metadata,
        audioIndex
      }
    };

    return { meta, channels: decoded.channels, projectPatch };
  }

  /* ------------------------------ 瀏覽器後備路線 ------------------------------ */

  async importWithBrowser(file, project, onProgress) {
    if (onProgress) onProgress(0, 'read');
    const buffer = await file.arrayBuffer();
    const wav = readWavHeader(buffer);

    let projectPatch = null;
    let sampleRate = project.sampleRate;
    let channels = project.channelCount;
    if (!project.rateLocked) {
      sampleRate = wav ? wav.sampleRate : project.sampleRate;
      channels = wav ? Math.min(2, Math.max(1, wav.channels)) : 2;
      projectPatch = { sampleRate, channelCount: channels, rateLocked: true };
    }

    if (onProgress) onProgress(0.2, 'decode');
    let audioBuffer;
    try {
      const ctx = new OfflineAudioContext(channels, 1, sampleRate);
      audioBuffer = await ctx.decodeAudioData(buffer);
    } catch {
      throw new Error(`瀏覽器無法解碼「${file.name}」。${ENGINE_MISSING_TEXT}`);
    }

    // 聲道對應：不足時複製第 0 聲道，過多時取前面幾個聲道
    const out = [];
    for (let c = 0; c < channels; c += 1) {
      const srcIndex = c < audioBuffer.numberOfChannels ? c : 0;
      out.push(new Float32Array(audioBuffer.getChannelData(srcIndex)));
    }
    if (onProgress) onProgress(1, 'decode');

    const meta = {
      id: createId('src'),
      fileName: file.name,
      length: audioBuffer.length,
      sampleRate,
      channelCount: channels,
      decoder: 'browser',
      originalFormat: {
        container: extensionOf(file.name),
        codec: wav ? 'pcm' : '',
        sampleRate: wav ? wav.sampleRate : 0,
        channels: audioBuffer.numberOfChannels,
        channelLayout: '',
        bitrateKbps: 0,
        durationSeconds: audioBuffer.duration,
        hasVideo: false,
        hasCover: false,
        metadata: {},
        audioIndex: 0
      }
    };

    return { meta, channels: out, projectPatch };
  }
}
