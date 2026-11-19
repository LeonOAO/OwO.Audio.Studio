/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Components / Timeline
 * --------------------------------------------------------------------------
 * 多軌時間軸：時間尺、音軌標頭、波形畫布、選取／播放頭覆蓋層、水平捲軸。
 *
 * 分層繪製：
 *   Ruler   時間尺（含選取帶與播放頭標記）    每格重繪（成本低）
 *   Wave    音軌背景、片段、波形、淡化曲線      只在專案／檢視變更時重繪
 *   Overlay 選取範圍與播放頭                    播放中每格重繪
 *
 * 滑鼠操作：
 *   空白處／波形拖曳      選取時間範圍（Shift 延伸既有選取）
 *   單擊                  設定播放頭
 *   片段標題列拖曳        移動片段（可拖到其他音軌）
 *   片段左右邊緣拖曳      修剪片段
 *   雙擊片段              選取整個片段範圍
 *   時間尺點擊／拖曳      移動播放頭
 *   Ctrl＋滾輪            以游標為中心縮放
 *   Shift＋滾輪／橫向滾動  水平捲動
 * ========================================================================== */

import { h } from './Dom.js';
import { clipEnd, dbToGain, isTrackAudible } from '../Domain/Model.js';
import { clipEnvelopeAt } from '../Domain/Fades.js';
import { chooseRulerStep, formatRulerLabel } from '../Domain/TimeCode.js';

export const TRACK_HEIGHT = 112;
const CLIP_HEADER = 18;
const EDGE_PX = 6;
const SNAP_PX = 8;
const MAX_SCROLL_PX = 8000000;

/** 音軌配色（依音軌順序輪替） */
const PALETTE = ['#4f8cff', '#2ec4a6', '#f5a524', '#e5577a', '#9b7bff', '#5cc8ff', '#a3d65c', '#ff8a5c'];

export class Timeline {
  /**
   * @param {import('../App/Editor.js').Editor} editor
   */
  constructor(editor) {
    this.editor = editor;
    this.width = 800;
    this.dpr = window.devicePixelRatio || 1;
    this.dirtyWave = true;
    this.dirtyOverlay = true;
    this.drag = null;
    this.rows = new Map();
    this.scrollRatio = 1;
    this.syncingScroll = false;
    this.lastTracks = null;
    this.onTick = () => {};

    /* ---------- DOM ---------- */
    this.rulerCanvas = h('canvas', { class: 'RulerCanvas' });
    this.waveCanvas = h('canvas', { class: 'WaveCanvas' });
    this.overlayCanvas = h('canvas', { class: 'OverlayCanvas', tabindex: '0' });
    this.headers = h('div', { class: 'TrackHeaders' });
    this.emptyHint = h('div', { class: 'EmptyHint' },
      h('div', { class: 'EmptyIcon' }, '🎵'),
      h('div', { class: 'EmptyTitle' }, '把音訊或影片檔拖曳到這裡'),
      h('div', { class: 'EmptySub' }, 'MP3、AAC、M4A、WAV、FLAC、OGG、Opus、AIFF、WMA、MP4、MKV…'),
      h('div', { class: 'EmptySub' }, '所有處理都在瀏覽器內完成，檔案不會上傳'));
    this.addTrackBtn = h('button', { class: 'AddTrackRow', type: 'button', onclick: () => editor.addTrack() }, '＋ 新增音軌');

    this.canvasStack = h('div', { class: 'CanvasStack' }, this.waveCanvas, this.overlayCanvas, this.emptyHint);
    this.tracksScroll = h('div', { class: 'TracksScroll' },
      h('div', { class: 'TracksInner' },
        h('div', { class: 'HeaderColumn' }, this.headers, this.addTrackBtn),
        this.canvasStack));

    this.cornerInfo = h('div', { class: 'RulerCorner' });
    this.hscrollInner = h('div', { class: 'HScrollInner' });
    this.hscroll = h('div', { class: 'HScroll' }, this.hscrollInner);

    this.el = h('div', { class: 'Timeline' },
      h('div', { class: 'RulerRow' }, this.cornerInfo, this.rulerCanvas),
      this.tracksScroll,
      h('div', { class: 'HScrollRow' }, h('div', { class: 'RulerCorner Blank' }), this.hscroll));

    /* ---------- 事件 ---------- */
    this.bindPointer();
    this.bindRuler();
    this.canvasStack.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
    this.rulerCanvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
    this.hscroll.addEventListener('scroll', () => this.handleHScroll());

    new ResizeObserver(() => this.resize()).observe(this.canvasStack);

    editor.ui.viewportWidth = () => this.width;
    editor.store.subscribe((state, changed) => {
      if (changed.has('project') || changed.has('view') || changed.has('currentTrackId') ||
          changed.has('selectedClipId') || changed.has('settings')) {
        this.dirtyWave = true;
      }
      if (changed.has('project')) this.syncHeaders();
      if (changed.has('currentTrackId')) this.syncHeaders();
      this.dirtyOverlay = true;
    });

    this.syncHeaders();
    requestAnimationFrame(() => this.frame());
  }

  /* ======================================================================
   * 座標換算
   * ==================================================================== */

  get view() {
    return this.editor.state.view;
  }

  xOf(sample) {
    return (sample - this.view.offset) / this.view.samplesPerPixel;
  }

  sampleAt(x) {
    return this.view.offset + x * this.view.samplesPerPixel;
  }

  /** 依 Y 座標取得音軌 */
  trackAtY(y) {
    const index = Math.floor(y / TRACK_HEIGHT);
    return this.editor.project.tracks[index] || null;
  }

  /* ======================================================================
   * 尺寸
   * ==================================================================== */

  resize() {
    const rect = this.canvasStack.getBoundingClientRect();
    this.width = Math.max(100, Math.floor(rect.width));
    this.dpr = window.devicePixelRatio || 1;
    this.sizeCanvas(this.rulerCanvas, this.width, 30);
    this.applyTrackHeight();
    this.dirtyWave = true;
    this.dirtyOverlay = true;
  }

  applyTrackHeight() {
    const tracks = this.editor.project.tracks.length;
    const height = Math.max(TRACK_HEIGHT, tracks * TRACK_HEIGHT);
    this.canvasStack.style.height = `${height}px`;
    this.sizeCanvas(this.waveCanvas, this.width, height);
    this.sizeCanvas(this.overlayCanvas, this.width, height);
  }

  sizeCanvas(canvas, width, height) {
    const w = Math.floor(width * this.dpr);
    const hgt = Math.floor(height * this.dpr);
    if (canvas.width !== w || canvas.height !== hgt) {
      canvas.width = w;
      canvas.height = hgt;
    }
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  /* ======================================================================
   * 主迴圈
   * ==================================================================== */

  frame() {
    const editor = this.editor;
    const playing = editor.state.transport.playing;

    if (playing) {
      const pos = editor.transport.position();
      editor.ensureVisible(pos);
      this.onTick(pos);
      this.dirtyOverlay = true;
    }

    if (this.dirtyWave) {
      if (this.waveCanvas.height !== Math.floor(Math.max(TRACK_HEIGHT, editor.project.tracks.length * TRACK_HEIGHT) * this.dpr)) {
        this.applyTrackHeight();
      }
      this.drawWave();
      this.syncScrollbar();
      this.dirtyWave = false;
      this.dirtyOverlay = true;
    }

    if (this.dirtyOverlay) {
      this.drawRuler();
      this.drawOverlay();
      this.dirtyOverlay = false;
    }

    requestAnimationFrame(() => this.frame());
  }

  /* ======================================================================
   * 繪製：時間尺
   * ==================================================================== */

  drawRuler() {
    const editor = this.editor;
    const ctx = this.rulerCanvas.getContext('2d');
    const { samplesPerPixel: spp } = this.view;
    const rate = editor.project.sampleRate;
    const W = this.width;
    const H = 30;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#161b26';
    ctx.fillRect(0, 0, W, H);

    // 選取帶
    const { start, end } = editor.state.selection;
    if (end > start) {
      ctx.fillStyle = editor.state.transport.loop ? 'rgba(46,196,166,0.35)' : 'rgba(79,140,255,0.35)';
      ctx.fillRect(this.xOf(start), 0, Math.max(1, (end - start) / spp), H);
    }

    // 刻度
    const step = chooseRulerStep(spp, rate);
    const minor = step / 5;
    const first = Math.floor(this.sampleAt(0) / minor) * minor;
    ctx.strokeStyle = '#3a4357';
    ctx.fillStyle = '#9aa4ba';
    ctx.font = '11px "Segoe UI", "Microsoft JhengHei", sans-serif';
    ctx.textBaseline = 'top';
    ctx.beginPath();
    for (let s = first; s < this.sampleAt(W); s += minor) {
      const x = Math.round(this.xOf(s)) + 0.5;
      const isMajor = Math.abs(Math.round(s / step) * step - s) < minor / 2;
      ctx.moveTo(x, isMajor ? 14 : 22);
      ctx.lineTo(x, H);
      if (isMajor && s >= 0) ctx.fillText(formatRulerLabel(Math.round(s), rate, step), x + 3, 3);
    }
    ctx.stroke();

    // 專案結尾
    const endX = this.xOf(editor.length());
    if (endX >= 0 && endX <= W) {
      ctx.fillStyle = '#e5577a';
      ctx.fillRect(endX, 0, 2, H);
    }

    // 播放頭標記
    const px = this.xOf(editor.livePosition());
    if (px >= -6 && px <= W + 6) {
      ctx.fillStyle = '#ff4d5e';
      ctx.beginPath();
      ctx.moveTo(px - 6, 18);
      ctx.lineTo(px + 6, 18);
      ctx.lineTo(px, H);
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = '#2a3142';
    ctx.beginPath();
    ctx.moveTo(0, H - 0.5);
    ctx.lineTo(W, H - 0.5);
    ctx.stroke();

    this.cornerInfo.textContent = `${editor.project.sampleRate.toLocaleString()} Hz｜${editor.project.channelCount === 1 ? '單聲道' : '立體聲'}`;
  }

  /* ======================================================================
   * 繪製：波形層
   * ==================================================================== */

  drawWave() {
    const editor = this.editor;
    const project = editor.project;
    const ctx = this.waveCanvas.getContext('2d');
    const W = this.width;
    const H = Math.max(TRACK_HEIGHT, project.tracks.length * TRACK_HEIGHT);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    this.emptyHint.style.display = editor.length() > 0 ? 'none' : 'flex';

    project.tracks.forEach((track, index) => {
      const top = index * TRACK_HEIGHT;
      const current = track.id === editor.state.currentTrackId;
      const audible = isTrackAudible(project, track);

      // 音軌背景
      ctx.fillStyle = current ? '#1c2333' : index % 2 ? '#141925' : '#171c28';
      ctx.fillRect(0, top, W, TRACK_HEIGHT);
      ctx.fillStyle = '#232a3a';
      ctx.fillRect(0, top + TRACK_HEIGHT - 1, W, 1);

      const color = PALETTE[index % PALETTE.length];
      for (const clip of track.clips) {
        this.drawClip(ctx, track, clip, top, color, audible);
      }
    });

    // 專案結尾線
    const endX = this.xOf(editor.length());
    if (endX >= 0 && endX <= W) {
      ctx.fillStyle = 'rgba(229,87,122,0.6)';
      ctx.fillRect(endX, 0, 1, H);
    }
  }

  drawClip(ctx, track, clip, top, color, audible) {
    const editor = this.editor;
    const spp = this.view.samplesPerPixel;
    const W = this.width;
    const cx0 = this.xOf(clip.timelineStart);
    const cx1 = this.xOf(clipEnd(clip));
    if (cx1 < 0 || cx0 > W) return;

    const x0 = Math.max(0, Math.floor(cx0));
    const x1 = Math.min(W, Math.ceil(cx1));
    const selected = clip.id === editor.state.selectedClipId;
    const bodyTop = top + 2;
    const bodyH = TRACK_HEIGHT - 4;

    // 片段本體
    ctx.globalAlpha = audible ? 1 : 0.4;
    ctx.fillStyle = hexAlpha(color, 0.16);
    ctx.fillRect(x0, bodyTop, x1 - x0, bodyH);
    ctx.fillStyle = hexAlpha(color, selected ? 0.95 : 0.6);
    ctx.fillRect(x0, bodyTop, x1 - x0, CLIP_HEADER);

    // 標題文字
    if (x1 - x0 > 40) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, bodyTop, x1 - x0, CLIP_HEADER);
      ctx.clip();
      ctx.fillStyle = '#0d1018';
      ctx.font = '600 11px "Segoe UI", "Microsoft JhengHei", sans-serif';
      ctx.textBaseline = 'middle';
      const gainText = clip.gainDb ? `  ${clip.gainDb > 0 ? '+' : ''}${clip.gainDb.toFixed(1)} dB` : '';
      ctx.fillText(`${clip.name || '片段'}${gainText}`, Math.max(x0, cx0) + 6, bodyTop + CLIP_HEADER / 2 + 1);
      ctx.restore();
    }

    // 波形
    const waveTop = bodyTop + CLIP_HEADER + 2;
    const waveH = bodyH - CLIP_HEADER - 4;
    const mid = waveTop + waveH / 2;
    const amp = (waveH / 2) * 0.95;
    const gain = dbToGain(clip.gainDb) * dbToGain(track.gainDb);
    const entry = editor.bank[clip.sourceId];

    ctx.fillStyle = hexAlpha(color, 0.25);
    ctx.fillRect(x0, mid, x1 - x0, 1);

    if (!entry) {
      ctx.fillStyle = '#e5577a';
      ctx.font = '12px "Segoe UI", "Microsoft JhengHei", sans-serif';
      ctx.fillText('來源資料遺失，請重新匯入', Math.max(x0, cx0) + 8, mid);
    } else if (spp >= 1) {
      ctx.fillStyle = color;
      for (let x = x0; x < x1; x += 1) {
        const t0 = Math.max(clip.timelineStart, this.sampleAt(x));
        const t1 = Math.min(clipEnd(clip), this.sampleAt(x + 1));
        if (t1 <= t0) continue;
        const s0 = Math.floor(clip.sourceStart + (t0 - clip.timelineStart));
        const s1 = Math.ceil(clip.sourceStart + (t1 - clip.timelineStart));
        const [lo, hi] = editor.peaks.range(clip.sourceId, entry.channels, s0, s1, spp);
        const env = clipEnvelopeAt(clip, Math.floor((t0 + t1) / 2) - clip.timelineStart) * gain;
        const yTop = mid - Math.min(1.05, hi * env) * amp;
        const yBot = mid - Math.max(-1.05, lo * env) * amp;
        ctx.fillRect(x, yTop, 1, Math.max(1, yBot - yTop));
      }
    } else {
      // 取樣點層級：每個聲道畫折線，非常放大時加上取樣點圓點
      const tStart = Math.max(clip.timelineStart, Math.floor(this.sampleAt(x0)) - 1);
      const tEnd = Math.min(clipEnd(clip), Math.ceil(this.sampleAt(x1)) + 1);
      entry.channels.forEach((ch, c) => {
        ctx.strokeStyle = c === 0 ? color : hexAlpha(color, 0.55);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        for (let t = tStart; t < tEnd; t += 1) {
          const off = t - clip.timelineStart;
          const v = (ch[clip.sourceStart + off] || 0) * gain * clipEnvelopeAt(clip, off);
          const x = this.xOf(t);
          const y = mid - Math.max(-1.05, Math.min(1.05, v)) * amp;
          if (t === tStart) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        if (spp < 0.25) {
          for (let t = tStart; t < tEnd; t += 1) {
            const off = t - clip.timelineStart;
            const v = (ch[clip.sourceStart + off] || 0) * gain * clipEnvelopeAt(clip, off);
            ctx.fillRect(this.xOf(t) - 1.5, mid - v * amp - 1.5, 3, 3);
          }
        }
      });
    }

    // 淡入淡出曲線
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 1.5;
    const drawFade = (fromT, length, fn) => {
      if (length <= 0) return;
      const fx0 = Math.max(x0, this.xOf(fromT));
      const fx1 = Math.min(x1, this.xOf(fromT + length));
      if (fx1 <= fx0) return;
      ctx.beginPath();
      for (let x = fx0; x <= fx1; x += 2) {
        const off = this.sampleAt(x) - clip.timelineStart;
        const y = waveTop + waveH - fn(off) * waveH;
        if (x === fx0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    drawFade(clip.timelineStart, clip.fadeIn.length, (off) => clipEnvelopeAt({ ...clip, fadeOut: { length: 0 } }, off));
    drawFade(clipEnd(clip) - clip.fadeOut.length, clip.fadeOut.length, (off) => clipEnvelopeAt({ ...clip, fadeIn: { length: 0 } }, off));

    // 外框
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeStyle = selected ? '#ffffff' : hexAlpha(color, 0.8);
    ctx.strokeRect(cx0 + 0.5, bodyTop + 0.5, cx1 - cx0 - 1, bodyH - 1);
    ctx.globalAlpha = 1;
  }

  /* ======================================================================
   * 繪製：覆蓋層（選取範圍、播放頭）
   * ==================================================================== */

  drawOverlay() {
    const editor = this.editor;
    const ctx = this.overlayCanvas.getContext('2d');
    const W = this.width;
    const tracks = editor.project.tracks;
    const H = Math.max(TRACK_HEIGHT, tracks.length * TRACK_HEIGHT);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const { start, end } = editor.state.selection;
    if (end > start) {
      const sx = this.xOf(start);
      const ex = this.xOf(end);
      const scopeAll = editor.state.settings.scope === 'all';
      const rowIndex = tracks.findIndex((t) => t.id === editor.state.currentTrackId);
      const top = scopeAll ? 0 : rowIndex * TRACK_HEIGHT;
      const height = scopeAll ? H : TRACK_HEIGHT;

      ctx.fillStyle = editor.state.transport.loop ? 'rgba(46,196,166,0.18)' : 'rgba(120,160,255,0.2)';
      ctx.fillRect(sx, top, Math.max(1, ex - sx), height);
      ctx.fillStyle = 'rgba(160,190,255,0.9)';
      ctx.fillRect(Math.round(sx), top, 1, height);
      ctx.fillRect(Math.round(ex), top, 1, height);
    }

    const px = this.xOf(editor.livePosition());
    if (px >= 0 && px <= W) {
      ctx.fillStyle = '#ff4d5e';
      ctx.fillRect(Math.round(px), 0, 1.5, H);
    }
  }

  /* ======================================================================
   * 音軌標頭（以 ID 對應重用 DOM，避免拖曳滑桿時失去焦點）
   * ==================================================================== */

  syncHeaders() {
    const editor = this.editor;
    const tracks = editor.project.tracks;
    const seen = new Set();

    tracks.forEach((track, index) => {
      let row = this.rows.get(track.id);
      if (!row) {
        row = new TrackHeaderRow(editor, track.id);
        this.rows.set(track.id, row);
      }
      row.update(track, index, track.id === editor.state.currentTrackId, tracks.length);
      seen.add(track.id);
    });

    for (const [id, row] of this.rows) {
      if (!seen.has(id)) {
        row.el.remove();
        this.rows.delete(id);
      }
    }

    // 依順序排列（只在順序不同時移動節點）
    tracks.forEach((track, index) => {
      const el = this.rows.get(track.id).el;
      if (this.headers.children[index] !== el) this.headers.insertBefore(el, this.headers.children[index] || null);
    });

    if (this.lastTracks !== tracks.length) {
      this.lastTracks = tracks.length;
      this.applyTrackHeight();
    }
  }

  /* ======================================================================
   * 水平捲軸
   * ==================================================================== */

  syncScrollbar() {
    const { offset, samplesPerPixel: spp } = this.view;
    const visible = spp * this.width;
    const content = Math.max(this.editor.length(), visible) + visible * 0.5;
    const totalPx = content / spp;
    this.scrollRatio = totalPx > MAX_SCROLL_PX ? MAX_SCROLL_PX / totalPx : 1;
    this.hscrollInner.style.width = `${Math.ceil(totalPx * this.scrollRatio)}px`;
    const left = (offset / spp) * this.scrollRatio;
    if (Math.abs(this.hscroll.scrollLeft - left) > 1) {
      this.syncingScroll = true;
      this.hscroll.scrollLeft = left;
    }
  }

  handleHScroll() {
    if (this.syncingScroll) {
      this.syncingScroll = false;
      return;
    }
    const spp = this.view.samplesPerPixel;
    this.editor.setView({ offset: (this.hscroll.scrollLeft / this.scrollRatio) * spp });
  }

  handleWheel(e) {
    const rect = this.canvasStack.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      this.editor.zoom(Math.exp(e.deltaY * 0.0025), this.sampleAt(x));
      return;
    }
    const horizontal = e.shiftKey ? e.deltaY || e.deltaX : Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0;
    if (horizontal) {
      e.preventDefault();
      this.editor.setView({ offset: this.view.offset + horizontal * this.view.samplesPerPixel });
    }
  }

  /* ======================================================================
   * 指標操作：時間尺
   * ==================================================================== */

  bindRuler() {
    let scrubbing = false;
    let wasPlaying = false;

    const posAt = (e) => {
      const rect = this.rulerCanvas.getBoundingClientRect();
      const sample = Math.max(0, Math.round(this.sampleAt(e.clientX - rect.left)));
      return this.editor.snap(sample, SNAP_PX * this.view.samplesPerPixel);
    };

    this.rulerCanvas.addEventListener('pointerdown', (e) => {
      scrubbing = true;
      wasPlaying = this.editor.state.transport.playing;
      if (wasPlaying) this.editor.stop();
      this.rulerCanvas.setPointerCapture(e.pointerId);
      this.editor.store.set({ playhead: posAt(e) });
    });
    this.rulerCanvas.addEventListener('pointermove', (e) => {
      if (scrubbing) this.editor.store.set({ playhead: posAt(e) });
    });
    this.rulerCanvas.addEventListener('pointerup', () => {
      if (!scrubbing) return;
      scrubbing = false;
      if (wasPlaying) this.editor.play();
    });
  }

  /* ======================================================================
   * 指標操作：波形區
   * ==================================================================== */

  /** 命中測試 */
  hitTest(x, y) {
    const track = this.trackAtY(y);
    if (!track) return { type: 'none', track: null, clip: null };
    const rowTop = this.editor.project.tracks.indexOf(track) * TRACK_HEIGHT;

    for (const clip of track.clips) {
      const cx0 = this.xOf(clip.timelineStart);
      const cx1 = this.xOf(clipEnd(clip));
      if (x < cx0 - EDGE_PX || x > cx1 + EDGE_PX) continue;
      const wide = cx1 - cx0 > EDGE_PX * 3;
      if (wide && Math.abs(x - cx0) <= EDGE_PX) return { type: 'trimStart', track, clip };
      if (wide && Math.abs(x - cx1) <= EDGE_PX) return { type: 'trimEnd', track, clip };
      if (x >= cx0 && x <= cx1) {
        return { type: y - rowTop < CLIP_HEADER + 4 ? 'move' : 'body', track, clip };
      }
    }
    return { type: 'empty', track, clip: null };
  }

  /** 取得吸附後的取樣點 */
  snapped(x, trackId, excludeClipId = null) {
    const editor = this.editor;
    let sample = Math.max(0, Math.round(this.sampleAt(x)));
    sample = editor.snap(sample, SNAP_PX * this.view.samplesPerPixel, { excludeClipId });
    if (trackId) sample = editor.zeroCrossSnap(sample, trackId);
    return sample;
  }

  bindPointer() {
    const canvas = this.overlayCanvas;
    const editor = this.editor;
    const local = (e) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      canvas.focus();
      const { x, y } = local(e);
      const hit = this.hitTest(x, y);
      if (!hit.track) return;
      canvas.setPointerCapture(e.pointerId);
      const key = `${hit.type}-${Date.now()}`;

      if (hit.type === 'move' || hit.type === 'trimStart' || hit.type === 'trimEnd') {
        editor.selectClip(hit.clip.id);
        this.drag = {
          type: hit.type,
          clipId: hit.clip.id,
          origStart: hit.clip.timelineStart,
          origLength: clipEnd(hit.clip) - hit.clip.timelineStart,
          startX: x,
          mergeKey: key,
          changed: false
        };
        return;
      }

      editor.setCurrentTrack(hit.track.id);
      editor.selectClip(hit.clip ? hit.clip.id : null);
      const sample = this.snapped(x, hit.track.id);
      const { start, end } = editor.state.selection;
      let anchor = sample;
      if (e.shiftKey && end > start) {
        anchor = Math.abs(sample - start) < Math.abs(sample - end) ? end : start;
        editor.setSelection(anchor, sample);
      }
      this.drag = { type: 'select', anchor, startX: x, trackId: hit.track.id, moved: e.shiftKey, shift: e.shiftKey };
    });

    canvas.addEventListener('pointermove', (e) => {
      const { x, y } = local(e);
      if (!this.drag) {
        const hit = this.hitTest(x, y);
        canvas.style.cursor = {
          trimStart: 'ew-resize', trimEnd: 'ew-resize', move: 'grab', body: 'text', empty: 'text'
        }[hit.type] || 'default';
        return;
      }

      const d = this.drag;
      if (d.type === 'select') {
        if (Math.abs(x - d.startX) > 3) d.moved = true;
        if (!d.moved) return;
        this.autoScroll(x);
        editor.setSelection(d.anchor, this.snapped(x, d.trackId));
      } else if (d.type === 'move') {
        canvas.style.cursor = 'grabbing';
        const spp = this.view.samplesPerPixel;
        let start = Math.max(0, Math.round(d.origStart + (x - d.startX) * spp));
        // 起點或終點任一靠近吸附點即吸附
        const snappedStart = editor.snap(start, SNAP_PX * spp, { excludeClipId: d.clipId });
        if (snappedStart !== start) start = snappedStart;
        else {
          const endSnap = editor.snap(start + d.origLength, SNAP_PX * spp, { excludeClipId: d.clipId });
          start = endSnap - d.origLength;
        }
        const target = this.trackAtY(y);
        if (editor.moveClip(d.clipId, Math.max(0, start), target ? target.id : undefined, d.mergeKey)) d.changed = true;
      } else {
        const pos = this.snapped(x, null, d.clipId);
        if (editor.trimClip(d.clipId, d.type === 'trimStart' ? 'start' : 'end', pos, d.mergeKey)) d.changed = true;
      }
    });

    const finish = (e) => {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      const { x } = local(e);
      if (d.type === 'select' && !d.moved) {
        editor.clearSelection();
        editor.setPlayhead(this.snapped(x, d.trackId));
      } else if (d.type === 'move' && d.changed) {
        editor.log('✔ 移動片段');
      } else if ((d.type === 'trimStart' || d.type === 'trimEnd') && d.changed) {
        editor.log('✔ 修剪片段');
      }
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);

    canvas.addEventListener('dblclick', (e) => {
      const { x, y } = local(e);
      const hit = this.hitTest(x, y);
      if (hit.clip) editor.selectClipRange(hit.clip.id);
    });
  }

  /** 拖曳選取靠近邊緣時自動捲動 */
  autoScroll(x) {
    const spp = this.view.samplesPerPixel;
    if (x > this.width - 24) this.editor.setView({ offset: this.view.offset + spp * 12 });
    else if (x < 24) this.editor.setView({ offset: this.view.offset - spp * 12 });
  }
}

/* ==========================================================================
 * 音軌標頭列
 * ========================================================================== */

class TrackHeaderRow {
  constructor(editor, trackId) {
    this.editor = editor;
    this.trackId = trackId;

    this.name = h('input', {
      class: 'TrackName',
      type: 'text',
      onchange: (e) => editor.setTrackProps(trackId, { name: e.target.value.trim() || '音軌' }),
      onkeydown: (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.target.blur();
      }
    });
    this.mute = h('button', {
      class: 'TrackBtn', type: 'button', title: '靜音（M）',
      onclick: () => editor.setTrackProps(trackId, { muted: !this.track.muted })
    }, 'M');
    this.solo = h('button', {
      class: 'TrackBtn', type: 'button', title: '獨奏',
      onclick: () => editor.setTrackProps(trackId, { solo: !this.track.solo })
    }, 'S');
    this.remove = h('button', {
      class: 'TrackBtn Danger', type: 'button', title: '刪除音軌',
      onclick: () => {
        if (this.track.clips.length && !confirm(`確定刪除「${this.track.name}」與其中的片段？`)) return;
        editor.removeTrack(trackId);
      }
    }, '✕');

    this.gain = h('input', {
      type: 'range', min: '-36', max: '12', step: '0.5', class: 'Slider',
      title: '音軌音量（雙擊歸零）',
      oninput: (e) => editor.setTrackProps(trackId, { gainDb: Number(e.target.value) }, `gain-${trackId}`),
      ondblclick: () => editor.setTrackProps(trackId, { gainDb: 0 })
    });
    this.gainText = h('span', { class: 'SliderValue' });
    this.pan = h('input', {
      type: 'range', min: '-100', max: '100', step: '1', class: 'Slider',
      title: '聲相（雙擊置中）',
      oninput: (e) => editor.setTrackProps(trackId, { pan: Number(e.target.value) / 100 }, `pan-${trackId}`),
      ondblclick: () => editor.setTrackProps(trackId, { pan: 0 })
    });
    this.panText = h('span', { class: 'SliderValue' });
    this.info = h('span', { class: 'TrackInfo' });

    this.el = h('div', {
      class: 'TrackHeader',
      style: { height: `${TRACK_HEIGHT}px` },
      onpointerdown: () => editor.setCurrentTrack(trackId)
    },
      h('div', { class: 'TrackTop' }, h('span', { class: 'TrackColor' }), this.name, this.mute, this.solo, this.remove),
      h('div', { class: 'TrackSliderRow' }, h('span', { class: 'SliderLabel' }, '音量'), this.gain, this.gainText),
      h('div', { class: 'TrackSliderRow' }, h('span', { class: 'SliderLabel' }, '聲相'), this.pan, this.panText),
      this.info);
  }

  update(track, index, current, total) {
    this.track = track;
    this.el.classList.toggle('Current', current);
    this.el.classList.toggle('Muted', !isTrackAudible(this.editor.project, track));
    this.el.querySelector('.TrackColor').style.background = PALETTE[index % PALETTE.length];
    if (document.activeElement !== this.name) this.name.value = track.name;
    this.mute.classList.toggle('On', track.muted);
    this.solo.classList.toggle('On', track.solo);
    this.remove.disabled = total <= 1;
    if (document.activeElement !== this.gain) this.gain.value = String(track.gainDb);
    if (document.activeElement !== this.pan) this.pan.value = String(Math.round(track.pan * 100));
    this.gainText.textContent = `${track.gainDb > 0 ? '+' : ''}${track.gainDb.toFixed(1)} dB`;
    const p = Math.round(track.pan * 100);
    this.panText.textContent = p === 0 ? '中' : p < 0 ? `左 ${-p}` : `右 ${p}`;
    this.info.textContent = `${track.clips.length} 個片段`;
  }
}

/** #rrggbb 加上透明度 */
function hexAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
