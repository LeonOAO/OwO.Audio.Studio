/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * App / Main
 * --------------------------------------------------------------------------
 * 程式進入點：
 *   1. 註冊 Service Worker（離線快取＋補上跨來源隔離標頭）
 *   2. 建立 Editor 與所有 UI 元件並掛載到頁面
 *   3. 綁定快捷鍵、拖曳匯入
 *   4. 初始化引擎與還原上次專案
 * ========================================================================== */

import { Editor } from './Editor.js';
import { h, $ } from '../Components/Dom.js';
import { Toolbar } from '../Components/Toolbar.js';
import { TimeBar } from '../Components/TimeBar.js';
import { Timeline } from '../Components/Timeline.js';
import { Inspector } from '../Components/Inspector.js';
import {
  InsertSilenceDialog, ExportDialog, StreamDialog, ShortcutsDialog, EnvironmentDialog
} from '../Components/Dialogs.js';
import { LogPanel, StatusBar, Toast, BusyOverlay, DropOverlay } from '../Components/Feedback.js';
import { bindShortcuts } from '../Platform/Shortcuts.js';
import { ACCEPT_ATTRIBUTE } from '../Engine/Import/Importer.js';

/* --------------------------------------------------------------------------
 * Service Worker
 * ------------------------------------------------------------------------ */

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  try {
    const reg = await navigator.serviceWorker.register(new URL('../../ServiceWorker.js', import.meta.url), { scope: './' });

    // 伺服器未提供 COOP/COEP 標頭時（例如 GitHub Pages），由 Service Worker 補上後重新載入一次
    if (!self.crossOriginIsolated && !sessionStorage.getItem('OwOAudioStudio.CoiReload')) {
      await navigator.serviceWorker.ready;
      if (reg.active && navigator.serviceWorker.controller) {
        sessionStorage.setItem('OwOAudioStudio.CoiReload', '1');
        location.reload();
        return;
      }
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!sessionStorage.getItem('OwOAudioStudio.CoiReload')) {
          sessionStorage.setItem('OwOAudioStudio.CoiReload', '1');
          location.reload();
        }
      });
    }
  } catch (error) {
    console.warn('Service Worker 註冊失敗：', error);
  }
}

/* --------------------------------------------------------------------------
 * 啟動
 * ------------------------------------------------------------------------ */

async function main() {
  const root = $('App');
  const editor = new Editor();
  window.OwOAudioStudio = editor; // 方便於開發者工具除錯

  // 回饋元件
  const log = new LogPanel();
  const toast = new Toast();
  editor.ui.log = (m, l) => log.add(m, l);
  editor.ui.toast = (m, l) => toast.show(m, l);

  // 對話框
  const streamDialog = new StreamDialog();
  editor.ui.chooseStream = (info) => streamDialog.choose(info);
  const insertDialog = new InsertSilenceDialog(editor);
  const exportDialog = new ExportDialog(editor);
  const shortcutsDialog = new ShortcutsDialog();
  const environmentDialog = new EnvironmentDialog(editor);

  // 檔案選擇器
  const fileInput = h('input', {
    type: 'file', multiple: true, accept: ACCEPT_ATTRIBUTE, style: { display: 'none' },
    onchange: (e) => {
      editor.importFiles(e.target.files);
      e.target.value = '';
    }
  });

  const actions = {
    openFiles: () => fileInput.click(),
    openExport: () => {
      if (!editor.length()) {
        editor.notify('專案沒有內容可匯出。', 'warn');
        return;
      }
      exportDialog.open();
    },
    openInsertSilence: () => insertDialog.open(),
    openShortcuts: () => shortcutsDialog.open(),
    openEnvironment: () => environmentDialog.open(),
    newProject: () => {
      if (editor.length() && !confirm('確定要清除目前專案並建立新專案？此操作無法復原。')) return;
      editor.newProject();
    }
  };

  // 主要元件
  const toolbar = new Toolbar(editor, actions);
  const timeBar = new TimeBar(editor);
  const timeline = new Timeline(editor);
  const inspector = new Inspector(editor);
  const status = new StatusBar(editor);
  const busy = new BusyOverlay(editor);
  const drop = new DropOverlay((files) => editor.importFiles(files));
  timeline.onTick = (pos) => timeBar.tick(pos);

  root.replaceChildren(
    h('header', { class: 'AppHeader' },
      h('div', { class: 'Brand' },
        h('span', { class: 'BrandLogo' }, '◉'),
        h('span', { class: 'BrandName' }, 'OwO Audio Studio'),
        h('span', { class: 'BrandVersion' }, 'v1.0.0')),
      toolbar.el),
    timeBar.el,
    h('main', { class: 'Workspace' },
      h('div', { class: 'MainColumn' }, timeline.el, log.el),
      inspector.el),
    status.el,
    busy.el,
    drop.el,
    toast.el,
    fileInput
  );

  bindShortcuts(editor, actions);

  // 關閉頁面前提醒（播放中或忙碌時）
  window.addEventListener('beforeunload', (e) => {
    if (editor.state.busy.active) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  editor.log('OwO Audio Studio v1.0.0 已啟動，所有處理都在本機瀏覽器完成，檔案不會上傳。');
  await editor.init();
  editor.zoomToFit();
}

/* --------------------------------------------------------------------------
 * 進入點
 * ------------------------------------------------------------------------ */

registerServiceWorker();
main().catch((error) => {
  console.error(error);
  const box = document.getElementById('BootError');
  if (box) {
    box.style.display = 'block';
    box.textContent = `啟動失敗：${error.message}`;
  }
});
