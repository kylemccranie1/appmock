// Notional threat rings. Reads plugins/threats/threats.json and raises an alert
// while ownship is inside a ring. Rings are also published as entities so other
// plugins can use them.
const RED = '#ff5d5d';

export default {
  async activate(ctx) {
    const { L, geo, el } = ctx;
    const { threats } = await (await fetch(ctx.assetUrl('threats.json'))).json();

    const group = L.layerGroup();
    const rings = new Map();
    for (const t of threats) {
      const ring = L.circle([t.lat, t.lon], {
        radius: t.radiusNm * geo.NM_TO_M, color: RED, weight: 2, fillColor: RED, fillOpacity: 0.08,
      }).bindPopup(`<b>${t.name}</b><br>Ring radius ${t.radiusNm} NM<br>${geo.fmtLatLon(t.lat, t.lon)}`);
      const center = L.circleMarker([t.lat, t.lon], { radius: 4, color: RED, fillColor: RED, fillOpacity: 1, interactive: false })
        .bindTooltip(t.name, { permanent: true, direction: 'top', className: 'map-label' });
      group.addLayer(ring).addLayer(center);
      rings.set(t.id, ring);
      ctx.entities.upsert({ id: t.id, kind: 'threat', label: t.name, lat: t.lat, lon: t.lon, radiusNm: t.radiusNm });
    }
    ctx.layers.add({ id: 'rings', name: 'Threat rings', layer: group });

    let root = null;
    let inside = new Set();
    function check(own) {
      const now = new Set();
      const rows = threats.map((t) => {
        const range = geo.distanceNm(own, t);
        const margin = range - t.radiusNm;
        if (margin < 0) now.add(t.id);
        rings.get(t.id).setStyle({ fillOpacity: margin < 0 ? 0.25 : 0.08, weight: margin < 0 ? 3 : 2 });
        return { t, range, margin, brg: geo.bearingDeg(own, t) };
      }).sort((a, b) => a.margin - b.margin);

      for (const id of now) {
        if (!inside.has(id)) ctx.ui.toast(`Inside ${threats.find((t) => t.id === id).name} ring`, { level: 'danger', ms: 6000 });
      }
      inside = now;
      ctx.ui.setStatus('alert', now.size ? `IN THREAT RING (${now.size})` : null, 'danger');

      root?.replaceChildren(
        el('h3', { text: `Threat rings (${threats.length})` }),
        el('ul', { class: 'list' }, rows.map(({ t, range, margin, brg }) =>
          el('li', { onclick: () => { ctx.map.panTo([t.lat, t.lon]); rings.get(t.id).openPopup(); } }, [
            el('b', { text: t.name }),
            el('span', { text: `${geo.pad3(brg)}° / ${range.toFixed(0)} NM` }),
            el('span', { text: `Ring ${t.radiusNm} NM` }),
            el('span', { class: margin < 0 ? 'tag' : '', text: margin < 0 ? `INSIDE by ${(-margin).toFixed(0)} NM` : `${margin.toFixed(0)} NM to edge` }),
          ]))),
        el('p', { class: 'muted', style: 'margin-top:10px', text: 'Notional rings for demonstration only.' }),
      );
    }

    ctx.ui.addPanel({ id: 'panel', title: 'Threats', render: (r) => { root = r; } });
    ctx.bus.on('ownship:update', check);
    const own = ctx.ownship.get();
    if (own) check(own);
  },
};
