/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Engine / Export / Presets
 * --------------------------------------------------------------------------
 * 匯出格式定義。每個格式包含：
 *
 *   id / label / ext   識別、顯示名稱、副檔名
 *   group              介面分組：common 常用｜pro 專業相容｜special 特殊
 *   engine             是否需要 ffmpeg 核心（false = 可用內建編碼器）
 *   cover              是否支援內嵌封面
 *   fixedRate          強制取樣率（例如 Opus 固定 48 kHz）
 *   options            動態選項（介面依此自動產生），showIf 控制顯示條件
 *   args(options)      產生 ffmpeg 輸出參數（不含輸入與輸出檔名）
 *
 * Codec 與容器的對應在此固定，不讓使用者任意組合，避免產生無法播放的檔案。
 * ========================================================================== */

/** 產生位元率選項 */
const kbps = (list) => list.map((v) => [v, `${v} kbps`]);

/** 共用：取樣率選項 */
export const SAMPLE_RATE_CHOICES = [
  ['source', '跟隨專案'],
  [8000, '8,000 Hz'],
  [16000, '16,000 Hz'],
  [22050, '22,050 Hz'],
  [32000, '32,000 Hz'],
  [44100, '44,100 Hz'],
  [48000, '48,000 Hz'],
  [88200, '88,200 Hz'],
  [96000, '96,000 Hz'],
  [192000, '192,000 Hz']
];

/** 共用：聲道選項 */
export const CHANNEL_CHOICES = [
  ['source', '跟隨專案'],
  [1, '單聲道'],
  [2, '立體聲']
];

export const PRESETS = [
  /* ------------------------------ 常用 ------------------------------ */
  {
    id: 'mp3',
    label: 'MP3',
    ext: 'mp3',
    group: 'common',
    engine: true,
    cover: true,
    options: [
      { key: 'mode', label: '位元率模式', choices: [['cbr', 'CBR 固定位元率'], ['vbr', 'VBR 可變位元率']], default: 'cbr' },
      { key: 'bitrate', label: '位元率', choices: kbps([64, 96, 128, 160, 192, 224, 256, 320]), default: 320, showIf: { mode: 'cbr' } },
      {
        key: 'quality', label: 'VBR 品質',
        choices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((q) => [q, `V${q}${q === 0 ? '（最佳）' : q === 2 ? '（標準）' : ''}`]),
        default: 0, showIf: { mode: 'vbr' }
      },
      { key: 'id3', label: 'ID3 版本', choices: [[3, 'ID3v2.3（相容性最佳）'], [4, 'ID3v2.4']], default: 3 }
    ],
    args: (o) => [
      '-c:a', 'libmp3lame',
      ...(o.mode === 'vbr' ? ['-q:a', o.quality] : ['-b:a', `${o.bitrate}k`]),
      '-id3v2_version', o.id3,
      '-write_xing', '1'
    ]
  },
  {
    id: 'm4a',
    label: 'M4A（AAC）',
    ext: 'm4a',
    group: 'common',
    engine: true,
    cover: true,
    options: [
      { key: 'bitrate', label: '位元率', choices: kbps([96, 128, 160, 192, 256, 320]), default: 256 }
    ],
    args: (o) => ['-c:a', 'aac', '-b:a', `${o.bitrate}k`, '-movflags', '+faststart', '-f', 'mp4']
  },
  {
    id: 'wav',
    label: 'WAV',
    ext: 'wav',
    group: 'common',
    engine: false,
    cover: false,
    options: [
      { key: 'bitDepth', label: '取樣格式', choices: [[16, '16-bit PCM（含抖動）'], [24, '24-bit PCM'], [32, '32-bit Float']], default: 24 }
    ],
    args: (o) => [
      '-c:a', o.bitDepth === 16 ? 'pcm_s16le' : o.bitDepth === 24 ? 'pcm_s24le' : 'pcm_f32le',
      ...(o.bitDepth === 16 ? ['-af', 'aresample=dither_method=triangular'] : []),
      '-f', 'wav'
    ]
  },
  {
    id: 'flac',
    label: 'FLAC',
    ext: 'flac',
    group: 'common',
    engine: true,
    cover: true,
    options: [
      { key: 'bitDepth', label: '位元深度', choices: [[16, '16-bit'], [24, '24-bit']], default: 24 },
      { key: 'level', label: '壓縮等級', choices: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((l) => [l, `${l}${l === 5 ? '（預設）' : l === 8 ? '（最小檔案）' : ''}`]), default: 5 }
    ],
    args: (o) => [
      '-c:a', 'flac',
      '-compression_level', o.level,
      ...(o.bitDepth === 16 ? ['-sample_fmt', 's16'] : ['-sample_fmt', 's32', '-bits_per_raw_sample', '24'])
    ]
  },
  {
    id: 'ogg',
    label: 'OGG Vorbis',
    ext: 'ogg',
    group: 'common',
    engine: true,
    cover: false,
    options: [
      { key: 'quality', label: '品質等級', choices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((q) => [q, `Q${q}`]), default: 6 }
    ],
    args: (o) => ['-c:a', 'libvorbis', '-q:a', o.quality, '-f', 'ogg']
  },
  {
    id: 'opus',
    label: 'Opus',
    ext: 'opus',
    group: 'common',
    engine: true,
    cover: false,
    fixedRate: 48000,
    options: [
      { key: 'bitrate', label: '位元率', choices: kbps([32, 64, 96, 128, 160, 192, 256, 320, 510]), default: 160 },
      { key: 'vbr', label: '位元率控制', choices: [['on', 'VBR'], ['constrained', 'Constrained VBR'], ['off', 'CBR']], default: 'on' },
      { key: 'application', label: '用途', choices: [['audio', '音樂'], ['voip', '語音'], ['lowdelay', '低延遲']], default: 'audio' }
    ],
    args: (o) => ['-c:a', 'libopus', '-b:a', `${o.bitrate}k`, '-vbr', o.vbr, '-application', o.application, '-f', 'ogg']
  },

  /* ------------------------------ 專業／相容 ------------------------------ */
  {
    id: 'aac',
    label: 'AAC（ADTS 裸流）',
    ext: 'aac',
    group: 'pro',
    engine: true,
    cover: false,
    options: [
      { key: 'bitrate', label: '位元率', choices: kbps([96, 128, 160, 192, 256, 320]), default: 256 }
    ],
    args: (o) => ['-c:a', 'aac', '-b:a', `${o.bitrate}k`, '-f', 'adts']
  },
  {
    id: 'aiff',
    label: 'AIFF',
    ext: 'aiff',
    group: 'pro',
    engine: true,
    cover: false,
    options: [
      { key: 'bitDepth', label: '取樣格式', choices: [[16, '16-bit PCM'], [24, '24-bit PCM'], [32, '32-bit PCM']], default: 24 }
    ],
    args: (o) => ['-c:a', `pcm_s${o.bitDepth}be`, '-f', 'aiff']
  },
  {
    id: 'alac',
    label: 'ALAC（Apple 無損）',
    ext: 'm4a',
    group: 'pro',
    engine: true,
    cover: true,
    options: [
      { key: 'bitDepth', label: '位元深度', choices: [[16, '16-bit'], [24, '24-bit']], default: 24 }
    ],
    args: (o) => ['-c:a', 'alac', '-sample_fmt', o.bitDepth === 16 ? 's16p' : 's32p', '-f', 'mp4']
  },
  {
    id: 'ac3',
    label: 'AC-3（Dolby Digital）',
    ext: 'ac3',
    group: 'pro',
    engine: true,
    cover: false,
    allowedRates: [32000, 44100, 48000],
    options: [
      { key: 'bitrate', label: '位元率', choices: kbps([192, 256, 320, 384, 448, 640]), default: 448 }
    ],
    args: (o) => ['-c:a', 'ac3', '-b:a', `${o.bitrate}k`, '-f', 'ac3']
  },
  {
    id: 'wma',
    label: 'WMA',
    ext: 'wma',
    group: 'pro',
    engine: true,
    cover: false,
    options: [
      { key: 'bitrate', label: '位元率', choices: kbps([96, 128, 160, 192, 256, 320]), default: 192 }
    ],
    args: (o) => ['-c:a', 'wmav2', '-b:a', `${o.bitrate}k`, '-f', 'asf']
  },
  {
    id: 'w64',
    label: 'Wave64（超過 4 GB）',
    ext: 'w64',
    group: 'pro',
    engine: true,
    cover: false,
    options: [
      { key: 'bitDepth', label: '取樣格式', choices: [[16, '16-bit PCM'], [24, '24-bit PCM'], [32, '32-bit Float']], default: 24 }
    ],
    args: (o) => ['-c:a', o.bitDepth === 32 ? 'pcm_f32le' : `pcm_s${o.bitDepth}le`, '-f', 'w64']
  },
  {
    id: 'caf',
    label: 'CAF（Core Audio）',
    ext: 'caf',
    group: 'pro',
    engine: true,
    cover: false,
    options: [
      { key: 'codec', label: '編碼', choices: [['pcm_s24le', '24-bit PCM'], ['pcm_s16le', '16-bit PCM'], ['alac', 'ALAC 無損']], default: 'pcm_s24le' }
    ],
    args: (o) => ['-c:a', o.codec, '-f', 'caf']
  },

  /* ------------------------------ 特殊 ------------------------------ */
  {
    id: 'webm',
    label: 'WebM Audio（Opus）',
    ext: 'webm',
    group: 'special',
    engine: true,
    cover: false,
    fixedRate: 48000,
    options: [
      { key: 'bitrate', label: '位元率', choices: kbps([64, 96, 128, 160, 192, 256]), default: 160 }
    ],
    args: (o) => ['-c:a', 'libopus', '-b:a', `${o.bitrate}k`, '-f', 'webm']
  },
  {
    id: 'mka',
    label: 'MKA（Matroska FLAC）',
    ext: 'mka',
    group: 'special',
    engine: true,
    cover: false,
    options: [],
    args: () => ['-c:a', 'flac', '-f', 'matroska']
  },
  {
    id: 'oggflac',
    label: 'Ogg FLAC',
    ext: 'oga',
    group: 'special',
    engine: true,
    cover: false,
    options: [],
    args: () => ['-c:a', 'flac', '-f', 'ogg']
  },
  {
    id: 'pcm',
    label: '原始 PCM（無標頭）',
    ext: 'pcm',
    group: 'special',
    engine: true,
    cover: false,
    options: [
      { key: 'fmt', label: '格式', choices: [['s16le', '16-bit 小端序'], ['s24le', '24-bit 小端序'], ['f32le', '32-bit Float']], default: 's16le' }
    ],
    args: (o) => ['-c:a', `pcm_${o.fmt}`, '-f', o.fmt]
  }
];

/** 分組顯示名稱 */
export const PRESET_GROUPS = [
  ['common', '常用'],
  ['pro', '專業／相容'],
  ['special', '特殊']
];

/** 依 ID 取得格式 */
export function getPreset(id) {
  return PRESETS.find((p) => p.id === id) || PRESETS[0];
}

/** 取得格式選項預設值 */
export function defaultOptions(preset) {
  const result = {};
  for (const opt of preset.options) result[opt.key] = opt.default;
  return result;
}

/** 判斷選項是否應顯示 */
export function isOptionVisible(option, values) {
  if (!option.showIf) return true;
  return Object.entries(option.showIf).every(([k, v]) => values[k] === v);
}

/** 常見中繼資料欄位 */
export const METADATA_FIELDS = [
  ['title', '標題'],
  ['artist', '演出者'],
  ['album', '專輯'],
  ['album_artist', '專輯演出者'],
  ['date', '年份'],
  ['track', '曲目編號'],
  ['genre', '類型'],
  ['composer', '作曲'],
  ['comment', '註解']
];

/**
 * 組合完整的 ffmpeg 輸出參數。
 * @param {object} preset
 * @param {object} options     格式選項
 * @param {object} common      { sampleRate: 'source'|number, channels: 'source'|number }
 * @param {object} metadata    { title, artist, ... }
 * @param {boolean} hasCover
 * @returns {string[]}
 */
export function buildArgs(preset, options, common, metadata, hasCover) {
  const args = [];

  // 串流對應與封面
  if (hasCover && preset.cover) {
    args.push('-map', '0:a', '-map', '1:v', '-c:v', 'copy', '-disposition:v:0', 'attached_pic');
    if (preset.id === 'mp3') args.push('-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)');
  } else {
    args.push('-map', '0:a');
  }

  args.push(...preset.args(options));

  // 取樣率與聲道
  const rate = preset.fixedRate || (common.sampleRate !== 'source' ? Number(common.sampleRate) : null);
  if (rate) args.push('-ar', rate);
  if (common.channels !== 'source') args.push('-ac', Number(common.channels));

  // 中繼資料
  for (const [key] of METADATA_FIELDS) {
    const value = (metadata[key] || '').trim();
    if (value) args.push('-metadata', `${key}=${value}`);
  }

  return args.map(String);
}
