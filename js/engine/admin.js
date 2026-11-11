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

export class AdminConsole {
  #items = new Map(); // id -> { id, kind, label, description, group, run | (value, onChange) }
  #log = [];          // newest first: { t, text, level }
  #open = false;
  #button;
  #panel;

  constructor(engine) {
    this.engine = engine;
    const control = L.control({ position: 'topright' });
    control.onAdd = () => {
      const root = el('div', { class: 'admin' });
      this.#button = el('button', {
        class: 'admin-btn', title: 'Admin console: trigger simulated events', 'aria-expanded': 'false',
        onclick: () => this.toggle(),
      });
      this.#panel = el('div', { class: 'admin-panel', hidden: true });
      root.append(this.#button, this.#panel);
      L.DomEvent.disableClickPropagation(root);
      L.DomEvent.disableScrollPropagation(root);
      return root;
    };
    control.addTo(engine.map);
    this.#draw();
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
    if (!this.#open) return;

    const groups = new Map();
    for (const item of this.#items.values()) {
      if (!groups.has(item.group)) groups.set(item.group, []);
      groups.get(item.group).push(item);
    }

    this.#panel.replaceChildren(
      el('div', { class: 'admin-head' }, [
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
    );
  }
}
