// Target folder: a list of target points, each with a card and a map symbol.
//
// Targets are published as `kind: 'target'` entities so other plugins can use
// them. Over-the-air changes arrive as `link:message` bus events (see README)
// and are held as pending until the user accepts or rejects them, unless
// auto-accept is on. Every message is answered with a `link:ack` event.
const ORANGE = '#ff9d3c';
const STATUSES = ['ACTIVE', 'HOLD', 'COMPLETE'];
const FIELDS = [
  ['name', 'Name'], ['category', 'Category'], ['priority', 'Priority'],
  ['status', 'Status'], ['elevFt', 'Elevation (ft)'], ['notes', 'Notes'],
];

export default {
  async activate(ctx) {
    const { L, geo, el } = ctx;

    // --- state ---------------------------------------------------------------
    async function seed() {
      const { targets } = await (await fetch(ctx.assetUrl('targets.json'))).json();
      return targets.map((t) => ({ rev: 1, source: 'seed', updatedAt: Date.now(), ...t }));
    }
    let targets = ctx.settings.get('targets', null) ?? await seed();
    const pending = new Map(ctx.settings.get('pending', [])); // target id -> { kind, msg, proposed }
    const seen = new Set(ctx.settings.get('seen', []));       // message ids already handled
    let autoAccept = ctx.settings.get('autoAccept', false);
    let selectedId = null;
    let editingId = null;
    let placing = false;

    const byId = (id) => targets.find((t) => t.id === id);
    const persist = () => {
      ctx.settings.set('targets', targets);
      ctx.settings.set('pending', [...pending]);
      ctx.settings.set('seen', [...seen].slice(-200));
    };

    // --- map -----------------------------------------------------------------
    const group = L.layerGroup();
    const markers = new Map();
    const published = new Set();
    ctx.layers.add({ id: 'targets', name: 'Targets', layer: group });

    const symbol = (t, { selected = false, ghost = false } = {}) => L.divIcon({
      className: '', iconSize: [26, 26], iconAnchor: [13, 13],
      html: `<div class="sym ${selected ? 'selected' : ''} ${ghost ? 'ghost' : ''}">` +
        `<svg width="26" height="26" viewBox="0 0 24 24"><path d="M12 3l9 16H3z" fill="${ghost ? 'none' : 'rgba(255,157,60,.25)'}" ` +
        `stroke="${ORANGE}" stroke-width="2" ${ghost ? 'stroke-dasharray="3 3"' : ''}/><circle cx="12" cy="13.5" r="1.6" fill="${ORANGE}"/></svg>` +
        `<span class="lbl" style="color:${ORANGE}">${ghost ? 'PROPOSED' : escapeHtml(t.name)}</span></div>`,
    });

    function drawMap() {
      group.clearLayers();
      markers.clear();
      for (const t of targets) {
        const m = L.marker([t.lat, t.lon], { icon: symbol(t, { selected: t.id === selectedId }), zIndexOffset: 500 })
          .on('click', () => select(t.id))
          .addTo(group);
        markers.set(t.id, m);
      }
      // Proposed positions from pending updates, drawn as ghosts.
      for (const [id, p] of pending) {
        if (p.kind === 'delete') continue;
        const cur = byId(id);
        if (cur && cur.lat === p.proposed.lat && cur.lon === p.proposed.lon) continue;
        L.marker([p.proposed.lat, p.proposed.lon], { icon: symbol(p.proposed, { ghost: true }), interactive: false }).addTo(group);
        if (cur) {
          L.polyline([[cur.lat, cur.lon], [p.proposed.lat, p.proposed.lon]],
            { color: ORANGE, weight: 2, dashArray: '4 6', interactive: false }).addTo(group);
        }
      }
    }

    function publish() {
      const ids = new Set(targets.map((t) => t.id));
      for (const id of [...published]) {
        if (!ids.has(id)) { ctx.entities.remove(id); published.delete(id); }
      }
      for (const t of targets) {
        ctx.entities.upsert({ ...t, kind: 'target', label: t.name });
        published.add(t.id);
      }
    }

    function sync({ data = true } = {}) {
      if (data) { publish(); persist(); ctx.bus.emit('targets:change', targets); }
      drawMap();
      drawPanel();
      const n = pending.size;
      ctx.ui.setStatus('pending', n ? `${n} TGT UPDATE${n > 1 ? 'S' : ''}` : null, 'warn');
    }

    function select(id, { pan = true } = {}) {
      selectedId = id;
      editingId = null;
      const t = byId(id);
      if (t && pan) ctx.map.panTo([t.lat, t.lon]);
      if (ctx.selection.get()?.id !== id) ctx.selection.set(id ? { kind: 'target', id } : null);
      sync({ data: false });
    }
    ctx.bus.on('selection:change', (sel) => {
      if (sel?.kind === 'target' && sel.id !== selectedId && byId(sel.id)) select(sel.id);
    });

    // --- over-the-air updates ------------------------------------------------
    const ack = (msg, result) => ctx.bus.emit('link:ack', { id: msg.id, result });

    function describe(cur, next) {
      const lines = [];
      if (!cur) return [`New target at ${geo.fmtLatLon(next.lat, next.lon)}`, `${next.category} · P${next.priority} · ${next.status}`];
      if (cur.lat !== next.lat || cur.lon !== next.lon) {
        lines.push(`Position: moved ${geo.distanceNm(cur, next).toFixed(1)} NM on ${geo.pad3(geo.bearingDeg(cur, next))}° to ${geo.fmtLatLon(next.lat, next.lon)}`);
      }
      for (const [key, label] of FIELDS) {
        if ((cur[key] ?? '') !== (next[key] ?? '')) lines.push(`${label}: ${cur[key] ?? '—'} → ${next[key] ?? '—'}`);
      }
      return lines.length ? lines : ['No field changes'];
    }

    function receive(msg) {
      if (!msg?.id || seen.has(msg.id)) return;
      seen.add(msg.id);
      const p = msg.payload ?? {};
      const cur = byId(p.id);
      let entry;
      if (msg.type === 'target.delete') {
        if (!cur) return ack(msg, 'ignored');
        entry = { kind: 'delete', msg };
      } else if (msg.type === 'target.upsert') {
        if (!Number.isFinite(p.lat ?? cur?.lat) || !Number.isFinite(p.lon ?? cur?.lon)) return ack(msg, 'invalid');
        if (cur && (p.rev ?? 0) <= cur.rev) return ack(msg, 'stale');
        entry = {
          kind: cur ? 'update' : 'new', msg,
          proposed: {
            name: 'UNNAMED', category: 'Unknown', priority: 3, status: 'ACTIVE', elevFt: null, notes: '', rev: 1,
            ...cur, ...p, source: 'link', updatedAt: Date.parse(msg.t) || Date.now(),
          },
        };
      } else {
        return; // not a message this plugin handles
      }
      const older = pending.get(p.id);
      if (older) ack(older.msg, 'superseded');
      pending.set(p.id, entry);
      if (autoAccept) return accept(p.id);
      ctx.ui.toast(`Target update received: ${cur?.name ?? entry.proposed.name}`, { level: 'warn' });
      sync();
    }

    function accept(id) {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (p.kind === 'delete') {
        targets = targets.filter((t) => t.id !== id);
        if (selectedId === id) { selectedId = null; ctx.selection.set(null); }
      } else if (byId(id)) {
        targets = targets.map((t) => (t.id === id ? p.proposed : t));
      } else {
        targets = [...targets, p.proposed];
      }
      ack(p.msg, 'accepted');
      sync();
    }

    function reject(id) {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      ack(p.msg, 'rejected');
      sync();
    }

    ctx.bus.on('link:message', receive);

    // --- local edits ---------------------------------------------------------
    function setPlacing(on) {
      placing = on;
      ctx.ui.captureMapTaps(on);
      if (on) ctx.ui.toast('Tap the map to place the target');
      drawPanel();
    }

    ctx.bus.on('map:click', (p) => {
      if (!placing) return;
      const n = targets.length + 1;
      const t = {
        id: `tgt-${Date.now().toString(36)}`, name: `NT-${String(n).padStart(3, '0')} NEW`, category: 'Unknown',
        priority: 3, status: 'ACTIVE', lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5), elevFt: null, notes: '',
        rev: 1, source: 'local', updatedAt: Date.now(),
      };
      targets = [...targets, t];
      setPlacing(false);
      selectedId = t.id;
      editingId = t.id;
      sync();
    });

    function saveEdit(id, form) {
      const v = Object.fromEntries(new FormData(form));
      const lat = Number(v.lat), lon = Number(v.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        return ctx.ui.toast('Latitude or longitude is not valid', { level: 'warn' });
      }
      targets = targets.map((t) => (t.id !== id ? t : {
        ...t, name: v.name.trim() || t.name, category: v.category.trim(), priority: Number(v.priority), status: v.status,
        lat, lon, elevFt: v.elevFt === '' ? null : Number(v.elevFt), notes: v.notes,
        rev: t.rev + 1, source: 'local', updatedAt: Date.now(),
      }));
      editingId = null;
      sync();
    }

    function remove(id) {
      if (!confirm(`Delete ${byId(id)?.name}?`)) return;
      targets = targets.filter((t) => t.id !== id);
      const p = pending.get(id);
      if (p) { pending.delete(id); ack(p.msg, 'ignored'); }
      selectedId = null;
      ctx.selection.set(null);
      sync();
    }

    // --- panel ---------------------------------------------------------------
    let root = null;
    const fromOwnship = (t) => {
      const own = ctx.ownship.get();
      return own ? `${geo.pad3(geo.bearingDeg(own, t))}° / ${geo.distanceNm(own, t).toFixed(0)} NM` : '--';
    };

    function pendingCard(id, p) {
      const cur = byId(id);
      const title = { new: 'NEW TARGET', update: 'UPDATE', delete: 'DELETE REQUEST' }[p.kind];
      const lines = p.kind === 'delete' ? ['Sender asks to remove this target'] : describe(cur, p.proposed);
      const where = p.kind === 'delete' ? cur : p.proposed;
      return el('div', { class: 'card' }, [
        el('h4', { text: `${title} · ${cur?.name ?? p.proposed.name}` }),
        el('p', { class: 'muted', style: 'margin:0', text: `From ${p.msg.from ?? 'unknown'} at ${String(p.msg.t).slice(11, 19)}Z` }),
        el('ul', {}, lines.map((text) => el('li', { text }))),
        el('div', { class: 'btnrow' }, [
          el('button', { class: 'btn primary', text: 'Accept', onclick: () => accept(id) }),
          el('button', { class: 'btn', text: 'Reject', onclick: () => reject(id) }),
          el('button', { class: 'btn', text: 'Show', onclick: () => ctx.map.panTo([where.lat, where.lon]) }),
        ]),
      ]);
    }

    function listView() {
      const rows = [...targets].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
      return [
        el('div', { class: 'btnrow' }, [
          el('button', { class: `btn ${placing ? 'active' : ''}`, text: placing ? 'Cancel placing' : 'Add target', onclick: () => setPlacing(!placing) }),
        ]),
        el('label', { class: 'row' }, [
          el('input', { type: 'checkbox', checked: autoAccept, onchange: (e) => {
            autoAccept = e.target.checked;
            ctx.settings.set('autoAccept', autoAccept);
            if (autoAccept) for (const id of [...pending.keys()]) accept(id);
          } }),
          el('span', { text: 'Auto-accept over-the-air updates' }),
        ]),
        pending.size ? el('h3', { text: `Pending updates (${pending.size})` }) : null,
        ...[...pending].map(([id, p]) => pendingCard(id, p)),
        el('h3', { text: `Targets (${rows.length})` }),
        el('ul', { class: 'list' }, rows.map((t) => el('li', { onclick: () => select(t.id) }, [
          el('b', { text: t.name }),
          el('span', { text: fromOwnship(t) }),
          el('span', { text: `P${t.priority} · ${t.category}` }),
          el('span', { class: pending.has(t.id) ? 'tag' : '', text: pending.has(t.id) ? 'UPDATE PENDING' : t.status }),
        ]))),
        el('div', { class: 'btnrow', style: 'margin-top:12px' }, [
          el('button', { class: 'btn', text: 'Reset to bundled targets', onclick: async () => {
            if (!confirm('Replace all targets with the bundled notional set?')) return;
            targets = await seed();
            for (const p of pending.values()) ack(p.msg, 'ignored');
            pending.clear();
            selectedId = null;
            sync();
          } }),
        ]),
        el('p', { class: 'muted', text: 'Notional targets for demonstration only.' }),
      ];
    }

    function detailView(t) {
      const p = pending.get(t.id);
      return [
        el('div', { class: 'btnrow' }, [el('button', { class: 'btn', text: '‹ All targets', onclick: () => select(null) })]),
        p ? pendingCard(t.id, p) : null,
        el('h3', { text: t.name }),
        el('dl', { class: 'kv' }, [
          el('dt', { text: 'Position' }), el('dd', { text: geo.fmtLatLon(t.lat, t.lon) }),
          el('dt', { text: 'Elevation' }), el('dd', { text: t.elevFt == null ? '---' : `${t.elevFt} ft` }),
          el('dt', { text: 'From ownship' }), el('dd', { text: fromOwnship(t) }),
          el('dt', { text: 'Category' }), el('dd', { text: t.category || '---' }),
          el('dt', { text: 'Priority' }), el('dd', { text: `P${t.priority}` }),
          el('dt', { text: 'Status' }), el('dd', { text: t.status }),
          el('dt', { text: 'Revision' }), el('dd', { text: `${t.rev} (${t.source})` }),
          el('dt', { text: 'Updated' }), el('dd', { text: `${new Date(t.updatedAt).toISOString().slice(11, 19)}Z` }),
        ]),
        t.notes ? el('p', { style: 'font-size:13px', text: t.notes }) : null,
        el('div', { class: 'btnrow', style: 'margin-top:12px' }, [
          el('button', { class: 'btn', text: 'Center', onclick: () => ctx.map.panTo([t.lat, t.lon]) }),
          el('button', { class: 'btn', text: 'Edit', onclick: () => { editingId = t.id; drawPanel(); } }),
          el('button', { class: 'btn danger', text: 'Delete', onclick: () => remove(t.id) }),
        ]),
      ];
    }

    function editView(t) {
      const field = (label, input) => el('label', { class: 'field' }, [el('span', { text: label }), input]);
      const option = (value, text, current) => el('option', { value, text, selected: String(value) === String(current) });
      const form = el('form', { onsubmit: (e) => { e.preventDefault(); saveEdit(t.id, form); } }, [
        el('h3', { text: 'Edit target' }),
        field('Name', el('input', { name: 'name', value: t.name, required: true })),
        field('Category', el('input', { name: 'category', value: t.category ?? '' })),
        field('Priority', el('select', { name: 'priority' }, [1, 2, 3].map((n) => option(n, `P${n}`, t.priority)))),
        field('Status', el('select', { name: 'status' }, STATUSES.map((s) => option(s, s, t.status)))),
        field('Latitude (decimal degrees)', el('input', { name: 'lat', value: t.lat, inputmode: 'decimal', required: true })),
        field('Longitude (decimal degrees)', el('input', { name: 'lon', value: t.lon, inputmode: 'decimal', required: true })),
        field('Elevation (ft)', el('input', { name: 'elevFt', value: t.elevFt ?? '', inputmode: 'numeric' })),
        field('Notes', el('textarea', { name: 'notes', text: t.notes ?? '' })),
        el('div', { class: 'btnrow' }, [
          el('button', { class: 'btn primary', type: 'submit', text: 'Save' }),
          el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => { editingId = null; drawPanel(); } }),
        ]),
      ]);
      return [form];
    }

    function drawPanel() {
      if (!root) return;
      const editing = byId(editingId);
      const selected = byId(selectedId);
      root.replaceChildren(...(editing ? editView(editing) : selected ? detailView(selected) : listView()).filter(Boolean));
    }

    ctx.ui.addPanel({ id: 'panel', title: 'Targets', render: (r) => { root = r; } });
    // Keep range/bearing fresh, but never redraw over a form the user is typing in.
    ctx.every(2000, () => { if (!editingId) drawPanel(); });

    sync();
  },
};

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
