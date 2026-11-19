/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Components / TimeInput
 * --------------------------------------------------------------------------
 * 毫秒級時間輸入欄位：
 *
 *   [標籤] [ 00:01:23.456 ] [−10] [−1] [+1] [+10]
 *
 *   - 依設定單位顯示（HH:MM:SS.mmm／毫秒／取樣點）
 *   - 可輸入 "1:23.456"、"83456ms"、"4005888smp"、"+250ms"（相對值）
 *   - Enter 或離開欄位時套用；Esc 還原；↑↓ 鍵 ±1 ms，Shift 加速為 ±10 ms
 *   - 解析失敗時顯示紅框，不會套用
 * ========================================================================== */

import { h } from './Dom.js';
import { parseTime, formatTime, msToSamples } from '../Domain/TimeCode.js';

export class TimeInput {
  /**
   * @param {object} options
   * @param {string} options.label
   * @param {() => { sampleRate: number, unit: string }} options.context
   * @param {(samples: number) => void} options.onCommit
   * @param {boolean} [options.nudge=true] 是否顯示 ±1／±10 ms 按鈕
   * @param {number} [options.min=0]
   * @param {string} [options.title]
   */
  constructor({ label, context, onCommit, nudge = true, min = 0, title = '' }) {
    this.context = context;
    this.onCommit = onCommit;
    this.min = min;
    this.value = 0;
    this.editing = false;

    this.input = h('input', {
      class: 'TimeField',
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      title: title || '可輸入 1:23.456、83456ms、4005888smp，或 +250ms 相對調整；↑↓ 微調 1 ms，Shift 為 10 ms',
      onfocus: () => {
        this.editing = true;
        this.input.select();
      },
      onblur: () => {
        this.apply();
        this.editing = false;
      },
      onkeydown: (e) => this.handleKey(e),
      oninput: () => this.input.classList.remove('Invalid')
    });

    const nudgeButton = (ms, text) =>
      h('button', {
        class: 'NudgeBtn',
        type: 'button',
        title: `${ms > 0 ? '+' : ''}${ms} 毫秒`,
        onclick: () => this.nudge(ms)
      }, text);

    this.el = h('div', { class: 'TimeInput' },
      h('span', { class: 'TimeLabel' }, label),
      this.input,
      nudge ? h('div', { class: 'NudgeGroup' },
        nudgeButton(-10, '−10'),
        nudgeButton(-1, '−1'),
        nudgeButton(1, '+1'),
        nudgeButton(10, '+10')) : null
    );
  }

  /** 外部更新顯示值（編輯中不覆蓋使用者輸入） */
  setValue(samples) {
    this.value = samples;
    if (this.editing) return;
    const { sampleRate, unit } = this.context();
    const text = formatTime(samples, sampleRate, unit);
    if (this.input.value !== text) this.input.value = text;
    this.input.classList.remove('Invalid');
  }

  /** 啟用／停用 */
  setDisabled(disabled) {
    this.input.disabled = disabled;
    for (const b of this.el.querySelectorAll('button')) b.disabled = disabled;
  }

  /** 解析並套用輸入 */
  apply() {
    const { sampleRate, unit } = this.context();
    const parsed = parseTime(this.input.value, sampleRate, unit);
    if (!parsed) {
      this.input.classList.add('Invalid');
      return false;
    }
    const target = parsed.relative ? this.value + parsed.samples : parsed.samples;
    const clamped = Math.max(this.min, target);
    this.input.classList.remove('Invalid');
    if (clamped !== this.value) this.onCommit(clamped);
    this.editing = false;
    this.setValue(clamped);
    return true;
  }

  /** 以毫秒微調 */
  nudge(ms) {
    const { sampleRate } = this.context();
    const target = Math.max(this.min, this.value + msToSamples(ms, sampleRate));
    this.onCommit(target);
    this.setValue(target);
  }

  handleKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (this.apply()) this.input.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.editing = false;
      this.setValue(this.value);
      this.input.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
      this.editing = false;
      this.nudge(step);
      this.editing = true;
      this.input.select();
    }
    e.stopPropagation(); // 避免觸發全域快捷鍵
  }
}
