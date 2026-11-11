// Offline support.
//
// Deployed copies are built by scripts/build.sh, which puts the app's code and
// data in a folder named after the commit (b-<sha>/). Those URLs never change
// content, so they are served from the cache once stored. Everything else
// (the page itself, the manifest, an unbuilt local copy) goes to the network
// first and falls back to the cache when offline.
//
// The page tells this worker which files make up the running version (see
// js/main.js); they are cached for offline use and older versions are dropped.
// Online map tiles are cached as they are viewed, up to TILE_LIMIT.
const SHELL_CACHE = 'shell-v3';
const TILE_CACHE = 'tiles-v1';
const TILE_LIMIT = 3000;
const TILE_HOSTS = ['tile.openstreetmap.org'];
const NETWORK_TIMEOUT_MS = 4000;
const VERSIONED = /\/b-[0-9a-f]{7,40}\//;
const ROOT_FILES = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

// "no-cache" means: always check with the server rather than trusting the
// browser's own HTTP cache.
const fresh = (url) => new Request(url, { cache: 'no-cache' });

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.allSettled(ROOT_FILES.map((url) => cache.add(fresh(url))));
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

// { type: 'precache', urls: [...], versionPrefix?: 'https://host/app/b-<sha>/' }
self.addEventListener('message', (event) => {
  const { type, urls = [], versionPrefix } = event.data ?? {};
  if (type !== 'precache') return;
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.allSettled(urls.map(async (url) => {
      if (!(await cache.match(url))) await cache.add(url);
    }));
    if (versionPrefix) {
      for (const request of await cache.keys()) {
        if (VERSIONED.test(request.url) && !request.url.startsWith(versionPrefix)) await cache.delete(request);
      }
    }
  })());
});

async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(key);
}

async function cacheFirst(event, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(event.request);
  if (hit) return hit;
  const res = await fetch(event.request);
  if (res.ok) {
    event.waitUntil(cache.put(event.request, res.clone()));
    if (cacheName === TILE_CACHE && Math.random() < 0.02) event.waitUntil(trim(TILE_CACHE, TILE_LIMIT));
  }
  return res;
}

async function networkFirst(event) {
  const { request } = event;
  const cache = await caches.open(SHELL_CACHE);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    // A navigation request cannot be re-issued with new options, so fetch its URL.
    const res = await fetch(request.mode === 'navigate' ? request.url : request, { cache: 'no-cache', signal: controller.signal });
    if (res.ok) event.waitUntil(cache.put(request, res.clone()));
    return res;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: request.mode === 'navigate' })
      ?? (request.mode === 'navigate' ? await cache.match('index.html') : undefined);
    if (hit) return hit;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (TILE_HOSTS.includes(url.hostname)) event.respondWith(cacheFirst(event, TILE_CACHE));
  else if (url.origin !== self.location.origin) return;
  else if (VERSIONED.test(url.pathname)) event.respondWith(cacheFirst(event, SHELL_CACHE));
  else event.respondWith(networkFirst(event));
});
