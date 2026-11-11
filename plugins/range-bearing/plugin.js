// Range / bearing tool. While the tool is on, tap a start point and then an end
// point. A third tap starts a new measurement.
export default {
  activate(ctx) {
    const { L, geo } = ctx;
    const group = L.layerGroup().addTo(ctx.map);
    ctx.onDispose(() => group.remove());

    let active = false;
    let start = null;

    const dot = (p) => L.circleMarker([p.lat, p.lon], { radius: 5, color: '#fff', fillColor: '#fff', fillOpacity: 1, interactive: false });

    const reset = () => { group.clearLayers(); start = null; };

    ctx.ui.addTool({
      id: 'measure', label: '📏', title: 'Measure range and bearing between two points', toggle: true,
      onToggle: (on) => {
        active = on;
        reset();
        ctx.ui.captureMapTaps(on);
        if (on) ctx.ui.toast('Tap a start point, then an end point');
      },
    });

    ctx.bus.on('map:click', (p) => {
      if (!active) return;
      if (!start || group.getLayers().length > 1) {
        reset();
        start = { lat: p.lat, lon: p.lon };
        dot(start).addTo(group);
        return;
      }
      const end = { lat: p.lat, lon: p.lon };
      const text = `${geo.pad3(geo.bearingDeg(start, end))}° / ${geo.distanceNm(start, end).toFixed(1)} NM`;
      dot(end).addTo(group);
      L.polyline([[start.lat, start.lon], [end.lat, end.lon]], { color: '#fff', weight: 2, dashArray: '6 6', interactive: false })
        .bindTooltip(text, { permanent: true, direction: 'center', className: 'map-label' })
        .addTo(group);
    });
  },
};
