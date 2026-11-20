/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Components / Toolbar
 * --------------------------------------------------------------------------
 * 頂部工具列：檔案、歷史、播放、剪輯、音軌、檢視、說明。
 * 依狀態自動更新按鈕可用性與播放按鈕圖示。
 * ========================================================================== */

import { h } from './Dom.js';

export class Toolbar {
  /**
   * @param {import('../App/Editor.js').Editor} editor
   * @param {object} actions 由 Main 傳入的對話框動作
   */
  constructor(editor, actions) {
    this.editor = editor;
    this.buttons = {};

    /** 建立按鈕 */
    const btn = (key, icon, text, title, onclick, extraClass = '') => {
      // 點擊後移除焦點，避免空白鍵同時觸發按鈕與播放快捷鍵
      const handler = (e) => {
        e.currentTarget.blur();
        onclick();
      };
      const el = h('button', { class: `ToolBtn ${extraClass}`, type: 'button', title, onclick: handler },
        h('span', { class: 'ToolIcon' }, icon),
        h('span', { class: 'ToolText' }, text));
      this.buttons[key] = el;
      return el;
    };

    /** 建立群組 */
    const group = (title, ...items) =>
      h('div', { class: 'ToolGroup', role: 'group', 'aria-label': title }, ...items);

    this.el = h('div', { class: 'Toolbar' },
      group('檔案',
        btn('open', '📂', '匯入', '匯入音訊或影片檔案（Ctrl+O）', () => actions.openFiles()),
        btn('new', '🆕', '新專案', '清除目前專案並建立新專案', () => actions.newProject()),
        btn('export', '💾', '匯出', '匯出音訊（Ctrl+E）', () => actions.openExport(), 'Primary')),
      group('歷史',
        btn('undo', '↶', '復原', '復原（Ctrl+Z）', () => editor.undo()),
        btn('redo', '↷', '重做', '重做（Ctrl+Y／Ctrl+Shift+Z）', () => editor.redo())),
      group('播放',
        btn('home', '⏮', '開頭', '回到開頭（Home）', () => editor.setPlayhead(0)),
        btn('play', '▶', '播放', '播放／暫停（空白鍵）', () => editor.togglePlay(), 'Accent'),
        btn('stop', '⏹', '停止', '停止；再按一次回到選取起點（Esc）', () => editor.stop()),
        btn('loop', '🔁', '循環', '循環播放選取範圍（L）', () => editor.toggleLoop()),
        btn('preview', '🎧', '試聽', '從選取起點前 1 秒開始播放（P）', () => editor.previewAround())),
      group('剪輯',
        btn('split', '✂', '分割', '在播放頭分割片段（S）', () => editor.split()),
        btn('delete', '⌫', '刪除接合', '刪除選取範圍並接合（Delete）', () => editor.rippleDelete()),
        btn('silence', '🔇', '靜音', '選取範圍靜音，長度不變（Shift+Delete）', () => editor.silence()),
        btn('insert', '▢', '插入空白', '在指定位置插入任意長度空白（Insert／I）', () => actions.openInsertSilence()),
        btn('keep', '⛶', '只保留', '只保留選取範圍（K）', () => editor.keepRange()),
        btn('copy', '⧉', '複製', '複製選取範圍（Ctrl+C）', () => editor.copy()),
        btn('cut', '✄', '剪下', '剪下選取範圍（Ctrl+X）', () => editor.cut()),
        btn('pasteInsert', '⤵', '插入貼上', '在播放頭插入貼上，後方內容往後推（Ctrl+V）', () => editor.paste(true)),
        btn('pasteOver', '⇣', '覆蓋貼上', '在播放頭覆蓋貼上，長度不變（Ctrl+Shift+V）', () => editor.paste(false)),
        btn('fadeIn', '◢', '淡入', '選取範圍淡入（F）', () => editor.fade('in')),
        btn('fadeOut', '◣', '淡出', '選取範圍淡出（Shift+F）', () => editor.fade('out'))),
      group('音軌',
        btn('addTrack', '＋', '新增音軌', '新增空白音軌（Ctrl+T）', () => editor.addTrack())),
      group('檢視',
        btn('zoomIn', '🔍', '放大', '放大（＋／Ctrl+滾輪）', () => editor.zoom(0.5)),
        btn('zoomOut', '🔎', '縮小', '縮小（－）', () => editor.zoom(2)),
        btn('fit', '↔', '全部', '顯示整個專案（0）', () => editor.zoomToFit()),
        btn('zoomSel', '⊡', '選取', '縮放到選取範圍（Z）', () => editor.zoomToSelection())),
      group('說明',
        btn('keys', '⌨', '快捷鍵', '快捷鍵一覽（?）', () => actions.openShortcuts()),
        btn('env', 'ℹ', '環境', '執行環境與引擎資訊', () => actions.openEnvironment()))
    );

    editor.store.subscribe(() => this.update());
    this.update();
  }

  /** 依狀態更新按鈕 */
  update() {
    const editor = this.editor;
    const state = editor.state;
    const hasAudio = editor.length() > 0;
    const hasSel = editor.hasSelection();
    const b = this.buttons;

    b.undo.disabled = !editor.history.canUndo;
    b.undo.title = editor.history.canUndo ? `復原：${editor.history.undoLabel}（Ctrl+Z）` : '沒有可復原的操作';
    b.redo.disabled = !editor.history.canRedo;
    b.redo.title = editor.history.canRedo ? `重做：${editor.history.redoLabel}（Ctrl+Y）` : '沒有可重做的操作';

    for (const key of ['export', 'play', 'home', 'stop', 'split']) b[key].disabled = !hasAudio;
    for (const key of ['delete', 'silence', 'keep', 'copy', 'cut', 'fadeIn', 'fadeOut', 'zoomSel', 'preview']) {
      b[key].disabled = !hasSel;
    }
    b.pasteInsert.disabled = !editor.clipboard;
    b.pasteOver.disabled = !editor.clipboard;

    const playing = state.transport.playing;
    b.play.querySelector('.ToolIcon').textContent = playing ? '⏸' : '▶';
    b.play.querySelector('.ToolText').textContent = playing ? '暫停' : '播放';
    b.loop.classList.toggle('On', state.transport.loop);
  }
}
