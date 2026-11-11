// Jet data transfer: pushes changes the crew has reviewed on the tablet to the
// jet. The transfer itself is simulated.
//
// This plugin does not know what is being sent. Other plugins offer changes:
//   bus 'transfer:collect'  payload is an array; push { id, group, title, detail, apply() }
//                           for each difference between the tablet and the jet.
//   bus 'transfer:changed'  emit whenever that set of differences changes.
//   bus 'transfer:done'     emitted here after the jet confirms and every apply() has run.
// A transfer is all or nothing: apply() runs only after the jet confirms.
const STEP_MS = 900;

export default {
  activate(ctx) {
    const { el } = ctx;
    const zulu = (ms) => `${new Date(ms).toISOString().slice(11, 19)}Z`;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    let linkUp = true;
    let failNext = false;
    let phase = 'idle';        // idle | confirm | sending | done | failed
    let progress = { step: 0, steps: 1, text: '' };
    let result = null;         // { count, t } of the last finished attempt
    let disposed = false;
    let settling = false;      // true while providers react to a confirmed transfer
    const deselected = new Set();
    const history = ctx.settings.get('history', []); // newest first: { t, count, ok }
    ctx.onDispose(() => { disposed = true; });

    const collect = () => {
      const items = [];
      ctx.bus.emit('transfer:collect', items);
      return items;
    };
    const chosen = (items) => items.filter((i) => !deselected.has(i.id));

    async function send() {
      const items = chosen(collect());
      if (!items.length || !linkUp) return;
      phase = 'sending';
      const steps = items.length + 2;
      const step = async (n, text) => { progress = { step: n, steps, text }; draw(); await sleep(STEP_MS); };
      await step(0, 'Connecting to the jet');
      for (const [i, item] of items.entries()) await step(i + 1, `Sending ${i + 1} of ${items.length}: ${item.title}`);
      await step(items.length + 1, 'Waiting for the jet to confirm');
      if (disposed) return;

      const ok = linkUp && !failNext;
      if (failNext) ctx.admin.setToggle('fail', false); // one-shot
      result = { count: items.length, t: Date.now() };
      history.unshift({ t: result.t, count: items.length, ok });
      history.length = Math.min(history.length, 10);
      ctx.settings.set('history', history);
      if (ok) {
        for (const item of items) item.apply();
        phase = 'done';
        settling = true;
        ctx.bus.emit('transfer:done', { count: items.length });
        settling = false;
        ctx.ui.toast(`Jet confirmed ${items.length} change${items.length > 1 ? 's' : ''}`);
        ctx.admin.log(`Jet transfer confirmed (${items.length})`);
      } else {
        phase = 'failed';
        ctx.ui.toast('Transfer to the jet failed. Nothing was changed in the jet.', { level: 'danger', ms: 7000 });
        ctx.admin.log('Jet transfer failed', 'warn');
      }
      draw();
    }

    // --- simulated conditions (admin console) ---------------------------------
    ctx.admin.addToggle({
      id: 'link', group: 'Jet data transfer', label: 'Jet link available',
      description: 'Off: the tablet cannot reach the jet, so nothing can be sent.',
      value: linkUp, onChange: (on) => { linkUp = on; draw(); },
    });
    ctx.admin.addToggle({
      id: 'fail', group: 'Jet data transfer', label: 'Next transfer fails',
      description: 'The jet does not confirm the next transfer.',
      value: failNext, onChange: (on) => { failNext = on; },
    });

    // --- panel ---------------------------------------------------------------
    let root = null;
    let panel = null;

    function draw() {
      const items = collect();
      const n = items.length;
      ctx.ui.setStatus('unsent', n ? `${n} NOT IN JET` : null, 'warn');
      panel?.setTitle(n ? `Jet (${n})` : 'Jet');
      if (!root) return;

      const picked = chosen(items);
      const plural = (count) => `${count} change${count === 1 ? '' : 's'}`;
      const body = [
        el('h3', { text: 'Send to jet' }),
        el('p', { class: linkUp ? 'slot-status ok' : 'slot-status bad', text: linkUp ? 'Jet link: connected' : 'Jet link: not available' }),
      ];

      if (phase === 'sending') {
        body.push(el('div', { class: 'card' }, [
          el('h4', { text: progress.text }),
          el('div', { class: 'bar' }, [el('div', { style: `width:${Math.round((100 * (progress.step + 1)) / progress.steps)}%` })]),
          el('p', { class: 'muted', style: 'margin:8px 0 0', text: 'Do not close the app until the jet confirms.' }),
        ]));
      } else {
        if (phase === 'done') {
          body.push(el('div', { class: 'card good' }, [
            el('h4', { text: `Jet confirmed ${plural(result.count)}` }),
            el('p', { class: 'muted', style: 'margin:0', text: `At ${zulu(result.t)}. The jet now matches the tablet for those items.` }),
          ]));
        }
        if (phase === 'failed') {
          body.push(el('div', { class: 'card bad' }, [
            el('h4', { text: 'Transfer failed' }),
            el('p', { class: 'muted', style: 'margin:0 0 8px', text: `At ${zulu(result.t)}. Nothing was changed in the jet. The changes are still on the tablet.` }),
          ]));
        }
        if (!n) {
          body.push(el('p', { class: 'muted', text: 'The jet matches the tablet. Nothing to send.' }));
        } else {
          let group = null;
          for (const item of items) {
            if (item.group !== group) { group = item.group; body.push(el('h3', { text: group })); }
            body.push(el('label', { class: 'row change' }, [
              el('input', { type: 'checkbox', checked: !deselected.has(item.id), disabled: phase === 'confirm', onchange: (e) => {
                if (e.target.checked) deselected.delete(item.id); else deselected.add(item.id);
                draw();
              } }),
              el('span', {}, [el('b', { text: item.title }), ...item.detail.map((text) => el('small', { text }))]),
            ]));
          }
          if (phase === 'confirm') {
            body.push(el('div', { class: 'card' }, [
              el('h4', { text: `Send ${plural(picked.length)} to the jet?` }),
              el('p', { class: 'muted', style: 'margin:0 0 8px', text: 'This replaces what the jet currently holds for these items.' }),
              el('div', { class: 'btnrow' }, [
                el('button', { class: 'btn primary', text: 'Send now', onclick: send }),
                el('button', { class: 'btn', text: 'Cancel', onclick: () => { phase = 'idle'; draw(); } }),
              ]),
            ]));
          } else {
            body.push(el('div', { class: 'btnrow', style: 'margin-top:10px' }, [
              el('button', {
                class: 'btn primary', disabled: !linkUp || !picked.length,
                text: phase === 'failed' ? `Retry: send ${plural(picked.length)}` : `Send ${plural(picked.length)} to jet`,
                onclick: () => { phase = 'confirm'; draw(); },
              }),
            ]));
            if (!linkUp) body.push(el('p', { class: 'muted', text: 'Changes stay on the tablet until the jet link returns.' }));
          }
        }
      }

      if (history.length) {
        body.push(
          el('h3', { text: 'Transfer history' }),
          el('ul', { class: 'admin-log' }, history.map((h) => el('li', { class: h.ok ? '' : 'warn' }, [
            el('span', { text: zulu(h.t) }),
            el('span', { text: `${plural(h.count)} · ${h.ok ? 'confirmed by jet' : 'failed'}` }),
          ]))),
        );
      }
      root.replaceChildren(...body);
    }

    panel = ctx.ui.addPanel({ id: 'panel', title: 'Jet', render: (r) => { root = r; } });
    ctx.bus.on('transfer:changed', () => {
      // New differences after a finished attempt start a fresh send.
      if (settling) return;
      if (phase === 'done') phase = 'idle';
      if (phase !== 'sending') draw();
    });
    ctx.bus.on('engine:ready', draw);
    draw();
  },
};
