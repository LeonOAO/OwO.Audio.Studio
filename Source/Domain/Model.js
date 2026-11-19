/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Domain / Model
 * --------------------------------------------------------------------------
 * 專案資料模型與基礎工具函式。
 *
 *   Project ─┬─ sources : { [id]: AudioSourceMeta }   解碼後音訊的描述
 *            └─ tracks  : Track[]
 *                          └─ clips : Clip[]          依 timelineStart 排序、彼此不重疊
 *
 * 「空白」不存成資料：片段之間未被覆蓋的時間，混音時即為 0（靜音）。
 * 所有物件皆視為不可變資料；修改一律回傳新物件。
 * ========================================================================== */

export const PROJECT_VERSION = 1;

/** 淡入淡出曲線 */
export const FadeCurve = Object.freeze({
  Linear: 'linear',
  EqualPower: 'equalPower',
  Exponential: 'exponential'
});

/* --------------------------------------------------------------------------
 * ID 產生
 * ------------------------------------------------------------------------ */

let idCounter = 0;

/**
 * 產生短 ID（時間戳＋遞增值＋亂數，足以在單一專案內唯一）。
 * @param {string} prefix
 */
export function createId(prefix) {
  idCounter = (idCounter + 1) % 1679616;
  const time = Date.now().toString(36);
  const count = idCounter.toString(36).padStart(4, '0');
  const rand = Math.floor(Math.random() * 1296).toString(36).padStart(2, '0');
  return `${prefix}_${time}${count}${rand}`;
}

/* --------------------------------------------------------------------------
 * 建構函式
 * ------------------------------------------------------------------------ */

/**
 * 建立新專案。
 * @param {object} [options]
 * @param {string} [options.name]
 * @param {number} [options.sampleRate]
 * @param {number} [options.channelCount]
 */
export function createProject({ name = '未命名專案', sampleRate = 48000, channelCount = 2 } = {}) {
  return {
    id: createId('prj'),
    name,
    sampleRate,
    channelCount,
    sources: {},
    tracks: [createTrack({ name: '音軌 1' })],
    rateLocked: false, // 第一個匯入的檔案決定取樣率後鎖定
    endMarker: 0,      // 專案結尾標記（在尾端插入空白時用來延長總長度）
    version: PROJECT_VERSION
  };
}

/**
 * 建立音軌。
 * @param {object} [options]
 */
export function createTrack({ name = '音軌', gainDb = 0, pan = 0 } = {}) {
  return {
    id: createId('trk'),
    name,
    gainDb,
    pan,
    muted: false,
    solo: false,
    clips: []
  };
}

/**
 * 建立淡入淡出設定。
 * @param {number} [length=0] 取樣點
 * @param {string} [curve=FadeCurve.EqualPower]
 */
export function createFade(length = 0, curve = FadeCurve.EqualPower) {
  return { length: Math.max(0, Math.round(length)), curve };
}

/**
 * 建立片段。
 * @param {object} options
 */
export function createClip({
  sourceId,
  sourceStart = 0,
  sourceEnd,
  timelineStart = 0,
  gainDb = 0,
  fadeIn = createFade(),
  fadeOut = createFade(),
  name = ''
}) {
  return {
    id: createId('clp'),
    sourceId,
    sourceStart,
    sourceEnd,
    timelineStart,
    gainDb,
    fadeIn,
    fadeOut,
    name
  };
}

/* --------------------------------------------------------------------------
 * 片段幾何
 * ------------------------------------------------------------------------ */

/** 片段長度（取樣點） */
export function clipLength(clip) {
  return clip.sourceEnd - clip.sourceStart;
}

/** 片段在時間軸上的結束位置（不含） */
export function clipEnd(clip) {
  return clip.timelineStart + clipLength(clip);
}

/** 依時間軸位置排序 */
export function sortClips(clips) {
  return [...clips].sort((a, b) => a.timelineStart - b.timelineStart);
}

/**
 * 專案總長度：所有片段最晚結束位置與 endMarker 兩者取大。
 * @param {object} project
 */
export function projectLength(project) {
  let end = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      end = Math.max(end, clipEnd(clip));
    }
  }
  return Math.max(end, project.endMarker || 0);
}

/**
 * 檢查單一音軌的片段是否重疊。
 * @param {object[]} clips
 * @returns {boolean}
 */
export function hasOverlap(clips) {
  const sorted = sortClips(clips);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].timelineStart < clipEnd(sorted[i - 1])) return true;
  }
  return false;
}

/**
 * 驗證整個專案的結構一致性（測試與除錯用）。
 * @param {object} project
 * @returns {string[]} 錯誤訊息清單，空陣列表示正常
 */
export function validateProject(project) {
  const errors = [];
  for (const track of project.tracks) {
    if (hasOverlap(track.clips)) errors.push(`音軌 ${track.name} 有片段重疊`);
    for (const clip of track.clips) {
      const source = project.sources[clip.sourceId];
      if (!source) errors.push(`片段 ${clip.id} 參照不存在的來源`);
      if (clip.sourceEnd <= clip.sourceStart) errors.push(`片段 ${clip.id} 長度無效`);
      if (clip.timelineStart < 0) errors.push(`片段 ${clip.id} 起點為負值`);
      if (source && (clip.sourceStart < 0 || clip.sourceEnd > source.length)) {
        errors.push(`片段 ${clip.id} 超出來源範圍`);
      }
      if (clip.fadeIn.length + clip.fadeOut.length > clipLength(clip)) {
        errors.push(`片段 ${clip.id} 淡入淡出總長超過片段長度`);
      }
    }
  }
  return errors;
}

/* --------------------------------------------------------------------------
 * 查詢
 * ------------------------------------------------------------------------ */

/** 依 ID 找音軌 */
export function findTrack(project, trackId) {
  return project.tracks.find((t) => t.id === trackId) || null;
}

/** 依 ID 找片段與所在音軌 */
export function findClip(project, clipId) {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

/**
 * 找出某時間點底下的片段。
 * @param {object} track
 * @param {number} position
 */
export function clipAt(track, position) {
  return track.clips.find((c) => c.timelineStart <= position && position < clipEnd(c)) || null;
}

/**
 * 依 solo/mute 規則判斷音軌是否應發聲。
 * @param {object} project
 * @param {object} track
 */
export function isTrackAudible(project, track) {
  const anySolo = project.tracks.some((t) => t.solo);
  if (anySolo) return track.solo;
  return !track.muted;
}

/** dB 轉線性增益 */
export function dbToGain(db) {
  return db <= -120 ? 0 : Math.pow(10, db / 20);
}

/** 線性增益轉 dB */
export function gainToDb(gain) {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain);
}
