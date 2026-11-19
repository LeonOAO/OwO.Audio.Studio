/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Components / Dialogs
 * --------------------------------------------------------------------------
 * 使用原生 <dialog> 的對話框：
 *   InsertSilenceDialog  插入空白（位置＋長度，毫秒精度，常用長度快速鍵）
 *   ExportDialog         匯出（模式、範圍、格式、動態選項、取樣率、中繼資料、封面）
 *   StreamDialog         多音軌檔案選擇音軌
 *   ShortcutsDialog      快捷鍵一覽
 *   EnvironmentDialog    執行環境資訊
 * ========================================================================== */

import { h, select, replaceChildren } from './Dom.js';
import { TimeInput } from './TimeInput.js';
import { msToSamples } from '../Domain/TimeCode.js';
import {
  PRESETS, PRESET_GROUPS, getPreset, defaultOptions, isOptionVisible,
  SAMPLE_RATE_CHOICES, CHANNEL_CHOICES, METADATA_FIELDS
} from '../Engine/Export/Presets.js';
import { detectCapabilities, CAPABILITY_LABELS } from '../Platform/Capabilities.js';

/**
 * 建立對話框外殼。
 * @param {string} title
 * @param {HTMLElement} body
 * @param {HTMLElement[]} buttons
 * @param {string} [extraClass]
 */
function createShell(title, body, buttons, extraClass = '') {
  const dialog = h('dialog', { class: `Dialog ${extraClass}` },
    h('header', { class: 'DialogHeader' },
      h('h2', null, title),
      h('button', { class: 'DialogClose', type: 'button', title: '關閉', onclick: () => dialog.close('cancel') }, '✕')),
    h('div', { class: 'DialogBody' }, body),
    h('footer', { class: 'DialogFooter' }, ...buttons));
  dialog.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.appendChild(dialog);
  return dialog;
}

/* ==========================================================================
 * 插入空白
 * ========================================================================== */

export class InsertSilenceDialog {
  constructor(editor) {
    this.editor = editor;
    const context = () => ({ sampleRate: editor.project.sampleRate, unit: editor.state.settings.unit });
    this.position = new TimeInput({ label: '插入位置', context, onCommit: (v) => { this.positionValue = v; } });
    this.length = new TimeInput({ label: '空白長度', context, onCommit: (v) => { this.lengthValue = v; } });
    this.scope = select([['all', '全部音軌（保持同步）'], ['current', '只有目前音軌']], 'all', () => {});

    const preset = (ms, text) => h('button', {
      class: 'Chip', type: 'button',
      onclick: () => {
        this.lengthValue = msToSamples(ms, editor.project.sampleRate);
        this.length.setValue(this.lengthValue);
      }
    }, text);

    const body = h('div', { class: 'Form' },
      h('p', { class: 'Muted' }, '在指定位置插入空白，後方內容會整段往後推，總長度增加。若只要讓某段變安靜而不改變長度，請改用「靜音」。'),
      this.position.el,
      this.length.el,
      h('div', { class: 'ChipRow' },
        preset(1, '1 ms'), preset(10, '10 ms'), preset(100, '100 ms'), preset(250, '250 ms'),
        preset(500, '500 ms'), preset(1000, '1 秒'), preset(2000, '2 秒'), preset(5000, '5 秒'), preset(10000, '10 秒')),
      h('label', { class: 'Row' }, h('span', null, '套用音軌'), this.scope),
      h('p', { class: 'Hint' }, '可直接輸入 2.75s、2750ms 或 00:00:02.750；輸入框內按 ↑↓ 可微調 1 毫秒。'));

    this.dialog = createShell('⎵ 插入空白', body, [
      h('button', { class: 'Btn', type: 'button', onclick: () => this.dialog.close('cancel') }, '取消'),
      h('button', { class: 'Btn Primary', type: 'button', onclick: () => this.confirm() }, '插入')
    ]);
  }

  open() {
    const editor = this.editor;
    const sel = editor.state.selection;
    this.positionValue = sel.end > sel.start ? sel.start : editor.state.playhead;
    this.lengthValue = this.lengthValue || msToSamples(1000, editor.project.sampleRate);
    this.position.setValue(this.positionValue);
    this.length.setValue(this.lengthValue);
    this.scope.value = editor.state.settings.scope;
    this.dialog.showModal();
  }

  confirm() {
    // 先套用輸入框中尚未確認的文字
    if (!this.position.apply() || !this.length.apply()) return;
    if (this.lengthValue <= 0) {
      this.length.input.classList.add('Invalid');
      return;
    }
    const trackIds = this.scope.value === 'current' ? [this.editor.state.currentTrackId] : null;
    if (this.editor.insertSilence(this.positionValue, this.lengthValue, trackIds)) this.dialog.close('ok');
  }
}

/* ==========================================================================
 * 匯出
 * ========================================================================== */

export class ExportDialog {
  constructor(editor) {
    this.editor = editor;
    this.formatId = 'mp3';
    this.optionValues = {};
    this.cover = null;

    // 模式
    this.mode = select([['mix', '完整混音（精確，重新編碼）'], ['stems', '每條音軌分別輸出（ZIP）'], ['fastcut', '快速裁切原始檔（不重新編碼）']],
      'mix', () => this.refresh());
    this.range = select([['all', '整個專案'], ['selection', '選取範圍']], 'all', () => {});
    this.fileName = h('input', { class: 'TextField', type: 'text' });

    // 格式（分組）
    this.format = h('select', { class: 'Select', onchange: (e) => this.selectFormat(e.target.value) },
      PRESET_GROUPS.map(([group, label]) => h('optgroup', { label },
        PRESETS.filter((p) => p.group === group).map((p) => h('option', { value: p.id }, p.label)))));
    this.formatOptions = h('div', { class: 'Form' });
    this.sampleRate = select(SAMPLE_RATE_CHOICES, 'source', () => this.refresh());
    this.channels = select(CHANNEL_CHOICES, 'source', () => this.refresh());

    // 中繼資料
    this.metaInputs = {};
    const metaGrid = h('div', { class: 'MetaGrid' },
      METADATA_FIELDS.map(([key, label]) => {
        const input = h('input', { class: 'TextField', type: 'text', placeholder: label });
        this.metaInputs[key] = input;
        return h('label', { class: 'Row Stack' }, h('span', null, label), input);
      }));
    this.coverInput = h('input', {
      type: 'file', accept: 'image/jpeg,image/png',
      onchange: (e) => { this.cover = e.target.files[0] || null; }
    });

    this.notice = h('div', { class: 'Notice' });
    this.formatSection = h('fieldset', { class: 'Fieldset' },
      h('legend', null, '格式'),
      h('label', { class: 'Row' }, h('span', null, '輸出格式'), this.format),
      this.formatOptions,
      h('label', { class: 'Row' }, h('span', null, '取樣率'), this.sampleRate),
      h('label', { class: 'Row' }, h('span', null, '聲道'), this.channels));
    this.metaSection = h('fieldset', { class: 'Fieldset' },
      h('legend', null, '中繼資料'),
      metaGrid,
      h('label', { class: 'Row' }, h('span', null, '封面圖片'), this.coverInput));

    const body = h('div', { class: 'Form ExportForm' },
      this.notice,
      h('fieldset', { class: 'Fieldset' },
        h('legend', null, '輸出'),
        h('label', { class: 'Row' }, h('span', null, '模式'), this.mode),
        h('label', { class: 'Row' }, h('span', null, '範圍'), this.range),
        h('label', { class: 'Row' }, h('span', null, '檔案名稱'), this.fileName)),
      this.formatSection,
      this.metaSection);

    this.confirmBtn = h('button', { class: 'Btn Primary', type: 'button', onclick: () => this.confirm() }, '開始匯出');
    this.dialog = createShell('💾 匯出音訊', body, [
      h('button', { class: 'Btn', type: 'button', onclick: () => this.dialog.close('cancel') }, '取消'),
      this.confirmBtn
    ], 'Wide');

    this.selectFormat(this.formatId);
  }

  open() {
    const editor = this.editor;
    const project = editor.project;
    this.range.value = editor.hasSelection() ? 'selection' : 'all';

    // 預設檔名：專案名稱，或第一個來源檔名
    const firstSource = Object.values(project.sources)[0];
    const base = project.name && project.name !== '未命名專案'
      ? project.name
      : firstSource ? firstSource.fileName.replace(/\.[^.]+$/, '') + '_edit' : 'OwO_Audio';
    this.fileName.value = base;

    // 中繼資料：從第一個來源帶入（只填空白欄位）
    const meta = (firstSource && firstSource.originalFormat && firstSource.originalFormat.metadata) || {};
    for (const [key] of METADATA_FIELDS) {
      if (!this.metaInputs[key].value && meta[key]) this.metaInputs[key].value = meta[key];
    }

    this.refresh();
    this.dialog.showModal();
  }

  selectFormat(id) {
    this.formatId = id;
    this.format.value = id;
    const preset = getPreset(id);
    this.optionValues = defaultOptions(preset);
    this.refresh();
  }

  /** 依目前選擇重建格式選項與提示 */
  refresh() {
    const editor = this.editor;
    const preset = getPreset(this.formatId);
    const mode = this.mode.value;
    const engine = editor.ffmpeg.available;

    // 動態選項
    replaceChildren(this.formatOptions,
      preset.options.filter((opt) => isOptionVisible(opt, this.optionValues)).map((opt) =>
        h('label', { class: 'Row' }, h('span', null, opt.label),
          select(opt.choices, this.optionValues[opt.key], (v) => {
            const sample = opt.choices.find(([c]) => String(c) === v);
            this.optionValues[opt.key] = sample ? sample[0] : v;
            this.refresh();
          }))));

    // 各區塊顯示
    const fast = mode === 'fastcut';
    this.formatSection.style.display = fast ? 'none' : '';
    this.metaSection.style.display = fast ? 'none' : '';
    this.coverInput.disabled = !preset.cover || !engine;
    this.sampleRate.disabled = Boolean(preset.fixedRate);
    if (preset.fixedRate) this.sampleRate.value = String(preset.fixedRate);
    else if (this.sampleRate.value === '48000' && this.lastFixed) this.sampleRate.value = 'source';
    this.lastFixed = Boolean(preset.fixedRate);

    // 提示與可用性
    const notes = [];
    let blocked = false;
    if (fast) {
      if (!editor.canFastCut()) {
        blocked = true;
        notes.push('⚠ 快速裁切需要 ffmpeg 核心，且專案中只能有一個本次匯入的來源檔案。');
      }
      notes.push('ℹ 快速裁切直接複製原始壓縮資料：速度快、音質不變，但起訖點會對齊 MP3／AAC 的壓縮框架，不保證準確到毫秒；專案中的剪輯、淡化與增益不會套用。');
    } else {
      const builtinWav = preset.id === 'wav' && this.sampleRate.value === 'source' && this.channels.value === 'source';
      if (!engine && !builtinWav) {
        blocked = true;
        notes.push(preset.id === 'wav'
          ? '⚠ 未安裝 ffmpeg 核心：WAV 只能以「跟隨專案」的取樣率與聲道輸出。'
          : `⚠ ${preset.label} 需要 ffmpeg 核心。請執行 FetchEngine 下載核心，或改選 WAV。`);
      }
      if (preset.fixedRate) notes.push(`ℹ ${preset.label} 固定使用 ${preset.fixedRate.toLocaleString()} Hz。`);
      if (preset.allowedRates) notes.push(`ℹ ${preset.label} 只支援 ${preset.allowedRates.map((r) => r.toLocaleString()).join('、')} Hz。`);
      if (mode === 'stems') notes.push('ℹ 分軌輸出會忽略獨奏／靜音設定，每條含片段的音軌各輸出一個檔案並打包成 ZIP。');
      if (builtinWav) notes.push('ℹ 使用內建 WAV 編碼器，不需要 ffmpeg 核心。');
      if (preset.cover && !engine) notes.push('ℹ 內嵌封面需要 ffmpeg 核心。');
    }
    replaceChildren(this.notice, notes.map((n) => h('p', null, n)));
    this.confirmBtn.disabled = blocked;
  }

  confirm() {
    const metadata = {};
    for (const [key] of METADATA_FIELDS) metadata[key] = this.metaInputs[key].value;

    const request = {
      mode: this.mode.value,
      formatId: this.formatId,
      options: { ...this.optionValues },
      common: {
        sampleRate: this.sampleRate.value === 'source' ? 'source' : Number(this.sampleRate.value),
        channels: this.channels.value === 'source' ? 'source' : Number(this.channels.value)
      },
      metadata,
      cover: this.cover,
      useSelection: this.range.value === 'selection',
      baseName: this.fileName.value.trim() || 'OwO_Audio'
    };
    this.dialog.close('ok');
    this.editor.exportAudio(request);
  }
}

/* ==========================================================================
 * 選擇音軌
 * ========================================================================== */

export class StreamDialog {
  constructor() {
    this.list = h('div', { class: 'StreamList' });
    this.title = h('p', { class: 'Muted' });
    this.dialog = createShell('🎼 選擇音軌', h('div', { class: 'Form' }, this.title, this.list), [
      h('button', { class: 'Btn Primary', type: 'button', onclick: () => this.dialog.close('ok') }, '使用此音軌')
    ]);
  }

  /**
   * @param {{ fileName: string, streams: object[] }} info
   * @returns {Promise<number>}
   */
  choose(info) {
    this.title.textContent = `「${info.fileName}」包含 ${info.streams.length} 條音軌，請選擇要匯入的音軌：`;
    replaceChildren(this.list, info.streams.map((s, i) =>
      h('label', { class: 'StreamItem' },
        h('input', { type: 'radio', name: 'stream', value: String(i), checked: i === 0 }),
        h('span', null, `#${i + 1}　${s.codec}　${s.sampleRate} Hz　${s.channelLayout || `${s.channels} 聲道`}` +
          `${s.bitrateKbps ? `　${s.bitrateKbps} kbps` : ''}${s.language ? `　[${s.language}]` : ''}`))));
    return new Promise((resolve) => {
      this.dialog.onclose = () => {
        const checked = this.list.querySelector('input:checked');
        resolve(checked ? Number(checked.value) : 0);
      };
      this.dialog.showModal();
    });
  }
}

/* ==========================================================================
 * 快捷鍵
 * ========================================================================== */

export const SHORTCUTS = [
  ['播放', [['空白鍵', '播放／暫停'], ['Esc', '停止；再按一次回到選取起點'], ['Home／End', '跳到開頭／結尾'], ['L', '循環播放選取範圍'], ['P', '從選取起點前 1 秒試聽']]],
  ['播放頭', [['← →', '移動 100 毫秒'], ['Alt + ← →', '移動 1 毫秒'], ['Alt + Shift + ← →', '移動 10 毫秒'], ['Ctrl + ← →', '移動 1 秒']]],
  ['選取', [['拖曳', '選取範圍'], ['Shift + 點擊', '延伸選取'], ['雙擊片段', '選取整個片段'], ['[ ／ ]', '以播放頭設定選取起點／終點'], ['Ctrl + A', '全選'], ['Ctrl + D', '取消選取']]],
  ['剪輯', [['S', '在播放頭分割'], ['Delete', '刪除並接合（無選取時刪除片段並接合）'], ['Shift + Delete', '靜音（長度不變）'], ['I／Insert', '插入空白'], ['K', '只保留選取'], ['F／Shift + F', '淡入／淡出'], ['Ctrl + C／X', '複製／剪下'], ['Ctrl + V', '插入貼上'], ['Ctrl + Shift + V', '覆蓋貼上']]],
  ['其他', [['Ctrl + Z', '復原'], ['Ctrl + Y／Ctrl + Shift + Z', '重做'], ['Ctrl + O', '匯入'], ['Ctrl + E', '匯出'], ['Ctrl + T', '新增音軌'], ['＋／－／0／Z', '放大／縮小／全部／縮放到選取'], ['Ctrl + 滾輪', '以游標為中心縮放'], ['Shift + 滾輪', '水平捲動'], ['?', '快捷鍵一覽']]]
];

export class ShortcutsDialog {
  constructor() {
    const body = h('div', { class: 'ShortcutGrid' },
      SHORTCUTS.map(([group, items]) => h('section', null,
        h('h4', null, group),
        h('dl', null, items.map(([k, v]) => [h('dt', null, h('kbd', null, k)), h('dd', null, v)])))));
    this.dialog = createShell('⌨ 快捷鍵', body, [
      h('button', { class: 'Btn Primary', type: 'button', onclick: () => this.dialog.close() }, '關閉')
    ], 'Wide');
  }

  open() {
    this.dialog.showModal();
  }
}

/* ==========================================================================
 * 執行環境
 * ========================================================================== */

export class EnvironmentDialog {
  constructor(editor) {
    this.editor = editor;
    this.body = h('div', { class: 'InfoGrid Wide' });
    this.dialog = createShell('ℹ 執行環境', this.body, [
      h('button', { class: 'Btn Primary', type: 'button', onclick: () => this.dialog.close() }, '關閉')
    ]);
  }

  async open() {
    const caps = detectCapabilities();
    const editor = this.editor;
    const usage = await editor.persistence.usage();
    const yes = (v) => (typeof v === 'boolean' ? (v ? '✔ 支援' : '✖ 不支援') : String(v || '—'));
    replaceChildren(this.body,
      h('span', null, '版本'), h('span', null, 'OwO Audio Studio v1.0.0'),
      h('span', null, '音訊引擎'), h('span', null, editor.state.engine.message),
      h('span', null, '自動儲存'), h('span', null, editor.persistence.opfsReady ? '✔ IndexedDB＋OPFS' : '✖ 停用'),
      h('span', null, '儲存空間'), h('span', null, usage ? `${(usage.usage / 1048576).toFixed(1)} MB／${(usage.quota / 1073741824).toFixed(1)} GB` : '—'),
      Object.entries(caps).map(([k, v]) => [h('span', null, CAPABILITY_LABELS[k] || k), h('span', null, yes(v))]));
    this.dialog.showModal();
  }
}
