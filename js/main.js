import { Engine } from './engine/engine.js';

const engine = new Engine();
window.omen = engine; // handy for poking at state from the console

engine.start().catch((err) => {
  console.error('[engine] failed to start', err);
  document.getElementById('cursor').textContent = `Engine failed to start: ${err.message}`;
});

if ('serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('[sw] registration failed', err));
  });
}
