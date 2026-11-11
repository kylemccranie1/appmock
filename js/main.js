import { Engine, ROOT } from './engine/engine.js';

const engine = new Engine();
window.omen = engine; // handy for poking at state from the console

engine.start().catch((err) => {
  console.error('[engine] failed to start', err);
  document.getElementById('cursor').textContent = `Engine failed to start: ${err.message}`;
});

if ('serviceWorker' in navigator) {
  // When an updated service worker takes over a page that an older one was
  // serving, reload once so the whole app comes from the same version.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });

  // Tell the service worker which files make up this version so it can keep
  // them for offline use. A built deploy ships the full list (files.json); an
  // unbuilt local copy falls back to whatever this page has loaded so far.
  async function precache() {
    const registration = await navigator.serviceWorker.ready;
    const versioned = /\/b-[0-9a-f]{7,40}\/$/.test(ROOT.pathname);
    let urls;
    try {
      const res = await fetch(new URL('files.json', ROOT));
      if (!res.ok) throw new Error('no file list');
      urls = (await res.json()).map((path) => new URL(path, ROOT).href);
    } catch {
      urls = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.startsWith(location.origin));
    }
    registration.active?.postMessage({ type: 'precache', urls: [location.href, ...urls], versionPrefix: versioned ? ROOT.href : undefined });
  }

  addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('sw.js');
      setTimeout(precache, 2000); // after plugins have loaded
    } catch (err) {
      console.warn('[sw] registration failed', err);
    }
  });
}
