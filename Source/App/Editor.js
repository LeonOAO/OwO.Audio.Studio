/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * App / Editor
 * --------------------------------------------------------------------------
 * 應用層中樞：串接 Store、History、各引擎與儲存服務，提供 UI 呼叫的所有動作。
 *
 *   UI 元件 ──呼叫──► Editor 動作 ──► Domain 純函式 ──► Store 更新 ──► UI 重繪
 *                         │
 *                         ├─ History     復原／重做
 *                         ├─ Transport   播放
 *                         ├─ Importer    匯入
 *                         ├─ Exporter    匯出
 *                         └─ Persistence 自動儲存
 *
 * 規則：所有修改專案的操作一律經過 commit()，因此都能復原。
 * ========================================================================== */

import { Store, createInitialState, loadSettings, saveSettings } from '../Store/Store.js';
import { History } from '../Commands/History.js';
import {
  createProject, projectLength, findClip, findTrack, clipEnd, clipAt, gainToDb
} from '../Domain/Model.js';
import * as Edit from '../Domain/Edit.js';
import { EditError } from '../Domain/Edit.js';
import { msToSamples, formatTime } from '../Domain/TimeCode.js';
import { findZeroCrossing, peakOfRange } from '../Domain/Analysis.js';
import { FFmpegClient } from '../Engine/FFmpeg/FFmpegClient.js';
import { Importer } from '../Engine/Import/Importer.js';
import { PeakService } from '../Engine/Peaks/PeakService.js';
import { Transport } from '../Engine/Playback/Transport.js';
import { runExport, saveBlob } from '../Engine/Export/Exporter.js';
import { Persistence } from '../Storage/Persistence.js';

/** 縮放限制：每像素取樣數 */
const MIN_SPP = 0.05;   // 最大放大：每個取樣點 20 像素
const MAX_SPP = 200000;

export class Editor {
  constructor() {
    this.settings = loadSettings();
    this.store = new Store(createInitialState(this.settings));
    this.history = new History(200);

    /** 來源 PCM 庫：{ [sourceId]: { channels: Float32Array[] } } */
    this.bank = {};
    /** 本次工作階段的原始檔案（快速裁切用）：sourceId → { file, audioIndex } */
    this.files = new Map();
    this.clipboard = null;

    this.peaks = new PeakService();
    this.ffmpeg = new FFmpegClient();
    this.persistence = new Persistence();
    this.transport = new Transport({
      getProject: () => this.state.project,
      getBank: () => this.bank,
      onEnded: () => this.handleEnded()
    });

    /** UI 掛勾：由元件註冊 */
    this.ui = {
      log: () => {},
      toast: () => {},
      chooseStream: async () => 0,
      viewportWidth: () => 1000
    };

    this.importer = new Importer({
      ffmpeg: this.ffmpeg,
      chooseStream: (info) => this.ui.chooseStream(info),
      log: (m, l) => this.log(m, l)
    });

    this.saveTimer = null;
    this.peakVersion = 0; // 峰值資料更新時遞增，通知波形重繪
  }

  /* ======================================================================
   * 基本存取
   * ==================================================================== */

  get state() {
    return this.store.get();
  }

  get project() {
    return this.state.project;
  }

  /** 寫入日誌 */
  log(message, level = 'info') {
    this.ui.log(message, level);
  }

  /** 顯示短暫提示（同時寫入日誌） */
  notify(message, level = 'info') {
    this.ui.toast(message, level);
    this.log(message, level);
  }

  /** 編輯套用範圍的音軌 ID 清單（null 表示全部） */
  scopeTrackIds() {
    return this.state.settings.scope === 'current' ? [this.state.currentTrackId] : null;
  }

  /** 接點淡化長度（取樣點） */
  junctionFade() {
    return msToSamples(this.state.settings.junctionFadeMs || 0, this.project.sampleRate);
  }

  /** 是否有選取範圍 */
  hasSelection() {
    const { start, end } = this.state.selection;
    return end > start;
  }

  /** 專案總長度 */
  length() {
    return projectLength(this.project);
  }

  /** 時間格式化（依目前單位） */
  format(samples, unit = this.state.settings.unit) {
    return formatTime(samples, this.project.sampleRate, unit);
  }

  /* ======================================================================
   * 初始化
   * ==================================================================== */

  async init() {
    // 專案變更：重新排程播放、排程自動儲存
    this.store.subscribe((state, changed) => {
      if (changed.has('project')) {
        this.transport.invalidate();
        this.scheduleSave();
      }
      if (changed.has('settings')) saveSettings(state.settings);
    });

    // 引擎偵測
    this.store.update('engine', { status: 'detecting', message: '偵測 ffmpeg 核心…' });
    const mode = await this.ffmpeg.detect();
    const engineText = {
      mt: 'ffmpeg 多執行緒核心',
      st: 'ffmpeg 單執行緒核心',
      none: '未找到 ffmpeg 核心（瀏覽器解碼＋內建 WAV）'
    }[mode];
    this.store.update('engine', { status: mode === 'none' ? 'fallback' : 'ready', mode, message: engineText });
    this.log(`音訊引擎：${engineText}`, mode === 'none' ? 'warn' : 'info');
    if (mode === 'none') {
      this.log('網站上找不到 Engine 資料夾的核心檔案；請到 GitHub 的 Actions 頁籤確認部署是否成功。', 'warn');
    }
    if (mode === 'st' && !self.crossOriginIsolated) {
      this.log('頁面尚未啟用跨來源隔離，暫用單執行緒核心；重新整理頁面通常即可改用多執行緒。');
    }

    // 儲存服務與還原
    const opfs = await this.persistence.init();
    this.log(opfs ? '自動儲存：已啟用（IndexedDB＋OPFS）' : '自動儲存：此瀏覽器不支援 OPFS，僅保留在記憶體中', opfs ? 'info' : 'warn');
    await this.restore();
  }

  /** 從上次自動儲存還原 */
  async restore() {
    let saved;
    try {
      saved = await this.persistence.loadProject();
    } catch {
      saved = null;
    }
    if (!saved || !saved.tracks) return;

    const ids = Object.keys(saved.sources || {});
    let missing = 0;
    for (const id of ids) {
      const meta = saved.sources[id];
      const channels = await this.persistence.readSource(id, meta.channelCount, meta.length);
      if (channels) {
        this.bank[id] = { channels };
        this.peaks.build(id, channels).then(() => this.bumpPeaks());
      } else {
        missing += 1;
      }
    }

    this.store.set({
      project: saved,
      currentTrackId: saved.tracks[0] ? saved.tracks[0].id : null,
      selection: { start: 0, end: 0 },
      playhead: 0,
      selectedClipId: null
    });
    this.zoomToFit();
    this.log(`已還原上次的專案「${saved.name}」（${ids.length} 個來源${missing ? `，${missing} 個來源資料遺失` : ''}）`,
      missing ? 'warn' : 'info');
  }

  /** 延遲自動儲存 */
  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.persistence.saveProject(this.project).catch((error) => {
        this.log(`自動儲存失敗：${error.message}`, 'warn');
      });
    }, 1200);
  }

  /** 峰值資料更新通知 */
  bumpPeaks() {
    this.peakVersion += 1;
    this.store.update('view', {}); // 觸發重繪
  }

  /* ======================================================================
   * Commit／復原／重做
   * ==================================================================== */

  /**
   * 執行一次可復原的修改。
   * @param {string} label
   * @param {(project: object) => object} fn
   * @param {{ mergeKey?: string, quiet?: boolean }} [options]
   * @returns {boolean} 是否成功
   */
  commit(label, fn, { mergeKey = null, quiet = false } = {}) {
    const before = this.project;
    let after;
    try {
      after = fn(before);
    } catch (error) {
      if (error instanceof EditError) {
        if (!quiet) this.notify(error.message, 'warn');
        return false;
      }
      throw error;
    }
    if (!after || after === before) return false;
    this.history.record(before, label, mergeKey);

    // 片段或音軌被移除時，修正目前選取
    const patch = { project: after };
    if (this.state.selectedClipId && !findClip(after, this.state.selectedClipId)) patch.selectedClipId = null;
    if (!findTrack(after, this.state.currentTrackId)) patch.currentTrackId = after.tracks[0].id;
    this.store.set(patch);
    if (!mergeKey && !quiet) this.log(`✔ ${label}`);
    return true;
  }

  undo() {
    const result = this.history.undo(this.project);
    if (!result) return;
    this.applyHistory(result.project);
    this.log(`↶ 復原：${result.label}`);
  }

  redo() {
    const result = this.history.redo(this.project);
    if (!result) return;
    this.applyHistory(result.project);
    this.log(`↷ 重做：${result.label}`);
  }

  applyHistory(project) {
    const patch = { project };
    if (this.state.selectedClipId && !findClip(project, this.state.selectedClipId)) patch.selectedClipId = null;
    if (!findTrack(project, this.state.currentTrackId)) patch.currentTrackId = project.tracks[0].id;
    this.store.set(patch);
  }

  /* ======================================================================
   * 選取、播放頭、設定
   * ==================================================================== */

  setSelection(start, end) {
    const max = Math.max(this.length(), start, end);
    const a = Math.max(0, Math.min(Math.round(start), Math.round(end)));
    const b = Math.min(max, Math.max(Math.round(start), Math.round(end)));
    this.store.set({ selection: { start: a, end: b } });
  }

  clearSelection() {
    this.store.set({ selection: { start: 0, end: 0 } });
  }

  selectAll() {
    this.setSelection(0, this.length());
  }

  /** 選取片段的完整範圍 */
  selectClipRange(clipId) {
    const found = findClip(this.project, clipId);
    if (!found) return;
    this.store.set({ selectedClipId: clipId, currentTrackId: found.track.id });
    this.setSelection(found.clip.timelineStart, clipEnd(found.clip));
  }

  setPlayhead(position) {
    const pos = Math.max(0, Math.round(position));
    this.store.set({ playhead: pos });
    if (this.state.transport.playing) this.play(pos);
  }

  /** 以毫秒微調播放頭 */
  nudgePlayhead(ms) {
    const base = this.state.transport.playing ? this.transport.position() : this.state.playhead;
    this.setPlayhead(base + msToSamples(ms, this.project.sampleRate));
  }

  /** 將選取起點或終點設為播放頭位置 */
  markSelection(edge) {
    const pos = this.state.transport.playing ? this.transport.position() : this.state.playhead;
    const { start, end } = this.state.selection;
    const hasSel = end > start;
    if (edge === 'start') this.setSelection(pos, hasSel && end > pos ? end : Math.max(pos, end));
    else this.setSelection(hasSel && start < pos ? start : Math.min(pos, start), pos);
  }

  updateSettings(patch) {
    this.store.update('settings', patch);
  }

  setCurrentTrack(trackId) {
    this.store.set({ currentTrackId: trackId });
  }

  selectClip(clipId) {
    const found = clipId ? findClip(this.project, clipId) : null;
    this.store.set({ selectedClipId: found ? clipId : null, ...(found ? { currentTrackId: found.track.id } : {}) });
  }

  /**
   * 吸附：片段邊界、播放頭、選取邊界、專案結尾。
   * @param {number} sample
   * @param {number} tolerance 取樣點容差
   * @param {{ excludeClipId?: string }} [options]
   */
  snap(sample, tolerance, { excludeClipId = null } = {}) {
    if (!this.state.settings.snap) return sample;
    const candidates = [0, this.state.playhead, this.length()];
    const { start, end } = this.state.selection;
    if (end > start) candidates.push(start, end);
    for (const track of this.project.tracks) {
      for (const clip of track.clips) {
        if (clip.id === excludeClipId) continue;
        candidates.push(clip.timelineStart, clipEnd(clip));
      }
    }
    let best = sample;
    let bestDist = tolerance;
    for (const c of candidates) {
      const d = Math.abs(c - sample);
      if (d <= bestDist) {
        best = c;
        bestDist = d;
      }
    }
    return best;
  }

  /**
   * 零交越點吸附（在指定音軌該位置的片段上搜尋 ±5 ms）。
   * @param {number} sample
   * @param {string} trackId
   */
  zeroCrossSnap(sample, trackId) {
    if (!this.state.settings.zeroCross) return sample;
    const track = findTrack(this.project, trackId);
    if (!track) return sample;
    const clip = clipAt(track, sample);
    if (!clip || !this.bank[clip.sourceId]) return sample;
    const radius = msToSamples(5, this.project.sampleRate);
    const srcPos = clip.sourceStart + (sample - clip.timelineStart);
    const found = findZeroCrossing(this.bank[clip.sourceId].channels, srcPos, radius);
    const result = clip.timelineStart + (found - clip.sourceStart);
    return Math.min(clipEnd(clip), Math.max(clip.timelineStart, result));
  }

  /* ======================================================================
   * 剪輯動作
   * ==================================================================== */

  /** 需要選取範圍的操作共用檢查 */
  requireSelection() {
    if (!this.hasSelection()) {
      this.notify('請先在波形上拖曳選取一段範圍，或在上方輸入起點與終點。', 'warn');
      return null;
    }
    return this.state.selection;
  }

  split() {
    const position = this.state.transport.playing ? this.transport.position() : this.state.playhead;
    this.commit(`分割於 ${this.format(position)}`, (p) =>
      Edit.splitAt(p, { position, trackIds: this.scopeTrackIds() }));
  }

  rippleDelete() {
    const sel = this.requireSelection();
    if (!sel) return;
    const ok = this.commit(`刪除並接合 ${this.format(sel.start)} ～ ${this.format(sel.end)}`, (p) =>
      Edit.rippleDelete(p, { ...sel, trackIds: this.scopeTrackIds(), junctionFade: this.junctionFade() }));
    if (ok) {
      this.store.set({ playhead: sel.start });
      this.clearSelection();
    }
  }

  silence() {
    const sel = this.requireSelection();
    if (!sel) return;
    this.commit(`區段靜音 ${this.format(sel.start)} ～ ${this.format(sel.end)}`, (p) =>
      Edit.silenceRange(p, { ...sel, trackIds: this.scopeTrackIds(), junctionFade: this.junctionFade() }));
  }

  /**
   * 插入空白。
   * @param {number} position
   * @param {number} length
   * @param {string[]|null} [trackIds]
   */
  insertSilence(position, length, trackIds = this.scopeTrackIds()) {
    const ok = this.commit(`插入空白 ${this.format(length)} 於 ${this.format(position)}`, (p) =>
      Edit.insertSilence(p, { position, length, trackIds, junctionFade: this.junctionFade() }));
    if (ok) this.setSelection(position, position + length);
    return ok;
  }

  keepRange() {
    const sel = this.requireSelection();
    if (!sel) return;
    const ok = this.commit(`只保留 ${this.format(sel.start)} ～ ${this.format(sel.end)}`, (p) =>
      Edit.keepRange(p, { ...sel, trackIds: this.scopeTrackIds() }));
    if (ok) {
      this.clearSelection();
      this.store.set({ playhead: 0 });
      this.zoomToFit();
    }
  }

  copy() {
    const sel = this.requireSelection();
    if (!sel) return false;
    try {
      this.clipboard = Edit.copyRange(this.project, { ...sel, trackIds: this.scopeTrackIds() });
      this.notify(`已複製 ${this.format(sel.end - sel.start)}`);
      this.store.update('view', {}); // 讓工具列更新貼上按鈕狀態
      return true;
    } catch (error) {
      if (error instanceof EditError) this.notify(error.message, 'warn');
      return false;
    }
  }

  cut() {
    if (this.copy()) this.rippleDelete();
  }

  /** 貼上：ripple = true 插入；false 覆蓋 */
  paste(ripple) {
    if (!this.clipboard) {
      this.notify('剪貼簿是空的。', 'warn');
      return;
    }
    const position = this.state.playhead;
    const len = this.clipboard.length;
    const ok = this.commit(`${ripple ? '插入貼上' : '覆蓋貼上'}於 ${this.format(position)}`, (p) =>
      Edit.paste(p, {
        position,
        clipboard: this.clipboard,
        ripple,
        targetTrackId: this.state.settings.scope === 'current' || this.clipboard.tracks.length === 1
          ? this.state.currentTrackId : null,
        rippleAllTracks: this.state.settings.rippleAllTracks,
        junctionFade: this.junctionFade()
      }));
    if (ok) this.setSelection(position, position + len);
  }

  fade(direction) {
    const sel = this.requireSelection();
    if (!sel) return;
    this.commit(direction === 'in' ? '選取範圍淡入' : '選取範圍淡出', (p) =>
      Edit.fadeRange(p, { ...sel, direction, curve: this.state.settings.fadeCurve, trackIds: this.scopeTrackIds() }));
  }

  /** 刪除目前選取的片段 */
  deleteSelectedClip(ripple = false) {
    const id = this.state.selectedClipId;
    if (!id) return false;
    return this.commit(ripple ? '刪除片段並接合' : '刪除片段', (p) => Edit.deleteClips(p, { clipIds: [id], ripple }));
  }

  /** Delete 鍵：有選取範圍時刪除並接合，否則刪除選取片段 */
  deleteAction(shift) {
    if (this.hasSelection()) {
      if (shift) this.silence();
      else this.rippleDelete();
    } else if (this.state.selectedClipId) {
      this.deleteSelectedClip(!shift);
    } else {
      this.notify('沒有選取範圍或片段。', 'warn');
    }
  }

  /** 非破壞式正規化：計算片段峰值並調整片段增益，使峰值為 target dBFS */
  normalizeClip(clipId, targetDb = -1) {
    const found = findClip(this.project, clipId);
    if (!found) return;
    const entry = this.bank[found.clip.sourceId];
    if (!entry) {
      this.notify('來源資料尚未載入。', 'warn');
      return;
    }
    const peak = peakOfRange(entry.channels, found.clip.sourceStart, found.clip.sourceEnd);
    if (peak <= 0) {
      this.notify('片段為靜音，無法正規化。', 'warn');
      return;
    }
    const gainDb = Math.round((targetDb - gainToDb(peak)) * 100) / 100;
    this.commit(`正規化片段至 ${targetDb} dBFS（${gainDb >= 0 ? '+' : ''}${gainDb} dB）`, (p) =>
      Edit.setClipProps(p, { clipId, patch: { gainDb } }));
  }

  setClipProps(clipId, patch, mergeKey = null) {
    this.commit('修改片段屬性', (p) => Edit.setClipProps(p, { clipId, patch }), { mergeKey });
  }

  moveClip(clipId, timelineStart, trackId, mergeKey = null) {
    return this.commit('移動片段', (p) => Edit.moveClip(p, { clipId, timelineStart, trackId }), { mergeKey, quiet: Boolean(mergeKey) });
  }

  trimClip(clipId, edge, position, mergeKey = null) {
    return this.commit(edge === 'start' ? '修剪片段起點' : '修剪片段終點', (p) =>
      edge === 'start'
        ? Edit.trimClipStart(p, { clipId, timelineStart: position })
        : Edit.trimClipEnd(p, { clipId, timelineEnd: position }), { mergeKey, quiet: Boolean(mergeKey) });
  }

  addTrack() {
    this.commit('新增音軌', (p) => Edit.addTrack(p));
    const tracks = this.project.tracks;
    this.store.set({ currentTrackId: tracks[tracks.length - 1].id });
  }

  removeTrack(trackId) {
    this.commit('刪除音軌', (p) => Edit.removeTrack(p, { trackId }));
  }

  setTrackProps(trackId, patch, mergeKey = null) {
    this.commit('修改音軌屬性', (p) => Edit.setTrackProps(p, { trackId, patch }), { mergeKey, quiet: Boolean(mergeKey) });
  }

  renameProject(name) {
    this.commit('重新命名專案', (p) => ({ ...p, name: name || '未命名專案' }), { mergeKey: 'rename', quiet: true });
  }

  /* ======================================================================
   * 播放控制
   * ==================================================================== */

  async play(from = this.state.playhead) {
    if (!this.length()) {
      this.notify('專案目前沒有音訊，請先匯入檔案。', 'warn');
      return;
    }
    const loop = this.state.transport.loop && this.hasSelection() ? this.state.selection : null;
    await this.transport.play(from, { loop });
    this.store.update('transport', { playing: true });
  }

  stop() {
    if (!this.state.transport.playing) {
      this.store.set({ playhead: this.hasSelection() ? this.state.selection.start : 0 });
      return;
    }
    const pos = this.transport.stop();
    this.store.set({ playhead: pos });
    this.store.update('transport', { playing: false });
  }

  togglePlay() {
    if (this.state.transport.playing) this.stop();
    else this.play();
  }

  /** 播放選取範圍前後 1 秒（試聽接點） */
  previewAround() {
    const sel = this.requireSelection();
    if (!sel) return;
    const pad = this.project.sampleRate;
    this.play(Math.max(0, sel.start - pad));
  }

  toggleLoop() {
    this.store.update('transport', { loop: !this.state.transport.loop });
    if (this.state.transport.playing) this.play(this.transport.position());
  }

  handleEnded() {
    this.store.update('transport', { playing: false });
    this.store.set({ playhead: this.transport.lastPosition });
  }

  /** 目前播放位置（播放中為即時位置） */
  livePosition() {
    return this.state.transport.playing ? this.transport.position() : this.state.playhead;
  }

  /* ======================================================================
   * 檢視
   * ==================================================================== */

  setView(patch) {
    const view = { ...this.state.view, ...patch };
    view.samplesPerPixel = Math.min(MAX_SPP, Math.max(MIN_SPP, view.samplesPerPixel));
    const maxOffset = Math.max(0, this.length() + view.samplesPerPixel * 200 - view.samplesPerPixel * this.ui.viewportWidth());
    view.offset = Math.max(0, Math.min(maxOffset, view.offset));
    this.store.set({ view });
  }

  /** 以 anchor（取樣點）為中心縮放 */
  zoom(factor, anchor = null) {
    const { offset, samplesPerPixel } = this.state.view;
    const center = anchor ?? offset + (samplesPerPixel * this.ui.viewportWidth()) / 2;
    const px = (center - offset) / samplesPerPixel;
    const spp = Math.min(MAX_SPP, Math.max(MIN_SPP, samplesPerPixel * factor));
    this.setView({ samplesPerPixel: spp, offset: center - px * spp });
  }

  zoomToFit() {
    const width = Math.max(200, this.ui.viewportWidth() - 20);
    const len = Math.max(this.length(), this.project.sampleRate * 10);
    this.setView({ samplesPerPixel: len / width, offset: 0 });
  }

  zoomToSelection() {
    const sel = this.requireSelection();
    if (!sel) return;
    const width = Math.max(200, this.ui.viewportWidth() - 40);
    const spp = (sel.end - sel.start) / width;
    this.setView({ samplesPerPixel: spp, offset: sel.start - spp * 20 });
  }

  /** 確保位置在畫面內（播放跟隨用） */
  ensureVisible(position) {
    const { offset, samplesPerPixel } = this.state.view;
    const width = samplesPerPixel * this.ui.viewportWidth();
    if (position < offset || position > offset + width * 0.95) {
      this.setView({ offset: position - width * 0.05 });
    }
  }

  /* ======================================================================
   * 匯入／匯出／專案
   * ==================================================================== */

  /** 設定忙碌狀態（顯示進度遮罩） */
  setBusy(active, label = '', ratio = 0) {
    this.store.set({ busy: { active, label, ratio } });
  }

  /**
   * 匯入多個檔案。
   * @param {File[]} files
   */
  async importFiles(files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    if (this.state.transport.playing) this.stop();

    for (let i = 0; i < list.length; i += 1) {
      const file = list[i];
      const prefix = list.length > 1 ? `（${i + 1}/${list.length}）` : '';
      this.setBusy(true, `匯入 ${file.name}${prefix}`, 0);
      try {
        const { meta, channels, projectPatch } = await this.importer.importFile(file, this.project, (r, stage) => {
          const stageText = { probe: '分析格式', decode: '解碼', read: '讀取檔案', ffmpeg: '解碼' }[stage] || stage;
          this.setBusy(true, `${stageText}：${file.name}${prefix}`, r);
        });

        // 第一個檔案決定專案規格（尚無任何來源時才調整）
        let base = this.project;
        if (projectPatch && !Object.keys(base.sources).length) base = { ...base, ...projectPatch };

        this.bank[meta.id] = { channels };
        this.files.set(meta.id, { file, audioIndex: meta.originalFormat.audioIndex || 0 });

        // 目前音軌是空的就放進去，否則新增一條音軌
        const target = findTrack(base, this.state.currentTrackId);
        const placement = target && target.clips.length === 0 ? target.id : '__new__';
        let added = null;
        this.commit(`匯入 ${file.name}`, () => {
          const result = Edit.addSourceWithClip(base, { source: meta, trackId: placement, position: 0 });
          added = result;
          return result.project;
        });
        if (added) this.store.set({ currentTrackId: added.trackId, selectedClipId: added.clipId });

        const fmt = meta.originalFormat;
        this.log(
          `來源資訊：${file.name}｜${fmt.codec || fmt.container || '未知編碼'}｜` +
          `${fmt.sampleRate || '?'} Hz → ${meta.sampleRate} Hz｜${fmt.channels} 聲道 → ${meta.channelCount}｜` +
          `長度 ${formatTime(meta.length, meta.sampleRate)}｜解碼器 ${meta.decoder === 'ffmpeg' ? 'ffmpeg' : '瀏覽器'}`
        );

        this.peaks.build(meta.id, channels).then(() => this.bumpPeaks());
        this.persistence.writeSource(meta.id, channels).catch((error) =>
          this.log(`來源暫存失敗（不影響編輯）：${error.message}`, 'warn'));
      } catch (error) {
        if (error.cancelled) {
          this.notify('已取消匯入。', 'warn');
          break;
        }
        this.notify(`匯入失敗：${error.message}`, 'error');
        if (error.logTail) this.log(error.logTail, 'error');
      }
    }

    this.setBusy(false);
    this.zoomToFit();
  }

  /**
   * 執行匯出。
   * @param {object} request 匯出對話框的設定
   */
  async exportAudio(request) {
    if (!this.length()) {
      this.notify('專案沒有內容可匯出。', 'warn');
      return;
    }
    if (this.state.transport.playing) this.stop();

    const range = request.useSelection && this.hasSelection()
      ? { ...this.state.selection }
      : { start: 0, end: this.length() };

    // 快速裁切只能用於單一來源
    let fastCutSource = null;
    if (request.mode === 'fastcut') {
      const ids = Object.keys(this.project.sources);
      if (ids.length !== 1) {
        this.notify('快速裁切只適用於專案內只有一個來源檔案的情況。', 'warn');
        return;
      }
      fastCutSource = this.files.get(ids[0]) || null;
    }

    this.setBusy(true, '準備匯出', 0);
    const started = performance.now();
    try {
      const result = await runExport({
        project: this.project,
        bank: this.bank,
        ffmpeg: this.ffmpeg,
        request: { ...request, range, fastCutSource },
        onProgress: (r, label) => this.setBusy(true, label, r),
        log: (m, l) => this.log(m, l)
      });
      this.setBusy(false);
      const saved = await saveBlob(result.name, result.blob);
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      if (saved) this.notify(`匯出完成：${result.name}（${(result.blob.size / 1048576).toFixed(2)} MB，耗時 ${seconds} 秒）`);
      else this.notify('已取消儲存。', 'warn');
    } catch (error) {
      this.setBusy(false);
      if (error.cancelled) this.notify('已取消匯出。', 'warn');
      else {
        this.notify(`匯出失敗：${error.message}`, 'error');
        if (error.logTail) this.log(error.logTail, 'error');
      }
    }
  }

  /** 取消目前的匯入／匯出 */
  cancelBusy() {
    this.ffmpeg.cancelAll();
    this.setBusy(false);
  }

  /** 開新專案（清除自動儲存） */
  async newProject() {
    if (this.state.transport.playing) this.stop();
    const project = createProject({ sampleRate: this.state.settings.defaultSampleRate, channelCount: 2 });
    this.bank = {};
    this.files.clear();
    this.peaks.clear();
    this.history.clear();
    this.clipboard = null;
    this.store.set({
      project,
      currentTrackId: project.tracks[0].id,
      selectedClipId: null,
      selection: { start: 0, end: 0 },
      playhead: 0
    });
    this.zoomToFit();
    try {
      await this.persistence.clearSources();
      await this.persistence.clearProject();
    } catch {
      /* 忽略 */
    }
    this.log('已建立新專案。');
  }

  /** 是否可使用快速裁切 */
  canFastCut() {
    const ids = Object.keys(this.project.sources);
    return this.ffmpeg.available && ids.length === 1 && this.files.has(ids[0]);
  }
}
