// Basemap: a bundled vector world (works with no network at all) plus an optional
// online raster layer whose viewed tiles are cached by the service worker.
const L = window.L;

export async function createBasemap(map) {
  const pane = map.createPane('basemap');
  pane.style.zIndex = 150; // below the tile pane, so raster tiles cover it where loaded
  pane.style.pointerEvents = 'none';
  const renderer = L.canvas({ pane: 'basemap', padding: 0.5 });

  const vector = L.layerGroup().addTo(map);

  try {
    const topo = await (await fetch(new URL('../../data/countries-50m.json', import.meta.url))).json();
    const land = window.topojson.feature(topo, topo.objects.land);
    const borders = window.topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b);
    L.geoJSON(land, {
      renderer, interactive: false,
      style: { color: '#3d5266', weight: 1, fillColor: '#18232e', fillOpacity: 1 },
    }).addTo(vector);
    L.geoJSON(borders, {
      renderer, interactive: false,
      style: { color: '#2c3d4d', weight: 1, fill: false },
    }).addTo(vector);
  } catch (err) {
    console.error('[basemap] vector basemap failed to load', err);
  }
  map.attributionControl.addAttribution('Basemap: Natural Earth');

  // Graticule drawn over the land, with spacing and edge labels that follow zoom.
  const labelPane = map.createPane('graticule-labels');
  labelPane.style.zIndex = 160;
  labelPane.style.pointerEvents = 'none';
  const graticule = L.layerGroup().addTo(vector);
  const label = (latlng, text, cls) => L.marker(latlng, {
    pane: 'graticule-labels', interactive: false, keyboard: false,
    icon: L.divIcon({ className: `grat-label ${cls}`, html: text, iconSize: null }),
  });
  const fmt = (v, pos, neg) => `${Math.abs(v) % 1 ? Math.abs(v).toFixed(1) : Math.abs(v)}°${v === 0 ? '' : v > 0 ? pos : neg}`;
  function drawGraticule() {
    const z = map.getZoom();
    const step = z < 4 ? 20 : z < 5 ? 10 : z < 6.5 ? 5 : z < 9 ? 1 : z < 11 ? 0.5 : 0.1;
    const b = map.getBounds().pad(0.5);
    const south = Math.max(-85, b.getSouth()), north = Math.min(85, b.getNorth());
    const west = Math.max(-180, b.getWest()), east = Math.min(180, b.getEast());
    const view = map.getBounds();
    const lines = [];
    graticule.clearLayers();
    for (let lon = Math.ceil(west / step) * step; lon <= east; lon += step) {
      lines.push([[south, lon], [north, lon]]);
      label([view.getSouth(), lon], fmt(+lon.toFixed(1), 'E', 'W'), 'lon').addTo(graticule);
    }
    for (let lat = Math.ceil(south / step) * step; lat <= north; lat += step) {
      lines.push([[lat, west], [lat, east]]);
      label([lat, view.getWest()], fmt(+lat.toFixed(1), 'N', 'S'), 'lat').addTo(graticule);
    }
    L.polyline(lines, { renderer, color: '#2a3b4a', weight: 1, interactive: false }).addTo(graticule);
  }
  map.on('moveend', drawGraticule);
  drawGraticule();

  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    crossOrigin: 'anonymous', // CORS responses keep the offline tile cache small
    attribution: '&copy; OpenStreetMap contributors',
  });

  return {
    modes: [
      { id: 'vector', name: 'Offline vector' },
      { id: 'osm', name: 'Street map (online, cached as viewed)' },
    ],
    set(mode) {
      if (mode === 'osm') osm.addTo(map); else osm.remove();
    },
  };
}
