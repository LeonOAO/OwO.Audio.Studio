/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Store / Store
 * --------------------------------------------------------------------------
 * 輕量狀態容器：單一狀態樹＋訂閱通知。
 *
 * 狀態結構：
 *   project        專案模型（不可變）
 *   selection      { start, end }   取樣點；start === end 表示無選取
 *   playhead       播放頭位置（取樣點）
 *   currentTrackId 目前作用中的音軌
 *   selectedClipId 目前選取的片段
 *   view           { offset, samplesPerPixel }  水平捲動與縮放
 *   transport      { playing, loop }
 *   settings       { unit, snap, zeroCross, scope, junctionFadeMs, fadeCurve, rippleAllTracks }
 *   engine         { status, mode, message }
 *   busy           { active, label, ratio }
 * ========================================================================== */

import { createProject } from '../Domain/Model.js';
import { TimeUnit } from '../Domain/TimeCode.js';

/** 設定預設值（會被 localStorage 中儲存的設定覆蓋） */
export const DEFAULT_SETTINGS = Object.freeze({
  unit: TimeUnit.Time,        // 時間顯示單位
  snap: true,                 // 吸附片段邊界與播放頭
  zeroCross: false,           // 選取邊界吸附零交越點
  scope: 'all',               // 編輯套用範圍：all 全部音軌｜current 目前音軌
  junctionFadeMs: 3,          // 接點淡化長度（毫秒），0 表示關閉
  fadeCurve: 'equalPower',    // 淡入淡出預設曲線
  rippleAllTracks: true,      // 插入貼上時是否同步推移全部音軌
  defaultSampleRate: 48000    // 尚未匯入檔案時的專案取樣率
});

const SETTINGS_KEY = 'OwOAudioStudio.Settings';

/** 從 localStorage 讀取設定 */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** 儲存設定到 localStorage */
export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* 私密瀏覽模式等情況下忽略 */
  }
}

/**
 * 建立初始狀態。
 * @param {object} settings
 */
export function createInitialState(settings) {
  const project = createProject({ sampleRate: settings.defaultSampleRate, channelCount: 2 });
  return {
    project,
    selection: { start: 0, end: 0 },
    playhead: 0,
    currentTrackId: project.tracks[0].id,
    selectedClipId: null,
    view: { offset: 0, samplesPerPixel: 1000 },
    transport: { playing: false, loop: false },
    settings,
    engine: { status: 'idle', mode: 'none', message: '尚未偵測' },
    busy: { active: false, label: '', ratio: 0 }
  };
}

export class Store {
  /**
   * @param {object} initialState
   */
  constructor(initialState) {
    this.state = initialState;
    /** @type {Set<(state: object, changed: Set<string>) => void>} */
    this.listeners = new Set();
    this.pending = new Set();
    this.scheduled = false;
  }

  /** 取得目前狀態 */
  get() {
    return this.state;
  }

  /**
   * 部分更新狀態。通知以 microtask 合併，同一輪多次 set 只通知一次。
   * @param {object} patch
   */
  set(patch) {
    let changed = false;
    for (const key of Object.keys(patch)) {
      if (this.state[key] !== patch[key]) {
        changed = true;
        this.pending.add(key);
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch };

    if (!this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => {
        this.scheduled = false;
        const keys = this.pending;
        this.pending = new Set();
        for (const listener of this.listeners) listener(this.state, keys);
      });
    }
  }

  /**
   * 更新巢狀物件中的部分欄位，例如 update('view', { offset: 100 })。
   * @param {string} key
   * @param {object} patch
   */
  update(key, patch) {
    this.set({ [key]: { ...this.state[key], ...patch } });
  }

  /**
   * 訂閱狀態變更。
   * @param {(state: object, changed: Set<string>) => void} listener
   * @returns {() => void} 取消訂閱
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
