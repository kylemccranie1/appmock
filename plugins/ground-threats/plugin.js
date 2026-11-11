// Ground threats.
//
// 1. Registers the Ground Threat List (GTL) slot in the Data panel. The GTL is
//    the list the mission takes off with and what the jet already holds.
// 2. Draws each threat on the map.
// 3. When a position update arrives for a threat, pops a notification the user
//    must acknowledge. Only then does the map show the threat at its new
//    position, with a ghost and a line back to where it was.
//
// 4. Tracks, per threat, the position the jet holds. Any difference is offered
//    to the jet-transfer plugin (see its header for the bus contract).
//
// Updates are simulated from the admin console; a real feed would call
// `receive({ threatId, lat, lon })` the same way.
//
// GTL file: CSV with a header row (id, name, type, lat, lon, radius_nm) or JSON
// (an array, or { "threats": [...] }, with the same keys). Decimal degrees.
const RED = '#ff5d5d';
const GHOST = '#b98a8a';
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

    // state: { file: { name, loadedAt }, threats: [...], pending: [...] } or null
    // threat: { id, name, type, lat, lon, radiusNm, history: [{ lat, lon, until }], updatedAt,
    //           baseline: { lat, lon } as loaded, jet: { lat, lon } as the jet holds it, jetAt }
    let state = ctx.settings.get('state', null);
    for (const t of state?.threats ?? []) { // state saved before the jet was tracked
      t.baseline ??= t.history[0] ? { lat: t.history[0].lat, lon: t.history[0].lon } : { lat: t.lat, lon: t.lon };
      t.jet ??= { ...t.baseline };
    }
    const inJet = (t) => t.jet.lat === t.lat && t.jet.lon === t.lon;
    const persist = () => ctx.settings.set('state', state);
    const byId = (id) => state?.threats.find((t) => t.id === id);
    const zulu = (ms) => `${new Date(ms).toISOString().slice(11, 19)}Z`;

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
        const lat = Number(pickField(row, 'lat')), lon = Number(pickField(row, 'lon'));
        const id = String(pickField(row, 'id') ?? '').trim() || `GT-${String(i + 1).padStart(2, '0')}`;
        const blank = pickField(row, 'lat') === '' || pickField(row, 'lat') == null || pickField(row, 'lon') === '' || pickField(row, 'lon') == null;
        if (blank || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || ids.has(id)) {
          skipped.push(i + 1);
          return;
        }
        ids.add(id);
        const radius = Number(pickField(row, 'radiusNm'));
        threats.push({
          id, lat, lon,
          name: String(pickField(row, 'name') ?? '').trim() || id,
          type: String(pickField(row, 'type') ?? '').trim() || 'Unknown type',
          radiusNm: Number.isFinite(radius) && radius > 0 ? radius : null,
          history: [], updatedAt: null, baseline: { lat, lon }, jet: { lat, lon }, jetAt: null,
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

    function popupHtml(t) {
      const prev = t.history.at(-1);
      return `<b>${escapeHtml(t.name)}</b><br>${escapeHtml(t.type)}<br>${geo.fmtLatLon(t.lat, t.lon)}` +
        (t.radiusNm ? `<br>Ring ${t.radiusNm} NM` : '') +
        (prev ? `<br><br><b>Moved ${geo.distanceNm(prev, t).toFixed(1)} NM on ${geo.pad3(geo.bearingDeg(prev, t))}°</b>` +
          `<br>Was: ${geo.fmtLatLon(prev.lat, prev.lon)}<br>Updated ${zulu(t.updatedAt)}<br>` +
          (inJet(t) ? `Sent to jet ${zulu(t.jetAt)}` : `<b>Not in jet.</b> Jet holds ${geo.fmtLatLon(t.jet.lat, t.jet.lon)}`) : '<br>As loaded in the jet');
    }

    function drawMap() {
      group.clearLayers();
      markers.clear();
      for (const t of state?.threats ?? []) {
        const prev = t.history.at(-1);
        if (prev) {
          // Where it was: a dashed ghost, plus a line to where it is now.
          if (t.radiusNm) {
            L.circle([prev.lat, prev.lon], { radius: t.radiusNm * geo.NM_TO_M, color: GHOST, weight: 1.5, dashArray: '5 7', fill: false, interactive: false }).addTo(group);
          }
          L.marker([prev.lat, prev.lon], { icon: symbol(`${t.name} WAS HERE`, { color: GHOST, hollow: true }), interactive: false }).addTo(group);
          const path = [...t.history.map((h) => [h.lat, h.lon]), [t.lat, t.lon]];
          if (path.length > 2) L.polyline(path.slice(0, -1), { color: GHOST, weight: 1, dashArray: '2 6', interactive: false }).addTo(group);
          L.polyline([[prev.lat, prev.lon], [t.lat, t.lon]], { color: '#fff', weight: 2, dashArray: '6 6', interactive: false })
            .bindTooltip(`${geo.distanceNm(prev, t).toFixed(1)} NM / ${geo.pad3(geo.bearingDeg(prev, t))}°`, { permanent: true, direction: 'center', className: 'map-label' })
            .addTo(group);
        }
        if (t.radiusNm) {
          L.circle([t.lat, t.lon], { radius: t.radiusNm * geo.NM_TO_M, color: RED, weight: 2, fillColor: RED, fillOpacity: prev ? 0.16 : 0.08, interactive: false }).addTo(group);
        }
        const m = L.marker([t.lat, t.lon], { icon: symbol(prev ? `${t.name} · MOVED ${zulu(t.updatedAt).slice(0, 5)}Z · ${inJet(t) ? 'IN JET' : 'NOT IN JET'}` : t.name), zIndexOffset: 400 })
          .bindPopup(() => popupHtml(t))
          .addTo(group);
        markers.set(t.id, m);
      }
    }

    const published = new Set();
    function publish() {
      const ids = new Set((state?.threats ?? []).map((t) => t.id));
      for (const id of [...published]) if (!ids.has(id)) { ctx.entities.remove(id); published.delete(id); }
      for (const t of state?.threats ?? []) {
        ctx.entities.upsert({ id: t.id, kind: 'threat', label: t.name, type: t.type, lat: t.lat, lon: t.lon, radiusNm: t.radiusNm, moved: t.history.length > 0 });
        published.add(t.id);
      }
    }

    function show(t) {
      const prev = t.history.at(-1);
      const pts = [[t.lat, t.lon], ...(prev ? [[prev.lat, prev.lon]] : [])];
      const padNm = (t.radiusNm ?? 10) * 1.3;
      const box = L.latLngBounds(pts.flatMap(([lat, lon]) => [0, 90, 180, 270].map((b) => {
        const p = geo.destination({ lat, lon }, b, padNm);
        return [p.lat, p.lon];
      })));
      // Leave room at the top so a waiting notification does not cover the threat.
      ctx.map.fitBounds(box, { maxZoom: 9, paddingTopLeft: [20, 200], paddingBottomRight: [20, 30] });
      ctx.selection.set({ kind: 'threat', id: t.id });
    }

    // --- position updates ----------------------------------------------------
    const notices = new Set();
    function cancelNotices() {
      for (const n of notices) n.cancel();
      notices.clear();
    }

    // Where a threat will be once every update already waiting is acknowledged.
    const latestKnown = (t) => state.pending.findLast((u) => u.threatId === t.id) ?? t;

    function announce(update) {
      const t = byId(update.threatId);
      if (!t) return;
      const from = update.from;
      const notice = ctx.ui.notify({
        title: `GTL update: ${t.name} has moved`,
        level: 'danger',
        lines: [
          t.type,
          `Moved ${geo.distanceNm(from, update).toFixed(1)} NM on ${geo.pad3(geo.bearingDeg(from, update))}°`,
          `Was: ${geo.fmtLatLon(from.lat, from.lon)}`,
          `Now: ${geo.fmtLatLon(update.lat, update.lon)}`,
          `Received ${zulu(update.t)}`,
        ],
        action: 'Acknowledge and show on map',
      });
      notices.add(notice);
      notice.then(() => { notices.delete(notice); commit(update); });
    }

    function receive({ threatId, lat, lon }) {
      const t = byId(threatId);
      if (!t) return false;
      const known = latestKnown(t);
      const update = { id: `upd-${Date.now().toString(36)}-${state.pending.length}`, threatId, lat, lon, t: Date.now(), from: { lat: known.lat, lon: known.lon } };
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
      t.history.push({ lat: t.lat, lon: t.lon, until: update.t });
      t.lat = update.lat;
      t.lon = update.lon;
      t.updatedAt = update.t;
      persist();
      ctx.admin.log(`${t.name} update acknowledged`);
      sync();
      show(t);
    }

    // --- differences from the jet, offered to the jet-transfer plugin ----------
    ctx.bus.on('transfer:collect', (items) => {
      for (const t of state?.threats ?? []) {
        if (inJet(t)) continue;
        const snapshot = { lat: t.lat, lon: t.lon };
        items.push({
          id: `gtl:${t.id}`, group: 'Ground threat positions', title: t.name,
          detail: [
            `Jet: ${geo.fmtLatLon(t.jet.lat, t.jet.lon)}`,
            `Tablet: ${geo.fmtLatLon(t.lat, t.lon)}`,
            `${geo.distanceNm(t.jet, t).toFixed(1)} NM / ${geo.pad3(geo.bearingDeg(t.jet, t))}° apart`,
          ],
          apply: () => { t.jet = snapshot; t.jetAt = Date.now(); },
        });
      }
    });
    ctx.bus.on('transfer:done', () => { persist(); sync(); });

    // --- simulated events (admin console) -------------------------------------
    let lastMoved = null;
    function simulateMove() {
      if (!state?.threats.length) {
        ctx.ui.toast('Load a GTL in the Data tab first', { level: 'warn' });
        throw new Error('no GTL loaded');
      }
      // Avoid picking the same threat twice in a row so demos show variety.
      const pool = state.threats.filter((t) => t.id !== lastMoved || state.threats.length === 1);
      const t = pool[Math.floor(Math.random() * pool.length)];
      lastMoved = t.id;
      const from = latestKnown(t);
      const to = geo.destination(from, Math.random() * 360, 8 + Math.random() * 22);
      receive({ threatId: t.id, lat: +to.lat.toFixed(5), lon: +to.lon.toFixed(5) });
    }

    ctx.admin.addAction({
      id: 'move', group: 'Ground threats', label: 'Threat position update',
      description: 'A random GTL threat reports a new position 8 to 30 NM away.',
      run: simulateMove,
    });
    let auto = false;
    ctx.admin.addToggle({
      id: 'auto', group: 'Ground threats', label: 'Automatic position updates',
      description: 'A random threat moves every 30 s.', value: auto, onChange: (on) => { auto = on; },
    });
    ctx.every(30000, () => { if (auto && state?.threats.length) simulateMove(); });
    ctx.admin.addAction({
      id: 'reset', group: 'Ground threats', label: 'Reset to takeoff positions',
      description: 'Undo every move, on the tablet and in the jet, and discard waiting updates.',
      run: () => {
        if (!state) return;
        cancelNotices();
        state.pending = [];
        for (const t of state.threats) {
          Object.assign(t, { lat: t.baseline.lat, lon: t.baseline.lon, history: [], updatedAt: null, jet: { ...t.baseline }, jetAt: null });
        }
        persist();
        sync();
      },
    });

    // --- panel ---------------------------------------------------------------
    let root = null;
    function drawPanel() {
      if (!root) return;
      if (!state) {
        root.replaceChildren(el('p', { class: 'muted', text: 'No Ground Threat List loaded. Load one in the Data tab.' }));
        return;
      }
      const moved = state.threats.filter((t) => t.history.length).length;
      const waiting = state.pending.length;
      root.replaceChildren(
        el('h3', { text: `Ground threats (${state.threats.length})` }),
        el('p', { class: 'muted', text: `${moved} moved since takeoff` + (waiting ? ` · ${waiting} update${waiting > 1 ? 's' : ''} waiting for acknowledgement` : '') }),
        el('ul', { class: 'list' }, [...state.threats]
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.name.localeCompare(b.name))
          .map((t) => {
            const prev = t.history.at(-1);
            return el('li', { onclick: () => { show(t); markers.get(t.id)?.openPopup(); } }, [
              el('b', { text: t.name }),
              el('span', { class: prev && !inJet(t) ? 'tag' : '', text: prev ? (inJet(t) ? 'MOVED · IN JET' : 'MOVED · NOT IN JET') : 'As loaded' }),
              el('span', { text: t.type }),
              el('span', { text: prev ? `${geo.distanceNm(prev, t).toFixed(1)} NM / ${geo.pad3(geo.bearingDeg(prev, t))}°` : (t.radiusNm ? `Ring ${t.radiusNm} NM` : '') }),
            ]);
          })),
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
