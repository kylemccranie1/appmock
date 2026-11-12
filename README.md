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
It can be dragged anywhere over the map (by the button or the panel header) and stays where it is put.
It is styled differently from the rest of the UI on purpose, so viewers can tell it is not part
of what is being proposed.

## What's in the baseline

- **Engine core** (`js/engine/`): map, event bus, shared ownship + entity store, layer registry,
  drawer/tool-rail UI slots, per-plugin settings, and a plugin host.
- **Offline first**: the basemap is a bundled Natural Earth vector world, and the service worker
  precaches the app shell and every registered plugin. An optional online street map caches
  tiles as they are viewed.
- **Data panel**: one upload slot per mission file type. The first is the Ground Threat List.
- **Three plugins so far** (`plugins/ownship/`, `plugins/ground-threats/` and
  `plugins/jet-transfer/`). Features are being added one at a time; the
  earlier demo plugins are in the git history.

## Ownship

The tablet shows the jet's current position using navigation data from the jet: an aircraft
symbol pointing along its track, a trail, and position, heading, ground speed and altitude in the
top bar. The ◎ button keeps the map centred on the jet; dragging the map, or anything that moves
the map on purpose (such as showing a threat update), turns it off so the view stays put.

If the navigation data stops, the symbol greys out where it was last seen and the top bar counts
how long ago that was.

The feed is simulated: the jet flies a racetrack near the loaded threats. Admin console controls:
*Jet navigation feed* (on/off), *Fast time (10×)*, *Start racetrack at map centre* and *Start
racetrack at the threats*.

## Use case: threat updates in flight

The overall flow being mocked up: threat information changes in flight, the crew sees it on the
tablet first, then pushes it to the jet through a data transfer.

Built so far:

1. **Load the Ground Threat List (GTL).** The GTL is the list the mission takes off with and what
   the jet already holds. Load it in the *Data* tab (file picker, drag and drop, or *Load
   sample*). Format: CSV with a header row `id,name,type,lat,lon,radius_nm,status`, or JSON with
   the same keys (an array, or `{ "threats": [...] }`). Positions are decimal degrees; `radius_nm`
   and `status` (`ACTIVE`, `SUSPECTED` or `INACTIVE`) are optional. Invalid and duplicate rows are skipped and reported.
2. **Threat update.** Five kinds are handled: a **new threat** that was not in the takeoff list,
   a new **position**, a new **type** (with its threat ring size), a new **status** (active,
   suspected or inactive), and **no longer a threat**. Each pops a notification saying what changed.
   The map does not change until the user acknowledges.
3. **Show the change against what the jet holds.** On acknowledge, the map zooms to the threat.
   A move shows a dashed ghost where the jet still has it and a line labelled with distance and
   bearing. A type change shows the new ring with the old ring dashed, and the label gives the
   new type and ring sizes. A new threat is labelled NEW, and a status change is labelled with the
   previous status. Active threats are drawn solid, suspected ones with a dashed ring, inactive
   ones as a thin outline. A threat that is no longer a threat is greyed out.
4. **Send to jet.** Each threat remembers the position the jet holds. Acknowledged moves show as
   "NOT IN JET" on the map and in the top bar, and a banner appears at the bottom of the map with
   a one-tap *Send to jet* button, followed by transfer progress and the result. The *Jet* tab
   lists each difference (jet position, tablet position, how far apart) for picking which to
   send. Once the jet confirms, the references are removed: a changed threat is drawn normally in
   its updated state and a removed threat disappears from the map; if the transfer fails, nothing changes in the jet and the user can retry.

Simulated events in the admin console: *New threat*, *Threat position update*, *Threat type
change*, *Threat status change*, *No longer a threat*, *Automatic updates* (every 30 s), *Reset to takeoff list*, *Jet link available*
and *Next transfer fails*.

Other plugins can offer their own changes to the transfer: listen for `transfer:collect` and push
`{ id, group, title, detail, apply() }` items into the array, emit `transfer:changed` when the
set changes, and persist on `transfer:done`.

No build step and no runtime dependencies beyond the vendored Leaflet and topojson-client.

## Run locally

Any static file server works (service workers need `http://localhost` or HTTPS):

```sh
python3 -m http.server 8080
# open http://localhost:8080
```

## Deploy on GitHub Pages

All paths are relative, so the app runs under `/<repo>/`.

- **GitHub Actions (included, recommended):** in the repo go to *Settings → Pages → Source* and
  choose *GitHub Actions*. `.github/workflows/pages.yml` runs `scripts/build.sh` and deploys the
  result. The build copies the code into a folder named after the commit and points `index.html`
  at it, so every file gets a new URL on every deploy and a browser can never run a mix of old
  and new files. A new deploy shows up on the next load.
- **From a branch:** *Settings → Pages → Source → Deploy from a branch*, pick the branch and
  `/ (root)`. This works without the build, but browsers may keep serving some old files for
  about ten minutes after a deploy.

The version a device is running is shown at the bottom of the admin console.

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
| `ctx.focus(bounds, options)` | Fit the map to something on purpose; stops following ownship |
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
| `ctx.ui.setBanner(node)` | Show an action banner at the bottom of the map; `null` removes it |
| `ctx.ui.showPanel(id)` | Open the drawer on one of this plugin's panels |
| `ctx.ui.notify({ title, lines, level, action })` | Notification the user must acknowledge; returns a promise that resolves when they do |
| `ctx.data.addSlot({ id, title, description, accept, load, clear, status, sample })` | Add a file slot to the Data panel |
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
