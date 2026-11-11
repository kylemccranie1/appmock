// Blue force tracks from a notional simulated feed. Swap `startFeed` for a real
// data link adapter: anything that calls ctx.entities.upsert() will be drawn.
const AIRCRAFT = 'M12 2l2 7 8 4v2l-8-2-.5 6 2.5 2v1l-4-1-4 1v-1l2.5-2-.5-6-8 2v-2l8-4z';
const STALE_MS = 30_000;
const BLUE = '#4fc3ff';

// Notional tracks. `period` is how often the track reports, in seconds.
const SEED = [
  { id: 'bf-nomad11', label: 'NOMAD 11', type: 'air', lat: 38.9, lon: -99.4, hdg: 110, gs: 440, alt: 26000, turn: 0.15, period: 2 },
  { id: 'bf-nomad12', label: 'NOMAD 12', type: 'air', lat: 38.95, lon: -99.6, hdg: 110, gs: 440, alt: 26500, turn: 0.15, period: 2 },
  { id: 'bf-atlas31', label: 'ATLAS 31', type: 'air', lat: 36.9, lon: -96.2, hdg: 320, gs: 380, alt: 21000, turn: -0.2, period: 3 },
  { id: 'bf-comet05', label: 'COMET 05', type: 'air', lat: 39.4, lon: -95.9, hdg: 235, gs: 300, alt: 15000, turn: 0.3, period: 5 },
  { id: 'bf-bison42', label: 'BISON 42', type: 'air', lat: 37.2, lon: -100.3, hdg: 45, gs: 410, alt: 28000, turn: 0, period: 60 },
  { id: 'bf-anvil', label: 'ANVIL OPS', type: 'ground', lat: 38.35, lon: -97.1, hdg: 0, gs: 0, alt: 0, turn: 0, period: 10 },
];

export default {
  activate(ctx) {
    const { L, geo, el } = ctx;
    const TIME_FACTOR = 6;
    const group = L.layerGroup();
    const markers = new Map();
    ctx.layers.add({ id: 'tracks', name: 'Blue force tracks', layer: group });

    const icon = (e, stale) => L.divIcon({
      className: '', iconSize: [26, 26], iconAnchor: [13, 13],
      html: `<div class="sym ${stale ? 'stale' : ''}">${e.type === 'ground'
        ? `<svg width="26" height="26" viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2" fill="none" stroke="${BLUE}" stroke-width="2"/><circle cx="12" cy="12" r="2" fill="${BLUE}"/></svg>`
        : `<svg width="26" height="26" viewBox="0 0 24 24" style="transform:rotate(${e.hdg ?? 0}deg)"><path fill="${BLUE}" d="${AIRCRAFT}"/></svg>`
      }<span class="lbl" style="color:${BLUE}">${e.label}</span></div>`,
    });

    const describe = (e) => {
      const own = ctx.ownship.get();
      const rb = own ? `${geo.pad3(geo.bearingDeg(own, e))}° / ${geo.distanceNm(own, e).toFixed(0)} NM` : '--';
      return { rb, range: own ? geo.distanceNm(own, e) : Infinity };
    };

    function draw(e) {
      const stale = Date.now() - e.t > STALE_MS;
      let m = markers.get(e.id);
      if (!m) {
        m = L.marker([e.lat, e.lon], { icon: icon(e, stale) }).addTo(group);
        m.bindPopup('');
        m.on('popupopen', () => {
          const cur = ctx.entities.get(e.id) ?? e;
          m.setPopupContent(`<b>${cur.label}</b><br>${geo.fmtLatLon(cur.lat, cur.lon)}<br>` +
            `${geo.pad3(cur.hdg ?? 0)}° · ${Math.round(cur.gs ?? 0)} kt · ${geo.fmtAlt(cur.alt)}<br>` +
            `From ownship: ${describe(cur).rb}<br>Age: ${Math.round((Date.now() - cur.t) / 1000)} s`);
        });
        markers.set(e.id, m);
      }
      m.setLatLng([e.lat, e.lon]);
      m.setIcon(icon(e, stale));
    }

    ctx.bus.on('entity:upsert', (e) => { if (e.kind === 'friendly') draw(e); });
    ctx.bus.on('entity:remove', (e) => {
      markers.get(e.id)?.remove();
      markers.delete(e.id);
    });
    ctx.onDispose(() => markers.clear());

    // --- notional feed ------------------------------------------------------
    function startFeed() {
      const tracks = SEED.map((t) => ({ ...t, due: 0 }));
      const tick = () => {
        for (const t of tracks) {
          if (t.gs) {
            t.hdg = geo.norm360(t.hdg + t.turn * TIME_FACTOR);
            Object.assign(t, geo.destination(t, t.hdg, (t.gs * TIME_FACTOR) / 3600));
          }
          if (--t.due <= 0) {
            t.due = t.period;
            const { due, turn, period, ...report } = t;
            ctx.entities.upsert({ ...report, kind: 'friendly' });
          }
        }
      };
      tick();
      ctx.every(1000, tick);
    }

    // --- panel --------------------------------------------------------------
    let root = null;
    function drawPanel() {
      if (!root) return;
      const rows = ctx.entities.all('friendly')
        .map((e) => ({ e, ...describe(e), stale: Date.now() - e.t > STALE_MS }))
        .sort((a, b) => a.range - b.range);
      root.replaceChildren(
        el('h3', { text: `Tracks (${rows.length})` }),
        el('ul', { class: 'list' }, rows.map(({ e, rb, stale }) =>
          el('li', { class: stale ? 'stale' : '', onclick: () => {
            ctx.map.panTo([e.lat, e.lon]);
            markers.get(e.id)?.openPopup();
          } }, [
            el('b', { text: e.label }),
            el('span', { text: rb }),
            el('span', { text: e.type === 'ground' ? 'Ground' : `${geo.fmtAlt(e.alt)} · ${Math.round(e.gs)} kt` }),
            el('span', { class: stale ? 'tag' : '', text: stale ? `STALE ${Math.round((Date.now() - e.t) / 1000)} s` : 'Live' }),
          ]))),
        el('p', { class: 'muted', style: 'margin-top:10px', text: 'Notional feed. Tracks dim when no report has arrived for 30 s.' }),
      );
    }
    ctx.ui.addPanel({ id: 'panel', title: 'Tracks', render: (r) => { root = r; } });
    ctx.every(2000, () => {
      drawPanel();
      for (const e of ctx.entities.all('friendly')) draw(e); // refresh staleness
    });

    startFeed();
    drawPanel();
  },
};
