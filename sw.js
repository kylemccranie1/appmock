// Offline support.
//  - App shell and every plugin in plugins/registry.json are precached at install.
//  - Same-origin requests are served cache-first and refreshed in the background,
//    so a new deploy shows up on the second load without bumping VERSION.
//  - Online map tiles are cached as they are viewed, up to TILE_LIMIT.
const VERSION = 'v1';
const SHELL_CACHE = `shell-${VERSION}`;
const TILE_CACHE = 'tiles-v1';
const TILE_LIMIT = 3000;
const TILE_HOSTS = ['tile.openstreetmap.org'];

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/main.js',
  'js/engine/engine.js',
  'js/engine/admin.js',
  'js/engine/bus.js',
  'js/engine/geo.js',
  'js/engine/ui.js',
  'js/engine/basemap.js',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'vendor/topojson-client.min.js',
  'data/countries-50m.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'plugins/registry.json',
];

async function pluginFiles() {
  try {
    const { plugins = [] } = await (await fetch('plugins/registry.json', { cache: 'no-cache' })).json();
    return plugins.flatMap((p) =>
      [p.entry ?? 'plugin.js', ...(p.assets ?? [])].map((f) => `plugins/${p.id}/${f}`));
  } catch {
    return [];
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL);
    // A broken plugin must not block the shell from installing.
    await Promise.allSettled((await pluginFiles()).map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, TILE_CACHE]);
    await Promise.all((await caches.keys()).filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(key);
}

async function tile(request) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    await cache.put(request, res.clone());
    if (Math.random() < 0.02) trim(TILE_CACHE, TILE_LIMIT);
  }
  return res;
}

async function shell(event) {
  const { request } = event;
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
  const refresh = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  });
  if (hit) {
    event.waitUntil(refresh.catch(() => {}));
    return hit;
  }
  try {
    return await refresh;
  } catch (err) {
    if (request.mode === 'navigate') {
      const index = await cache.match('index.html');
      if (index) return index;
    }
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (TILE_HOSTS.includes(url.hostname)) event.respondWith(tile(request));
  else if (url.origin === self.location.origin) event.respondWith(shell(event));
});
