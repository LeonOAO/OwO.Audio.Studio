/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Engine / Export / Exporter
 * --------------------------------------------------------------------------
 * 匯出管線：
 *
 *   精確模式（預設）
 *     共用混音核心離線渲染 ─► 交錯 f32 PCM ─► 內建 WAV 或 ffmpeg 編碼 ─► 驗證
 *
 *   分軌模式
 *     每條有片段的音軌各渲染一次 ─► 分別編碼 ─► 打包 ZIP
 *
 *   快速裁切（不重新編碼）
 *     直接以 ffmpeg -c copy 截取原始檔；位置會對齊壓縮框架，不保證毫秒精準
 * ========================================================================== */

import { renderRangeInterleaved } from '../Render/Mixer.js';
import { encodeWav } from './WavEncoder.js';
import { createZip } from './Zip.js';
import { getPreset, buildArgs } from './Presets.js';
import { extensionOf } from '../Import/Importer.js';

/** MIME 對照 */
const MIME = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', webm: 'audio/webm', aiff: 'audio/aiff',
  ac3: 'audio/ac3', wma: 'audio/x-ms-wma', mka: 'audio/x-matroska', caf: 'audio/x-caf'
};

/** 移除檔名中不合法字元 */
export function sanitizeFileName(name) {
  return (name || '未命名').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || '未命名';
}

/**
 * 執行匯出。
 *
 * @param {object} params
 * @param {object} params.project
 * @param {object} params.bank
 * @param {import('../FFmpeg/FFmpegClient.js').FFmpegClient} params.ffmpeg
 * @param {object} params.request
 *   { mode: 'mix'|'stems'|'fastcut', formatId, options, common, metadata, cover: File|null,
 *     range: { start, end }, baseName, fastCutSource: { file, audioIndex } }
 * @param {(ratio:number, label:string)=>void} params.onProgress
 * @param {(message:string, level?:string)=>void} params.log
 * @returns {Promise<{ name: string, blob: Blob }>}
 */
export async function runExport({ project, bank, ffmpeg, request, onProgress, log }) {
  const { mode, range, baseName } = request;
  const base = sanitizeFileName(baseName);

  if (mode === 'fastcut') {
    return fastCut({ project, ffmpeg, request, base, onProgress, log });
  }

  const preset = getPreset(request.formatId);
  const useBuiltinWav = preset.id === 'wav'
    && request.common.sampleRate === 'source'
    && request.common.channels === 'source';

  if (!useBuiltinWav && preset.engine !== false && !ffmpeg.available) {
    throw new Error(`輸出 ${preset.label} 需要 ffmpeg 核心，請先執行 FetchEngine 下載；或改用 WAV 輸出。`);
  }
  if (!useBuiltinWav && !ffmpeg.available) {
    throw new Error('變更取樣率或聲道需要 ffmpeg 核心；請將取樣率與聲道設為「跟隨專案」。');
  }

  // 封面圖讀入一次，所有輸出共用
  let cover = null;
  if (request.cover && preset.cover && ffmpeg.available) {
    cover = { name: request.cover.name, data: new Uint8Array(await request.cover.arrayBuffer()) };
  }

  // 決定要輸出的項目
  const jobs = [];
  if (mode === 'stems') {
    for (const track of project.tracks) {
      if (!track.clips.length) continue;
      jobs.push({ name: `${base}_${sanitizeFileName(track.name)}.${preset.ext}`, trackIds: [track.id] });
    }
    if (!jobs.length) throw new Error('沒有任何含片段的音軌可輸出。');
  } else {
    jobs.push({ name: `${base}.${preset.ext}`, trackIds: null });
  }

  const results = [];
  for (let i = 0; i < jobs.length; i += 1) {
    const job = jobs[i];
    const slice = 1 / jobs.length;
    const baseRatio = i * slice;
    const report = (r, label) => onProgress(baseRatio + r * slice, label);

    // 1. 離線渲染
    const pcm = await renderRangeInterleaved(project, bank, range.start, range.end, {
      trackIds: job.trackIds,
      onProgress: (r) => report(r * 0.5, `渲染 ${job.name}`)
    });

    // 2. 編碼
    let data;
    if (useBuiltinWav) {
      report(0.6, `編碼 ${job.name}`);
      data = encodeWav(pcm, project.sampleRate, project.channelCount, Number(request.options.bitDepth));
      log(`內建 WAV 編碼完成：${job.name}`);
    } else {
      const args = buildArgs(preset, request.options, request.common, request.metadata, Boolean(cover));
      const outName = `out_${i}.${preset.ext}`;
      const result = await ffmpeg.encode(
        {
          pcm,
          sampleRate: project.sampleRate,
          channels: project.channelCount,
          args,
          outName,
          cover: cover ? { name: cover.name, data: cover.data.slice() } : null
        },
        (r) => report(0.5 + r * 0.5, `編碼 ${job.name}`)
      );
      data = result.data;

      // 3. 驗證輸出長度
      const expected = (range.end - range.start) / project.sampleRate;
      const actual = result.check.durationSeconds;
      const diffMs = Math.abs(actual - expected) * 1000;
      log(`驗證 ${job.name}：預期 ${expected.toFixed(3)} 秒，實際 ${actual.toFixed(3)} 秒，差異 ${diffMs.toFixed(1)} ms`,
        diffMs > 60 ? 'warn' : 'info');
    }

    results.push({ name: job.name, data });
  }

  onProgress(1, '完成');

  if (results.length === 1) {
    return { name: results[0].name, blob: new Blob([results[0].data], { type: MIME[preset.ext] || 'application/octet-stream' }) };
  }
  return { name: `${base}_分軌.zip`, blob: createZip(results) };
}

/** 快速裁切原始檔（不重新編碼） */
async function fastCut({ project, ffmpeg, request, base, onProgress, log }) {
  if (!ffmpeg.available) throw new Error('快速裁切需要 ffmpeg 核心。');
  const src = request.fastCutSource;
  if (!src || !src.file) throw new Error('找不到原始檔案；快速裁切只能用於本次工作階段中匯入的檔案。');

  const ext = extensionOf(src.file.name) || 'bin';
  const start = request.range.start / project.sampleRate;
  const end = request.range.end / project.sampleRate;
  const result = await ffmpeg.fastCut(
    { file: src.file, audioIndex: src.audioIndex || 0, start, end, outName: `cut.${ext}` },
    (r) => onProgress(r, '快速裁切')
  );

  const expected = end - start;
  const diffMs = Math.abs(result.check.durationSeconds - expected) * 1000;
  log(`快速裁切完成：預期 ${expected.toFixed(3)} 秒，實際 ${result.check.durationSeconds.toFixed(3)} 秒，差異 ${diffMs.toFixed(1)} ms（未重新編碼，起訖點對齊壓縮框架）`,
    diffMs > 60 ? 'warn' : 'info');

  onProgress(1, '完成');
  return { name: `${base}.${ext}`, blob: new Blob([result.data], { type: MIME[ext] || 'application/octet-stream' }) };
}

/**
 * 儲存檔案：優先使用 File System Access API，否則以下載方式儲存。
 * @param {string} name
 * @param {Blob} blob
 * @returns {Promise<boolean>} 使用者取消時回傳 false
 */
export async function saveBlob(name, blob) {
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const ext = extensionOf(name);
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: ext ? [{ description: ext.toUpperCase(), accept: { [blob.type || 'application/octet-stream']: [`.${ext}`] } }] : undefined
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (error) {
      if (error && error.name === 'AbortError') return false;
      // 其他錯誤（例如型別不被接受）改用下載方式
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}
