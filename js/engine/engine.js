// Engine core: owns the map, shared state (ownship + entities), the event bus,
// the layer registry and the plugin host. Everything mission-specific is a plugin.
import { Bus } from './bus.js';
import { UI, el } from './ui.js';
import { createBasemap } from './basemap.js';
import * as geo from './geo.js';

const L = window.L;

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(`omen:${key}`);
      return raw == null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`omen:${key}`, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

export class Engine {
  bus = new Bus();
  ui = new UI();
  entities = new Map();   // id -> { id, kind, lat, lon, hdg?, gs?, alt?, label?, source, t }
  ownship = null;         // { lat, lon, hdg, gs, alt, src, t }
  layers = new Map();     // id -> { id, name, layer, visible, owner }
  plugins = new Map();    // id -> { meta, enabled, instance?, disposers, error? }
  selection = null;       // { kind, id } of the entity the user last picked, or null
  follow = false;

  async start() {
    const view = store.get('core:view', { center: [38.0, -97.5], zoom: 7 });
    this.map = L.map('map', {
      zoomControl: false, minZoom: 2, maxZoom: 13, zoomSnap: 0.5,
      maxBounds: [[-85, -220], [85, 220]], maxBoundsViscosity: 0.8,
    }).setView(view.center, view.zoom);
    this.map.attributionControl.setPrefix(false);

    this.basemap = await createBasemap(this.map);
    this.basemap.set(store.get('core:basemap', 'vector'));

    this.#wireMap();
    this.#coreTools();
    this.#corePanels();
    this.#topbar();
    await this.#loadPlugins();
    this.bus.emit('engine:ready');
  }

  // --- shared state --------------------------------------------------------
  setOwnship(fix) {
    this.ownship = { ...fix, t: Date.now() };
    this.bus.emit('ownship:update', this.ownship);
  }

  upsertEntity(entity) {
    const next = { ...this.entities.get(entity.id), ...entity, t: Date.now() };
    this.entities.set(entity.id, next);
    this.bus.emit('entity:upsert', next);
    return next;
  }

  removeEntity(id) {
    const entity = this.entities.get(id);
    if (!entity) return;
    this.entities.delete(id);
    this.bus.emit('entity:remove', entity);
  }

  select(selection) {
    this.selection = selection ?? null;
    this.bus.emit('selection:change', this.selection);
  }

  // --- layers --------------------------------------------------------------
  addLayer({ id, name, layer, visible = true, owner = 'core' }) {
    const rec = { id, name, layer, owner, visible: store.get(`layer:${id}`, visible) };
    this.layers.set(id, rec);
    if (rec.visible) layer.addTo(this.map);
    this.bus.emit('layers:change');
    return () => {
      layer.remove();
      this.layers.delete(id);
      this.bus.emit('layers:change');
    };
  }

  setLayerVisible(id, visible) {
    const rec = this.layers.get(id);
    if (!rec) return;
    rec.visible = visible;
    store.set(`layer:${id}`, visible);
    if (visible) rec.layer.addTo(this.map); else rec.layer.remove();
    this.bus.emit('layers:change');
  }

  // --- plugin host ---------------------------------------------------------
  async #loadPlugins() {
    let registry = [];
    try {
      registry = (await (await fetch('plugins/registry.json')).json()).plugins ?? [];
    } catch (err) {
      console.error('[plugins] registry failed to load', err);
      this.ui.toast('Plugin registry failed to load', { level: 'warn' });
    }
    for (const meta of registry) {
      this.plugins.set(meta.id, { meta, enabled: false, disposers: [] });
    }
    for (const meta of registry) {
      if (store.get(`plugin:${meta.id}`, meta.enabled !== false)) await this.enablePlugin(meta.id);
    }
    this.bus.emit('plugins:change');
  }

  async enablePlugin(id) {
    const rec = this.plugins.get(id);
    if (!rec || rec.enabled) return;
    rec.error = null;
    try {
      const base = new URL(`plugins/${id}/`, document.baseURI);
      const mod = await import(new URL(rec.meta.entry ?? 'plugin.js', base).href);
      rec.instance = mod.default;
      await rec.instance.activate(this.#context(rec, base));
      rec.enabled = true;
    } catch (err) {
      console.error(`[plugins] "${id}" failed to activate`, err);
      rec.error = String(err?.message ?? err);
      this.#dispose(rec);
      this.ui.toast(`Plugin "${rec.meta.name ?? id}" failed to start`, { level: 'warn' });
    }
    store.set(`plugin:${id}`, rec.enabled);
    this.bus.emit('plugins:change');
  }

  async disablePlugin(id) {
    const rec = this.plugins.get(id);
    if (!rec?.enabled) return;
    try { await rec.instance.deactivate?.(); } catch (err) { console.error(`[plugins] "${id}" deactivate failed`, err); }
    this.#dispose(rec);
    rec.enabled = false;
    store.set(`plugin:${id}`, false);
    this.bus.emit('plugins:change');
  }

  #dispose(rec) {
    for (const fn of rec.disposers.splice(0).reverse()) {
      try { fn(); } catch (err) { console.error('[plugins] cleanup failed', err); }
    }
  }

  // The only surface a plugin sees. Everything registered through it is torn
  // down automatically when the plugin is disabled.
  #context(rec, base) {
    const id = rec.meta.id;
    const track = (dispose) => { rec.disposers.push(dispose); return dispose; };
    const statusKeys = new Set();
    return {
      id,
      L,
      geo,
      el,
      map: this.map,
      assetUrl: (rel) => new URL(rel, base).href,
      onDispose: track,
      every: (ms, fn) => { const h = setInterval(fn, ms); return track(() => clearInterval(h)); },
      bus: {
        on: (event, fn) => track(this.bus.on(event, fn)),
        emit: (event, payload) => this.bus.emit(event, payload),
      },
      ownship: {
        get: () => this.ownship,
        set: (fix) => this.setOwnship(fix),
      },
      entities: {
        all: (kind) => [...this.entities.values()].filter((e) => !kind || e.kind === kind),
        get: (eid) => this.entities.get(eid),
        upsert: (entity) => {
          if (!this.entities.has(entity.id)) track(() => this.removeEntity(entity.id));
          return this.upsertEntity({ source: id, ...entity });
        },
        remove: (eid) => this.removeEntity(eid),
      },
      selection: {
        get: () => this.selection,
        set: (selection) => this.select(selection),
      },
      layers: {
        add: (opts) => track(this.addLayer({ ...opts, id: `${id}:${opts.id}`, owner: id })),
      },
      ui: {
        addPanel: (opts) => { const p = this.ui.addPanel({ ...opts, id: `${id}:${opts.id}` }); track(p.remove); return p; },
        addTool: (opts) => { const t = this.ui.addTool({ ...opts, id: `${id}:${opts.id}` }); track(t.remove); return t; },
        setStatus: (key, text, level) => {
          this.ui.setStatus(`${id}:${key}`, text, level);
          if (text && !statusKeys.has(key)) {
            statusKeys.add(key);
            track(() => this.ui.setStatus(`${id}:${key}`, null));
          }
        },
        toast: (msg, opts) => this.ui.toast(msg, opts),
        // While on, taps go to the map (map:click) instead of opening overlay popups.
        captureMapTaps: (on) => {
          this.map.getContainer().classList.toggle('capture', on);
          if (on) { this.map.closePopup(); track(() => this.map.getContainer().classList.remove('capture')); }
        },
      },
      settings: {
        get: (key, fallback) => store.get(`p:${id}:${key}`, fallback),
        set: (key, value) => store.set(`p:${id}:${key}`, value),
      },
    };
  }

  // --- core wiring ---------------------------------------------------------
  #wireMap() {
    const { map, bus } = this;
    const cursor = document.getElementById('cursor');
    const showCursor = (latlng) => {
      const p = { lat: latlng.lat, lon: latlng.lng };
      let text = geo.fmtLatLon(p.lat, p.lon);
      if (this.ownship) {
        text += `  ·  ${geo.pad3(geo.bearingDeg(this.ownship, p))}° / ${geo.distanceNm(this.ownship, p).toFixed(1)} NM from ownship`;
      }
      cursor.textContent = text;
    };
    map.on('mousemove', (e) => showCursor(e.latlng));
    map.on('click', (e) => {
      showCursor(e.latlng);
      bus.emit('map:click', { lat: e.latlng.lat, lon: e.latlng.lng, latlng: e.latlng });
    });
    map.on('moveend', () => {
      const c = map.getCenter();
      store.set('core:view', { center: [c.lat, c.lng], zoom: map.getZoom() });
    });
    map.on('dragstart', () => this.setFollow(false));
    bus.on('ownship:update', (o) => {
      if (this.follow) map.panTo([o.lat, o.lon], { animate: true, duration: 0.5 });
    });
  }

  setFollow(on) {
    this.follow = on;
    store.set('core:follow', on);
    this.followTool?.setActive(on);
    if (on && this.ownship) this.map.panTo([this.ownship.lat, this.ownship.lon]);
  }

  #coreTools() {
    this.ui.addTool({ id: 'menu', label: '☰', title: 'Show or hide the side panel', onClick: () => {
      this.ui.toggleDrawer();
      setTimeout(() => this.map.invalidateSize(), 220);
    } });
    this.ui.addTool({ id: 'zoom-in', label: '+', title: 'Zoom in', onClick: () => this.map.zoomIn() });
    this.ui.addTool({ id: 'zoom-out', label: '−', title: 'Zoom out', onClick: () => this.map.zoomOut() });
    this.followTool = this.ui.addTool({
      id: 'follow', label: '◎', title: 'Keep the map centered on ownship', toggle: true,
      onToggle: (on) => this.setFollow(on),
    });
    this.setFollow(store.get('core:follow', true));
    if (window.matchMedia('(max-width: 720px)').matches) this.ui.toggleDrawer(false);
  }

  #corePanels() {
    this.ui.addPanel({
      id: 'core:layers', title: 'Layers',
      render: (root) => {
        const draw = () => {
          const mode = store.get('core:basemap', 'vector');
          root.replaceChildren(
            el('h3', { text: 'Basemap' }),
            ...this.basemap.modes.map((m) => el('label', { class: 'row' }, [
              el('input', { type: 'radio', name: 'basemap', checked: m.id === mode, onchange: () => {
                store.set('core:basemap', m.id); this.basemap.set(m.id);
              } }),
              el('span', { text: m.name }),
            ])),
            el('h3', { text: 'Overlays' }),
            ...(this.layers.size ? [...this.layers.values()].map((rec) => el('label', { class: 'row' }, [
              el('input', { type: 'checkbox', checked: rec.visible, onchange: (e) => this.setLayerVisible(rec.id, e.target.checked) }),
              el('span', { text: rec.name }),
              el('small', { text: rec.owner }),
            ])) : [el('p', { class: 'muted', text: 'No overlays. Enable a plugin to add some.' })]),
          );
        };
        this.bus.on('layers:change', draw);
        draw();
      },
    });

    this.ui.addPanel({
      id: 'core:plugins', title: 'Plugins',
      render: (root) => {
        const draw = () => root.replaceChildren(
          ...[...this.plugins.values()].map((rec) => el('div', { class: 'plugin' }, [
            el('label', { class: 'row' }, [
              el('input', { type: 'checkbox', checked: rec.enabled, onchange: (e) =>
                (e.target.checked ? this.enablePlugin(rec.meta.id) : this.disablePlugin(rec.meta.id)) }),
              el('span', { text: rec.meta.name ?? rec.meta.id }),
              el('small', { text: `v${rec.meta.version ?? '0'}` }),
            ]),
            el('p', { class: 'muted', text: rec.meta.description ?? '' }),
            rec.error ? el('p', { class: 'error', text: `Failed: ${rec.error}` }) : null,
          ])),
          el('p', { class: 'muted', text: 'Plugins are listed in plugins/registry.json.' }),
        );
        this.bus.on('plugins:change', draw);
        draw();
      },
    });
  }

  #topbar() {
    const $ = (id) => document.getElementById(id);
    const clock = () => { $('clock').textContent = `${new Date().toISOString().slice(11, 19)}Z`; };
    clock();
    setInterval(clock, 1000);

    const net = () => {
      const online = navigator.onLine;
      $('net').textContent = online ? 'ONLINE' : 'OFFLINE';
      $('net').className = `pill ${online ? 'ok' : 'warn'}`;
      this.bus.emit('net:change', { online });
    };
    addEventListener('online', net);
    addEventListener('offline', net);
    net();

    this.bus.on('ownship:update', (o) => {
      $('ro-pos').textContent = geo.fmtLatLon(o.lat, o.lon);
      $('ro-hdg').textContent = o.hdg == null ? '---' : `${geo.pad3(o.hdg)}°`;
      $('ro-gs').textContent = o.gs == null ? '---' : `${Math.round(o.gs)} kt`;
      $('ro-alt').textContent = geo.fmtAlt(o.alt);
      $('ro-src').textContent = o.src ?? '--';
    });
  }
}
