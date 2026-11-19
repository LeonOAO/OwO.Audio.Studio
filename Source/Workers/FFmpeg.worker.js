/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Workers / FFmpeg.worker.js（Classic Worker）
 * --------------------------------------------------------------------------
 * 直接驅動 @ffmpeg/core 的 UMD 版本（ffmpeg-core.js / .wasm），
 * 不依賴 @ffmpeg/ffmpeg 包裝層，也不需要任何建置工具。
 * 核心檔案由 GitHub Actions 部署時自動下載到 Engine/ST 與 Engine/MT。
 *
 * 訊息協定（主執行緒 → Worker）：
 *   { type:'load',    jobId, coreURL, wasmURL, workerURL }
 *   { type:'probe',   jobId, file }
 *   { type:'decode',  jobId, file, audioIndex, sampleRate, channels }
 *   { type:'encode',  jobId, pcm, sampleRate, channels, args, outName, cover }
 *   { type:'fastcut', jobId, file, audioIndex, start, end, outName }
 *
 * 回應（Worker → 主執行緒）：
 *   { type:'progress', jobId, ratio, stage }
 *   { type:'done',     jobId, result }
 *   { type:'error',    jobId, message, logTail }
 *
 * 注意：ffmpeg.exec 為同步執行，執行期間無法中途取消；
 *       取消由主執行緒直接 terminate() 本 Worker 後重新載入。
 * ========================================================================== */

/* global createFFmpegCore, FileReaderSync */

let core = null;      // ffmpeg core 實例
let logLines = [];    // 目前工作的 ffmpeg 輸出
let currentJob = null;

/* --------------------------------------------------------------------------
 * 訊息進入點
 * ------------------------------------------------------------------------ */

self.onmessage = async (event) => {
  const msg = event.data;
  currentJob = msg.jobId;
  logLines = [];

  try {
    let result;
    switch (msg.type) {
      case 'load':
        result = await load(msg);
        break;
      case 'probe':
        result = probe(msg);
        break;
      case 'decode':
        result = decode(msg);
        break;
      case 'encode':
        result = encode(msg);
        break;
      case 'fastcut':
        result = fastCut(msg);
        break;
      default:
        throw new Error(`未知的工作類型：${msg.type}`);
    }
    const transfer = collectTransfer(result);
    self.postMessage({ type: 'done', jobId: msg.jobId, result }, transfer);
  } catch (error) {
    self.postMessage({
      type: 'error',
      jobId: msg.jobId,
      message: error && error.message ? error.message : String(error),
      logTail: logLines.slice(-25).join('\n')
    });
  }
};

/** 找出結果中可轉移的 ArrayBuffer，避免大型資料被複製 */
function collectTransfer(result) {
  const list = [];
  if (!result) return list;
  if (result.channels) for (const ch of result.channels) list.push(ch.buffer);
  if (result.data && result.data.buffer) list.push(result.data.buffer);
  return list;
}

/** 回報進度 */
function progress(ratio, stage) {
  self.postMessage({ type: 'progress', jobId: currentJob, ratio, stage });
}

/* --------------------------------------------------------------------------
 * 載入核心
 * ------------------------------------------------------------------------ */

async function load({ coreURL, wasmURL, workerURL }) {
  if (core) return { reused: true };

  importScripts(coreURL); // UMD 版本會在全域定義 createFFmpegCore
  if (typeof createFFmpegCore !== 'function') {
    throw new Error('ffmpeg-core.js 未定義 createFFmpegCore，核心檔案可能不完整。');
  }

  // 與官方 @ffmpeg/ffmpeg 相同的載入方式：以 hash 傳遞 wasm 與 worker 路徑
  const hash = btoa(JSON.stringify({ wasmURL, workerURL }));
  core = await createFFmpegCore({ mainScriptUrlOrBlob: `${coreURL}#${hash}` });

  core.setLogger(({ message }) => {
    logLines.push(message);
    if (logLines.length > 4000) logLines.splice(0, 2000);
  });
  core.setProgress(({ progress: ratio }) => {
    if (Number.isFinite(ratio) && ratio >= 0 && ratio <= 1) progress(ratio, 'ffmpeg');
  });

  return { reused: false };
}

/** 執行 ffmpeg 指令並回傳結束代碼 */
function run(args) {
  if (!core) throw new Error('ffmpeg 核心尚未載入。');
  if (typeof core.setTimeout === 'function') core.setTimeout(-1);
  core.exec(...args.map(String));
  const ret = core.ret;
  core.reset();
  return ret;
}

/* --------------------------------------------------------------------------
 * 檔案系統工具
 * ------------------------------------------------------------------------ */

/** 取得安全的副檔名 */
function safeExt(name) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name || '');
  return m ? `.${m[1].toLowerCase()}` : '';
}

/**
 * 將使用者檔案掛載到虛擬檔案系統。
 * 優先使用 WORKERFS（不複製整個檔案到記憶體），失敗時改為寫入 MEMFS。
 * @returns {{ path: string, cleanup: () => void }}
 */
function mountInput(file) {
  const dir = `/in_${currentJob}`;
  const name = `input${safeExt(file.name)}`;
  core.FS.mkdir(dir);

  try {
    const renamed = new File([file], name, { type: file.type });
    core.FS.mount(core.FS.filesystems.WORKERFS, { files: [renamed] }, dir);
    return {
      path: `${dir}/${name}`,
      cleanup: () => {
        try { core.FS.unmount(dir); } catch { /* 已卸載 */ }
        try { core.FS.rmdir(dir); } catch { /* 已刪除 */ }
      }
    };
  } catch {
    const buffer = new FileReaderSync().readAsArrayBuffer(file);
    core.FS.writeFile(`${dir}/${name}`, new Uint8Array(buffer));
    return {
      path: `${dir}/${name}`,
      cleanup: () => {
        try { core.FS.unlink(`${dir}/${name}`); } catch { /* 已刪除 */ }
        try { core.FS.rmdir(dir); } catch { /* 已刪除 */ }
      }
    };
  }
}

/** 安全刪除虛擬檔案 */
function removeFile(path) {
  try { core.FS.unlink(path); } catch { /* 不存在 */ }
}

/* --------------------------------------------------------------------------
 * 探測（解析 ffmpeg -i 的輸出）
 * ------------------------------------------------------------------------ */

/** 聲道配置字串轉聲道數 */
function layoutToChannels(layout) {
  const text = (layout || '').trim();
  const table = {
    mono: 1, stereo: 2, '2.1': 3, '3.0': 3, quad: 4, '4.0': 4, '4.1': 5,
    '5.0': 5, '5.1': 6, '6.0': 6, '6.1': 7, '7.0': 7, '7.1': 8, hexagonal: 6, octagonal: 8
  };
  const base = text.replace(/\(.*\)$/, '');
  if (table[base]) return table[base];
  const m = /(\d+)\s*channels?/.exec(text);
  return m ? Number(m[1]) : 2;
}

/** 解析 ffmpeg 資訊輸出 */
function parseProbe(lines) {
  const info = {
    format: '',
    durationSeconds: 0,
    bitrateKbps: 0,
    audioStreams: [],
    hasVideo: false,
    hasCover: false,
    metadata: {}
  };
  let inGlobalMeta = false;

  for (const line of lines) {
    let m;
    if ((m = /^Input #0, (.+?), from/.exec(line))) {
      info.format = m[1];
      continue;
    }
    if (/^\s{2}Metadata:/.test(line)) {
      inGlobalMeta = true;
      continue;
    }
    if (inGlobalMeta) {
      const mm = /^\s{4}([A-Za-z0-9_\-]+)\s*:\s?(.*)$/.exec(line);
      if (mm && !/^\s{6}/.test(line)) {
        const key = mm[1].toLowerCase();
        if (!(key in info.metadata)) info.metadata[key] = mm[2];
        continue;
      }
      inGlobalMeta = false;
    }
    if ((m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line))) {
      info.durationSeconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      const br = /bitrate:\s*(\d+)\s*kb\/s/.exec(line);
      if (br) info.bitrateKbps = Number(br[1]);
      continue;
    }
    if ((m = /Stream #0:(\d+)[^:]*:\s*Audio:\s*(.+)$/.exec(line))) {
      const parts = m[2].split(',').map((s) => s.trim());
      const codec = parts[0] || '';
      const rateText = parts.find((p) => /\d+\s*Hz/.test(p)) || '';
      const rateIndex = parts.indexOf(rateText);
      const layout = rateIndex >= 0 ? parts[rateIndex + 1] || '' : '';
      const brText = parts.find((p) => /kb\/s/.test(p)) || '';
      info.audioStreams.push({
        streamIndex: Number(m[1]),
        audioIndex: info.audioStreams.length,
        codec,
        sampleRate: Number((/(\d+)\s*Hz/.exec(rateText) || [0, 0])[1]),
        channelLayout: layout,
        channels: layoutToChannels(layout),
        bitrateKbps: Number((/(\d+)\s*kb\/s/.exec(brText) || [0, 0])[1]),
        language: (/Stream #0:\d+(?:\[[^\]]*\])?\(([^)]+)\)/.exec(line) || [])[1] || ''
      });
      continue;
    }
    if (/Stream #0:\d+.*Video:/.test(line)) {
      if (/attached pic/.test(line)) info.hasCover = true;
      else info.hasVideo = true;
    }
  }
  return info;
}

function probe({ file }) {
  const input = mountInput(file);
  try {
    run(['-hide_banner', '-nostdin', '-i', input.path]); // 沒有輸出檔，回傳非 0 屬正常
  } finally {
    input.cleanup();
  }
  const info = parseProbe(logLines);
  if (!info.audioStreams.length) {
    throw new Error('檔案中找不到可用的音軌，或格式不受目前 ffmpeg 核心支援。');
  }
  return info;
}

/* --------------------------------------------------------------------------
 * 解碼：輸出指定取樣率的 32-bit float PCM
 * ------------------------------------------------------------------------ */

function decode({ file, audioIndex = 0, sampleRate, channels }) {
  const input = mountInput(file);
  const out = `/decoded_${currentJob}.pcm`;
  let ret;
  try {
    progress(0, 'decode');
    ret = run([
      '-hide_banner', '-nostdin',
      '-i', input.path,
      '-map', `0:a:${audioIndex}`,
      '-vn', '-sn', '-dn',
      '-ac', channels,
      '-ar', sampleRate,
      '-acodec', 'pcm_f32le',
      '-f', 'f32le',
      '-y', out
    ]);
  } finally {
    input.cleanup();
  }
  if (ret !== 0) {
    removeFile(out);
    throw new Error(`解碼失敗（ffmpeg 結束代碼 ${ret}）。`);
  }

  const bytes = core.FS.readFile(out);
  removeFile(out);

  // 對齊檢查：位移非 4 的倍數時先複製
  const aligned = bytes.byteOffset % 4 === 0 ? bytes : bytes.slice();
  const data = new Float32Array(aligned.buffer, aligned.byteOffset, Math.floor(aligned.byteLength / 4));

  // 拆成每聲道獨立陣列
  const frames = Math.floor(data.length / channels);
  const result = [];
  for (let c = 0; c < channels; c += 1) result.push(new Float32Array(frames));
  let k = 0;
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channels; c += 1) result[c][i] = data[k++];
  }

  progress(1, 'decode');
  return { channels: result, length: frames, sampleRate, channelCount: channels };
}

/* --------------------------------------------------------------------------
 * 編碼：接收交錯 PCM，依預設參數輸出目標格式
 * ------------------------------------------------------------------------ */

function encode({ pcm, sampleRate, channels, args, outName, cover }) {
  const input = `/mix_${currentJob}.pcm`;
  const output = `/${outName}`;
  const coverPath = cover ? `/cover_${currentJob}${safeExt(cover.name) || '.jpg'}` : null;

  core.FS.writeFile(input, new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  if (cover) core.FS.writeFile(coverPath, cover.data);

  const command = [
    '-hide_banner', '-nostdin',
    '-f', 'f32le', '-ar', sampleRate, '-ac', channels, '-i', input
  ];
  if (cover) command.push('-i', coverPath);
  command.push(...args, '-y', output);

  let ret;
  try {
    progress(0, 'encode');
    ret = run(command);
  } finally {
    removeFile(input);
    if (coverPath) removeFile(coverPath);
  }
  if (ret !== 0) {
    removeFile(output);
    throw new Error(`編碼失敗（ffmpeg 結束代碼 ${ret}），可能是目前核心未包含此編碼器。`);
  }

  const data = core.FS.readFile(output);

  // 驗證：重新探測輸出檔
  logLines = [];
  run(['-hide_banner', '-nostdin', '-i', output]);
  const check = parseProbe(logLines);
  removeFile(output);

  progress(1, 'encode');
  return { data: data.slice(), check };
}

/* --------------------------------------------------------------------------
 * 快速裁切：不重新編碼，直接複製封包（位置會對齊壓縮框架）
 * ------------------------------------------------------------------------ */

function fastCut({ file, audioIndex = 0, start, end, outName }) {
  const input = mountInput(file);
  const output = `/${outName}`;
  let ret;
  try {
    progress(0, 'fastcut');
    ret = run([
      '-hide_banner', '-nostdin',
      '-i', input.path,
      '-ss', start.toFixed(6),
      '-to', end.toFixed(6),
      '-map', `0:a:${audioIndex}`,
      '-map_metadata', '0',
      '-c', 'copy',
      '-y', output
    ]);
  } finally {
    input.cleanup();
  }
  if (ret !== 0) {
    removeFile(output);
    throw new Error(`快速裁切失敗（ffmpeg 結束代碼 ${ret}）。`);
  }
  const data = core.FS.readFile(output);
  logLines = [];
  run(['-hide_banner', '-nostdin', '-i', output]);
  const check = parseProbe(logLines);
  removeFile(output);
  progress(1, 'fastcut');
  return { data: data.slice(), check };
}
