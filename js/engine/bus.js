// Minimal synchronous event bus. A throwing listener never breaks the others.
export class Bus {
  #map = new Map();

  on(event, fn) {
    if (!this.#map.has(event)) this.#map.set(event, new Set());
    this.#map.get(event).add(fn);
    return () => this.#map.get(event)?.delete(fn);
  }

  emit(event, payload) {
    for (const fn of [...(this.#map.get(event) ?? [])]) {
      try { fn(payload); } catch (err) { console.error(`[bus] listener for "${event}" failed`, err); }
    }
  }
}
