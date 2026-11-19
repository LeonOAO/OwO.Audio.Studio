/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Domain / Edit
 * --------------------------------------------------------------------------
 * 所有剪輯操作的純函式實作：(project, args) => newProject
 *
 *   splitAt          在指定位置分割片段                 總長度不變
 *   rippleDelete     刪除範圍並將後方片段往前接合       總長度縮短
 *   silenceRange     將範圍變成靜音，後方不移動         總長度不變
 *   insertSilence    在指定位置插入空白，後方往後推     總長度延長
 *   keepRange        只保留範圍                         總長度＝範圍長度
 *   copyRange/paste  複製與貼上（插入或覆蓋）
 *   fadeRange        對範圍套用淡入／淡出
 *   moveClip/trim    片段移動與邊緣修剪
 *
 * 範圍 [a, b) 為半開區間，單位一律為取樣點。
 * trackIds 為 null 表示套用到全部音軌。
 * junctionFade（取樣點）：在刪除／插入／靜音所產生的接點加上短淡化，避免爆音。
 * ========================================================================== */

import {
  createClip,
  createTrack,
  createFade,
  createId,
  clipEnd,
  clipLength,
  sortClips,
  projectLength,
  findClip,
  hasOverlap
} from './Model.js';
import { clampFades } from './Fades.js';

/** 剪輯操作失敗時拋出，訊息可直接顯示給使用者 */
export class EditError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EditError';
  }
}

/* --------------------------------------------------------------------------
 * 內部工具
 * ------------------------------------------------------------------------ */

/** 判斷音軌是否在套用範圍內 */
function inScope(track, trackIds) {
  return !trackIds || trackIds.includes(track.id);
}

/** 只對範圍內的音軌套用 fn，其餘保持原物件 */
function mapScopedTracks(project, trackIds, fn) {
  return {
    ...project,
    tracks: project.tracks.map((track) => (inScope(track, trackIds) ? fn(track) : track))
  };
}

/** 以新片段清單取代音軌片段（自動排序） */
function withClips(track, clips) {
  return { ...track, clips: sortClips(clips) };
}

/** 範圍正規化並驗證 */
function normalizeRange(a, b) {
  const start = Math.max(0, Math.round(Math.min(a, b)));
  const end = Math.max(0, Math.round(Math.max(a, b)));
  if (end <= start) throw new EditError('選取範圍長度為 0，請先選取一段時間。');
  return [start, end];
}

/** 將片段淡出長度至少設為 len */
function ensureFadeOut(clip, len) {
  if (len <= 0 || clip.fadeOut.length >= len) return clip;
  return clampFades({ ...clip, fadeOut: { ...clip.fadeOut, length: len } });
}

/** 將片段淡入長度至少設為 len */
function ensureFadeIn(clip, len) {
  if (len <= 0 || clip.fadeIn.length >= len) return clip;
  return clampFades({ ...clip, fadeIn: { ...clip.fadeIn, length: len } });
}

/**
 * 在接點兩側加入淡化：結束於 endPos 的片段淡出、起始於 startPos 的片段淡入。
 * @param {object[]} clips
 * @param {number} endPos   左側片段的結束位置
 * @param {number} startPos 右側片段的起始位置
 * @param {number} len
 */
function applyJunctionFades(clips, endPos, startPos, len) {
  if (!len) return clips;
  return clips.map((clip) => {
    let next = clip;
    if (clipEnd(next) === endPos) next = ensureFadeOut(next, len);
    if (next.timelineStart === startPos) next = ensureFadeIn(next, len);
    return next;
  });
}

/**
 * 將單一片段在時間軸位置 t 分割成兩段。t 不在片段內部時回傳 null。
 * @param {object} clip
 * @param {number} t
 * @returns {[object, object] | null}
 */
export function splitClip(clip, t) {
  if (t <= clip.timelineStart || t >= clipEnd(clip)) return null;
  const offset = t - clip.timelineStart;

  const left = clampFades({
    ...clip,
    id: createId('clp'),
    sourceEnd: clip.sourceStart + offset,
    fadeOut: createFade(0, clip.fadeOut.curve)
  });

  const right = clampFades({
    ...clip,
    id: createId('clp'),
    sourceStart: clip.sourceStart + offset,
    timelineStart: t,
    fadeIn: createFade(0, clip.fadeIn.curve)
  });

  return [left, right];
}

/** 在音軌內所有跨越 t 的片段處分割 */
function splitTrackAt(track, t) {
  let changed = false;
  const clips = [];
  for (const clip of track.clips) {
    const parts = splitClip(clip, t);
    if (parts) {
      clips.push(parts[0], parts[1]);
      changed = true;
    } else {
      clips.push(clip);
    }
  }
  return changed ? withClips(track, clips) : track;
}

/* --------------------------------------------------------------------------
 * 範圍操作
 * ------------------------------------------------------------------------ */

/**
 * 在位置 t 分割片段。
 * @param {object} project
 * @param {{ position: number, trackIds?: string[]|null }} args
 */
export function splitAt(project, { position, trackIds = null }) {
  const t = Math.round(position);
  let count = 0;
  const next = mapScopedTracks(project, trackIds, (track) => {
    const result = splitTrackAt(track, t);
    if (result !== track) count += 1;
    return result;
  });
  if (!count) throw new EditError('播放頭位置沒有可分割的片段。');
  return next;
}

/**
 * 刪除範圍並接合（Ripple Delete）。
 * @param {object} project
 * @param {{ start: number, end: number, trackIds?: string[]|null, junctionFade?: number }} args
 */
export function rippleDelete(project, { start, end, trackIds = null, junctionFade = 0 }) {
  const [a, b] = normalizeRange(start, end);
  const len = b - a;

  const next = mapScopedTracks(project, trackIds, (track) => {
    const split = splitTrackAt(splitTrackAt(track, a), b);
    const kept = [];
    for (const clip of split.clips) {
      if (clipEnd(clip) <= a) kept.push(clip);
      else if (clip.timelineStart >= b) kept.push({ ...clip, timelineStart: clip.timelineStart - len });
      // 位於 [a, b) 內的片段被刪除
    }
    return withClips(track, applyJunctionFades(kept, a, a, junctionFade));
  });

  // 結尾標記同步縮短
  const marker = project.endMarker || 0;
  let newMarker = marker;
  if (marker >= b) newMarker = marker - len;
  else if (marker > a) newMarker = a;
  return { ...next, endMarker: newMarker };
}

/**
 * 將範圍變成靜音（移除範圍內片段，後方不移動，總長度不變）。
 * @param {object} project
 * @param {{ start: number, end: number, trackIds?: string[]|null, junctionFade?: number }} args
 */
export function silenceRange(project, { start, end, trackIds = null, junctionFade = 0 }) {
  const [a, b] = normalizeRange(start, end);
  const originalLength = projectLength(project);

  const next = mapScopedTracks(project, trackIds, (track) => {
    const split = splitTrackAt(splitTrackAt(track, a), b);
    const kept = split.clips.filter((clip) => clipEnd(clip) <= a || clip.timelineStart >= b);
    return withClips(track, applyJunctionFades(kept, a, b, junctionFade));
  });

  // 靜音尾段時保持原本總長度
  return { ...next, endMarker: Math.max(project.endMarker || 0, originalLength) };
}

/**
 * 在位置 t 插入 length 長度的空白，後方片段往後推。
 * @param {object} project
 * @param {{ position: number, length: number, trackIds?: string[]|null, junctionFade?: number }} args
 */
export function insertSilence(project, { position, length, trackIds = null, junctionFade = 0 }) {
  const t = Math.max(0, Math.round(position));
  const len = Math.round(length);
  if (len <= 0) throw new EditError('空白長度必須大於 0。');

  const originalLength = projectLength(project);

  const next = mapScopedTracks(project, trackIds, (track) => {
    const split = splitTrackAt(track, t);
    const moved = split.clips.map((clip) =>
      clip.timelineStart >= t ? { ...clip, timelineStart: clip.timelineStart + len } : clip
    );
    return withClips(track, applyJunctionFades(moved, t, t + len, junctionFade));
  });

  // 結尾標記：插入點在專案內部則整體延長；在專案尾端之後則延長到插入點＋長度
  const base = Math.max(originalLength, t);
  return { ...next, endMarker: base + len };
}

/**
 * 只保留範圍 [a, b)，其餘刪除並將保留部分移到 0。
 * @param {object} project
 * @param {{ start: number, end: number, trackIds?: string[]|null }} args
 */
export function keepRange(project, { start, end, trackIds = null }) {
  const [a, b] = normalizeRange(start, end);

  const next = mapScopedTracks(project, trackIds, (track) => {
    const split = splitTrackAt(splitTrackAt(track, a), b);
    const kept = split.clips
      .filter((clip) => clip.timelineStart >= a && clipEnd(clip) <= b)
      .map((clip) => ({ ...clip, timelineStart: clip.timelineStart - a }));
    return withClips(track, kept);
  });

  return { ...next, endMarker: b - a };
}

/**
 * 對範圍套用淡入或淡出。
 * 範圍內每個片段（分割後）獨立套用完整長度的淡化。
 * @param {object} project
 * @param {{ start: number, end: number, direction: 'in'|'out', curve: string, trackIds?: string[]|null }} args
 */
export function fadeRange(project, { start, end, direction, curve, trackIds = null }) {
  const [a, b] = normalizeRange(start, end);
  let touched = 0;

  const next = mapScopedTracks(project, trackIds, (track) => {
    const split = splitTrackAt(splitTrackAt(track, a), b);
    const clips = split.clips.map((clip) => {
      if (clip.timelineStart < a || clipEnd(clip) > b) return clip;
      touched += 1;
      const len = clipLength(clip);
      if (direction === 'in') {
        return clampFades({ ...clip, fadeIn: createFade(len, curve), fadeOut: createFade(0, clip.fadeOut.curve) });
      }
      return clampFades({ ...clip, fadeOut: createFade(len, curve), fadeIn: createFade(0, clip.fadeIn.curve) });
    });
    return withClips(track, clips);
  });

  if (!touched) throw new EditError('選取範圍內沒有音訊片段。');
  return next;
}

/* --------------------------------------------------------------------------
 * 複製與貼上
 * ------------------------------------------------------------------------ */

/**
 * 複製範圍內容到剪貼簿資料結構。
 * @param {object} project
 * @param {{ start: number, end: number, trackIds?: string[]|null }} args
 * @returns {{ length: number, tracks: { trackId: string, clips: object[] }[] }}
 */
export function copyRange(project, { start, end, trackIds = null }) {
  const [a, b] = normalizeRange(start, end);
  const tracks = [];

  for (const track of project.tracks) {
    if (!inScope(track, trackIds)) continue;
    const split = splitTrackAt(splitTrackAt(track, a), b);
    const clips = split.clips
      .filter((clip) => clip.timelineStart >= a && clipEnd(clip) <= b)
      .map((clip) => ({ ...clip, timelineStart: clip.timelineStart - a }));
    tracks.push({ trackId: track.id, clips });
  }

  return { length: b - a, tracks };
}

/**
 * 貼上剪貼簿內容。
 *   ripple = true ：先在 t 插入等長空白，再放入片段（插入貼上）
 *   ripple = false：先將 [t, t+len) 靜音，再放入片段（覆蓋貼上）
 *
 * 對應規則：剪貼簿只有一條音軌且指定 targetTrackId 時貼到該音軌；
 * 否則依原音軌 ID 對應，找不到時依序對應或新增音軌。
 *
 * @param {object} project
 * @param {{ position: number, clipboard: object, ripple: boolean, targetTrackId?: string|null,
 *           rippleAllTracks?: boolean, junctionFade?: number }} args
 */
export function paste(project, {
  position,
  clipboard,
  ripple,
  targetTrackId = null,
  rippleAllTracks = true,
  junctionFade = 0
}) {
  if (!clipboard || !clipboard.length) throw new EditError('剪貼簿是空的。');
  const t = Math.max(0, Math.round(position));
  const len = clipboard.length;

  let next = project;

  // 1. 決定每一段剪貼簿音軌要貼到哪條音軌
  const mapping = [];
  if (clipboard.tracks.length === 1 && targetTrackId) {
    mapping.push({ entry: clipboard.tracks[0], trackId: targetTrackId });
  } else {
    clipboard.tracks.forEach((entry, index) => {
      let target = next.tracks.find((tr) => tr.id === entry.trackId);
      if (!target) target = next.tracks[index];
      if (!target) {
        target = createTrack({ name: `音軌 ${next.tracks.length + 1}` });
        next = { ...next, tracks: [...next.tracks, target] };
      }
      mapping.push({ entry, trackId: target.id });
    });
  }

  const targetIds = mapping.map((m) => m.trackId);

  // 2. 騰出空間
  if (ripple) {
    next = insertSilence(next, {
      position: t,
      length: len,
      trackIds: rippleAllTracks ? null : targetIds,
      junctionFade
    });
  } else {
    next = silenceRange(next, { start: t, end: t + len, trackIds: targetIds, junctionFade: 0 });
  }

  // 3. 放入片段（全部重新產生 ID）
  next = {
    ...next,
    tracks: next.tracks.map((track) => {
      const items = mapping.filter((m) => m.trackId === track.id);
      if (!items.length) return track;
      const added = items.flatMap((m) =>
        m.entry.clips.map((clip) => ({ ...clip, id: createId('clp'), timelineStart: clip.timelineStart + t }))
      );
      return withClips(track, [...track.clips, ...added]);
    })
  };

  const end = t + len;
  return { ...next, endMarker: Math.max(next.endMarker || 0, end) };
}

/* --------------------------------------------------------------------------
 * 片段操作
 * ------------------------------------------------------------------------ */

/**
 * 移動片段（可跨音軌）。與目標音軌其他片段重疊時拋出 EditError。
 * @param {object} project
 * @param {{ clipId: string, timelineStart: number, trackId?: string }} args
 */
export function moveClip(project, { clipId, timelineStart, trackId }) {
  const found = findClip(project, clipId);
  if (!found) throw new EditError('找不到片段。');

  const destId = trackId || found.track.id;
  const moved = { ...found.clip, timelineStart: Math.max(0, Math.round(timelineStart)) };

  const tracks = project.tracks.map((track) => {
    let clips = track.clips.filter((c) => c.id !== clipId);
    if (track.id === destId) clips = [...clips, moved];
    // 只有來源與目標音軌需要重建，其餘保持原物件以利結構共享
    const touched = track.id === destId || track.id === found.track.id;
    return touched ? withClips(track, clips) : track;
  });

  const dest = tracks.find((t) => t.id === destId);
  if (!dest) throw new EditError('找不到目標音軌。');
  if (hasOverlap(dest.clips)) throw new EditError('目標位置與其他片段重疊。');

  return { ...project, tracks };
}

/**
 * 修剪片段起點（拖曳左邊緣）。
 * @param {object} project
 * @param {{ clipId: string, timelineStart: number }} args
 */
export function trimClipStart(project, { clipId, timelineStart }) {
  const found = findClip(project, clipId);
  if (!found) throw new EditError('找不到片段。');
  const { track, clip } = found;

  // 限制：不早於來源起點、不早於前一片段結尾、至少保留 1 個取樣點
  const prevEnd = track.clips
    .filter((c) => c.id !== clipId && clipEnd(c) <= clip.timelineStart)
    .reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  const minStart = Math.max(prevEnd, clip.timelineStart - clip.sourceStart);
  const maxStart = clipEnd(clip) - 1;
  const t = Math.min(maxStart, Math.max(minStart, Math.round(timelineStart)));
  const delta = t - clip.timelineStart;

  const updated = clampFades({ ...clip, timelineStart: t, sourceStart: clip.sourceStart + delta });
  return replaceClip(project, track.id, updated);
}

/**
 * 修剪片段終點（拖曳右邊緣）。
 * @param {object} project
 * @param {{ clipId: string, timelineEnd: number }} args
 */
export function trimClipEnd(project, { clipId, timelineEnd }) {
  const found = findClip(project, clipId);
  if (!found) throw new EditError('找不到片段。');
  const { track, clip } = found;
  const source = project.sources[clip.sourceId];

  const nextStart = track.clips
    .filter((c) => c.id !== clipId && c.timelineStart >= clipEnd(clip))
    .reduce((m, c) => Math.min(m, c.timelineStart), Infinity);
  const maxEnd = Math.min(nextStart, clip.timelineStart + (source.length - clip.sourceStart));
  const minEnd = clip.timelineStart + 1;
  const end = Math.min(maxEnd, Math.max(minEnd, Math.round(timelineEnd)));

  const updated = clampFades({ ...clip, sourceEnd: clip.sourceStart + (end - clip.timelineStart) });
  return replaceClip(project, track.id, updated);
}

/**
 * 修改片段屬性（增益、淡入淡出、名稱）。
 * @param {object} project
 * @param {{ clipId: string, patch: object }} args
 */
export function setClipProps(project, { clipId, patch }) {
  const found = findClip(project, clipId);
  if (!found) throw new EditError('找不到片段。');
  const updated = clampFades({ ...found.clip, ...patch });
  return replaceClip(project, found.track.id, updated);
}

/**
 * 刪除片段；ripple 為 true 時後方片段往前補位。
 * @param {object} project
 * @param {{ clipIds: string[], ripple?: boolean }} args
 */
export function deleteClips(project, { clipIds, ripple = false }) {
  let next = project;
  for (const clipId of clipIds) {
    const found = findClip(next, clipId);
    if (!found) continue;
    if (ripple) {
      next = rippleDelete(next, {
        start: found.clip.timelineStart,
        end: clipEnd(found.clip),
        trackIds: [found.track.id]
      });
    } else {
      next = {
        ...next,
        tracks: next.tracks.map((t) =>
          t.id === found.track.id ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t
        )
      };
    }
  }
  return next;
}

/** 以更新後片段取代原片段並重新排序 */
function replaceClip(project, trackId, updated) {
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      track.id === trackId
        ? withClips(track, track.clips.map((c) => (c.id === updated.id ? updated : c)))
        : track
    )
  };
}

/* --------------------------------------------------------------------------
 * 音軌與來源
 * ------------------------------------------------------------------------ */

/** 新增空白音軌 */
export function addTrack(project, { name } = {}) {
  const track = createTrack({ name: name || `音軌 ${project.tracks.length + 1}` });
  return { ...project, tracks: [...project.tracks, track] };
}

/** 刪除音軌（至少保留一條） */
export function removeTrack(project, { trackId }) {
  if (project.tracks.length <= 1) throw new EditError('專案至少需要保留一條音軌。');
  return { ...project, tracks: project.tracks.filter((t) => t.id !== trackId) };
}

/** 修改音軌屬性（名稱、增益、聲相、靜音、獨奏） */
export function setTrackProps(project, { trackId, patch }) {
  return {
    ...project,
    tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t))
  };
}

/**
 * 加入新來源並在時間軸放入一個完整片段。
 * 目標音軌放得下時放在該音軌；否則新增一條音軌。
 * @param {object} project
 * @param {{ source: object, trackId?: string|null, position?: number }} args
 * @returns {{ project: object, clipId: string, trackId: string }}
 */
export function addSourceWithClip(project, { source, trackId = null, position = 0 }) {
  let next = { ...project, sources: { ...project.sources, [source.id]: source } };
  let target = next.tracks.find((t) => t.id === trackId) || null;
  if (!target && trackId === null) target = next.tracks[0];

  const clip = createClip({
    sourceId: source.id,
    sourceStart: 0,
    sourceEnd: source.length,
    timelineStart: Math.max(0, Math.round(position)),
    name: source.fileName
  });

  const fits = target && !hasOverlap([...target.clips, clip]);
  if (!fits) {
    const track = createTrack({ name: `音軌 ${next.tracks.length + 1}` });
    next = { ...next, tracks: [...next.tracks, track] };
    target = track;
  }

  next = {
    ...next,
    tracks: next.tracks.map((t) => (t.id === target.id ? withClips(t, [...t.clips, clip]) : t))
  };

  return { project: next, clipId: clip.id, trackId: target.id };
}

/**
 * 移除已沒有任何片段參照的來源（回傳新專案與被移除的來源 ID）。
 * @param {object} project
 */
export function pruneSources(project) {
  const used = new Set();
  for (const track of project.tracks) for (const clip of track.clips) used.add(clip.sourceId);
  const removed = Object.keys(project.sources).filter((id) => !used.has(id));
  if (!removed.length) return { project, removed };
  const sources = { ...project.sources };
  for (const id of removed) delete sources[id];
  return { project: { ...project, sources }, removed };
}
