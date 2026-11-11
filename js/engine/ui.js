// UI slots that the core and plugins fill: drawer panels, tool rail buttons,
// status chips and toasts.
const $ = (id) => document.getElementById(id);

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) if (c != null) node.append(c);
  return node;
}

export class UI {
  #panels = new Map();
  #active = null;

  constructor() {
    this.tabs = $('tabs');
    this.panels = $('panels');
    this.rail = $('toolrail');
    this.status = $('status');
    this.toasts = $('toasts');
    this.drawer = $('drawer');
  }

  // --- drawer panels -------------------------------------------------------
  addPanel({ id, title, render, first = false }) {
    const tab = el('button', { class: 'tab', role: 'tab', text: title, onclick: () => this.selectPanel(id) });
    const body = el('section', { class: 'panel', hidden: true });
    if (first) this.tabs.prepend(tab); else this.tabs.append(tab);
    this.panels.append(body);
    this.#panels.set(id, { tab, body });
    render?.(body);
    if (!this.#active || first) this.selectPanel(id);
    this.#panelsChanged();
    return {
      el: body,
      remove: () => {
        tab.remove(); body.remove(); this.#panels.delete(id);
        if (this.#active === id) {
          this.#active = null;
          const next = this.#panels.keys().next().value;
          if (next) this.selectPanel(next);
        }
        this.#panelsChanged();
      },
    };
  }

  // The drawer only exists on screen while it has at least one panel.
  #panelsChanged() {
    this.drawer.classList.toggle('empty', this.#panels.size === 0);
    this.onPanels?.(this.#panels.size);
  }

  selectPanel(id) {
    if (!this.#panels.has(id)) return;
    this.#active = id;
    for (const [pid, p] of this.#panels) {
      p.tab.classList.toggle('active', pid === id);
      p.body.hidden = pid !== id;
    }
  }

  toggleDrawer(force) {
    const open = force ?? this.drawer.classList.contains('closed');
    this.drawer.classList.toggle('closed', !open);
    return open;
  }

  // --- tool rail -----------------------------------------------------------
  // toggle tools call onToggle(active); plain tools call onClick().
  addTool({ id, label, title, toggle = false, active = false, onToggle, onClick }) {
    const btn = el('button', { class: 'tool', title: title ?? label, 'aria-label': title ?? label, 'data-tool': id, text: label });
    const setActive = (on) => { btn.classList.toggle('active', on); btn.setAttribute('aria-pressed', String(on)); };
    if (toggle) setActive(active);
    btn.addEventListener('click', () => {
      if (toggle) {
        const on = !btn.classList.contains('active');
        setActive(on);
        onToggle?.(on);
      } else onClick?.();
    });
    this.rail.append(btn);
    return {
      setActive,
      isActive: () => btn.classList.contains('active'),
      setHidden: (hidden) => { btn.hidden = hidden; },
      remove: () => btn.remove(),
    };
  }

  // --- status chips (top bar) ---------------------------------------------
  setStatus(key, text, level = 'info') {
    let chip = this.status.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (!text) { chip?.remove(); return; }
    if (!chip) { chip = el('span', { class: 'chip', 'data-key': key }); this.status.append(chip); }
    const topbar = document.getElementById('topbar');
    if (topbar.hidden) { topbar.hidden = false; this.onLayout?.(); }
    chip.className = `chip ${level}`;
    chip.textContent = text;
  }

  // --- notifications the user must acknowledge ------------------------------
  // Shown one at a time, oldest first. Returns a promise that resolves when the
  // user acknowledges; call .cancel() on it to withdraw the notification.
  #notices = [];

  notify({ title, lines = [], level = 'warn', action = 'Acknowledge' }) {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    const entry = { title, lines, level, action, resolve };
    this.#notices.push(entry);
    promise.cancel = () => {
      this.#notices = this.#notices.filter((n) => n !== entry);
      this.#drawNotice();
    };
    this.#drawNotice();
    return promise;
  }

  #drawNotice() {
    const host = document.getElementById('alerts');
    const current = this.#notices[0];
    if (!current) { host.replaceChildren(); return; }
    const more = this.#notices.length - 1;
    host.replaceChildren(el('div', { class: `alert ${current.level}`, role: 'alertdialog', 'aria-label': current.title }, [
      el('h4', { text: current.title }),
      ...current.lines.map((text) => el('p', { text })),
      el('div', { class: 'alert-foot' }, [
        el('span', { text: more ? `${more} more waiting` : '' }),
        el('button', { class: 'btn primary', text: current.action, onclick: () => {
          this.#notices = this.#notices.filter((n) => n !== current);
          this.#drawNotice();
          current.resolve();
        } }),
      ]),
    ]));
  }

  // --- toasts --------------------------------------------------------------
  toast(message, { level = 'info', ms = 4500 } = {}) {
    const t = el('div', { class: `toast ${level}`, text: message });
    this.toasts.append(t);
    setTimeout(() => t.remove(), ms);
  }
}
