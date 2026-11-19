/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Commands / History
 * --------------------------------------------------------------------------
 * 復原／重做堆疊。
 *
 * 專案模型為不可變資料，每一步只保存「操作前的專案參照」，
 * 不複製任何 PCM，因此 200 步也幾乎不佔記憶體。
 *
 * mergeKey：連續且相同 mergeKey 的操作（例如拖曳、連續微調）合併為一步。
 * ========================================================================== */

export class History {
  /**
   * @param {number} [limit=200] 最大步數
   */
  constructor(limit = 200) {
    this.limit = limit;
    /** @type {{ project: object, label: string, mergeKey: string|null, time: number }[]} */
    this.undoStack = [];
    /** @type {{ project: object, label: string }[]} */
    this.redoStack = [];
  }

  /**
   * 記錄一次修改。
   * @param {object} previousProject 修改前的專案
   * @param {string} label           操作名稱（顯示用）
   * @param {string|null} [mergeKey] 合併鍵
   */
  record(previousProject, label, mergeKey = null) {
    const now = Date.now();
    const last = this.undoStack[this.undoStack.length - 1];

    // 1.5 秒內相同 mergeKey 的操作合併：保留最早的修改前狀態
    if (mergeKey && last && last.mergeKey === mergeKey && now - last.time < 1500) {
      last.time = now;
      this.redoStack = [];
      return;
    }

    this.undoStack.push({ project: previousProject, label, mergeKey, time: now });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  /**
   * 復原。
   * @param {object} currentProject
   * @returns {{ project: object, label: string } | null}
   */
  undo(currentProject) {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push({ project: currentProject, label: entry.label });
    return { project: entry.project, label: entry.label };
  }

  /**
   * 重做。
   * @param {object} currentProject
   * @returns {{ project: object, label: string } | null}
   */
  redo(currentProject) {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push({ project: currentProject, label: entry.label, mergeKey: null, time: 0 });
    return { project: entry.project, label: entry.label };
  }

  /** 清空全部紀錄（開新專案時使用） */
  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  /** 下一個可復原的操作名稱 */
  get undoLabel() {
    const last = this.undoStack[this.undoStack.length - 1];
    return last ? last.label : '';
  }

  /** 下一個可重做的操作名稱 */
  get redoLabel() {
    const last = this.redoStack[this.redoStack.length - 1];
    return last ? last.label : '';
  }
}
