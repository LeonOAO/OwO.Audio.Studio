/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Components / TimeBar
 * --------------------------------------------------------------------------
 * 時間控制列：
 *   播放頭｜選取起點｜選取終點｜選取長度｜單位｜套用範圍｜吸附｜零交越點
 *
 * 所有欄位皆可直接輸入毫秒級時間並以 ±1／±10 ms 微調。
 * ========================================================================== */

import { h, select } from './Dom.js';
import { TimeInput } from './TimeInput.js';
import { TimeUnit } from '../Domain/TimeCode.js';

export class TimeBar {
  /**
   * @param {import('../App/Editor.js').Editor} editor
   */
  constructor(editor) {
    this.editor = editor;
    const context = () => ({ sampleRate: editor.project.sampleRate, unit: editor.state.settings.unit });

    this.playhead = new TimeInput({
      label: '播放頭',
      context,
      onCommit: (v) => {
        editor.setPlayhead(v);
        editor.ensureVisible(v);
      }
    });

    this.start = new TimeInput({
      label: '起點',
      context,
      onCommit: (v) => {
        const { end } = editor.state.selection;
        editor.setSelection(v, Math.max(v, end));
      }
    });

    this.end = new TimeInput({
      label: '終點',
      context,
      onCommit: (v) => {
        const { start, end } = editor.state.selection;
        editor.setSelection(end > start ? Math.min(start, v) : Math.min(v, editor.state.playhead), v);
      }
    });

    this.length = new TimeInput({
      label: '長度',
      context,
      nudge: true,
      title: '輸入長度會從起點重新計算終點',
      onCommit: (v) => {
        const { start, end } = editor.state.selection;
        const base = end > start ? start : editor.state.playhead;
        editor.setSelection(base, base + v);
      }
    });

    this.unit = select(
      [[TimeUnit.Time, '時:分:秒.毫秒'], [TimeUnit.Milliseconds, '毫秒'], [TimeUnit.Samples, '取樣點']],
      editor.state.settings.unit,
      (v) => editor.updateSettings({ unit: v }),
      { title: '時間顯示單位' }
    );

    this.scope = select(
      [['all', '全部音軌'], ['current', '目前音軌']],
      editor.state.settings.scope,
      (v) => editor.updateSettings({ scope: v }),
      { title: '分割、刪除、靜音、插入空白等操作的套用範圍' }
    );

    const toggle = (key, text, title) => {
      const input = h('input', {
        type: 'checkbox',
        onchange: (e) => editor.updateSettings({ [key]: e.target.checked })
      });
      input.checked = Boolean(editor.state.settings[key]);
      this[`${key}Box`] = input;
      return h('label', { class: 'Toggle', title }, input, h('span', null, text));
    };

    this.el = h('div', { class: 'TimeBar' },
      h('div', { class: 'TimeGroup' }, this.playhead.el),
      h('div', { class: 'TimeGroup Selection' }, this.start.el, this.end.el, this.length.el),
      h('div', { class: 'TimeGroup Options' },
        h('label', { class: 'Field' }, h('span', null, '單位'), this.unit),
        h('label', { class: 'Field' }, h('span', null, '套用'), this.scope),
        toggle('snap', '吸附', '拖曳時吸附片段邊界、播放頭與選取邊界'),
        toggle('zeroCross', '零交越點', '選取邊界自動移到最近的零交越點（±5 ms），減少爆音'))
    );

    editor.store.subscribe((state, changed) => {
      if (changed.has('settings')) {
        this.unit.value = state.settings.unit;
        this.scope.value = state.settings.scope;
        this.snapBox.checked = state.settings.snap;
        this.zeroCrossBox.checked = state.settings.zeroCross;
      }
      this.update();
    });
    this.update();
  }

  /** 同步顯示值 */
  update() {
    const { selection, transport } = this.editor.state;
    if (!transport.playing) this.playhead.setValue(this.editor.state.playhead);
    this.start.setValue(selection.start);
    this.end.setValue(selection.end);
    this.length.setValue(selection.end - selection.start);
  }

  /** 播放中每格更新播放頭欄位 */
  tick(position) {
    this.playhead.setValue(position);
  }
}
