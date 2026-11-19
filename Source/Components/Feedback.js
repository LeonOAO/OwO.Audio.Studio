/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Components / Feedback
 * --------------------------------------------------------------------------
 * 使用者回饋元件：
 *   LogPanel     日誌面板（每筆一行、筆與筆之間空一行，可複製與清除）
 *   StatusBar    狀態列（引擎、規格、長度、輸出音量表）
 *   Toast        右下角短暫提示
 *   BusyOverlay  匯入／匯出進度遮罩（可取消）
 *   DropOverlay  拖曳檔案提示
 * ========================================================================== */

import { h } from './Dom.js';
import { formatTime } from '../Domain/TimeCode.js';

/* ==========================================================================
 * 日誌面板
 * ========================================================================== */

export class LogPanel {
  constructor() {
    this.entries = [];
    this.text = h('pre', { class: 'LogText' });
    this.count = h('span', { class: 'LogCount' }, '0');
    this.collapsed = false;

    this.toggleBtn = h('button', { class: 'LinkBtn', type: 'button', onclick: () => this.toggle() }, '收合');
    this.el = h('section', { class: 'LogPanel' },
      h('header', { class: 'LogHeader' },
        h('span', null, '📝 日誌 '), this.count,
        h('span', { class: 'Spacer' }),
        h('button', { class: 'LinkBtn', type: 'button', onclick: () => this.copy() }, '複製'),
        h('button', { class: 'LinkBtn', type: 'button', onclick: () => this.clear() }, '清除'),
        this.toggleBtn),
      this.text);
  }

  /**
   * 新增一筆日誌。
   * @param {string} message
   * @param {'info'|'warn'|'error'} [level]
   */
  add(message, level = 'info') {
    const time = new Date().toLocaleTimeString('zh-TW', { hour12: false });
    const icon = { info: 'ℹ', warn: '⚠', error: '✖' }[level] || 'ℹ';
    // 多行訊息（例如 ffmpeg 輸出）每行縮排，保持「一行文字＋一個空白行」的版面
    const lines = String(message).split('\n').filter((l) => l.trim() !== '');
    const body = lines.map((l, i) => (i === 0 ? l : `    ${l}`)).join('\n');
    this.entries.push(`[${time}] ${icon} ${body}`);
    if (this.entries.length > 500) this.entries.splice(0, 100);
    this.render();
  }

  render() {
    this.text.textContent = this.entries.join('\n\n');
    this.count.textContent = String(this.entries.length);
    this.text.scrollTop = this.text.scrollHeight;
  }

  clear() {
    this.entries = [];
    this.render();
  }

  async copy() {
    try {
      await navigator.clipboard.writeText(this.entries.join('\n\n'));
    } catch {
      /* 剪貼簿權限不足時忽略 */
    }
  }

  toggle() {
    this.collapsed = !this.collapsed;
    this.el.classList.toggle('Collapsed', this.collapsed);
    this.toggleBtn.textContent = this.collapsed ? '展開' : '收合';
  }
}

/* ==========================================================================
 * 狀態列
 * ========================================================================== */

export class StatusBar {
  /**
   * @param {import('../App/Editor.js').Editor} editor
   */
  constructor(editor) {
    this.editor = editor;
    this.engine = h('span', { class: 'StatusItem' });
    this.spec = h('span', { class: 'StatusItem' });
    this.length = h('span', { class: 'StatusItem' });
    this.isolation = h('span', { class: 'StatusItem' });
    this.meterFill = h('div', { class: 'MeterFill' });
    this.meterText = h('span', { class: 'MeterText' }, '-∞ dB');

    this.el = h('footer', { class: 'StatusBar' },
      this.engine, this.spec, this.length, this.isolation,
      h('span', { class: 'Spacer' }),
      h('span', { class: 'StatusItem' }, '輸出'),
      h('div', { class: 'Meter' }, this.meterFill),
      this.meterText);

    editor.store.subscribe(() => this.update());
    this.update();
    this.peakHold = 0;
    setInterval(() => this.updateMeter(), 60);
  }

  update() {
    const editor = this.editor;
    const { engine } = editor.state;
    const project = editor.project;
    const icon = { ready: '🟢', fallback: '🟡', detecting: '⏳', idle: '⚪' }[engine.status] || '⚪';
    this.engine.textContent = `${icon} ${engine.message}`;
    this.spec.textContent = `${project.sampleRate.toLocaleString()} Hz／${project.channelCount === 1 ? '單聲道' : '立體聲'}`;
    this.length.textContent = `總長度 ${formatTime(editor.length(), project.sampleRate)}`;
    this.isolation.textContent = self.crossOriginIsolated ? '🔒 跨來源隔離' : '🔓 未隔離（單執行緒）';
  }

  updateMeter() {
    const peak = this.editor.transport.meter();
    this.peakHold = Math.max(peak, this.peakHold * 0.9);
    const db = this.peakHold > 0 ? 20 * Math.log10(this.peakHold) : -Infinity;
    const ratio = Number.isFinite(db) ? Math.max(0, Math.min(1, (db + 60) / 60)) : 0;
    this.meterFill.style.width = `${(ratio * 100).toFixed(1)}%`;
    this.meterFill.classList.toggle('Clip', db >= -0.1);
    this.meterText.textContent = Number.isFinite(db) ? `${db.toFixed(1)} dB` : '-∞ dB';
  }
}

/* ==========================================================================
 * 短暫提示
 * ========================================================================== */

export class Toast {
  constructor() {
    this.el = h('div', { class: 'ToastHost', 'aria-live': 'polite' });
  }

  show(message, level = 'info') {
    const item = h('div', { class: `Toast ${level}` }, message);
    this.el.appendChild(item);
    setTimeout(() => item.classList.add('Hide'), 3200);
    setTimeout(() => item.remove(), 3700);
  }
}

/* ==========================================================================
 * 進度遮罩
 * ========================================================================== */

export class BusyOverlay {
  /**
   * @param {import('../App/Editor.js').Editor} editor
   */
  constructor(editor) {
    this.label = h('div', { class: 'BusyLabel' });
    this.bar = h('div', { class: 'BusyBarFill' });
    this.percent = h('div', { class: 'BusyPercent' });
    this.el = h('div', { class: 'BusyOverlay' },
      h('div', { class: 'BusyCard' },
        h('div', { class: 'Spinner' }),
        this.label,
        h('div', { class: 'BusyBar' }, this.bar),
        this.percent,
        h('button', { class: 'Btn', type: 'button', onclick: () => editor.cancelBusy() }, '取消')));

    editor.store.subscribe((state, changed) => {
      if (!changed.has('busy')) return;
      const { active, label, ratio } = state.busy;
      this.el.classList.toggle('Show', active);
      this.label.textContent = label;
      const pct = Math.max(0, Math.min(100, ratio * 100));
      this.bar.style.width = `${pct.toFixed(1)}%`;
      this.percent.textContent = `${pct.toFixed(0)}%`;
    });
  }
}

/* ==========================================================================
 * 拖曳檔案
 * ========================================================================== */

export class DropOverlay {
  /**
   * @param {(files: FileList) => void} onDrop
   */
  constructor(onDrop) {
    this.el = h('div', { class: 'DropOverlay' }, h('div', { class: 'DropCard' }, '📥 放開以匯入檔案'));
    let depth = 0;
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      this.el.classList.add('Show');
    });
    window.addEventListener('dragover', (e) => {
      if (hasFiles(e)) e.preventDefault();
    });
    window.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) this.el.classList.remove('Show');
    });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      this.el.classList.remove('Show');
      if (e.dataTransfer.files.length) onDrop(e.dataTransfer.files);
    });
  }
}
