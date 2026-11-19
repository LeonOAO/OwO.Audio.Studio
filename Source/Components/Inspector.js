/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Components / Inspector
 * --------------------------------------------------------------------------
 * 右側屬性面板：
 *   片段   位置、長度、來源範圍、增益、淡入淡出、正規化、刪除、原始格式資訊
 *   專案   名稱、取樣率、聲道、長度、來源數量、儲存空間
 *   設定   接點淡化、預設淡化曲線、插入貼上推移範圍
 * ========================================================================== */

import { h, select, replaceChildren } from './Dom.js';
import { TimeInput } from './TimeInput.js';
import { findClip, clipEnd, clipLength, projectLength } from '../Domain/Model.js';
import { formatTime, samplesToMs, msToSamples } from '../Domain/TimeCode.js';

const CURVES = [['equalPower', '等功率（推薦）'], ['linear', '線性'], ['exponential', '指數']];

export class Inspector {
  /**
   * @param {import('../App/Editor.js').Editor} editor
   */
  constructor(editor) {
    this.editor = editor;
    this.clipBody = h('div', { class: 'PanelBody' });
    this.projectBody = h('div', { class: 'PanelBody' });
    this.settingsBody = h('div', { class: 'PanelBody' });
    this.renderedClipKey = null;

    this.el = h('aside', { class: 'Inspector' },
      h('section', { class: 'Panel' }, h('h3', { class: 'PanelTitle' }, '🎚 片段'), this.clipBody),
      h('section', { class: 'Panel' }, h('h3', { class: 'PanelTitle' }, '📁 專案'), this.projectBody),
      h('section', { class: 'Panel' }, h('h3', { class: 'PanelTitle' }, '⚙ 設定'), this.settingsBody));

    this.buildSettings();
    editor.store.subscribe((state, changed) => {
      if (changed.has('project') || changed.has('selectedClipId') || changed.has('settings')) this.render();
    });
    this.render();
  }

  render() {
    this.renderClip();
    this.renderProject();
  }

  /* ------------------------------ 片段 ------------------------------ */

  renderClip() {
    const editor = this.editor;
    const id = editor.state.selectedClipId;
    const found = id ? findClip(editor.project, id) : null;

    if (!found) {
      this.renderedClipKey = null;
      replaceChildren(this.clipBody, h('p', { class: 'Muted' }, '點選片段標題列即可檢視與調整片段屬性。'));
      return;
    }

    const { clip } = found;
    const rate = editor.project.sampleRate;
    const unit = editor.state.settings.unit;

    // 同一片段只更新數值，避免重建造成輸入焦點遺失
    const key = `${clip.id}|${unit}`;
    if (this.renderedClipKey === key && this.clipControls) {
      this.updateClipControls(clip);
      return;
    }
    this.renderedClipKey = key;

    const context = () => ({ sampleRate: editor.project.sampleRate, unit: editor.state.settings.unit });
    const startInput = new TimeInput({
      label: '起點',
      context,
      onCommit: (v) => editor.moveClip(clip.id, v)
    });
    const lengthInput = new TimeInput({
      label: '長度',
      context,
      onCommit: (v) => {
        const current = findClip(editor.project, clip.id);
        if (current) editor.trimClip(clip.id, 'end', current.clip.timelineStart + v);
      }
    });

    const numberField = (label, value, step, onChange, suffix) => {
      const input = h('input', {
        type: 'number', class: 'NumberField', step: String(step), value: String(value),
        onchange: (e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        },
        onkeydown: (e) => e.stopPropagation()
      });
      return { input, row: h('label', { class: 'Row' }, h('span', null, label), h('span', { class: 'Inline' }, input, h('em', null, suffix))) };
    };

    const gain = numberField('增益', clip.gainDb, 0.1, (v) => editor.setClipProps(clip.id, { gainDb: Math.max(-60, Math.min(24, v)) }), 'dB');
    const fadeIn = numberField('淡入', Math.round(samplesToMs(clip.fadeIn.length, rate)), 1,
      (v) => editor.setClipProps(clip.id, { fadeIn: { ...this.currentClip().fadeIn, length: msToSamples(Math.max(0, v), editor.project.sampleRate) } }), 'ms');
    const fadeOut = numberField('淡出', Math.round(samplesToMs(clip.fadeOut.length, rate)), 1,
      (v) => editor.setClipProps(clip.id, { fadeOut: { ...this.currentClip().fadeOut, length: msToSamples(Math.max(0, v), editor.project.sampleRate) } }), 'ms');
    const fadeInCurve = select(CURVES, clip.fadeIn.curve, (v) => editor.setClipProps(clip.id, { fadeIn: { ...this.currentClip().fadeIn, curve: v } }));
    const fadeOutCurve = select(CURVES, clip.fadeOut.curve, (v) => editor.setClipProps(clip.id, { fadeOut: { ...this.currentClip().fadeOut, curve: v } }));
    const info = h('div', { class: 'InfoGrid' });

    this.clipControls = { startInput, lengthInput, gain, fadeIn, fadeOut, fadeInCurve, fadeOutCurve, info };

    replaceChildren(this.clipBody,
      startInput.el,
      lengthInput.el,
      gain.row,
      fadeIn.row,
      h('label', { class: 'Row' }, h('span', null, '淡入曲線'), fadeInCurve),
      fadeOut.row,
      h('label', { class: 'Row' }, h('span', null, '淡出曲線'), fadeOutCurve),
      h('div', { class: 'ButtonRow' },
        h('button', { class: 'Btn', type: 'button', title: '非破壞式：只調整片段增益，使峰值為 -1 dBFS', onclick: () => editor.normalizeClip(clip.id, -1) }, '正規化 −1 dB'),
        h('button', { class: 'Btn', type: 'button', onclick: () => editor.selectClipRange(clip.id) }, '選取範圍')),
      h('div', { class: 'ButtonRow' },
        h('button', { class: 'Btn', type: 'button', onclick: () => editor.deleteSelectedClip(false) }, '刪除片段'),
        h('button', { class: 'Btn Danger', type: 'button', onclick: () => editor.deleteSelectedClip(true) }, '刪除並接合')),
      info);

    this.updateClipControls(clip);
  }

  /** 取得最新的片段資料 */
  currentClip() {
    const found = findClip(this.editor.project, this.editor.state.selectedClipId);
    return found ? found.clip : null;
  }

  updateClipControls(clip) {
    const editor = this.editor;
    const c = this.clipControls;
    const rate = editor.project.sampleRate;
    c.startInput.setValue(clip.timelineStart);
    c.lengthInput.setValue(clipLength(clip));
    if (document.activeElement !== c.gain.input) c.gain.input.value = String(clip.gainDb);
    if (document.activeElement !== c.fadeIn.input) c.fadeIn.input.value = String(Math.round(samplesToMs(clip.fadeIn.length, rate)));
    if (document.activeElement !== c.fadeOut.input) c.fadeOut.input.value = String(Math.round(samplesToMs(clip.fadeOut.length, rate)));
    c.fadeInCurve.value = clip.fadeIn.curve;
    c.fadeOutCurve.value = clip.fadeOut.curve;

    const source = editor.project.sources[clip.sourceId];
    const fmt = (source && source.originalFormat) || {};
    const row = (k, v) => [h('span', null, k), h('span', null, v)];
    replaceChildren(c.info,
      row('來源', source ? source.fileName : '（遺失）'),
      row('來源範圍', `${formatTime(clip.sourceStart, rate)} ～ ${formatTime(clip.sourceEnd, rate)}`),
      row('時間軸終點', formatTime(clipEnd(clip), rate)),
      row('原始編碼', fmt.codec || fmt.container || '—'),
      row('原始規格', fmt.sampleRate ? `${fmt.sampleRate} Hz／${fmt.channels} 聲道` : '—'),
      row('原始位元率', fmt.bitrateKbps ? `${fmt.bitrateKbps} kbps` : '—'),
      row('解碼器', source ? (source.decoder === 'ffmpeg' ? 'ffmpeg' : '瀏覽器') : '—'));
  }

  /* ------------------------------ 專案 ------------------------------ */

  renderProject() {
    const editor = this.editor;
    const project = editor.project;
    if (!this.projectName) {
      this.projectName = h('input', {
        class: 'TextField', type: 'text',
        onchange: (e) => editor.renameProject(e.target.value.trim()),
        onkeydown: (e) => e.stopPropagation()
      });
      this.projectInfo = h('div', { class: 'InfoGrid' });
      this.storageInfo = h('span', null, '—');
      replaceChildren(this.projectBody,
        h('label', { class: 'Row Stack' }, h('span', null, '專案名稱'), this.projectName),
        this.projectInfo);
    }
    if (document.activeElement !== this.projectName) this.projectName.value = project.name;

    const len = projectLength(project);
    const row = (k, v) => [h('span', null, k), h('span', null, v)];
    replaceChildren(this.projectInfo,
      row('取樣率', `${project.sampleRate.toLocaleString()} Hz${project.rateLocked ? '' : '（未鎖定）'}`),
      row('聲道', project.channelCount === 1 ? '單聲道' : '立體聲'),
      row('總長度', formatTime(len, project.sampleRate)),
      row('總取樣點', len.toLocaleString()),
      row('音軌', `${project.tracks.length} 條`),
      row('來源檔案', `${Object.keys(project.sources).length} 個`),
      row('儲存空間', this.storageInfo));

    clearTimeout(this.usageTimer);
    this.usageTimer = setTimeout(async () => {
      const usage = await editor.persistence.usage();
      if (usage) this.storageInfo.textContent = `${(usage.usage / 1048576).toFixed(1)} MB／${(usage.quota / 1073741824).toFixed(1)} GB`;
    }, 1500);
  }

  /* ------------------------------ 設定 ------------------------------ */

  buildSettings() {
    const editor = this.editor;
    const s = () => editor.state.settings;

    const junction = h('input', {
      type: 'number', class: 'NumberField', min: '0', max: '50', step: '1', value: String(s().junctionFadeMs),
      onchange: (e) => editor.updateSettings({ junctionFadeMs: Math.max(0, Math.min(50, Number(e.target.value) || 0)) }),
      onkeydown: (e) => e.stopPropagation()
    });
    const curve = select(CURVES, s().fadeCurve, (v) => editor.updateSettings({ fadeCurve: v }));
    const ripple = select([['true', '全部音軌'], ['false', '僅貼上的音軌']], String(s().rippleAllTracks),
      (v) => editor.updateSettings({ rippleAllTracks: v === 'true' }));
    const rate = select([[44100, '44,100 Hz'], [48000, '48,000 Hz'], [96000, '96,000 Hz']], s().defaultSampleRate,
      (v) => editor.updateSettings({ defaultSampleRate: Number(v) }));

    replaceChildren(this.settingsBody,
      h('label', { class: 'Row', title: '刪除、插入空白、靜音所產生接點的淡化長度，可避免爆音；0 表示關閉' },
        h('span', null, '接點淡化'), h('span', { class: 'Inline' }, junction, h('em', null, 'ms'))),
      h('label', { class: 'Row' }, h('span', null, '淡入淡出曲線'), curve),
      h('label', { class: 'Row', title: '插入貼上時，後方內容往後推移的音軌範圍' }, h('span', null, '插入貼上推移'), ripple),
      h('label', { class: 'Row', title: '尚未匯入檔案時的專案取樣率；匯入第一個檔案後會改用該檔案的取樣率' },
        h('span', null, '新專案取樣率'), rate));

    editor.store.subscribe((state, changed) => {
      if (!changed.has('settings')) return;
      if (document.activeElement !== junction) junction.value = String(state.settings.junctionFadeMs);
      curve.value = state.settings.fadeCurve;
      ripple.value = String(state.settings.rippleAllTracks);
      rate.value = String(state.settings.defaultSampleRate);
    });
  }
}
