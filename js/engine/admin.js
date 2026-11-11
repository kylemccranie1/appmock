// Admin console: the demo operator's controls, top right of the map.
//
// This app is a UI mockup for conveying requirements, so the events a real
// system would receive (a datalink message, a new threat, a failure) are
// simulated. Plugins register those simulations here, either as actions that
// fire on command or as toggles for simulations that run on their own.
// The console is deliberately styled differently from the product UI so
// viewers can tell it is not part of what is being proposed.
import { el } from './ui.js';

const L = window.L;
const LOG_LIMIT = 30;
const POS_KEY = 'omen:core:adminPos';
const DRAG_THRESHOLD = 6; // px of movement before a press counts as a drag, not a tap

export class AdminConsole {
  #items = new Map(); // id -> { id, kind, label, description, group, run | (value, onChange) }
  #log = [];          // newest first: { t, text, level }
  #open = false;
  #button;
  #panel;
  #root;
  #host;
  #pos = null; // { x, y } from the top left of the map once dragged, else null (top right)

  constructor(engine, build = 'dev') {
    this.engine = engine;
    this.build = build;
    // A free-floating element over the map. It starts top right and can be
    // dragged anywhere by the button or the panel header; the spot is remembered.
    this.#host = engine.map.getContainer();
    this.#button = el('button', { class: 'admin-btn', title: 'Admin console: trigger simulated events. Drag to move.', 'aria-expanded': 'false' });
    this.#panel = el('div', { class: 'admin-panel', hidden: true });
    this.#root = el('div', { class: 'admin' }, [this.#button, this.#panel]);
    this.#host.append(this.#root);
    L.DomEvent.disableClickPropagation(this.#root);
    L.DomEvent.disableScrollPropagation(this.#root);
    this.#root.addEventListener('pointerdown', (e) => e.stopPropagation()); // keep the map from panning

    this.#makeDraggable(this.#button, () => this.toggle());
    try { this.#pos = JSON.parse(localStorage.getItem(POS_KEY)); } catch { /* storage unavailable */ }
    addEventListener('resize', () => this.#place());
    engine.map.on('resize', () => this.#place());
    this.#draw();
  }

  // Drag `handle` to move the console. A press that does not move calls onTap.
  #makeDraggable(handle, onTap) {
    handle.style.touchAction = 'none';
    let start = null;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || e.target.closest('.admin-close')) return;
      const box = this.#root.getBoundingClientRect();
      const host = this.#host.getBoundingClientRect();
      start = { px: e.clientX, py: e.clientY, x: box.left - host.left, y: box.top - host.top, moved: false };
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.px, dy = e.clientY - start.py;
      if (!start.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      start.moved = true;
      this.#root.classList.add('dragging');
      this.#pos = { x: start.x + dx, y: start.y + dy };
      this.#place();
    });
    const end = (e) => {
      if (!start) return;
      const { moved } = start;
      start = null;
      this.#root.classList.remove('dragging');
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      if (moved) {
        try { localStorage.setItem(POS_KEY, JSON.stringify(this.#pos)); } catch { /* storage unavailable */ }
      } else if (e.type === 'pointerup') onTap?.();
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  // Apply the saved position, keeping the button and the open panel on screen.
  // The saved spot is where the user dropped it; near an edge the console is
  // nudged inward only as far as needed, so the panel never covers the button.
  #place() {
    const root = this.#root;
    const host = this.#host.getBoundingClientRect();
    if (!host.width) return;
    const margin = 10;
    root.classList.toggle('placed', !!this.#pos);
    this.#panel.style.maxHeight = `${Math.max(160, Math.min(560, host.height - this.#button.offsetHeight - 2 * margin - 6))}px`;
    if (!this.#pos) {
      Object.assign(root.style, { left: 'auto', top: `${margin}px`, right: `${margin}px` });
      return;
    }
    const x = Math.min(Math.max(this.#pos.x, margin), Math.max(margin, host.width - root.offsetWidth - margin));
    const y = Math.min(Math.max(this.#pos.y, margin), Math.max(margin, host.height - root.offsetHeight - margin));
    Object.assign(root.style, { left: `${x}px`, top: `${y}px`, right: 'auto' });
  }

  toggle(open = !this.#open) {
    this.#open = open;
    this.#draw();
  }

  // Register an on-command event: { id, label, description?, group?, run() }.
  // Register an automatic simulation: { id, kind: 'toggle', label, value, onChange(on) }.
  // Returns a function that removes it.
  add(item) {
    this.#items.set(item.id, { kind: 'action', group: 'General', ...item });
    this.#draw();
    return () => { this.#items.delete(item.id); this.#draw(); };
  }

  async trigger(id) {
    const item = this.#items.get(id);
    if (!item || item.kind !== 'action') return;
    try {
      await item.run();
      this.log(item.label);
      this.engine.bus.emit('admin:trigger', { id });
    } catch (err) {
      console.error(`[admin] "${id}" failed`, err);
      this.log(`${item.label} failed: ${err?.message ?? err}`, 'warn');
    }
  }

  setToggle(id, on) {
    const item = this.#items.get(id);
    if (!item || item.kind !== 'toggle') return;
    item.value = on;
    try { item.onChange?.(on); } catch (err) { console.error(`[admin] "${id}" failed`, err); }
    this.log(`${item.label}: ${on ? 'on' : 'off'}`);
  }

  log(text, level = 'info') {
    this.#log.unshift({ t: new Date(), text, level });
    this.#log.length = Math.min(this.#log.length, LOG_LIMIT);
    this.#draw();
  }

  #draw() {
    if (!this.#button) return;
    const count = this.#items.size;
    this.#button.textContent = `⚙ ADMIN${count ? ` · ${count}` : ''}`;
    this.#button.classList.toggle('active', this.#open);
    this.#button.setAttribute('aria-expanded', String(this.#open));
    this.#panel.hidden = !this.#open;
    if (!this.#open) { this.#place(); return; }

    const groups = new Map();
    for (const item of this.#items.values()) {
      if (!groups.has(item.group)) groups.set(item.group, []);
      groups.get(item.group).push(item);
    }

    let head;
    this.#panel.replaceChildren(
      head = el('div', { class: 'admin-head', title: 'Drag to move' }, [
        el('b', { text: 'Admin console' }),
        el('button', { class: 'admin-close', 'aria-label': 'Close', text: '×', onclick: () => this.toggle(false) }),
      ]),
      el('p', { class: 'muted', text: 'Simulation controls for the demo. Not part of the proposed product.' }),
      ...(count ? [...groups].flatMap(([group, items]) => [
        el('h3', { text: group }),
        ...items.map((item) => (item.kind === 'toggle'
          ? el('label', { class: 'row admin-item' }, [
            el('input', { type: 'checkbox', checked: !!item.value, onchange: (e) => this.setToggle(item.id, e.target.checked) }),
            el('span', {}, [el('b', { text: item.label }), item.description ? el('small', { text: item.description }) : null]),
          ])
          : el('div', { class: 'admin-item' }, [
            el('span', {}, [el('b', { text: item.label }), item.description ? el('small', { text: item.description }) : null]),
            el('button', { class: 'btn', text: 'Trigger', onclick: () => this.trigger(item.id) }),
          ]))),
      ]) : [el('p', { class: 'admin-empty', text: 'No simulated events are set up yet. They will appear here as features are added.' })]),
      el('h3', { text: 'Log' }),
      this.#log.length
        ? el('ul', { class: 'admin-log' }, this.#log.map((entry) =>
          el('li', { class: entry.level }, [el('span', { text: `${entry.t.toISOString().slice(11, 19)}Z` }), el('span', { text: entry.text })])))
        : el('p', { class: 'muted', text: 'Nothing triggered yet.' }),
      el('p', { class: 'admin-build', text: `Version ${this.build}` }),
    );
    this.#makeDraggable(head);
    this.#place();
  }
}
