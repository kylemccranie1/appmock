// Ownship: publishes the aircraft's own position to the engine and draws it.
// Source is either a built-in racetrack simulator or the device GPS.
const AIRCRAFT = 'M12 2l2 7 8 4v2l-8-2-.5 6 2.5 2v1l-4-1-4 1v-1l2.5-2-.5-6-8 2v-2l8-4z';
const TRAIL_POINTS = 600;

export default {
  activate(ctx) {
    const { L, geo, el } = ctx;

    const marker = L.marker([0, 0], {
      interactive: false, zIndexOffset: 1000,
      icon: L.divIcon({
        className: '', iconSize: [36, 36], iconAnchor: [18, 18],
        html: `<div class="sym"><svg class="own" width="36" height="36" viewBox="0 0 24 24"><path fill="#ffd24a" d="${AIRCRAFT}"/></svg></div>`,
      }),
    });
    const trail = L.polyline([], { color: '#ffd24a', weight: 2, opacity: 0.6, dashArray: '3 6', interactive: false });
    const group = L.layerGroup([trail]);
    ctx.layers.add({ id: 'ownship', name: 'Ownship and trail', layer: group });

    ctx.bus.on('ownship:update', (o) => {
      marker.setLatLng([o.lat, o.lon]);
      if (!group.hasLayer(marker)) group.addLayer(marker);
      const svg = marker.getElement()?.querySelector('.own');
      if (svg) svg.style.transform = `rotate(${o.hdg ?? 0}deg)`;
      trail.addLatLng([o.lat, o.lon]);
      const pts = trail.getLatLngs();
      if (pts.length > TRAIL_POINTS) trail.setLatLngs(pts.slice(-TRAIL_POINTS));
    });

    // --- sources -----------------------------------------------------------
    // Racetrack: straight legs joined by 180 degree turns, run faster than real
    // time so movement is visible on a wide-area map.
    function startSim() {
      const TIME_FACTOR = 6, GS = 420, LEG_NM = 60, TURN_RATE = 1.5;
      const s = { lat: 37.6, lon: -98.6, hdg: 70, leg: 0, turned: 0, turning: false };
      const step = () => {
        const dt = TIME_FACTOR; // seconds of sim time per 1 s tick
        if (s.turning) {
          const d = TURN_RATE * dt;
          s.hdg = geo.norm360(s.hdg + d);
          s.turned += d;
          if (s.turned >= 180) { s.turning = false; s.turned = 0; s.leg = 0; }
        } else if (s.leg >= LEG_NM) {
          s.turning = true;
        }
        const dist = (GS * dt) / 3600;
        if (!s.turning) s.leg += dist;
        Object.assign(s, geo.destination(s, s.hdg, dist));
        ctx.ownship.set({ lat: s.lat, lon: s.lon, hdg: s.hdg, gs: GS, alt: 24000, src: 'SIM' });
      };
      step();
      const h = setInterval(step, 1000);
      return () => clearInterval(h);
    }

    function startGps() {
      if (!('geolocation' in navigator)) {
        ctx.ui.toast('This device has no location service. Using the simulator.', { level: 'warn' });
        setTimeout(() => setSource('sim'));
        return () => {};
      }
      let last = null;
      const id = navigator.geolocation.watchPosition((pos) => {
        const c = pos.coords;
        const here = { lat: c.latitude, lon: c.longitude };
        let hdg = Number.isFinite(c.heading) ? c.heading : null;
        if (hdg == null && last && geo.distanceNm(last, here) > 0.01) hdg = geo.bearingDeg(last, here);
        hdg ??= ctx.ownship.get()?.hdg ?? 0;
        last = here;
        ctx.ownship.set({
          ...here, hdg,
          gs: Number.isFinite(c.speed) ? c.speed * 1.94384 : null,
          alt: Number.isFinite(c.altitude) ? c.altitude * 3.28084 : null,
          src: 'GPS',
        });
      }, (err) => {
        ctx.ui.toast(`Location unavailable (${err.message}). Using the simulator.`, { level: 'warn' });
        setSource('sim');
      }, { enableHighAccuracy: true, maximumAge: 1000 });
      return () => navigator.geolocation.clearWatch(id);
    }

    let stop = null;
    let source = ctx.settings.get('source', 'sim');
    function setSource(next) {
      stop?.();
      source = next;
      ctx.settings.set('source', next);
      trail.setLatLngs([]);
      drawPanel();
      stop = next === 'gps' ? startGps() : startSim();
    }
    ctx.onDispose(() => stop?.());

    // --- panel -------------------------------------------------------------
    let panelRoot = null;
    function drawPanel() {
      if (!panelRoot) return;
      const o = ctx.ownship.get();
      panelRoot.replaceChildren(
        el('h3', { text: 'Position source' }),
        el('div', { class: 'btnrow' }, [
          el('button', { class: `btn ${source === 'sim' ? 'active' : ''}`, text: 'Simulator', onclick: () => setSource('sim') }),
          el('button', { class: `btn ${source === 'gps' ? 'active' : ''}`, text: 'Device GPS', onclick: () => setSource('gps') }),
        ]),
        el('h3', { text: 'Current fix' }),
        el('dl', { class: 'kv' }, o ? [
          el('dt', { text: 'Position' }), el('dd', { text: geo.fmtLatLon(o.lat, o.lon) }),
          el('dt', { text: 'Heading' }), el('dd', { text: `${geo.pad3(o.hdg ?? 0)}°` }),
          el('dt', { text: 'Ground speed' }), el('dd', { text: o.gs == null ? '---' : `${Math.round(o.gs)} kt` }),
          el('dt', { text: 'Altitude' }), el('dd', { text: geo.fmtAlt(o.alt) }),
        ] : [el('dt', { text: 'Waiting for a fix' }), el('dd')]),
        el('div', { class: 'btnrow', style: 'margin-top:12px' }, [
          el('button', { class: 'btn', text: 'Clear trail', onclick: () => trail.setLatLngs([]) }),
        ]),
      );
    }
    ctx.ui.addPanel({ id: 'panel', title: 'Ownship', render: (root) => { panelRoot = root; } });
    ctx.bus.on('ownship:update', drawPanel);

    setSource(source);
  },
};
