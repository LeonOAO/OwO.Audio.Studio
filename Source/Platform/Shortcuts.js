/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Platform / Shortcuts
 * --------------------------------------------------------------------------
 * 全域快捷鍵。焦點在輸入欄位或對話框開啟時不觸發（避免干擾文字輸入）。
 * 對照表與 Components/Dialogs.js 的 SHORTCUTS 一致。
 * ========================================================================== */

import { isTypingTarget } from '../Components/Dom.js';

/**
 * 綁定快捷鍵。
 * @param {import('../App/Editor.js').Editor} editor
 * @param {object} actions 對話框動作（openFiles、openExport、openInsertSilence、openShortcuts）
 */
export function bindShortcuts(editor, actions) {
  window.addEventListener('keydown', (e) => {
    if (isTypingTarget(e.target)) return;
    if (document.querySelector('dialog[open]')) return;

    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;
    const lower = key.length === 1 ? key.toLowerCase() : key;
    let handled = true;

    if (ctrl) {
      switch (lower) {
        case 'z': if (e.shiftKey) editor.redo(); else editor.undo(); break;
        case 'y': editor.redo(); break;
        case 'c': editor.copy(); break;
        case 'x': editor.cut(); break;
        case 'v': editor.paste(!e.shiftKey); break;
        case 'a': editor.selectAll(); break;
        case 'd': editor.clearSelection(); break;
        case 'o': actions.openFiles(); break;
        case 'e': actions.openExport(); break;
        case 't': editor.addTrack(); break;
        case 'ArrowLeft': editor.nudgePlayhead(-1000); break;
        case 'ArrowRight': editor.nudgePlayhead(1000); break;
        default: handled = false;
      }
    } else {
      switch (lower) {
        case ' ': editor.togglePlay(); break;
        case 'Escape': editor.stop(); break;
        case 'Home': editor.setPlayhead(0); editor.ensureVisible(0); break;
        case 'End': editor.setPlayhead(editor.length()); editor.ensureVisible(editor.length()); break;
        case 'ArrowLeft':
          editor.nudgePlayhead(e.altKey ? (e.shiftKey ? -10 : -1) : -100);
          editor.ensureVisible(editor.state.playhead);
          break;
        case 'ArrowRight':
          editor.nudgePlayhead(e.altKey ? (e.shiftKey ? 10 : 1) : 100);
          editor.ensureVisible(editor.state.playhead);
          break;
        case 's': editor.split(); break;
        case 'Delete':
        case 'Backspace': editor.deleteAction(e.shiftKey); break;
        case 'Insert':
        case 'i': actions.openInsertSilence(); break;
        case 'k': editor.keepRange(); break;
        case 'f': editor.fade(e.shiftKey ? 'out' : 'in'); break;
        case 'l': editor.toggleLoop(); break;
        case 'p': editor.previewAround(); break;
        case '[': editor.markSelection('start'); break;
        case ']': editor.markSelection('end'); break;
        case '+':
        case '=': editor.zoom(0.5); break;
        case '-':
        case '_': editor.zoom(2); break;
        case '0': editor.zoomToFit(); break;
        case 'z': editor.zoomToSelection(); break;
        case '?': actions.openShortcuts(); break;
        default: handled = false;
      }
    }

    if (handled) e.preventDefault();
  });
}
