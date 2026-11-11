// Data load: the one place where mission files are brought onto the tablet.
// Each plugin that consumes a file type registers a slot; the "Data" drawer
// panel shows one card per slot and exists only while there is at least one.
//
// Slot shape:
//   { id, title, description, accept, replaceWarning?,
//     load(text, fileName)  -> throws an Error with a readable message on bad input
//     clear()
//     status()              -> { loaded: boolean, text: string, notes?: string[] }
//     sample?: { url, fileName } }
import { el } from './ui.js';

export class DataLoad {
  #slots = new Map();
  #errors = new Map();
  #panel = null;

  constructor(engine) {
    this.engine = engine;
  }

  addSlot(slot) {
    this.#slots.set(slot.id, slot);
    if (!this.#panel) this.#panel = this.engine.ui.addPanel({ id: 'core:data', title: 'Data', first: true });
    this.refresh();
    return () => {
      this.#slots.delete(slot.id);
      this.#errors.delete(slot.id);
      if (!this.#slots.size) { this.#panel?.remove(); this.#panel = null; } else this.refresh();
    };
  }

  async #load(slot, getText, fileName) {
    try {
      if (slot.status().loaded && slot.replaceWarning && !confirm(slot.replaceWarning)) return;
      await slot.load(await getText(), fileName);
      this.#errors.delete(slot.id);
    } catch (err) {
      console.warn(`[data] ${slot.id}: ${err.message}`);
      this.#errors.set(slot.id, err.message);
    }
    this.refresh();
  }

  refresh() {
    if (!this.#panel) return;
    this.#panel.el.replaceChildren(
      el('p', { class: 'muted', text: 'Load the files the mission starts with. Each file type has its own slot.' }),
      ...[...this.#slots.values()].map((slot) => this.#card(slot)),
    );
  }

  #card(slot) {
    const status = slot.status();
    const error = this.#errors.get(slot.id);
    const input = el('input', { type: 'file', accept: slot.accept ?? '', hidden: true, onchange: (e) => {
      const file = e.target.files?.[0];
      if (file) this.#load(slot, () => file.text(), file.name);
    } });
    const card = el('div', { class: `slot ${status.loaded ? 'loaded' : ''}` }, [
      el('h4', { text: slot.title }),
      el('p', { class: 'muted', text: slot.description ?? '' }),
      el('p', { class: 'slot-status', text: status.text }),
      ...(status.notes ?? []).map((text) => el('p', { class: 'muted', text })),
      error ? el('p', { class: 'error', text: `Could not load: ${error}` }) : null,
      el('div', { class: 'btnrow' }, [
        el('label', { class: 'btn primary', role: 'button' }, [status.loaded ? 'Replace file' : 'Choose file', input]),
        slot.sample ? el('button', { class: 'btn', text: 'Load sample', onclick: () =>
          this.#load(slot, async () => (await fetch(slot.sample.url)).text(), slot.sample.fileName) }) : null,
      ]),
      el('div', { class: 'slot-foot' }, [
        slot.sample ? el('a', { href: slot.sample.url, download: slot.sample.fileName, text: 'Download sample file' }) : null,
        status.loaded ? el('button', { class: 'linkbtn', text: 'Clear', onclick: () => {
          if (!confirm(`Remove the loaded ${slot.title}?`)) return;
          slot.clear();
          this.#errors.delete(slot.id);
          this.refresh();
        } }) : null,
      ]),
    ]);
    // Drag and drop for desktop browsers; tablets use the file picker.
    card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drop'); });
    card.addEventListener('dragleave', () => card.classList.remove('drop'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drop');
      const file = e.dataTransfer?.files?.[0];
      if (file) this.#load(slot, () => file.text(), file.name);
    });
    return card;
  }
}
