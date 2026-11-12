// Targets: weapon-target pairs.
//
// The tablet is pushed a pairing (this target, for the weapon on this station)
// together with a target file. The flow:
//   1. A notification announces the pairing. Nothing is drawn yet.
//   2. The user opens it for review: the target from the file is drawn on the
//      map (aimpoint, target area, range and bearing from ownship) next to a
//      card with the file's contents and a set of checks.
//   3. The user accepts or rejects it. A pairing that fails a check cannot be
//      accepted.
//   4. An accepted pairing is offered to the jet-transfer plugin. When the jet
//      confirms, the target is loaded into the weapon on that station.
//
// Everything here is notional: the stations, weapon names, targets and the file
// format are invented for the mockup. Pairings are simulated from the admin
// console; a real feed would call `receive({ station, weapon, file, from })`.
//
// Pair states: received -> review -> accepted -> loaded, or rejected / superseded.
const ORANGE = '#ff9d3c';
const SHOWN = ['review', 'accepted', 'loaded'];
const LOADOUT = [ // notional stores loadout, as the jet would report it
  { id: '3', weapon: 'Notional weapon A' },
  { id: '4', weapon: 'Notional weapon A' },
  { id: '6', weapon: 'Notional weapon B' },
  { id: '7', weapon: 'Notional weapon B' },
];
const NAMES = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL', 'INDIA', 'JULIETT', 'KILO', 'LIMA'];
const DESCRIPTIONS = ['Notional storage building', 'Notional vehicle park', 'Notional communications mast', 'Notional bridge abutment', 'Notional radar site'];

const checksum = (text) => {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h.toString(16).toUpperCase().padStart(8, '0');
};

// The target file is "KEY: value" lines. AREA is "lat,lon; lat,lon; ...".
function parseTargetFile(text) {
  const f = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) f[line.slice(0, i).trim().toUpperCase()] = line.slice(i + 1).trim();
  }
  const pair = (s) => (s ?? '').split(',').map((v) => Number(v.trim()));
  const [lat, lon] = pair(f.AIMPOINT);
  return {
    id: f.ID, name: f.NAME, station: f.STATION, weapon: f.WEAPON, lat, lon,
    elevFt: f.ELEVATION_FT === undefined ? null : Number(f.ELEVATION_FT),
    datum: f.DATUM, description: f.DESCRIPTION, remarks: f.REMARKS, originator: f.ORIGINATOR, time: f.TIME,
    area: (f.AREA ?? '').split(';').map(pair).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)),
  };
}

export default {
  activate(ctx) {
    const { L, geo, el } = ctx;
    const zulu = (ms) => `${new Date(ms).toISOString().slice(11, 19)}Z`;

    // pair: { id, station, weapon, file: { name, text, checksum }, target (parsed from the file),
    //         from, t, state, loadedAt }
    let pairs = ctx.settings.get('pairs', []);
    let selectedId = null;
    let showFile = false;
    const persist = () => ctx.settings.set('pairs', pairs);
    const byId = (id) => pairs.find((p) => p.id === id);
    const title = (p) => `${p.target.name} → STA ${p.station}`;
    const loadedOn = (station) => pairs.find((p) => p.station === station && p.state === 'loaded');
    const pendingOn = (station) => pairs.findLast((p) => p.station === station && ['received', 'review', 'accepted'].includes(p.state));

    // --- checks shown in the review card ---------------------------------------
    // level: ok | warn (worth knowing) | fail (blocks acceptance)
    function checks(p) {
      const t = p.target;
      const out = [];
      const sumOk = checksum(p.file.text) === p.file.checksum;
      out.push({ level: sumOk ? 'ok' : 'fail', text: sumOk ? 'File checksum matches' : 'File checksum does not match: the file may be corrupt' });
      const coordsOk = Number.isFinite(t.lat) && Number.isFinite(t.lon) && Math.abs(t.lat) <= 90 && Math.abs(t.lon) <= 180;
      out.push({ level: coordsOk ? 'ok' : 'fail', text: coordsOk ? 'Aimpoint coordinates are valid' : 'Aimpoint coordinates are missing or invalid' });
      const station = LOADOUT.find((s) => s.id === p.station);
      if (!station) out.push({ level: 'fail', text: `The jet has no station ${p.station}` });
      else if (station.weapon !== p.weapon) out.push({ level: 'fail', text: `STA ${p.station} holds ${station.weapon}, but the pairing is for ${p.weapon}` });
      else out.push({ level: 'ok', text: `STA ${p.station} holds ${station.weapon}, as the pairing expects` });
      if (coordsOk) {
        const inside = ctx.entities.all('threat').filter((th) => th.radiusNm && geo.distanceNm(th, t) <= th.radiusNm);
        out.push(inside.length
          ? { level: 'warn', text: `Target is inside the ring of ${inside.map((th) => th.label).join(', ')}` }
          : { level: 'ok', text: 'Target is outside all threat rings' });
      }
      const current = loadedOn(p.station);
      if (current && current.id !== p.id) out.push({ level: 'warn', text: `Replaces ${current.target.name}, currently loaded on STA ${p.station}` });
      return out;
    }
    const blocked = (p) => checks(p).some((c) => c.level === 'fail');

    // --- map -----------------------------------------------------------------
    const group = L.layerGroup();
    const rangeLine = L.polyline([], { color: ORANGE, weight: 1.5, dashArray: '3 7', interactive: false });
    ctx.layers.add({ id: 'targets', name: 'Targets', layer: group });

    const symbol = (label, selected) => L.divIcon({
      className: '', iconSize: [26, 26], iconAnchor: [13, 13],
      html: `<div class="sym ${selected ? 'selected' : ''}"><svg width="26" height="26" viewBox="0 0 24 24">` +
        `<path d="M12 3l9 16H3z" fill="rgba(255,157,60,.25)" stroke="${ORANGE}" stroke-width="2"/>` +
        `<path d="M12 9v8M8 13.5h8" stroke="${ORANGE}" stroke-width="1.5"/></svg>` +
        `<span class="lbl" style="color:${ORANGE}">${escapeHtml(label)}</span></div>`,
    });
    const stateTag = { review: 'UNDER REVIEW', accepted: 'ACCEPTED · NOT IN JET', loaded: 'LOADED' };

    function drawMap() {
      group.clearLayers();
      for (const p of pairs.filter((x) => SHOWN.includes(x.state))) {
        const t = p.target;
        if (!Number.isFinite(t.lat) || !Number.isFinite(t.lon)) continue;
        if (t.area.length >= 3) {
          L.polygon(t.area, { color: ORANGE, weight: 1.5, fillColor: ORANGE, fillOpacity: 0.08, interactive: false }).addTo(group);
        }
        L.marker([t.lat, t.lon], { icon: symbol(`${t.name} · STA ${p.station} · ${stateTag[p.state]}`, p.id === selectedId), zIndexOffset: 700 })
          .on('click', () => open(p.id, { focus: false }))
          .addTo(group);
      }
      drawRange();
    }

    // Range and bearing from ownship to the pairing being looked at.
    let rangeEl = null;
    function rangeText(p) {
      const own = ctx.ownship.get();
      return own ? `${geo.pad3(geo.bearingDeg(own, p.target))}° / ${geo.distanceNm(own, p.target).toFixed(1)} NM` : 'No ownship position';
    }
    function drawRange() {
      const p = byId(selectedId);
      const own = ctx.ownship.get();
      if (p && own && SHOWN.includes(p.state) && Number.isFinite(p.target.lat)) {
        rangeLine.setLatLngs([[own.lat, own.lon], [p.target.lat, p.target.lon]]);
        if (!group.hasLayer(rangeLine)) group.addLayer(rangeLine);
        if (rangeEl) rangeEl.textContent = rangeText(p);
      } else {
        group.removeLayer(rangeLine);
      }
    }
    ctx.bus.on('ownship:update', drawRange);

    function focus(p) {
      const t = p.target;
      if (!Number.isFinite(t.lat) || !Number.isFinite(t.lon)) return;
      const pts = [0, 90, 180, 270].map((b) => { const q = geo.destination(t, b, 4); return [q.lat, q.lon]; });
      ctx.focus(L.latLngBounds(pts), { maxZoom: 12, paddingTopLeft: [20, 200], paddingBottomRight: [20, 130] });
    }

    // --- flow ----------------------------------------------------------------
    const notices = new Map();

    function announce(p) {
      const notice = ctx.ui.notify({
        title: 'Weapon-target pair received', level: 'warn',
        lines: [title(p), p.weapon, `File: ${p.file.name}`, `From ${p.from} at ${zulu(p.t)}`],
        action: 'Review on map',
      });
      notices.set(p.id, notice);
      notice.then(() => {
        notices.delete(p.id);
        if (byId(p.id)?.state !== 'received') return;
        p.state = 'review';
        ctx.admin.log(`${title(p)} opened for review`);
        open(p.id);
      });
    }

    function receive({ station, weapon, file, from }) {
      const target = parseTargetFile(file.text);
      const p = { id: `wtp-${Date.now().toString(36)}-${pairs.length}`, station, weapon, file, target, from, t: Date.now(), state: 'received', loadedAt: null };
      // A newer pairing for a station replaces any that is still waiting.
      for (const older of pairs) {
        if (older.station === station && ['received', 'review', 'accepted'].includes(older.state)) {
          older.state = 'superseded';
          notices.get(older.id)?.cancel();
          notices.delete(older.id);
        }
      }
      pairs.push(p);
      announce(p);
      sync();
    }

    function open(id, { focus: doFocus = true } = {}) {
      selectedId = id;
      showFile = false;
      const p = byId(id);
      sync();
      if (p) {
        ctx.ui.showPanel('panel');
        if (doFocus) focus(p);
      }
    }

    function decide(p, state) {
      p.state = state;
      ctx.admin.log(`${title(p)} ${state}`);
      if (state === 'rejected') ctx.ui.toast(`${title(p)} rejected. The sender is told (simulated).`);
      if (state === 'accepted') ctx.ui.toast(`${title(p)} accepted. Send it to the jet from the banner.`);
      sync();
    }

    // Accepted pairings are what this plugin has for the jet.
    ctx.bus.on('transfer:collect', (items) => {
      for (const p of pairs.filter((x) => x.state === 'accepted')) {
        items.push({
          id: `wtp:${p.id}`, group: 'Weapon-target pairs', title: title(p),
          detail: [`Load into ${p.weapon}`, geo.fmtLatLon(p.target.lat, p.target.lon), `File ${p.file.name}`],
          apply: () => {
            const previous = loadedOn(p.station);
            if (previous) previous.state = 'superseded';
            p.state = 'loaded';
            p.loadedAt = Date.now();
          },
        });
      }
    });
    ctx.bus.on('transfer:done', () => sync());

    // --- panel ---------------------------------------------------------------
    let root = null;

    function reviewView(p) {
      const t = p.target;
      const list = checks(p);
      const icon = { ok: '✓', warn: '!', fail: '✕' };
      rangeEl = el('dd', { text: rangeText(p) });
      const stateLine = {
        received: 'Waiting to be opened',
        review: 'Under review',
        accepted: 'Accepted. Not yet in the jet.',
        loaded: `Loaded into the weapon on STA ${p.station} at ${p.loadedAt ? zulu(p.loadedAt) : ''}`,
        rejected: 'Rejected',
        superseded: 'Replaced by a newer pairing',
      }[p.state];
      const actions = p.state === 'review' ? [
        el('button', { class: 'btn primary', text: 'Accept', disabled: blocked(p), onclick: () => decide(p, 'accepted') }),
        el('button', { class: 'btn danger', text: 'Reject', onclick: () => decide(p, 'rejected') }),
      ] : p.state === 'accepted' ? [
        el('button', { class: 'btn', text: 'Back to review', onclick: () => decide(p, 'review') }),
      ] : [];
      return [
        el('div', { class: 'btnrow' }, [el('button', { class: 'btn', text: '‹ All stations', onclick: () => open(null) })]),
        el('h3', { text: title(p) }),
        el('p', { class: `slot-status ${p.state === 'loaded' ? 'ok' : ['rejected', 'superseded'].includes(p.state) ? 'bad' : ''}`, text: stateLine }),
        el('dl', { class: 'kv' }, [
          el('dt', { text: 'Station' }), el('dd', { text: `STA ${p.station}` }),
          el('dt', { text: 'Weapon' }), el('dd', { text: p.weapon }),
          el('dt', { text: 'Target' }), el('dd', { text: t.name ?? '---' }),
          el('dt', { text: 'Description' }), el('dd', { text: t.description ?? '---' }),
          el('dt', { text: 'Aimpoint' }), el('dd', { text: Number.isFinite(t.lat) ? geo.fmtLatLon(t.lat, t.lon) : 'invalid' }),
          el('dt', { text: 'Elevation' }), el('dd', { text: t.elevFt == null ? '---' : `${t.elevFt} ft (${t.datum ?? 'datum not given'})` }),
          el('dt', { text: 'From ownship' }), rangeEl,
          el('dt', { text: 'Sent by' }), el('dd', { text: `${p.from} at ${zulu(p.t)}` }),
        ]),
        el('h3', { text: 'Checks' }),
        el('ul', { class: 'checks' }, list.map((c) => el('li', { class: c.level }, [el('b', { text: icon[c.level] }), el('span', { text: c.text })]))),
        el('h3', { text: 'Target file' }),
        el('p', { class: 'muted', style: 'margin-bottom:6px', text: `${p.file.name} · ${p.file.text.length} bytes · checksum ${p.file.checksum}` }),
        el('button', { class: 'linkbtn', style: 'color:var(--blue)', text: showFile ? 'Hide file contents' : 'Show file contents', onclick: () => { showFile = !showFile; drawPanel(); } }),
        showFile ? el('pre', { class: 'filetext', text: p.file.text }) : null,
        actions.length ? el('div', { class: 'btnrow', style: 'margin-top:12px' }, actions) : null,
        p.state === 'review' && blocked(p) ? el('p', { class: 'error', text: 'This pairing fails a check and cannot be accepted.' }) : null,
        el('div', { class: 'btnrow', style: 'margin-top:8px' }, [el('button', { class: 'btn', text: 'Show on map', disabled: !SHOWN.includes(p.state), onclick: () => focus(p) })]),
      ];
    }

    function listView() {
      const waiting = pairs.filter((p) => p.state === 'received').length;
      const past = pairs.filter((p) => ['rejected', 'superseded'].includes(p.state)).slice(-6).reverse();
      return [
        el('h3', { text: 'Weapon stations' }),
        el('p', { class: 'muted', text: waiting ? `${waiting} pairing${waiting > 1 ? 's' : ''} waiting to be opened` : 'Pairings pushed to the tablet appear here for review.' }),
        el('ul', { class: 'list' }, LOADOUT.map((s) => {
          const loaded = loadedOn(s.id), pending = pendingOn(s.id);
          const target = pending && pending.state !== 'received' ? pending : loaded;
          return el('li', { onclick: () => target && open(target.id) }, [
            el('b', { text: `STA ${s.id}` }),
            el('span', { class: pending ? 'tag' : '', text: pending ? { received: 'NEW PAIRING', review: 'UNDER REVIEW', accepted: 'ACCEPTED · NOT IN JET' }[pending.state] : loaded ? 'LOADED' : 'NO TARGET' }),
            el('span', { text: s.weapon }),
            el('span', { text: pending && pending.state !== 'received' ? pending.target.name : loaded ? loaded.target.name : '' }),
          ]);
        })),
        ...(past.length ? [
          el('h3', { text: 'Rejected or replaced' }),
          el('ul', { class: 'list' }, past.map((p) => el('li', { class: 'stale', onclick: () => open(p.id, { focus: false }) }, [
            el('b', { text: title(p) }), el('span', { text: p.state.toUpperCase() }),
            el('span', { text: p.weapon }), el('span', { text: zulu(p.t) }),
          ]))),
        ] : []),
        el('p', { class: 'muted', style: 'margin-top:10px', text: 'Notional stations, weapons and targets for demonstration only.' }),
      ];
    }

    function drawPanel() {
      if (!root) return;
      const p = byId(selectedId);
      rangeEl = null;
      root.replaceChildren(...(p ? reviewView(p) : listView()).filter(Boolean));
    }
    ctx.ui.addPanel({ id: 'panel', title: 'Targets', render: (r) => { root = r; } });

    function sync() {
      persist();
      drawMap();
      drawPanel();
      const review = pairs.filter((p) => p.state === 'review').length;
      ctx.ui.setStatus('review', review ? `${review} TARGET${review > 1 ? 'S' : ''} TO REVIEW` : null, 'warn');
      ctx.bus.emit('transfer:changed');
    }
    // Threat changes can alter the "inside a threat ring" check.
    ctx.bus.on('entity:upsert', (e) => { if (e.kind === 'threat' && selectedId) drawPanel(); });

    // --- simulated events (admin console) -------------------------------------
    let made = ctx.settings.get('made', 0);

    function buildFile({ station, weapon }) {
      const n = made++;
      ctx.settings.set('made', made);
      // Place the target near the threats if there are any, else near the middle of the map.
      const threats = ctx.entities.all('threat');
      const c = ctx.map.getCenter();
      const anchor = threats.length ? threats[Math.floor(Math.random() * threats.length)] : { lat: c.lat, lon: c.lng };
      const at = geo.destination(anchor, Math.random() * 360, 8 + Math.random() * 30);
      const corner = (b) => { const q = geo.destination(at, b + 20, 0.35); return `${q.lat.toFixed(5)},${q.lon.toFixed(5)}`; };
      const id = `NT-${String(400 + n).padStart(4, '0')}`;
      const text = [
        'NOTIONAL TARGET FILE v1',
        `ID: ${id}`,
        `NAME: TGT ${NAMES[n % NAMES.length]}`,
        `STATION: ${station}`,
        `WEAPON: ${weapon}`,
        `AIMPOINT: ${at.lat.toFixed(5)}, ${at.lon.toFixed(5)}`,
        `ELEVATION_FT: ${600 + Math.round(Math.random() * 90) * 10}`,
        'DATUM: WGS-84',
        `DESCRIPTION: ${DESCRIPTIONS[n % DESCRIPTIONS.length]}`,
        `AREA: ${[45, 135, 225, 315].map(corner).join('; ')}`,
        'REMARKS: Notional data for demonstration only',
        'ORIGINATOR: NOTIONAL C2',
        `TIME: ${new Date().toISOString()}`,
      ].join('\n');
      return { name: `${id}.tgt`, text, checksum: checksum(text) };
    }

    function simulate({ mismatch = false, corrupt = false } = {}) {
      // Prefer a station with nothing loaded or waiting, so the first few pairings fill the jet.
      const free = LOADOUT.filter((s) => !loadedOn(s.id) && !pendingOn(s.id));
      const pool = free.length ? free : LOADOUT;
      const station = pool[Math.floor(Math.random() * pool.length)];
      const weapon = mismatch ? LOADOUT.find((s) => s.weapon !== station.weapon).weapon : station.weapon;
      const file = buildFile({ station: station.id, weapon });
      if (corrupt) file.checksum = checksum(`${file.text} `);
      receive({ station: station.id, weapon, file, from: 'NOTIONAL C2' });
    }

    ctx.admin.addAction({ id: 'pair', group: 'Targets', label: 'Weapon-target pair', description: 'A pairing and its target file are pushed to the tablet.', run: () => simulate() });
    ctx.admin.addAction({ id: 'mismatch', group: 'Targets', label: 'Pair for the wrong weapon', description: 'The pairing names a weapon the station does not hold.', run: () => simulate({ mismatch: true }) });
    ctx.admin.addAction({ id: 'corrupt', group: 'Targets', label: 'Pair with a corrupt file', description: 'The target file fails its checksum.', run: () => simulate({ corrupt: true }) });
    ctx.admin.addAction({
      id: 'clear', group: 'Targets', label: 'Clear all targets',
      description: 'Remove every pairing from the tablet and the weapons.',
      run: () => {
        for (const n of notices.values()) n.cancel();
        notices.clear();
        pairs = [];
        selectedId = null;
        sync();
      },
    });

    // Pairings that were still unopened when the app was last closed.
    for (const p of pairs.filter((x) => x.state === 'received')) announce(p);
    sync();
  },
};

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
