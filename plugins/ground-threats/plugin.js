// Ground threats.
//
// 1. Registers the Ground Threat List (GTL) slot in the Data panel. The GTL is
//    the list the mission takes off with and what the jet already holds.
// 2. Draws each threat on the map.
// 3. Handles three kinds of in-flight update to a threat:
//      move    a new position
//      type    a new type and/or threat ring size
//      remove  it is no longer a threat
//    Each pops a notification the user must acknowledge. Only then does the map
//    change, and it shows the change against what the jet still holds: a ghost
//    at the old position, a dashed ring at the old size, or the threat greyed
//    out if it is to be removed.
// 4. Tracks, per threat, what the jet holds. Any difference is offered to the
//    jet-transfer plugin (see its header for the bus contract). Once the jet
//    confirms, the references are cleared: a changed threat is drawn normally
//    and a removed one disappears from the map.
//
// Updates are simulated from the admin console; a real feed would call
// `receive({ threatId, kind, changes })` the same way.
//
// GTL file: CSV with a header row (id, name, type, lat, lon, radius_nm) or JSON
// (an array, or { "threats": [...] }, with the same keys). Decimal degrees.
const RED = '#ff5d5d';
const GHOST = '#b98a8a';
const GREY = '#8a97a3';
const FIELDS = ['lat', 'lon', 'type', 'radiusNm', 'removed']; // what an update can change
const ALIASES = {
  id: ['id', 'threat_id'],
  name: ['name', 'designator'],
  type: ['type', 'system'],
  lat: ['lat', 'latitude'],
  lon: ['lon', 'lng', 'long', 'longitude'],
  radiusNm: ['radius_nm', 'radiusnm', 'radius', 'ring_nm'],
};

export default {
  activate(ctx) {
    const { L, geo, el } = ctx;

    // state: { file: { name, loadedAt, skipped }, threats: [...], pending: [...] } or null
    // threat: { id, name, lat, lon, type, radiusNm, removed,   <- as shown on the tablet
    //           jet: { lat, lon, type, radiusNm, removed },    <- as the jet holds it
    //           baseline: { ...same },                         <- as loaded
    //           history: [{ ...same, until }], updatedAt, jetAt }
    // update: { id, threatId, kind, changes, from, t }
    let state = ctx.settings.get('state', null);
    const snap = (t) => Object.fromEntries(FIELDS.map((k) => [k, k === 'removed' ? !!t[k] : t[k] ?? null]));
    migrate();

    const persist = () => ctx.settings.set('state', state);
    const byId = (id) => state?.threats.find((t) => t.id === id);
    const zulu = (ms) => `${new Date(ms).toISOString().slice(11, 19)}Z`;
    const ring = (nm) => (nm ? `${nm} NM` : 'none');

    // How the tablet differs from the jet for one threat.
    function diff(t) {
      const j = t.jet;
      const d = {
        moved: t.lat !== j.lat || t.lon !== j.lon,
        typed: t.type !== j.type || t.radiusNm !== j.radiusNm,
        removed: !!t.removed !== !!j.removed,
      };
      d.any = d.moved || d.typed || d.removed;
      return d;
    }
    const gone = (t) => t.removed && t.jet.removed; // removed on the tablet and in the jet

    // State saved by earlier versions tracked positions only.
    function migrate() {
      for (const t of state?.threats ?? []) {
        t.removed ??= false;
        t.baseline = { ...snap(t), ...(t.history?.[0] ? { lat: t.history[0].lat, lon: t.history[0].lon } : {}), ...t.baseline };
        t.jet = { ...snap(t), lat: t.baseline.lat, lon: t.baseline.lon, ...t.jet };
      }
      for (const u of state?.pending ?? []) {
        if (!u.kind) Object.assign(u, { kind: 'move', changes: { lat: u.lat, lon: u.lon } });
      }
    }

    // --- GTL file ------------------------------------------------------------
    function parseCsvLine(line) {
      const out = [];
      let cur = '', quoted = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quoted) {
          if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
      }
      out.push(cur);
      return out.map((v) => v.trim());
    }

    function parseGtl(text, fileName) {
      let rows;
      const trimmed = text.trim();
      if (!trimmed) throw new Error('the file is empty');
      if (/\.json$/i.test(fileName) || trimmed[0] === '[' || trimmed[0] === '{') {
        let json;
        try { json = JSON.parse(trimmed); } catch { throw new Error('the file is not valid JSON'); }
        rows = Array.isArray(json) ? json : json.threats;
        if (!Array.isArray(rows)) throw new Error('expected a list of threats');
      } else {
        const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
        const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
        rows = lines.slice(1).map((line) => Object.fromEntries(parseCsvLine(line).map((v, i) => [header[i], v])));
      }
      const pickField = (row, key) => {
        const hit = Object.keys(row).find((k) => ALIASES[key].includes(k.toLowerCase()));
        return hit === undefined ? undefined : row[hit];
      };
      const threats = [];
      const skipped = [];
      const ids = new Set();
      rows.forEach((row, i) => {
        const rawLat = pickField(row, 'lat'), rawLon = pickField(row, 'lon');
        const lat = Number(rawLat), lon = Number(rawLon);
        const id = String(pickField(row, 'id') ?? '').trim() || `GT-${String(i + 1).padStart(2, '0')}`;
        const blank = rawLat === '' || rawLat == null || rawLon === '' || rawLon == null;
        if (blank || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || ids.has(id)) {
          skipped.push(i + 1);
          return;
        }
        ids.add(id);
        const radius = Number(pickField(row, 'radiusNm'));
        const fields = {
          lat, lon, removed: false,
          type: String(pickField(row, 'type') ?? '').trim() || 'Unknown type',
          radiusNm: Number.isFinite(radius) && radius > 0 ? radius : null,
        };
        threats.push({
          id, name: String(pickField(row, 'name') ?? '').trim() || id,
          ...fields, jet: { ...fields }, baseline: { ...fields }, history: [], updatedAt: null, jetAt: null,
        });
      });
      if (!threats.length) throw new Error('no valid threats found. Expected columns: id, name, type, lat, lon, radius_nm');
      return { threats, skipped };
    }

    function loadGtl(text, fileName) {
      const { threats, skipped } = parseGtl(text, fileName);
      cancelNotices();
      state = { file: { name: fileName, loadedAt: Date.now(), skipped }, threats, pending: [] };
      persist();
      ctx.admin.log(`GTL loaded: ${fileName} (${threats.length} threats)`);
      sync();
      ctx.map.fitBounds(L.latLngBounds(threats.map((t) => [t.lat, t.lon])).pad(0.35));
    }

    ctx.data.addSlot({
      id: 'gtl',
      title: 'Ground Threat List (GTL)',
      description: 'The threat list the mission takes off with, matching what is loaded in the jet. CSV or JSON with id, name, type, lat, lon, radius_nm.',
      accept: '.csv,.json,text/csv,application/json',
      replaceWarning: 'Replace the loaded GTL? Threat updates received so far will be discarded.',
      sample: { url: ctx.assetUrl('sample-gtl.csv'), fileName: 'sample-gtl.csv' },
      load: loadGtl,
      clear: () => { cancelNotices(); state = null; persist(); sync(); },
      status: () => (state ? {
        loaded: true,
        text: `${state.file.name} · ${state.threats.length} threats · loaded ${zulu(state.file.loadedAt)}`,
        notes: state.file.skipped?.length ? [`Skipped ${state.file.skipped.length} invalid or duplicate row(s): ${state.file.skipped.join(', ')}`] : [],
      } : { loaded: false, text: 'No file loaded' }),
    });

    // --- map -----------------------------------------------------------------
    const group = L.layerGroup();
    const markers = new Map();
    ctx.layers.add({ id: 'threats', name: 'Ground threats', layer: group });

    const symbol = (label, { color = RED, hollow = false } = {}) => L.divIcon({
      className: '', iconSize: [22, 22], iconAnchor: [11, 11],
      html: `<div class="sym"><svg width="22" height="22" viewBox="0 0 24 24"><path d="M12 3l9 9-9 9-9-9z" ` +
        `fill="${hollow ? 'none' : color}" stroke="${color}" stroke-width="2" ${hollow ? 'stroke-dasharray="3 3"' : ''}/></svg>` +
        `<span class="lbl" style="color:${color}">${escapeHtml(label)}</span></div>`,
    });
    const circle = (p, nm, style) => L.circle([p.lat, p.lon], { radius: nm * geo.NM_TO_M, interactive: false, ...style });

    // What differs from the jet, as short lines (used by the popup and the transfer list).
    function diffLines(t) {
      const d = diff(t), j = t.jet;
      if (d.removed) return ['No longer a threat. The jet still shows it.'];
      const lines = [];
      if (d.moved) {
        lines.push(`Position: moved ${geo.distanceNm(j, t).toFixed(1)} NM on ${geo.pad3(geo.bearingDeg(j, t))}°`, `Jet holds ${geo.fmtLatLon(j.lat, j.lon)}`);
      }
      if (d.typed) {
        if (t.type !== j.type) lines.push(`Type: ${j.type} → ${t.type}`);
        if (t.radiusNm !== j.radiusNm) lines.push(`Ring: ${ring(j.radiusNm)} → ${ring(t.radiusNm)}`);
      }
      return lines;
    }

    function popupHtml(t) {
      const d = diff(t);
      return `<b>${escapeHtml(t.name)}</b><br>${escapeHtml(t.type)}<br>${geo.fmtLatLon(t.lat, t.lon)}<br>Ring ${ring(t.radiusNm)}<br><br>` +
        (d.any ? `<b>Not in jet</b><br>${diffLines(t).map(escapeHtml).join('<br>')}<br>Updated ${zulu(t.updatedAt)}`
          : t.history.length ? `Updated ${zulu(t.updatedAt)}<br>Sent to jet ${zulu(t.jetAt)}` : 'As loaded in the jet');
    }

    function drawMap() {
      group.clearLayers();
      markers.clear();
      for (const t of state?.threats ?? []) {
        if (gone(t)) continue; // removed and the jet knows: nothing left to show
        const d = diff(t), j = t.jet;
        let label = t.name;

        if (t.removed) {
          // No longer a threat, but the jet still shows it: greyed out until sent.
          if (j.radiusNm) circle(j, j.radiusNm, { color: GREY, weight: 1.5, dashArray: '5 7', fill: false }).addTo(group);
          const m = L.marker([j.lat, j.lon], { icon: symbol(`${t.name} · NO LONGER A THREAT · NOT IN JET`, { color: GREY, hollow: true }), zIndexOffset: 400 })
            .bindPopup(() => popupHtml(t)).addTo(group);
          markers.set(t.id, m);
          continue;
        }

        // References to what the jet holds are only drawn while it differs.
        if (d.moved) {
          if (j.radiusNm) circle(j, j.radiusNm, { color: GHOST, weight: 1.5, dashArray: '5 7', fill: false }).addTo(group);
          L.marker([j.lat, j.lon], { icon: symbol(`${t.name} WAS HERE`, { color: GHOST, hollow: true }), interactive: false }).addTo(group);
          L.polyline([[j.lat, j.lon], [t.lat, t.lon]], { color: '#fff', weight: 2, dashArray: '6 6', interactive: false })
            .bindTooltip(`${geo.distanceNm(j, t).toFixed(1)} NM / ${geo.pad3(geo.bearingDeg(j, t))}°`, { permanent: true, direction: 'center', className: 'map-label' })
            .addTo(group);
          label += ` · MOVED ${zulu(t.updatedAt).slice(0, 5)}Z`;
        }
        if (d.typed) {
          if (!d.moved && j.radiusNm && j.radiusNm !== t.radiusNm) {
            circle(j, j.radiusNm, { color: GHOST, weight: 1.5, dashArray: '5 7', fill: false }).addTo(group); // the old ring size
          }
          if (t.type !== j.type) label += ` · NOW ${t.type.toUpperCase()}`;
          if (t.radiusNm !== j.radiusNm) label += ` · RING ${j.radiusNm ?? 0}→${t.radiusNm ?? 0} NM`;
        }
        if (d.any) label += ' · NOT IN JET';

        if (t.radiusNm) circle(t, t.radiusNm, { color: RED, weight: 2, fillColor: RED, fillOpacity: d.any ? 0.16 : 0.08 }).addTo(group);
        const m = L.marker([t.lat, t.lon], { icon: symbol(label), zIndexOffset: 500 }).bindPopup(() => popupHtml(t)).addTo(group);
        markers.set(t.id, m);
      }
    }

    const published = new Set();
    function publish() {
      const live = (state?.threats ?? []).filter((t) => !t.removed);
      const ids = new Set(live.map((t) => t.id));
      for (const id of [...published]) if (!ids.has(id)) { ctx.entities.remove(id); published.delete(id); }
      for (const t of live) {
        ctx.entities.upsert({ id: t.id, kind: 'threat', label: t.name, type: t.type, lat: t.lat, lon: t.lon, radiusNm: t.radiusNm, inJet: !diff(t).any });
        published.add(t.id);
      }
    }

    function show(t) {
      const d = diff(t), j = t.jet;
      const here = t.removed ? j : t;
      const pts = [[here.lat, here.lon], ...(d.moved && !t.removed ? [[j.lat, j.lon]] : [])];
      const padNm = Math.max(t.radiusNm ?? 0, j.radiusNm ?? 0, 10) * 1.3;
      const box = L.latLngBounds(pts.flatMap(([lat, lon]) => [0, 90, 180, 270].map((b) => {
        const p = geo.destination({ lat, lon }, b, padNm);
        return [p.lat, p.lon];
      })));
      // Leave room for a waiting notification at the top and the banner at the bottom.
      ctx.map.fitBounds(box, { maxZoom: 9, paddingTopLeft: [20, 200], paddingBottomRight: [20, 130] });
      if (!t.removed) ctx.selection.set({ kind: 'threat', id: t.id });
    }

    // --- updates -------------------------------------------------------------
    const notices = new Set();
    function cancelNotices() {
      for (const n of notices) n.cancel();
      notices.clear();
    }

    // The threat as it will be once every update already waiting is acknowledged.
    const latestKnown = (t) => state.pending.filter((u) => u.threatId === t.id).reduce((acc, u) => ({ ...acc, ...u.changes }), snap(t));

    function describe(update, t) {
      const from = update.from, to = { ...from, ...update.changes };
      const received = `Received ${zulu(update.t)}`;
      if (update.kind === 'remove') {
        return {
          title: `GTL update: ${t.name} is no longer a threat`, level: 'good',
          lines: [from.type, geo.fmtLatLon(from.lat, from.lon), 'It will be greyed out, then removed from the map once sent to the jet', received],
        };
      }
      if (update.kind === 'type') {
        return {
          title: `GTL update: ${t.name} has changed type`, level: 'danger',
          lines: [`Was: ${from.type} · ring ${ring(from.radiusNm)}`, `Now: ${to.type} · ring ${ring(to.radiusNm)}`, `Position unchanged: ${geo.fmtLatLon(from.lat, from.lon)}`, received],
        };
      }
      return {
        title: `GTL update: ${t.name} has moved`, level: 'danger',
        lines: [from.type, `Moved ${geo.distanceNm(from, to).toFixed(1)} NM on ${geo.pad3(geo.bearingDeg(from, to))}°`,
          `Was: ${geo.fmtLatLon(from.lat, from.lon)}`, `Now: ${geo.fmtLatLon(to.lat, to.lon)}`, received],
      };
    }

    function announce(update) {
      const t = byId(update.threatId);
      if (!t) return;
      const notice = ctx.ui.notify({ ...describe(update, t), action: 'Acknowledge and show on map' });
      notices.add(notice);
      notice.then(() => { notices.delete(notice); commit(update); });
    }

    // kind: 'move' (changes { lat, lon }), 'type' ({ type, radiusNm }) or 'remove' ({ removed: true }).
    function receive({ threatId, kind, changes }) {
      const t = byId(threatId);
      if (!t) return false;
      const known = latestKnown(t);
      if (known.removed) return false; // nothing more to say about a threat that is gone
      const update = { id: `upd-${Date.now().toString(36)}-${state.pending.length}`, threatId, kind, changes, t: Date.now(), from: known };
      state.pending.push(update);
      persist();
      announce(update);
      sync();
      return true;
    }

    // Runs when the user acknowledges: only now does the map change.
    function commit(update) {
      const t = byId(update.threatId);
      state.pending = state.pending.filter((u) => u.id !== update.id);
      if (!t) return persist();
      t.history.push({ ...snap(t), until: update.t });
      Object.assign(t, update.changes);
      t.updatedAt = update.t;
      persist();
      ctx.admin.log(`${t.name} ${update.kind} update acknowledged`);
      sync();
      show(t);
    }

    // --- differences from the jet, offered to the jet-transfer plugin ----------
    ctx.bus.on('transfer:collect', (items) => {
      for (const t of state?.threats ?? []) {
        const d = diff(t);
        if (!d.any) continue;
        const snapshot = snap(t);
        items.push({
          id: `gtl:${t.id}`, group: 'Ground threat changes', title: t.name,
          detail: d.removed ? ['Remove from the jet: no longer a threat'] : diffLines(t),
          apply: () => { t.jet = snapshot; t.jetAt = Date.now(); },
        });
      }
    });
    ctx.bus.on('transfer:done', () => { persist(); sync(); });

    // --- simulated events (admin console) -------------------------------------
    let lastPicked = null;
    function pickThreat() {
      const live = (state?.threats ?? []).filter((t) => !latestKnown(t).removed);
      if (!live.length) {
        ctx.ui.toast(state ? 'No threats left to update' : 'Load a GTL in the Data tab first', { level: 'warn' });
        throw new Error(state ? 'no threats left' : 'no GTL loaded');
      }
      // Avoid picking the same threat twice in a row so demos show variety.
      const pool = live.filter((t) => t.id !== lastPicked || live.length === 1);
      const t = pool[Math.floor(Math.random() * pool.length)];
      lastPicked = t.id;
      return t;
    }

    function simulateMove() {
      const t = pickThreat();
      const to = geo.destination(latestKnown(t), Math.random() * 360, 8 + Math.random() * 22);
      receive({ threatId: t.id, kind: 'move', changes: { lat: +to.lat.toFixed(5), lon: +to.lon.toFixed(5) } });
    }

    function simulateType() {
      const t = pickThreat();
      const now = latestKnown(t);
      // Choose another type from the ones in the loaded GTL, so ring sizes stay consistent per type.
      const catalog = [...new Map(state.threats.map((x) => [x.baseline.type, x.baseline.radiusNm])).entries()]
        .filter(([type, radius]) => type !== now.type && radius !== now.radiusNm);
      const [type, radiusNm] = catalog.length
        ? catalog[Math.floor(Math.random() * catalog.length)]
        : [`${now.type} (variant)`, Math.max(5, (now.radiusNm ?? 15) + (Math.random() < 0.5 ? -8 : 10))];
      receive({ threatId: t.id, kind: 'type', changes: { type, radiusNm } });
    }

    function simulateRemove() {
      receive({ threatId: pickThreat().id, kind: 'remove', changes: { removed: true } });
    }

    const group$ = 'Ground threats';
    ctx.admin.addAction({ id: 'move', group: group$, label: 'Threat position update', description: 'A random threat reports a new position 8 to 30 NM away.', run: simulateMove });
    ctx.admin.addAction({ id: 'type', group: group$, label: 'Threat type change', description: 'A random threat is re-identified as another type with a different ring size.', run: simulateType });
    ctx.admin.addAction({ id: 'remove', group: group$, label: 'No longer a threat', description: 'A random threat is reported as no longer a threat.', run: simulateRemove });
    let auto = false;
    ctx.admin.addToggle({
      id: 'auto', group: group$, label: 'Automatic updates',
      description: 'Every 30 s a random threat moves or changes type.', value: auto, onChange: (on) => { auto = on; },
    });
    ctx.every(30000, () => {
      if (!auto || !state?.threats.some((t) => !latestKnown(t).removed)) return;
      (Math.random() < 0.7 ? simulateMove : simulateType)();
    });
    ctx.admin.addAction({
      id: 'reset', group: group$, label: 'Reset to takeoff list',
      description: 'Undo every change, on the tablet and in the jet, and discard waiting updates.',
      run: () => {
        if (!state) return;
        cancelNotices();
        state.pending = [];
        for (const t of state.threats) Object.assign(t, t.baseline, { jet: { ...t.baseline }, history: [], updatedAt: null, jetAt: null });
        persist();
        sync();
      },
    });

    // --- panel ---------------------------------------------------------------
    let root = null;
    function tag(t) {
      const d = diff(t);
      if (!t.history.length) return { text: 'As loaded', warn: false };
      const what = t.removed ? 'REMOVED' : [d.moved && 'MOVED', d.typed && 'TYPE CHANGED'].filter(Boolean).join(' + ') || 'UPDATED';
      return { text: `${what} · ${d.any ? 'NOT IN JET' : 'IN JET'}`, warn: d.any };
    }

    function drawPanel() {
      if (!root) return;
      if (!state) {
        root.replaceChildren(el('p', { class: 'muted', text: 'No Ground Threat List loaded. Load one in the Data tab.' }));
        return;
      }
      const active = state.threats.filter((t) => !gone(t));
      const removed = state.threats.filter(gone);
      const unsent = state.threats.filter((t) => diff(t).any).length;
      const waiting = state.pending.length;
      const row = (t) => {
        const { text, warn } = tag(t);
        return el('li', { class: gone(t) ? 'stale' : '', onclick: () => { show(t); markers.get(t.id)?.openPopup(); } }, [
          el('b', { text: t.name }),
          el('span', { class: warn ? 'tag' : '', text }),
          el('span', { text: t.type }),
          el('span', { text: `Ring ${ring(t.radiusNm)}` }),
        ]);
      };
      const order = (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.name.localeCompare(b.name);
      root.replaceChildren(
        el('h3', { text: `Ground threats (${active.length})` }),
        el('p', { class: 'muted', text: `${unsent} change${unsent === 1 ? '' : 's'} not in the jet` + (waiting ? ` · ${waiting} update${waiting > 1 ? 's' : ''} waiting for acknowledgement` : '') }),
        el('ul', { class: 'list' }, [...active].sort(order).map(row)),
        ...(removed.length ? [
          el('h3', { text: `No longer threats (${removed.length})` }),
          el('ul', { class: 'list' }, [...removed].sort(order).map(row)),
        ] : []),
      );
    }
    ctx.ui.addPanel({ id: 'panel', title: 'Threats', render: (r) => { root = r; } });

    function sync() {
      publish();
      drawMap();
      drawPanel();
      ctx.data.refresh();
      ctx.bus.emit('transfer:changed');
    }

    // Updates that were still waiting when the app was last closed.
    for (const update of state?.pending ?? []) announce(update);
    sync();
  },
};

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
