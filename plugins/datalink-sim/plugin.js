// Simulated over-the-air link. It stands in for a real transport (WebSocket,
// server-sent events, a radio gateway): a real adapter only needs to emit the
// same `link:message` events and listen for `link:ack`.
//
// Message shape:
//   { id, seq, t (ISO time), from, type, payload }
//   type 'target.upsert'  payload { id, rev, ...changed fields }
//   type 'target.delete'  payload { id }
const CATEGORIES = ['Storage site', 'Comms node', 'Mobile', 'Vehicle park'];
const STATUSES = ['ACTIVE', 'HOLD', 'COMPLETE'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export default {
  activate(ctx) {
    const { geo, el } = ctx;
    let up = ctx.settings.get('up', true);
    let auto = false;
    let seq = 0;
    let made = 0;
    const queue = [];
    const log = []; // newest first: { msg, summary, state }

    function send(type, payload, summary) {
      const msg = { id: `msg-${Date.now().toString(36)}-${++seq}`, seq, t: new Date().toISOString(), from: 'NOTIONAL C2', type, payload };
      log.unshift({ msg, summary, state: up ? 'delivered' : 'queued' });
      log.length = Math.min(log.length, 25);
      if (up) ctx.bus.emit('link:message', msg); else queue.push(msg);
      draw();
    }

    function setLink(next) {
      up = next;
      ctx.settings.set('up', up);
      if (up) {
        // Deliver everything that was held while the link was down, in order.
        for (const msg of queue.splice(0)) {
          const entry = log.find((e) => e.msg.id === msg.id);
          if (entry) entry.state = 'delivered';
          ctx.bus.emit('link:message', msg);
        }
      }
      draw();
    }

    ctx.bus.on('link:ack', ({ id, result }) => {
      const entry = log.find((e) => e.msg.id === id);
      if (entry) { entry.state = result; draw(); }
    });

    // --- simulated events ----------------------------------------------------
    const anyTarget = () => {
      const targets = ctx.entities.all('target');
      if (!targets.length) ctx.ui.toast('There are no targets to update', { level: 'warn' });
      return targets.length ? pick(targets) : null;
    };

    const events = {
      'Move a target': () => {
        const t = anyTarget();
        if (!t) return;
        const to = geo.destination(t, Math.random() * 360, 3 + Math.random() * 9);
        send('target.upsert', { id: t.id, rev: t.rev + 1, lat: +to.lat.toFixed(5), lon: +to.lon.toFixed(5) }, `Move ${t.label}`);
      },
      'Change status': () => {
        const t = anyTarget();
        if (!t) return;
        const status = pick(STATUSES.filter((s) => s !== t.status));
        const priority = 1 + ((t.priority ?? 3) % 3);
        send('target.upsert', { id: t.id, rev: t.rev + 1, status, priority }, `${t.label}: ${status}, P${priority}`);
      },
      'New target': () => {
        const center = ctx.map.getCenter();
        const at = geo.destination({ lat: center.lat, lon: center.lng }, Math.random() * 360, 10 + Math.random() * 40);
        const name = `NT-1${String(++made).padStart(2, '0')} LINK`;
        send('target.upsert', {
          id: `tgt-ota-${Date.now().toString(36)}`, rev: 1, name, category: pick(CATEGORIES), priority: 1 + Math.floor(Math.random() * 3),
          status: 'ACTIVE', lat: +at.lat.toFixed(5), lon: +at.lon.toFixed(5), elevFt: 600 + Math.round(Math.random() * 90) * 10,
          notes: 'Passed over the air (simulated).',
        }, `New target ${name}`);
      },
      'Delete a target': () => {
        const t = anyTarget();
        if (t) send('target.delete', { id: t.id }, `Delete ${t.label}`);
      },
    };
    const random = () => pick(Object.values(events).slice(0, 3))(); // never auto-delete

    ctx.every(15000, () => { if (auto) random(); });

    // --- panel ---------------------------------------------------------------
    let root = null;
    function draw() {
      ctx.ui.setStatus('link', up ? 'LINK UP' : `LINK DOWN${queue.length ? ` · ${queue.length} QUEUED` : ''}`, up ? 'ok' : 'warn');
      if (!root) return;
      root.replaceChildren(
        el('h3', { text: 'Link' }),
        el('div', { class: 'btnrow' }, [
          el('button', { class: `btn ${up ? 'active' : ''}`, text: 'Up', onclick: () => setLink(true) }),
          el('button', { class: `btn ${up ? '' : 'active'}`, text: 'Down', onclick: () => setLink(false) }),
        ]),
        el('p', { class: 'muted', text: 'While the link is down, messages queue and are delivered in order when it comes back.' }),
        el('h3', { text: 'Send a simulated update' }),
        ...Object.entries(events).map(([label, run]) =>
          el('div', { class: 'btnrow' }, [el('button', { class: 'btn', text: label, onclick: run })])),
        el('label', { class: 'row' }, [
          el('input', { type: 'checkbox', checked: auto, onchange: (e) => { auto = e.target.checked; } }),
          el('span', { text: 'Send a random update every 15 s' }),
        ]),
        el('h3', { text: `Message log (${log.length})` }),
        log.length ? el('ul', { class: 'list' }, log.map(({ msg, summary, state }) => el('li', {}, [
          el('b', { text: summary }),
          el('span', { class: ['queued', 'rejected', 'stale', 'invalid'].includes(state) ? 'tag' : '', text: state.toUpperCase() }),
          el('span', { text: `#${msg.seq} · ${msg.type}` }),
          el('span', { text: `${msg.t.slice(11, 19)}Z` }),
        ]))) : el('p', { class: 'muted', text: 'Nothing sent yet.' }),
      );
    }

    ctx.ui.addPanel({ id: 'panel', title: 'Datalink', render: (r) => { root = r; } });
    draw();
  },
};
