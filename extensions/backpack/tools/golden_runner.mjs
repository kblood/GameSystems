// Runs golden vectors (data/backpack.golden.json: input sequences -> expected states/outcomes) against the JS core.
// The Godot twin (godot/addons/gs_backpack/tests/gs_backpack_parity_tests.gd) runs the same file with the same op set and
// the same observation format; tools/parity.mjs compares both. Non-finite numbers travel in JSON as "NaN"/"Infinity"/"-Infinity".
import { createApproach } from '../approach.js';
import { createPull } from '../pull.js';
import { createBackpackState } from '../state.js';
import { parseProfile } from '../profile.js';
import { createContainerLedger, createMemoryInventory } from '../ledger.js';
import { createStash } from '../stash.js';
import { captureCheckpoint, prepareCheckpoint } from '../checkpoint.js';

export const GOLDEN_SCHEMA = 'gamesystems.backpack-golden.v1';
export const EPS = 1e-7;

/** Decode JSON-safe non-finite markers (recursively). */
export function dec(v) {
  if (v === 'NaN') return NaN;
  if (v === 'Infinity') return Infinity;
  if (v === '-Infinity') return -Infinity;
  if (Array.isArray(v)) return v.map(dec);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dec(x)]));
  return v;
}
const r9 = x => (typeof x === 'number' ? Math.round(x * 1e9) / 1e9 : x);
const roundDeep = v => (Array.isArray(v) ? v.map(roundDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, roundDeep(x)])) : r9(v));
export const fmtEvent = e => {
  if (e.type === 'state') return `state:${e.from}>${e.to}:${e.reason}`;
  if (e.type === 'release_blocked') return `release_blocked:${e.reason}`;
  if (e.side) return `${e.type}:${e.side}`;
  return e.type;
};

export function runApproach(vec) {
  const a = createApproach(), out = [];
  for (const raw of vec.ops) {
    const op = dec(raw);
    if (op.op === 'observe') { a.observe(op.side, op.tracked, op.hand, op.shoulderY, op.dt); out.push(null); }
    else if (op.op === 'check') out.push(a.check(op.side, op.hand, op.shoulderY));
    else if (op.op === 'reset') { a.reset(op.side ?? ''); out.push(null); }
    else throw new Error(`Unknown approach op ${op.op}`);
  }
  return out;
}

export function runPull(vec) {
  const p = createPull(), out = [];
  for (const raw of vec.ops) {
    const op = dec(raw);
    if (op.op === 'begin') out.push(p.begin(op.hand, op.side, op.kind ?? 'grip'));
    else if (op.op === 'step') out.push(roundDeep({ offset: p.step(op.hand, op.tracked, op.dt), target: p.target, active: p.active }));
    else if (op.op === 'cancel') { p.cancel(); out.push(roundDeep({ offset: p.offset, target: p.target, active: p.active })); }
    else throw new Error(`Unknown pull op ${op.op}`);
  }
  return out;
}

export function buildProfile(vec, files) {
  const profile = JSON.parse(JSON.stringify(files.profiles[vec.profile ?? 'example']));
  if (vec.thresholds) profile.thresholds = { ...(profile.thresholds ?? {}), ...vec.thresholds };
  if (vec.tiers) profile.tiers = { ...(profile.tiers ?? {}), ...vec.tiers };
  return profile;
}

export function observeState(st, result, extra = {}) {
  const snap = st.snapshot();
  const access = st.profile.pockets.filter(k => st.canAccess(k.id)).map(k => k.id).join(',');
  return roundDeep({ ok: result.ok, reason: result.reason, events: result.events.map(fmtEvent), state: snap.state, owner: snap.owner, holder: snap.holder,
    secondary: snap.secondary, openFraction: snap.openFraction, accessOpen: snap.accessOpen, pullOffset: snap.pullOffset, returnProgress: snap.returnProgress,
    placed: snap.placed, posture: snap.posture, tier: st.tier, access, ...extra });
}

export function runState(vec, files) {
  const st = createBackpackState({ profile: buildProfile(vec, files), tier: vec.tier ?? 'high' });
  const out = [];
  for (const raw of vec.ops) {
    const op = dec(raw);
    let r, extra = {};
    switch (op.op) {
      case 'step': r = st.step(op.dt, op.input ?? {}); break;
      case 'grab': r = st.grab(op.side, { kind: op.kind ?? 'grip', handleDistanceM: op.handleDistanceM }); break;
      case 'open': r = st.open(); break;
      case 'close': r = st.close(); break;
      case 'callToHand': r = st.callToHand(op.side); break;
      case 'die': r = st.die(); break;
      case 'setTier': r = st.setTier(op.tier); break;
      case 'setPosture': st.setPosture(op.posture); r = { ok: true, reason: '', events: [] }; break;
      case 'capture': r = { ok: true, reason: '', events: [] }; extra = { capture: st.capture() }; break;
      case 'restore': {
        try { const plan = st.prepareRestore(op.data); plan.commit(); r = { ok: true, reason: '', events: [] }; } catch { r = { ok: false, reason: 'invalid', events: [] }; }
        break;
      }
      default: throw new Error(`Unknown state op ${op.op}`);
    }
    out.push(observeState(st, r, extra));
  }
  return out;
}

export function runProfile(vec) {
  try { parseProfile(vec.profile); return { valid: true }; } catch { return { valid: false }; }
}

// ---- container ledger (P2). One observation per op: { result, events, where, refresh, extra }; the Godot twin builds the same.
const fmtLedgerEvent = (type, d) => {
  const t = type.replace(/^backpack:/, '');
  if (t === 'moved') return `moved:${d.itemId}:${d.from}>${d.to}`;
  if (t === 'mount_return') return `mount_return:${d.itemId}:${d.pocketId}:${d.ok}`;
  if (d.itemId !== undefined) return `${t}:${d.itemId}:${d.pocketId}@${d.cell ?? ''}`;
  return t;
};
const normResult = r => ({ ok: !!r.ok, reason: r.reason ?? '', cell: r.cell ?? '', itemId: r.itemId ?? '', failedItem: r.failedItem ?? '', cells: (r.cells ?? []).join(',') });
const viewObs = v => ({ mode: v.mode, tab: v.tab, tabs: v.tabs.join(','), page: v.page, pages: v.pages, pageSize: v.pageSize, total: v.total, truncated: v.truncated,
  items: v.items.map(i => `${i.itemId}@${i.cell}`).join(',') });

export function runLedger(vec, files) {
  const profile = JSON.parse(JSON.stringify(files.profiles[vec.profile ?? 'example']));
  const mem = createMemoryInventory(), override = new Map(), ids = [];
  let events = [], access = 'all';
  const fault = { store: { skip: 0, fail: 0 }, retrieve: { skip: 0, fail: 0 } };
  const pass = f => { if (f.skip > 0) { f.skip--; return true; } if (f.fail > 0) { f.fail--; return false; } return true; };
  const inventory = {
    addSlot: (...a) => mem.addSlot(...a), itemInfo: id => override.get(id) ?? mem.itemInfo(id), itemInSlot: s => mem.itemInSlot(s), slotOf: id => mem.slotOf(id),
    store: (id, o, s) => (pass(fault.store) ? mem.store(id, o, s) : false), retrieve: (s, o) => (pass(fault.retrieve) ? mem.retrieve(s, o) : ''),
  };
  const emit = (type, data) => events.push(fmtLedgerEvent(type, data));
  const tier = vec.tier ?? 'high';
  const stash = profile.kind === 'stash' ? createStash({ profile, inventory, emit, tier }) : null;
  const ledger = stash ? stash.ledger : createContainerLedger({ profile, inventory, canAccess: id => access === 'all' || access.includes(id), emit, tier });
  const removers = [];
  const out = [];
  for (const raw of vec.ops) {
    const op = dec(raw);
    let r = { ok: true, reason: '' }, extra = {};
    switch (op.op) {
      case 'registerItem': {
        const ok = mem.registerItem(op.id, op.category, op.size, op.owner ?? 'world', op.tags);
        if (!ok && op.force) override.set(op.id, { category: op.category, size: [...op.size], owner: op.owner ?? 'world' });
        if (ok || op.force) ids.push(op.id);
        r = { ok, reason: '' }; break;
      }
      case 'setAccess': access = op.pockets; break;
      case 'open': r = stash.open(); break;
      case 'close': r = stash.close(); break;
      case 'check': r = ledger.check(op.item, op.pocket, { expectedOwner: op.owner ?? 'world' }); break;
      case 'store': r = ledger.store(op.item, op.pocket, { expectedOwner: op.owner ?? 'world' }); break;
      case 'retrieve': r = ledger.retrieve(op.pocket, { itemId: op.item, newOwner: op.newOwner ?? 'world' }); break;
      case 'move': r = ledger.move(op.item, op.pocket); break;
      case 'storeAll': r = ledger.storeAll(op.items, op.pocket, { expectedOwner: op.owner ?? 'world' }); break;
      case 'hand': r = { ok: mem.transfer(op.item, op.from, op.to), reason: '' }; break;
      case 'fault': fault[op.method] = { skip: op.skip, fail: op.fail }; break;
      case 'validator': {
        const on = op.on, items = op.items, pockets = op.pockets;
        removers.push(ledger.addValidator(e => !(on.includes(e.kind) && (!items || items.includes(e.itemId)) && (!pockets || pockets.includes(e.pocketId)))));
        break;
      }
      case 'clearValidators': while (removers.length) removers.pop()(); break;
      case 'offer': r = ledger.offer(op.item, op.pocket, { released: op.released === true }); break;
      case 'scheduleReturn': r = ledger.scheduleReturn(op.item, op.pocket); extra = { pending: ledger.pendingReturns().join(',') }; break;
      case 'tick': { const res = ledger.tick(op.dt); extra = { returns: res.map(x => `${x.itemId}:${x.ok}:${x.reason}`).join(','), pending: ledger.pendingReturns().join(',') }; break; }
      case 'hold': r = ledger.hold(op.item, op.side); break;
      case 'unhold': r = ledger.unhold(op.item); break;
      case 'selectView': extra = { view: viewObs(ledger.selectView({ tab: op.tab, page: op.page })) }; break;
      case 'view': extra = { view: viewObs(ledger.view({ tab: op.tab, page: op.page, exclude: op.exclude })) }; break;
      case 'setTier': ledger.setTier(op.tier); break;
      case 'listener': {
        let done = false;
        ledger.onRefresh(() => { if (op.mode === 'store_once' && done) return; done = true; ledger.store(op.item, op.pocket); });
        break;
      }
      case 'capture': extra = { capture: (stash ?? ledger).capture() }; break;
      case 'captureV2': extra = { capture: captureCheckpoint({ ledger }) }; break;
      case 'restore': {
        try { const plan = (stash ?? ledger).prepareRestore(op.data); plan.commit(); plan.notify(); } catch { r = { ok: false, reason: 'invalid' }; }
        break;
      }
      case 'restoreV2': {
        try { const plan = prepareCheckpoint({ ledger }, op.absent ? undefined : op.data); plan.commit(); plan.notify(); extra = { absent: plan.absent, version: plan.version }; } catch { r = { ok: false, reason: 'invalid' }; }
        break;
      }
      default: throw new Error(`Unknown ledger op ${op.op}`);
    }
    out.push({ result: normResult(r), events, where: [...ids].sort().map(id => { const i = mem.itemInfo(id); return `${id}:${i ? i.owner : '?'}@${i ? mem.slotOf(id) : ''}`; }).join('|'),
      refresh: ledger.refreshStats(), extra });
    events = [];
  }
  return out;
}

export function runAll(files) {
  return {
    profileCases: files.golden.profileCases.map(v => ({ name: v.name, results: runProfile(v) })),
    approach: files.golden.approach.map(v => ({ name: v.name, results: runApproach(v) })),
    pull: files.golden.pull.map(v => ({ name: v.name, results: runPull(v) })),
    state: files.golden.state.map(v => ({ name: v.name, results: runState(v, files) })),
    ledger: (files.golden.ledger ?? []).map(v => ({ name: v.name, results: runLedger(v, files) })),
  };
}

/** Deep compare with numeric tolerance; returns the path of the first difference or ''. */
export function firstDiff(a, b, path = '') {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= EPS ? '' : `${path}: ${a} vs ${b}`;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return `${path}: array length ${a?.length} vs ${b?.length}`;
    for (let i = 0; i < a.length; i++) { const d = firstDiff(a[i], b[i], `${path}[${i}]`); if (d) return d; }
    return '';
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) return `${path}: keys ${ka} vs ${kb}`;
    for (const k of ka) { const d = firstDiff(a[k], b[k], `${path}.${k}`); if (d) return d; }
    return '';
  }
  return a === b ? '' : `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}
