// Airspace overlay. Reads plugins/airspace/airspace.geojson; each feature needs
// properties { name, type, status, floor, ceiling }.
const STYLE = {
  refuel: { color: '#54d18c', dashArray: null },
  restricted: { color: '#ffb347', dashArray: '6 6' },
  corridor: { color: '#b28cff', dashArray: null },
  default: { color: '#8298ab', dashArray: '2 6' },
};

export default {
  async activate(ctx) {
    const { L, el } = ctx;
    const data = await (await fetch(ctx.assetUrl('airspace.geojson'))).json();

    const layer = L.geoJSON(data, {
      style: (f) => {
        const s = STYLE[f.properties.type] ?? STYLE.default;
        const active = f.properties.status === 'ACTIVE';
        return { color: s.color, weight: 2, dashArray: s.dashArray, fillColor: s.color, fillOpacity: active ? 0.14 : 0.03, opacity: active ? 0.9 : 0.5 };
      },
      onEachFeature: (f, lyr) => {
        const p = f.properties;
        lyr.bindPopup(`<b>${p.name}</b><br>${p.type.toUpperCase()} · ${p.status}<br>${p.floor} to ${p.ceiling}`);
        lyr.bindTooltip(p.name, { permanent: true, direction: 'center', className: 'map-label' });
      },
    });
    ctx.layers.add({ id: 'volumes', name: 'Airspace volumes', layer });

    ctx.ui.addPanel({
      id: 'panel', title: 'Airspace',
      render: (root) => root.replaceChildren(
        el('h3', { text: `Volumes (${data.features.length})` }),
        el('ul', { class: 'list' }, data.features.map((f, i) => {
          const p = f.properties;
          return el('li', { onclick: () => {
            const target = layer.getLayers()[i];
            ctx.map.fitBounds(target.getBounds(), { padding: [40, 40], maxZoom: 9 });
            target.openPopup();
          } }, [
            el('b', { text: p.name }),
            el('span', { class: p.status === 'ACTIVE' ? 'tag' : '', text: p.status }),
            el('span', { text: p.type }),
            el('span', { text: `${p.floor} to ${p.ceiling}` }),
          ]);
        })),
        el('p', { class: 'muted', style: 'margin-top:10px', text: 'Notional volumes for demonstration only.' }),
      ),
    });
  },
};
