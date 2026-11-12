// Key manager: cryptographic keys sent to this tablet.
//
// Flow:
//   1. A key arrives. A notification pops up naming the key and its type.
//   2. The crew opens it in the key manager, which shows its details and a set
//      of checks.
//   3. The crew stores it or rejects it. A key that fails a check cannot be stored.
//   4. Stored keys are listed by type with their state: ACTIVE, FUTURE,
//      SUPERSEDED or EXPIRED. Keys can be deleted singly or all at once (zeroize).
//
// Key types are not fixed: the first key of a type the tablet has not seen
// before adds that type to the manager and is called out as a new type.
//
// This is a mockup. No key material exists anywhere in it: a "key" here is only
// a label, a type, a validity period and a fingerprint, all notional. Keys are
// simulated from the admin console; a real feed would call `receive(pkg, from)`.
//
// Key states: received -> review -> stored, or rejected. A stored key's
// ACTIVE / FUTURE / SUPERSEDED / EXPIRED status is worked out from the clock.
const DEVICE_ID = 'TABLET-07'; // notional identity of this tablet
const KNOWN_TYPES = ['Notional datalink key', 'Notional voice key', 'Notional navigation key'];
const NEW_TYPES = ['Notional identification key', 'Notional mission data key', 'Notional telemetry key'];
const HOUR = 3600e3;

const checksum = (text) => {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h.toString(16).toUpperCase().padStart(8, '0');
};
// The fingerprint covers everything in the package, so any change to it shows.
const fingerprintOf = (pkg) => checksum(JSON.stringify([pkg.label, pkg.type, pkg.validFrom, pkg.validTo, pkg.addressedTo, pkg.nonce]));

export default {
  activate(ctx) {
    const { el } = ctx;
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const when = (ms) => { const d = new Date(ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.toISOString().slice(11, 16)}Z`; };

    // key: { id, pkg: { label, type, validFrom, validTo, addressedTo, nonce }, fingerprint, from, t, state, storedAt }
    let keys = ctx.settings.get('keys', []);
    let types = ctx.settings.get('types', [...KNOWN_TYPES]); // key types this tablet knows about
    let selectedId = null;
    const persist = () => { ctx.settings.set('keys', keys); ctx.settings.set('types', types); };
    const byId = (id) => keys.find((k) => k.id === id);
    const stored = (type) => keys.filter((k) => k.state === 'stored' && (!type || k.pkg.type === type));

    // ACTIVE: in its validity period and the newest such key of its type.
    function status(k) {
      const now = Date.now();
      if (k.state !== 'stored') return { received: 'NEW', review: 'TO REVIEW', rejected: 'REJECTED' }[k.state];
      if (now >= k.pkg.validTo) return 'EXPIRED';
      if (now < k.pkg.validFrom) return 'FUTURE';
      const newer = stored(k.pkg.type).some((o) => o.id !== k.id && o.pkg.validFrom > k.pkg.validFrom && now >= o.pkg.validFrom && now < o.pkg.validTo);
      return newer ? 'SUPERSEDED' : 'ACTIVE';
    }

    // level: ok | warn (worth knowing) | fail (blocks storing)
    function checks(k) {
      const p = k.pkg, now = Date.now(), out = [];
      const intact = fingerprintOf(p) === k.fingerprint;
      out.push({ level: intact ? 'ok' : 'fail', text: intact ? 'Fingerprint matches: the key arrived intact' : 'Fingerprint does not match: the key may be corrupt or altered' });
      out.push(p.addressedTo === DEVICE_ID
        ? { level: 'ok', text: `Addressed to this tablet (${DEVICE_ID})` }
        : { level: 'fail', text: `Addressed to ${p.addressedTo}, not this tablet (${DEVICE_ID})` });
      if (now >= p.validTo) out.push({ level: 'fail', text: `Already expired at ${when(p.validTo)}` });
      else if (now < p.validFrom) out.push({ level: 'warn', text: `Not valid yet: takes effect ${when(p.validFrom)}` });
      else out.push({ level: 'ok', text: `Valid now, until ${when(p.validTo)}` });
      const others = stored(p.type).filter((o) => o.id !== k.id);
      if (!types.includes(p.type) || (k.newType && k.state !== 'stored')) out.push({ level: 'warn', text: 'New key type: this tablet has not held a key of this type before' });
      else if (others.some((o) => status(o) === 'ACTIVE') && now >= p.validFrom) out.push({ level: 'warn', text: 'Supersedes the key of this type that is active now' });
      return out;
    }
    const blocked = (k) => checks(k).some((c) => c.level === 'fail');

    // --- flow ----------------------------------------------------------------
    const notices = new Map();

    function announce(k) {
      const notice = ctx.ui.notify({
        title: k.newType ? 'New key received: new key type' : 'New key received', level: 'warn',
        lines: [k.pkg.label, k.pkg.type, `Valid ${when(k.pkg.validFrom)} to ${when(k.pkg.validTo)}`, `From ${k.from} at ${when(k.t)}`],
        action: 'Open in key manager',
      });
      notices.set(k.id, notice);
      notice.then(() => {
        notices.delete(k.id);
        if (byId(k.id)?.state !== 'received') return;
        k.state = 'review';
        open(k.id);
      });
    }

    function receive(pkg, from) {
      const k = {
        id: `key-${Date.now().toString(36)}-${keys.length}`, pkg, fingerprint: pkg.fingerprint ?? fingerprintOf(pkg),
        from, t: Date.now(), state: 'received', storedAt: null, newType: !types.includes(pkg.type),
      };
      delete k.pkg.fingerprint;
      keys.push(k);
      ctx.admin.log(`Key received: ${pkg.label}`);
      announce(k);
      sync();
    }

    function open(id) {
      selectedId = id;
      sync();
      if (id) ctx.ui.showPanel('panel');
    }

    function store(k) {
      k.state = 'stored';
      k.storedAt = Date.now();
      if (!types.includes(k.pkg.type)) types.push(k.pkg.type);
      ctx.ui.toast(`${k.pkg.label} stored`);
      ctx.admin.log(`Key stored: ${k.pkg.label}`);
      sync();
    }

    function reject(k) {
      k.state = 'rejected';
      ctx.ui.toast(`${k.pkg.label} rejected. The sender is told (simulated).`);
      ctx.admin.log(`Key rejected: ${k.pkg.label}`);
      sync();
    }

    function remove(k) {
      if (!confirm(`Delete ${k.pkg.label} from this tablet?`)) return;
      keys = keys.filter((o) => o.id !== k.id);
      selectedId = null;
      ctx.admin.log(`Key deleted: ${k.pkg.label}`);
      sync();
    }

    function zeroize() {
      if (!confirm('Zeroize: delete every key on this tablet? This cannot be undone.')) return;
      for (const n of notices.values()) n.cancel();
      notices.clear();
      keys = [];
      selectedId = null;
      ctx.ui.toast('All keys deleted from this tablet', { level: 'warn' });
      ctx.admin.log('Keys zeroized', 'warn');
      sync();
    }

    // --- panel ---------------------------------------------------------------
    let root = null;
    const tagClass = (s) => (['TO REVIEW', 'NEW', 'EXPIRED', 'REJECTED'].includes(s) ? 'tag' : '');

    function detailView(k) {
      const p = k.pkg, list = checks(k), s = status(k);
      const icon = { ok: '✓', warn: '!', fail: '✕' };
      return [
        el('div', { class: 'btnrow' }, [el('button', { class: 'btn', text: '‹ All keys', onclick: () => open(null) })]),
        el('h3', { text: p.label }),
        el('p', { class: `slot-status ${s === 'ACTIVE' ? 'ok' : ['EXPIRED', 'REJECTED'].includes(s) ? 'bad' : ''}`, text: s }),
        el('dl', { class: 'kv' }, [
          el('dt', { text: 'Type' }), el('dd', { text: p.type }),
          el('dt', { text: 'Valid from' }), el('dd', { text: when(p.validFrom) }),
          el('dt', { text: 'Valid to' }), el('dd', { text: when(p.validTo) }),
          el('dt', { text: 'Addressed to' }), el('dd', { text: p.addressedTo }),
          el('dt', { text: 'Fingerprint' }), el('dd', { text: k.fingerprint }),
          el('dt', { text: 'Sent by' }), el('dd', { text: `${k.from} at ${when(k.t)}` }),
          ...(k.storedAt ? [el('dt', { text: 'Stored' }), el('dd', { text: when(k.storedAt) })] : []),
        ]),
        el('p', { class: 'muted', style: 'margin-top:8px', text: 'The key itself is never displayed. Only its details are shown.' }),
        el('h3', { text: 'Checks' }),
        el('ul', { class: 'checks' }, list.map((c) => el('li', { class: c.level }, [el('b', { text: icon[c.level] }), el('span', { text: c.text })]))),
        k.state === 'review' ? el('div', { class: 'btnrow', style: 'margin-top:12px' }, [
          el('button', { class: 'btn primary', text: 'Store key', disabled: blocked(k), onclick: () => store(k) }),
          el('button', { class: 'btn danger', text: 'Reject', onclick: () => reject(k) }),
        ]) : null,
        k.state === 'review' && blocked(k) ? el('p', { class: 'error', text: 'This key fails a check and cannot be stored.' }) : null,
        k.state !== 'review' ? el('div', { class: 'btnrow', style: 'margin-top:12px' }, [
          el('button', { class: 'btn danger', text: k.state === 'stored' ? 'Delete key' : 'Remove from list', onclick: () => remove(k) }),
        ]) : null,
      ];
    }

    function listView() {
      const waiting = keys.filter((k) => k.state === 'received').length;
      const order = { ACTIVE: 0, 'TO REVIEW': 1, NEW: 1, FUTURE: 2, SUPERSEDED: 3, EXPIRED: 4 };
      const row = (k) => {
        const s = status(k);
        return el('li', { class: ['SUPERSEDED', 'EXPIRED', 'REJECTED'].includes(s) ? 'stale' : '', onclick: () => {
          // Opening a new key from the list counts as opening its notification.
          if (k.state === 'received') { notices.get(k.id)?.cancel(); notices.delete(k.id); k.state = 'review'; }
          open(k.id);
        } }, [
          el('b', { text: k.pkg.label }),
          el('span', { class: tagClass(s), text: s }),
          el('span', { text: `${when(k.pkg.validFrom)} to` }),
          el('span', { text: when(k.pkg.validTo) }),
        ]);
      };
      const live = keys.filter((k) => k.state !== 'rejected');
      const allTypes = [...new Set([...types, ...live.map((k) => k.pkg.type)])];
      const rejected = keys.filter((k) => k.state === 'rejected').slice(-5).reverse();
      return [
        el('h3', { text: 'Key manager' }),
        el('p', { class: 'muted', text: `This tablet: ${DEVICE_ID}. ` + (waiting ? `${waiting} new key${waiting > 1 ? 's' : ''} waiting to be opened.` : 'Keys sent to this tablet appear here.') }),
        ...allTypes.flatMap((type) => {
          const mine = live.filter((k) => k.pkg.type === type).sort((a, b) => (order[status(a)] ?? 9) - (order[status(b)] ?? 9) || b.pkg.validFrom - a.pkg.validFrom);
          const active = mine.some((k) => status(k) === 'ACTIVE');
          return [
            el('h3', { text: `${type}${types.includes(type) ? '' : ' · NEW TYPE'}` }),
            mine.length ? el('ul', { class: 'list' }, mine.map(row)) : null,
            active ? null : el('p', { class: mine.length ? 'error' : 'muted', text: 'No active key of this type' }),
          ];
        }),
        ...(rejected.length ? [el('h3', { text: 'Rejected' }), el('ul', { class: 'list' }, rejected.map(row))] : []),
        el('div', { class: 'btnrow', style: 'margin-top:14px' }, [
          el('button', { class: 'btn danger', text: 'Zeroize all keys', disabled: !keys.length, onclick: zeroize }),
        ]),
        el('p', { class: 'muted', text: 'Mockup only: these are notional key details. No key material exists in this app.' }),
      ];
    }

    function drawPanel() {
      if (!root) return;
      const k = byId(selectedId);
      root.replaceChildren(...(k ? detailView(k) : listView()).filter(Boolean));
    }
    const panel = ctx.ui.addPanel({ id: 'panel', title: 'Keys', render: (r) => { root = r; } });

    function sync() {
      persist();
      drawPanel();
      const review = keys.filter((k) => k.state === 'review').length;
      panel.setTitle(review ? `Keys (${review})` : 'Keys');
      ctx.ui.setStatus('review', review ? `${review} KEY${review > 1 ? 'S' : ''} TO REVIEW` : null, 'warn');
      const missing = types.filter((type) => stored(type).length && !stored(type).some((k) => status(k) === 'ACTIVE'));
      ctx.ui.setStatus('expired', missing.length ? `NO ACTIVE KEY: ${missing.length} TYPE${missing.length > 1 ? 'S' : ''}` : null, 'danger');
    }
    // Validity is time based, so refresh as the clock moves.
    ctx.every(15000, sync);

    // --- simulated events (admin console) -------------------------------------
    let made = ctx.settings.get('made', 0);
    const short = (type) => type.replace('Notional ', '').replace(' key', '').toUpperCase().replace(/\s+/g, '-');

    function build(type, { startsIn = 0, hours = 24, addressedTo = DEVICE_ID } = {}) {
      const n = ++made;
      ctx.settings.set('made', made);
      const validFrom = Date.now() + startsIn;
      return {
        label: `NOTIONAL-${short(type)}-${String(n).padStart(4, '0')}`, type,
        validFrom, validTo: validFrom + hours * HOUR, addressedTo, nonce: Math.random().toString(36).slice(2, 10),
      };
    }
    const anyType = () => types[Math.floor(Math.random() * types.length)];
    const group = 'Keys';

    ctx.admin.addAction({ id: 'key', group, label: 'New key', description: 'A key of a type the tablet already knows, valid now for 24 hours.', run: () => receive(build(anyType()), 'NOTIONAL KEY AUTHORITY') });
    ctx.admin.addAction({
      id: 'type', group, label: 'Key of a new type', description: 'The first key of a type this tablet has not held before.',
      run: () => {
        const unused = NEW_TYPES.filter((t) => !types.includes(t) && !keys.some((k) => k.pkg.type === t));
        const type = unused[0] ?? `Notional type ${made + 1} key`;
        receive(build(type), 'NOTIONAL KEY AUTHORITY');
      },
    });
    ctx.admin.addAction({ id: 'future', group, label: 'Key that takes effect later', description: 'Valid from two hours from now.', run: () => receive(build(anyType(), { startsIn: 2 * HOUR }), 'NOTIONAL KEY AUTHORITY') });
    ctx.admin.addAction({
      id: 'corrupt', group, label: 'Key that fails its fingerprint', description: 'The key arrives altered or corrupt.',
      run: () => { const pkg = build(anyType()); receive({ ...pkg, fingerprint: fingerprintOf({ ...pkg, nonce: 'tampered' }) }, 'NOTIONAL KEY AUTHORITY'); },
    });
    ctx.admin.addAction({ id: 'misaddressed', group, label: 'Key for another device', description: 'The key is addressed to a different tablet.', run: () => receive(build(anyType(), { addressedTo: 'TABLET-12' }), 'NOTIONAL KEY AUTHORITY') });
    ctx.admin.addAction({
      id: 'expire', group, label: 'Expire an active key', description: 'An active key reaches the end of its validity period now.',
      run: () => {
        const k = keys.find((x) => status(x) === 'ACTIVE');
        if (!k) { ctx.ui.toast('There is no active key to expire', { level: 'warn' }); throw new Error('no active key'); }
        // Changing the validity period would break the fingerprint, so re-issue it as the sender would.
        k.pkg.validTo = Date.now() - 1000;
        k.fingerprint = fingerprintOf(k.pkg);
        ctx.ui.toast(`${k.pkg.label} has expired`, { level: 'warn' });
        sync();
      },
    });

    // Keys that were still unopened when the app was last closed.
    for (const k of keys.filter((x) => x.state === 'received')) announce(k);
    sync();
  },
};
