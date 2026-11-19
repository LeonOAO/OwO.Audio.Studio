/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Components / Dom
 * --------------------------------------------------------------------------
 * 精簡的 DOM 建構工具，讓元件程式碼保持可讀。
 *
 *   h('button', { class: 'Btn', onclick: fn, title: '說明' }, '文字', childNode)
 * ========================================================================== */

/**
 * 建立元素。
 * @param {string} tag
 * @param {object|null} [props] 屬性；on 開頭為事件；class、style、dataset 特別處理
 * @param {...(Node|string|number|null|false)} children
 * @returns {HTMLElement}
 */
export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else if (key in el && typeof value !== 'string') el[key] = value;
      else el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

/** 加入子節點（支援巢狀陣列與文字） */
function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** 清空並替換子節點 */
export function replaceChildren(el, ...children) {
  el.replaceChildren();
  append(el, children);
}

/** 以 id 取得元素 */
export function $(id) {
  return document.getElementById(id);
}

/**
 * 建立下拉選單。
 * @param {[any, string][]} choices
 * @param {any} value
 * @param {(value: string) => void} onChange
 * @param {object} [props]
 */
export function select(choices, value, onChange, props = {}) {
  const el = h('select', { class: 'Select', ...props, onchange: (e) => onChange(e.target.value) },
    choices.map(([v, label]) => h('option', { value: String(v) }, label)));
  el.value = String(value);
  return el;
}

/** 判斷事件是否發生在可輸入元素內 */
export function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
