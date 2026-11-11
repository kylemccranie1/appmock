// Plugin template. Copy this folder, rename it, and add an entry to
// plugins/registry.json. See the README for the full context API.
//
// Everything registered through `ctx` (layers, panels, tools, bus listeners,
// timers, entities, status chips) is removed automatically on disable, so
// `deactivate` is only needed for resources the engine cannot see, such as an
// open WebSocket.
export default {
  async activate(ctx) {
    const { L, el } = ctx;

    // A map overlay with a toggle in the Layers panel.
    const layer = L.layerGroup();
    ctx.layers.add({ id: 'example', name: 'Example overlay', layer });

    // React to shared state.
    ctx.bus.on('ownship:update', (own) => {
      // own = { lat, lon, hdg, gs, alt, src, t }
    });

    // A drawer panel.
    ctx.ui.addPanel({
      id: 'panel', title: 'Example',
      render: (root) => root.append(el('p', { class: 'muted', text: 'Hello from a plugin.' })),
    });

    // A tool rail button.
    ctx.ui.addTool({ id: 'hello', label: '★', title: 'Say hello', onClick: () => ctx.ui.toast('Hello') });

    // Simulated events for the admin console (top right). Use an action for an
    // event fired on command and a toggle for a simulation that runs by itself.
    ctx.admin.addAction({
      id: 'ping', label: 'Example event', description: 'Shows a toast.',
      run: () => ctx.ui.toast('Simulated event received'),
    });
    let auto = false;
    ctx.admin.addToggle({ id: 'auto', label: 'Example auto simulation', value: auto, onChange: (on) => { auto = on; } });
    ctx.every(10000, () => { if (auto) ctx.ui.toast('Automatic simulated event'); });

    // Persisted, per-plugin settings.
    ctx.settings.set('lastStarted', Date.now());
  },

  async deactivate() {},
};
