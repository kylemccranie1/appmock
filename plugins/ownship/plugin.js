// Ownship: shows the jet's own position on the tablet, using navigation data
// supplied by the jet.
//
// The feed is simulated (the jet flies a racetrack near the loaded threats).
// A real integration would replace `startFeed` with whatever delivers the jet's
// navigation solution and call `onNav(fix)` the same way:
//   fix = { lat, lon, track (deg true), gs (kt), alt (ft), t (ms) }
//
// If fixes stop arriving, the symbol greys out where it was last seen and the
// top bar shows how old the position is.
const AIRCRAFT = 'M12 2l2 7 8 4v2l-8-2-.5 6 2.5 2v1l-4-1-4 1v-1l2.5-2-.5-6-8 2v-2l8-4z';
const LIVE = '#ffffff';
const STALE = '#8a97a3';
const STALE_AFTER_MS = 3000;
const TRAIL_POINTS = 500;

export default {
  activate(ctx) {
    const { L, geo } = ctx;

    // --- display -------------------------------------------------------------
    const icon = (color) => L.divIcon({
      className: '', iconSize: [40, 40], iconAnchor: [20, 20],
      html: `<div class="sym"><svg class="own" width="40" height="40" viewBox="0 0 24 24">` +
        `<path fill="${color}" stroke="#0b1118" stroke-width=".7" stroke-linejoin="round" d="${AIRCRAFT}"/></svg></div>`,
    });
    const marker = L.marker([0, 0], { interactive: false, zIndexOffset: 1000, icon: icon(LIVE) });
    const trail = L.polyline([], { color: LIVE, weight: 2, opacity: 0.55, dashArray: '2 7', interactive: false });
    const group = L.layerGroup([trail]);
    ctx.layers.add({ id: 'ownship', name: 'Ownship and trail', layer: group });

    let last = null;      // most recent fix
    let stale = false;
    let sinceTrail = 0;

    const rotate = () => {
      const svg = marker.getElement()?.querySelector('.own');
      if (svg && last) svg.style.transform = `rotate(${last.track}deg)`;
    };
    marker.on('add', rotate);

    function setStale(next) {
      if (next !== stale) {
        stale = next;
        marker.setIcon(icon(stale ? STALE : LIVE));
        rotate();
      }
      const age = last ? Math.round((Date.now() - last.t) / 1000) : null;
      ctx.ui.setStatus('nav', stale ? (last ? `NAV DATA LOST ${Math.floor(age / 60)}:${String(age % 60).padStart(2, '0')}` : 'NO NAV DATA') : null, 'danger');
    }

    // Called for every navigation fix from the jet.
    function onNav(fix) {
      last = fix;
      marker.setLatLng([fix.lat, fix.lon]);
      if (!group.hasLayer(marker)) group.addLayer(marker);
      rotate();
      if (++sinceTrail >= 2) {
        sinceTrail = 0;
        trail.addLatLng([fix.lat, fix.lon]);
        const pts = trail.getLatLngs();
        if (pts.length > TRAIL_POINTS) trail.setLatLngs(pts.slice(-TRAIL_POINTS));
      }
      setStale(false);
      ctx.ownship.set({ lat: fix.lat, lon: fix.lon, hdg: fix.track, gs: fix.gs, alt: fix.alt, src: 'JET' });
    }

    ctx.every(1000, () => setStale(!last || Date.now() - last.t > STALE_AFTER_MS));

    // --- simulated jet navigation feed ----------------------------------------
    // A racetrack: straight legs joined by 180 degree turns, anchored near the
    // loaded threats so the jet flies through the area of interest.
    const TICK_MS = 500, GS = 450, ALT = 24000, LEG_NM = 110, TURN_RATE = 1.5; // deg/s
    let feedOn = true;
    let fast = ctx.settings.get('fast', true);
    let sim = ctx.settings.get('sim', null);

    function place(anchor) {
      const start = geo.destination(geo.destination(anchor, 270, LEG_NM / 2), 180, 25);
      sim = { lat: start.lat, lon: start.lon, hdg: 90, leg: 0, turned: 0, turning: false };
      trail.setLatLngs([]);
    }

    function defaultAnchor() {
      const threats = ctx.entities.all('threat');
      if (threats.length) {
        return { lat: threats.reduce((s, t) => s + t.lat, 0) / threats.length, lon: threats.reduce((s, t) => s + t.lon, 0) / threats.length };
      }
      const c = ctx.map.getCenter();
      return { lat: c.lat, lon: c.lng };
    }

    function startFeed() {
      let ticks = 0;
      ctx.every(TICK_MS, () => {
        if (!sim) place(defaultAnchor());
        const dt = (TICK_MS / 1000) * (fast ? 10 : 1); // seconds of flight per tick
        if (sim.turning) {
          const d = TURN_RATE * dt;
          sim.hdg = geo.norm360(sim.hdg + d);
          sim.turned += d;
          if (sim.turned >= 180) Object.assign(sim, { turning: false, turned: 0, leg: 0, hdg: Math.round(sim.hdg / 90) * 90 % 360 });
        } else if (sim.leg >= LEG_NM) {
          sim.turning = true;
        }
        const dist = (GS * dt) / 3600;
        if (!sim.turning) sim.leg += dist;
        Object.assign(sim, geo.destination(sim, sim.hdg, dist));
        if (++ticks % 10 === 0) ctx.settings.set('sim', sim); // the jet keeps flying across reloads
        if (feedOn) onNav({ lat: sim.lat, lon: sim.lon, track: sim.hdg, gs: GS, alt: ALT, t: Date.now() });
      });
    }

    // --- simulated conditions (admin console) ---------------------------------
    ctx.admin.addToggle({
      id: 'feed', group: 'Ownship', label: 'Jet navigation feed',
      description: 'Off: the jet stops sending its position, as if the connection dropped.',
      value: feedOn, onChange: (on) => { feedOn = on; },
    });
    ctx.admin.addToggle({
      id: 'fast', group: 'Ownship', label: 'Fast time (10×)',
      description: 'Fly ten times faster than real time so movement is visible on a wide map.',
      value: fast, onChange: (on) => { fast = on; ctx.settings.set('fast', on); },
    });
    ctx.admin.addAction({
      id: 'here', group: 'Ownship', label: 'Start racetrack at map centre',
      description: 'Restart the simulated flight around the middle of the current view.',
      run: () => {
        const c = ctx.map.getCenter();
        place({ lat: c.lat, lon: c.lng });
      },
    });
    ctx.admin.addAction({
      id: 'threats', group: 'Ownship', label: 'Start racetrack at the threats',
      description: 'Restart the simulated flight around the loaded threats.',
      run: () => place(defaultAnchor()),
    });

    startFeed();
  },
};
