# Moving Map Prototype

A plugin-based moving map that runs as an installable, offline-capable web app (PWA). It is a
baseline for prototyping what mission apps could look like as plugins on an open mission engine.

> **Unofficial prototype.** Not affiliated with or endorsed by any government program or vendor.
> All tracks, airspace and threat data in this repo are notional. Not for operational or
> navigational use. This is a public repo: do not commit real or controlled data.

## What's in the baseline

- **Engine core** (`js/engine/`): map, event bus, shared ownship + entity store, layer registry,
  drawer/tool-rail UI slots, per-plugin settings, and a plugin host.
- **Offline first**: the basemap is a bundled Natural Earth vector world, and the service worker
  precaches the app shell and every registered plugin. An optional online street map caches
  tiles as they are viewed.
- **Five plugins** (`plugins/`), each of which can be switched on and off at runtime:

  | Plugin | What it does |
  | --- | --- |
  | `ownship` | Own position from a racetrack simulator or the device GPS, with a trail |
  | `blue-force` | Friendly tracks from a notional feed, with range/bearing and stale-track dimming |
  | `airspace` | Airspace volumes from a GeoJSON file |
  | `threats` | Threat rings from a JSON file, with an alert while ownship is inside one |
  | `range-bearing` | Two-tap range and bearing measurement |

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
| `map:click` | `{ lat, lon, latlng }` |
| `net:change` | `{ online }` |
| `layers:change`, `plugins:change`, `engine:ready` | none |

Plugins should talk to each other through the entity store and the bus rather than importing
one another. For example, `threats` publishes its rings as `kind: 'threat'` entities, and a real
data-link adapter only needs to call `ctx.entities.upsert()` for `blue-force` to draw its tracks.

## Known limits

- The offline basemap is country outlines only (Natural Earth 1:50m). A detailed offline
  basemap (for example vector tiles in a PMTiles file) is the obvious next step.
- Plugins run in the page with full access; there is no sandboxing or signing.
- State lives in `localStorage`; there is no sync between devices.

## Credits

[Leaflet](https://leafletjs.com) (BSD-2-Clause), [topojson-client](https://github.com/topojson/topojson-client) (ISC),
[Natural Earth](https://www.naturalearthdata.com) via [world-atlas](https://github.com/topojson/world-atlas),
optional online tiles © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
