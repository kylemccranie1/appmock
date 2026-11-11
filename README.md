# Moving Map Prototype

A plugin-based moving map that runs as an installable, offline-capable web app (PWA). It is a
baseline for prototyping what mission apps could look like as plugins on an open mission engine.

> **Unofficial prototype.** Not affiliated with or endorsed by any government program or vendor.
> All tracks, airspace and threat data in this repo are notional. Not for operational or
> navigational use. This is a public repo: do not commit real or controlled data.

## Ground rule: this is a mockup

The app is a working UI mockup meant to convey requirements in a practical way, not a real
system. Anything a real system would receive from outside (a datalink message, a new threat, a
failure) is simulated. The **admin console** in the top right of the map is where the person
running the demo triggers those events on command or switches automatic simulations on and off.
It is styled differently from the rest of the UI on purpose, so viewers can tell it is not part
of what is being proposed.

## What's in the baseline

- **Engine core** (`js/engine/`): map, event bus, shared ownship + entity store, layer registry,
  drawer/tool-rail UI slots, per-plugin settings, and a plugin host.
- **Offline first**: the basemap is a bundled Natural Earth vector world, and the service worker
  precaches the app shell and every registered plugin. An optional online street map caches
  tiles as they are viewed.
- **No plugins enabled yet.** The screen is the map only: zoom, an offline/online basemap switch
  and a cursor position readout. The side panel, the top bar and the follow-ownship button appear
  on their own once a plugin adds a panel, a status chip or an ownship position. Features are
  being added back one at a time; the earlier demo plugins are in the git history.

No build step and no runtime dependencies beyond the vendored Leaflet and topojson-client.

## Run locally

Any static file server works (service workers need `http://localhost` or HTTPS):

```sh
python3 -m http.server 8080
# open http://localhost:8080
```

## Deploy on GitHub Pages

Either option works; all paths are relative, so the app runs under `/<repo>/`.

- **GitHub Actions (included):** in the repo go to *Settings → Pages → Source* and choose
  *GitHub Actions*. `.github/workflows/pages.yml` then deploys on every push to `main`.
- **From a branch:** *Settings → Pages → Source → Deploy from a branch*, pick the branch and
  `/ (root)`.

After a new deploy, the service worker serves the cached copy first and refreshes in the
background, so changes appear on the second load.

## Writing a plugin

1. Copy `plugins/_template/` to `plugins/<your-id>/`.
2. Add an entry to `plugins/registry.json`:

   ```json
   { "id": "your-id", "name": "Your plugin", "version": "0.1.0",
     "description": "One line.", "enabled": true, "assets": ["data.json"] }
   ```

   `assets` lists extra files in the plugin folder to precache for offline use.
3. Export `activate(ctx)` (and optionally `deactivate()`) from `plugin.js`.

Everything registered through `ctx` is cleaned up automatically when the plugin is disabled.

### Context API

| Member | Purpose |
| --- | --- |
| `ctx.map`, `ctx.L` | The Leaflet map and the Leaflet namespace |
| `ctx.geo` | `distanceNm`, `bearingDeg`, `destination`, `fmtLatLon`, `fmtAlt`, `pad3`, `NM_TO_M` |
| `ctx.el(tag, props, children)` | Small DOM builder |
| `ctx.bus.on(event, fn)` / `ctx.bus.emit(event, data)` | Event bus |
| `ctx.ownship.get()` / `ctx.ownship.set(fix)` | Shared ownship `{ lat, lon, hdg, gs, alt, src }` |
| `ctx.entities.upsert(e)` / `.remove(id)` / `.get(id)` / `.all(kind)` | Shared entity store; entities need `id`, `kind`, `lat`, `lon` |
| `ctx.admin.addAction({ id, label, description, group, run })` | Add an on-command simulated event to the admin console |
| `ctx.admin.addToggle({ id, label, description, group, value, onChange })` | Add an on/off automatic simulation to the admin console |
| `ctx.admin.log(text, level)` | Write a line to the admin console log |
| `ctx.selection.get()` / `ctx.selection.set({ kind, id })` | The entity the user last picked, shared across plugins |
| `ctx.layers.add({ id, name, layer, visible })` | Register an overlay with a toggle in the Layers panel |
| `ctx.ui.addPanel({ id, title, render(root) })` | Add a drawer tab |
| `ctx.ui.addTool({ id, label, title, toggle, onToggle, onClick })` | Add a tool rail button |
| `ctx.ui.setStatus(key, text, level)` | Top bar chip (`info`, `ok`, `warn`, `danger`); pass `null` to clear |
| `ctx.ui.toast(message, { level, ms })` | Transient message |
| `ctx.ui.captureMapTaps(on)` | Route taps to `map:click` instead of overlay popups (for drawing/measuring tools) |
| `ctx.settings.get(key, fallback)` / `.set(key, value)` | Per-plugin persisted settings |
| `ctx.assetUrl(path)` | URL of a file in the plugin's folder |
| `ctx.every(ms, fn)`, `ctx.onDispose(fn)` | Timers and custom cleanup |

### Bus events

| Event | Payload |
| --- | --- |
| `ownship:update` | `{ lat, lon, hdg, gs, alt, src, t }` |
| `entity:upsert` / `entity:remove` | The entity |
| `selection:change` | `{ kind, id }` or `null` |
| `admin:trigger` | `{ id }` of the simulated event that was fired |
| `map:click` | `{ lat, lon, latlng }` |
| `net:change` | `{ online }` |
| `layers:change`, `plugins:change`, `engine:ready` | none |

Plugins should talk to each other through the entity store and the bus rather than importing
one another.

## Known limits

- The offline basemap is country outlines only (Natural Earth 1:50m). A detailed offline
  basemap (for example vector tiles in a PMTiles file) is the obvious next step.
- Plugins run in the page with full access; there is no sandboxing or signing.
- State lives in `localStorage`; there is no sync between devices.

## Credits

[Leaflet](https://leafletjs.com) (BSD-2-Clause), [topojson-client](https://github.com/topojson/topojson-client) (ISC),
[Natural Earth](https://www.naturalearthdata.com) via [world-atlas](https://github.com/topojson/world-atlas),
optional online tiles © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
