// Backpack core (P0, extensions/backpack): profile contract, state machine, container ledger, approach/pull ports,
// checkpoint, golden vectors and the JS <-> Godot parity run. No engine, no three.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHost } from '../../extensions/host/index.js';
import backpackExtension, {
  BACKPACK_DATA, BACKPACK_TIERS, BACKPACK_STATES, TRANSITIONS, OWNER_OF, canTransition, isHeld, parseProfile, tierFlags, thresholdsOf,
  createBackpackState, createBackpackSystem, createContainerLedger, createMemoryInventory, createApproach, createPull, createRecordingAudio,
  createStash, captureCheckpoint, prepareCheckpoint, restoreCheckpoint, CHECKPOINT_SCHEMA, PROFILE_KINDS, SNAP_MODES, materialLimit,
  ADAPTER_METHODS, assertAdapter, sizeFits, canonicalSize, APPROACH, PULL,
} from '../../extensions/backpack/index.js';
import { buildGolden, goldenText, DATA_DIR, GODOT_DATA_DIR, COPIED } from '../../extensions/backpack/tools/gen_golden.mjs';
import { runApproach, runPull, runState, runProfile, runLedger, firstDiff } from '../../extensions/backpack/tools/golden_runner.mjs';
import { profileCases } from '../../extensions/backpack/tools/vectors.mjs';
import { profileCasesAll, ledgerVectors } from '../../extensions/backpack/tools/ledger_vectors.mjs';
import { compareParity } from '../../extensions/backpack/tools/parity.mjs';

const read = name => readFileSync(`${DATA_DIR}/${name}`, 'utf8');
const EXAMPLE = JSON.parse(read('profile.example.json'));
const DT = 0.02;
const H = (local, grip = true, tracked = true) => ({ tracked, grip, local });
const NONE = H(null, false, false);
const IN = (L, R, extra = {}) => ({ hands: { left: L ?? NONE, right: R ?? NONE }, ...extra });
const R = (z, grip = true) => H([0, 0.1, z], grip);
const SURFACE = { stable: true, position: [1, 0.8, -2], rotation: [0, 0, 0, 1] };
const run = (st, n, dt, input) => { let r; for (let i = 0; i < n; i++) r = st.step(dt, input); return r; };
const mk = (tier = 'high', profile = EXAMPLE) => createBackpackState({ profile, tier });
/** WORN -> DRAWING -> HELD_CLOSED with the right hand. */
function toHeld(st, extra = {}) {
  st.step(DT, IN(null, R(0.2)));
  assert.equal(st.grab('right', { handleDistanceM: 0.05 }).ok, true);
  for (let i = 1; i <= 13; i++) st.step(0.04, IN(null, R(0.2 - 0.25 * i / 13), extra));
  run(st, 8, 0.04, IN(null, R(-0.05), extra));
  assert.equal(st.state, 'HELD_CLOSED');
  return st;
}
const lcg = seed => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;

// ---------------------------------------------------------------- data and contract
test('data: constants are the Godot constants (0.16 m reach, 3.5 cm deadzone, 20 cm cap, ...) and name their sources', () => {
  assert.equal(PULL.HANDLE_REACH_M, 0.16); assert.equal(PULL.PULL_DEADZONE_M, 0.035); assert.equal(PULL.MAX_PULL_M, 0.2); assert.equal(PULL.FOLLOW_RATE, 14);
  assert.equal(APPROACH.APPROACH_LIFETIME_S, 1.25); assert.equal(APPROACH.MAX_SAMPLE_JUMP_M, 0.3); assert.equal(APPROACH.MAX_SAMPLE_DT, 0.15);
  assert.equal(APPROACH.ENTRY_FRONT_M, -0.22); assert.equal(APPROACH.RETRIEVE_BELOW_SHOULDER_M, 0.35);
  // every constant in the Godot sources has the same value in the data file (read straight from the .gd text)
  const gd = file => Object.fromEntries([...readFileSync(new URL(`../../godot/addons/gs_backpack/${file}`, import.meta.url), 'utf8').matchAll(/^const (\w+) := (-?[\d.]+)/gm)].map(m => [m[1], Number(m[2])]));
  for (const [k, v] of Object.entries(gd('gs_backpack_approach.gd'))) assert.equal(APPROACH[k], v, `APPROACH.${k}`);
  for (const [k, v] of Object.entries(gd('gs_backpack_handle_pull.gd'))) assert.equal(PULL[k], v, `PULL.${k}`);
  for (const key of ['APPROACH', 'PULL', 'STATE', 'TIERS']) assert.ok(BACKPACK_DATA.sources[key].length > 20, `source of ${key}`);
});

test('tiers: off/minimal/low/medium/high flags, physical items only on high, minimal never detaches', () => {
  assert.deepEqual([...BACKPACK_TIERS], ['off', 'minimal', 'low', 'medium', 'high']);
  const flags = Object.fromEntries(BACKPACK_TIERS.map(t => [t, tierFlags(EXAMPLE, t)]));
  assert.deepEqual(BACKPACK_TIERS.filter(t => flags[t].physicalItems), ['high']);
  assert.equal(flags.off.enabled, false); assert.equal(flags.minimal.pull, true); assert.equal(flags.minimal.detach, false);
  assert.equal(flags.low.detach && flags.low.open, true); assert.equal(flags.low.twoHand, false); assert.equal(flags.medium.twoHand && flags.medium.weightLag, true);
  assert.equal(flags.high.physicalItemsMax, 8);
  assert.throws(() => tierFlags(EXAMPLE, 'ultra'), RangeError);
});

test('profile: example validates; schema file and validator agree; invalid profiles are rejected; lossPolicy must be never', () => {
  const p = parseProfile(EXAMPLE);
  assert.equal(p.lossPolicy, 'never'); assert.equal(p.handle.reachM, 0.16);
  const schema = JSON.parse(read('profile.schema.json'));
  assert.deepEqual(schema.required.sort(), ['schema', 'id', 'detachable', 'lossPolicy', 'pockets'].sort(), 'handle/dominantHand are required by the pack branch only (allOf)');
  assert.deepEqual(schema.properties.lossPolicy.enum, ['never']);
  assert.deepEqual(Object.keys(schema.properties).sort(), ['schema', 'kind', 'id', 'displayName', 'detachable', 'lossPolicy', 'dominantHand', 'handle', 'donZone', 'recall', 'bagMount', 'mass', 'thresholds', 'tiers', 'pockets'].sort());
  for (const c of profileCases(EXAMPLE)) assert.equal(runProfile(c).valid, ['example_is_valid', 'overrides_are_valid', 'left_handed_minimal_profile'].includes(c.name), c.name);
  assert.deepEqual(PROFILE_KINDS, ['pack', 'stash']); assert.deepEqual(SNAP_MODES, ['none', 'range', 'dropped']);
  for (const bad of ['on_death_drop', 'on_death_lose', 'sometimes', '', null]) assert.throws(() => parseProfile({ ...EXAMPLE, lossPolicy: bad }), /lossPolicy/);
  assert.throws(() => parseProfile({ ...EXAMPLE, tiers: { medium: { physicalItems: true, physicalItemsMax: 3 } } }), /physical items are only allowed/);
  assert.deepEqual(parseProfile(JSON.parse(JSON.stringify(EXAMPLE))), p, 'parse is idempotent on its own output');
  assert.equal(thresholdsOf(parseProfile({ ...EXAMPLE, thresholds: { donDwellS: 1 } })).donDwellS, 1);
});

test('sizes compare after sorting the axes (a rotated item fits), with a 1e-6 epsilon', () => {
  assert.deepEqual(canonicalSize([0.1, 0.3, 0.2]), [0.3, 0.2, 0.1]);
  assert.ok(sizeFits([0.1, 0.3, 0.2], [0.3, 0.2, 0.1])); assert.ok(sizeFits([0.1, 0.1, 0.3], [0.3, 0.15, 0.15]));
  assert.ok(!sizeFits([0.31, 0.1, 0.1], [0.3, 0.2, 0.2])); assert.ok(sizeFits([0.3 + 5e-7, 0.1, 0.1], [0.3, 0.2, 0.2]));
});

// ---------------------------------------------------------------- state machine
test('transition table: only the documented transitions are legal, every state has an owner, RETURNING only goes WORN', () => {
  assert.deepEqual(Object.keys(TRANSITIONS).sort(), [...BACKPACK_STATES].sort());
  const legal = [];
  for (const a of BACKPACK_STATES) for (const b of BACKPACK_STATES) if (canTransition(a, b)) legal.push(`${a}>${b}`);
  assert.deepEqual(legal.sort(), ['DRAWING>HELD_CLOSED', 'DRAWING>WORN', 'HELD_CLOSED>HELD_OPEN', 'HELD_CLOSED>PLACED', 'HELD_CLOSED>RETURNING', 'HELD_OPEN>HELD_CLOSED',
    'HELD_OPEN>PLACED', 'HELD_OPEN>RETURNING', 'PLACED>HELD_CLOSED', 'PLACED>HELD_OPEN', 'PLACED>RETURNING', 'RETURNING>WORN', 'WORN>DRAWING', 'WORN>HELD_CLOSED'].sort());
  for (const forbidden of ['WORN>PLACED', 'WORN>RETURNING', 'WORN>HELD_OPEN', 'DRAWING>PLACED', 'DRAWING>RETURNING', 'RETURNING>HELD_CLOSED', 'RETURNING>PLACED', 'HELD_CLOSED>WORN', 'PLACED>WORN']) {
    const [a, b] = forbidden.split('>'); assert.equal(canTransition(a, b), false, forbidden);
  }
  assert.deepEqual(OWNER_OF, { WORN: 'worn', DRAWING: 'worn', PLACED: 'world', RETURNING: 'in_transit' });
  assert.ok(isHeld('HELD_OPEN') && isHeld('HELD_CLOSED') && !isHeld('PLACED'));
});

test('full cycle: WORN -> DRAWING -> HELD_CLOSED -> HELD_OPEN -> PLACED -> HELD -> RETURNING -> WORN with the right owner each step', () => {
  const st = mk('low'); const owners = [];
  const seen = () => owners.push(`${st.state}/${st.owner}`);
  seen(); toHeld(st); seen();
  assert.equal(st.holder, 'right');
  assert.equal(st.open().ok, true); run(st, 30, DT, IN(null, R(0)));
  assert.equal(st.state, 'HELD_OPEN'); seen();
  const placed = st.step(DT, IN(null, R(0, false), { surface: SURFACE }));
  assert.equal(st.state, 'PLACED'); assert.deepEqual(placed.events.map(e => e.reason), ['placed']); seen();
  assert.equal(st.step(DT, IN(null, R(0.2))).ok, true);
  assert.equal(st.grab('right', { handleDistanceM: 0.1 }).ok, true); assert.equal(st.state, 'HELD_OPEN'); seen();
  st.step(DT, IN(null, R(0, false)));
  assert.equal(st.state, 'RETURNING'); seen();
  run(st, 40, DT, IN(null, null)); assert.equal(st.state, 'WORN'); seen();
  assert.deepEqual(owners, ['WORN/worn', 'HELD_CLOSED/hand:right', 'HELD_OPEN/hand:right', 'PLACED/world', 'HELD_OPEN/hand:right', 'RETURNING/in_transit', 'WORN/worn']);
});

test('invalid transitions are rejected with a reason and change nothing', () => {
  const st = mk('high');
  const idle = () => JSON.stringify(st.snapshot());
  const before = idle();
  for (const [r, why] of [[st.open(), 'invalid_state'], [st.close(), 'invalid_state'], [st.grab('right', { handleDistanceM: 0.05 }), 'not_tracked']]) { assert.equal(r.ok, false); assert.equal(r.reason, why); }
  assert.equal(idle(), before);
  st.step(DT, IN(null, R(0.2, false))); assert.equal(st.grab('right', { handleDistanceM: 0.05 }).reason, 'not_gripping');
  st.step(DT, IN(null, R(0.2)));
  for (const [args, why] of [[['right', { handleDistanceM: 0.1601 }], 'out_of_reach'], [['right', {}], 'out_of_reach'], [['right', { handleDistanceM: NaN }], 'out_of_reach'],
    [['middle', { handleDistanceM: 0.05 }], 'invalid_hand'], [['right', { kind: 'click', handleDistanceM: 0.05 }], 'invalid_kind']]) assert.equal(st.grab(...args).reason, why);
  assert.equal(st.state, 'WORN');
  assert.equal(st.grab('right', { handleDistanceM: 0.16 }).ok, true, 'exactly 16 cm is in reach');
  assert.equal(st.grab('right', { handleDistanceM: 0.05 }).reason, 'busy');
  assert.equal(st.open().reason, 'invalid_state'); assert.equal(st.callToHand('right').reason, 'busy');
  assert.equal(st.step(-1).reason, 'invalid_dt'); assert.equal(st.step(NaN).reason, 'invalid_dt');
  toHeld(mk('high')).die();
  const held = toHeld(mk('medium')); assert.equal(held.open().reason, 'needs_two_hands');
  const minimal = mk('minimal'); minimal.step(DT, IN(null, R(0.2))); minimal.grab('right', { handleDistanceM: 0.05 });
  assert.equal(minimal.state, 'DRAWING'); assert.equal(mk('off').grab('right', { handleDistanceM: 0.05 }).reason, 'tier_off');
});

test('the draw: below 18 cm or let go early the bag goes back; weapon transition and blocked path hold the release', () => {
  const early = mk('high'); early.step(DT, IN(null, R(0.2))); early.grab('right', { handleDistanceM: 0.05 });
  run(early, 10, DT, IN(null, R(0.0))); assert.equal(early.state, 'DRAWING'); assert.ok(early.pull.offset > 0.01 && early.pull.offset < 0.18);
  early.step(DT, IN(null, R(0.0, false))); assert.equal(early.state, 'WORN');
  run(early, 60, DT, IN(null, null)); assert.equal(early.pull.offset, 0, 'the pull settles back to the worn anchor');
  for (const [extra, reason] of [[{ weaponBusy: true }, 'weapon_busy'], [{ pathClear: false }, 'path_blocked']]) {
    const st = mk('high'); st.step(DT, IN(null, R(0.2))); st.grab('right', { handleDistanceM: 0.05 });
    const events = []; for (let i = 0; i < 60; i++) events.push(...st.step(0.04, IN(null, R(-0.05), extra)).events.map(e => e.type + ':' + (e.reason ?? '')));
    assert.equal(st.state, 'DRAWING'); assert.deepEqual(events, [`release_blocked:${reason}`], 'reported once, not every frame');
    st.step(0.04, IN(null, R(-0.05)));
    assert.equal(st.state, 'HELD_CLOSED');
  }
  const noDetach = mk('minimal'); noDetach.step(DT, IN(null, R(0.2))); noDetach.grab('right', { handleDistanceM: 0.05 });
  run(noDetach, 60, 0.04, IN(null, R(-0.05))); assert.equal(noDetach.state, 'DRAWING', 'minimal: guided pull only, the bag never leaves the body');
  assert.ok(noDetach.pull.offset <= PULL.MAX_PULL_M + 1e-12);
});

test('tracking loss: DRAWING cancels at once; HELD freezes for the grace, regained within it keeps the bag, beyond it RETURNING (never a drop)', () => {
  const d = mk('high'); d.step(DT, IN(null, R(0.2))); d.grab('right', { handleDistanceM: 0.05 }); run(d, 10, DT, IN(null, R(0)));
  const lost = d.step(DT, IN(null, H(null, true, false))); assert.equal(d.state, 'WORN'); assert.equal(lost.events[0].reason, 'tracking_lost');
  const st = toHeld(mk('low')); const grace = thresholdsOf(st.profile).trackingGraceS;
  const events = [];
  for (let t = 0; t < grace - 0.1; t += DT) events.push(...st.step(DT, IN(null, NONE)).events.map(e => e.type));
  assert.equal(st.state, 'HELD_CLOSED'); assert.equal(st.owner, 'hand:right', 'still owned by the hand, frozen'); assert.deepEqual(events, ['tracking_grace']);
  assert.equal(st.step(DT, IN(null, R(0))).events[0].type, 'tracking_regained');
  let n = 0; for (; st.state !== 'RETURNING' && n < 400; n++) st.step(DT, IN(null, NONE));
  assert.ok(n * DT >= grace - DT && n * DT <= grace + DT, `grace ${n * DT}`);
  assert.equal(st.owner, 'in_transit'); assert.notEqual(st.state, 'PLACED'); assert.equal(st.capture().state, 'WORN');
  run(st, 40, DT, IN(null, NONE)); assert.equal(st.state, 'WORN');
});

test('never lost: policy is only "never"; release in mid air returns; death restores; random play always ends WORN or PLACED', () => {
  const rnd = lcg(12345);
  for (const tier of ['minimal', 'low', 'medium', 'high']) {
    const st = mk(tier); let guard = 0; const reasons = new Set(['grab', 'released', 'grip_released', 'tracking_lost', 'opened', 'closed', 'placed', 'no_surface', 'don', 'too_far', 'returned',
      'grab_placed', 'call_to_hand', 'tier_lowered', 'tier_off', 'death_restore', 'restore', 'reset']);
    for (let i = 0; i < 6000; i++) {
      const dice = rnd();
      const hand = (side) => rnd() < 0.15 ? NONE : H([(rnd() - 0.5) * 0.3, 0.1, 0.25 - rnd() * 0.35], rnd() < 0.85);
      const input = IN(hand('left'), hand('right'), { surface: rnd() < 0.4 ? SURFACE : null, donDistanceM: rnd() < 0.5 ? rnd() : undefined, bagDistanceM: rnd() < 0.05 ? 20 : 1,
        pathClear: rnd() < 0.9, weaponBusy: rnd() < 0.05, posture: rnd() < 0.2 ? 'seated' : 'standing' });
      if (dice < 0.05) st.grab(rnd() < 0.5 ? 'left' : 'right', { handleDistanceM: rnd() * 0.3 });
      else if (dice < 0.08) st.open(); else if (dice < 0.1) st.close(); else if (dice < 0.12) st.callToHand(rnd() < 0.5 ? 'left' : 'right');
      else if (dice < 0.125) st.die(); else if (dice < 0.13) st.setTier(['minimal', 'low', 'medium', 'high'][Math.floor(rnd() * 4)]);
      const before = st.state, r = st.step(rnd() < 0.1 ? 0.3 : rnd() * 0.06, input);
      for (const e of r.events) if (e.type === 'state') {
        assert.ok(reasons.has(e.reason), e.reason);
        assert.ok(canTransition(e.from, e.to) || e.to === 'WORN', `${e.from}>${e.to} ${e.reason}`);
      }
      const snap = st.snapshot();
      assert.ok(BACKPACK_STATES.includes(snap.state)); assert.ok(snap.openFraction >= 0 && snap.openFraction <= 1);
      assert.equal(snap.owner, isHeld(snap.state) ? `hand:${snap.holder}` : OWNER_OF[snap.state], `${before}>${snap.state}`);
      assert.equal(isHeld(snap.state), snap.holder !== ''); assert.ok(snap.pullOffset >= 0 && snap.pullOffset <= PULL.MAX_PULL_M + 1e-12);
      assert.ok(['worn', 'world', 'in_transit'].includes(snap.owner) || snap.owner.startsWith('hand:'), 'the bag always has an owner');
      guard++;
    }
    assert.equal(guard, 6000);
    // hands off, nothing happens any more: the bag is worn or set down, never in the air or in transit forever
    st.setTier(tier === 'minimal' ? 'low' : tier); run(st, 400, 0.05, IN(null, null));
    assert.ok(['WORN', 'PLACED'].includes(st.state), `${tier} ended ${st.state}`);
    if (st.state === 'PLACED') { st.step(DT, IN(null, null, { bagDistanceM: 50 })); run(st, 40, 0.05, IN(null, null)); assert.equal(st.state, 'WORN'); }
  }
  const dead = toHeld(mk('high')); dead.die(); assert.equal(dead.state, 'WORN'); assert.equal(dead.owner, 'worn'); assert.equal(dead.openFraction, 0);
  const drop = toHeld(mk('high')); drop.step(DT, IN(null, R(0, false), { surface: { stable: false, position: [0, 0, 0], rotation: [0, 0, 0, 1] } }));
  assert.equal(drop.state, 'RETURNING', 'an unstable surface is not a place to put the bag');
  const bad = toHeld(mk('high')); bad.step(DT, IN(null, R(0, false), { surface: { stable: true, position: [0, NaN, 0], rotation: [0, 0, 0, 1] } }));
  assert.equal(bad.state, 'RETURNING', 'an invalid pose never becomes PLACED');
});

test('don zone: dwell with hysteresis snaps the bag on; a short dwell does not; PLACED too far returns; tier lowered sends it home', () => {
  const st = toHeld(mk('low'));
  run(st, 10, DT, IN(null, R(0), { donDistanceM: 0.5 }));
  run(st, 20, DT, IN(null, R(0), { donDistanceM: 0.3 })); assert.equal(st.state, 'HELD_CLOSED');
  run(st, 30, DT, IN(null, R(0), { donDistanceM: 0.2 })); run(st, 5, DT, IN(null, R(0), { donDistanceM: 0.34 }));
  const r = st.step(DT, IN(null, R(0, false), { donDistanceM: 0.34, surface: SURFACE }));
  assert.equal(st.state, 'RETURNING'); assert.equal(r.events[0].reason, 'don', 'inside the hysteresis band the dwell holds');
  const short = toHeld(mk('low')); run(short, 10, DT, IN(null, R(0), { donDistanceM: 0.2 })); short.step(DT, IN(null, R(0), { donDistanceM: 0.5 }));
  run(short, 10, DT, IN(null, R(0), { donDistanceM: 0.2 })); short.step(DT, IN(null, R(0, false), { donDistanceM: 0.2 }));
  assert.equal(short.state, 'RETURNING'); const lastReason = short.snapshot(); assert.equal(lastReason.owner, 'in_transit');
  const far = toHeld(mk('low')); far.step(DT, IN(null, R(0, false), { surface: SURFACE }));
  far.step(DT, IN(null, null, { bagDistanceM: 7.9 })); assert.equal(far.state, 'PLACED'); far.step(DT, IN(null, null, { bagDistanceM: 8.01 })); assert.equal(far.state, 'RETURNING');
  const lower = toHeld(mk('high')); lower.setTier('minimal'); assert.equal(lower.state, 'RETURNING'); lower.setTier('off'); assert.equal(lower.state, 'WORN');
});

test('two hands (medium+): open needs the second hand, handoff keeps the bag, low does not need it', () => {
  const st = toHeld(mk('medium'));
  assert.equal(st.open().reason, 'needs_two_hands');
  st.step(DT, IN(H([-0.2, 0.1, 0]), R(0))); assert.equal(st.snapshot().secondary, true); assert.equal(st.open().ok, true);
  run(st, 30, DT, IN(H([-0.2, 0.1, 0]), R(0))); assert.equal(st.state, 'HELD_OPEN');
  const r = st.step(DT, IN(H([-0.2, 0.1, 0]), R(0, false)));
  assert.deepEqual(r.events.map(e => e.type + ':' + e.side), ['handoff:left']); assert.equal(st.owner, 'hand:left'); assert.equal(st.state, 'HELD_OPEN');
  const low = toHeld(mk('low')); assert.equal(low.open().ok, true);
  const noOpen = toHeld(mk('low', { ...EXAMPLE, tiers: { low: { open: false } } })); assert.equal(noOpen.open().reason, 'tier_no_open');
});

test('seated recall gesture is optional: only seated, only with the profile switch, from WORN or PLACED', () => {
  const st = mk('low'); st.step(DT, IN(null, R(0.2)));
  assert.equal(st.callToHand('right').reason, 'not_seated'); st.setPosture('seated');
  assert.equal(st.callToHand('left').reason, 'not_tracked'); assert.equal(st.callToHand('right').ok, true);
  assert.equal(st.state, 'HELD_CLOSED'); assert.equal(st.owner, 'hand:right');
  st.step(DT, IN(null, R(0, false), { surface: SURFACE })); assert.equal(st.state, 'PLACED');
  st.step(DT, IN(null, R(0))); assert.equal(st.callToHand('right').ok, true); assert.equal(st.state, 'HELD_CLOSED');
  const off = mk('low', { ...EXAMPLE, recall: { seated: false } }); off.step(DT, IN(null, R(0.2))); off.setPosture('seated');
  assert.equal(off.callToHand('right').reason, 'recall_disabled');
  assert.equal(mk('minimal').callToHand('right').reason, 'tier_no_detach');
  assert.throws(() => st.setPosture('flying'), RangeError);
});

test('dt independence: the pull follows 1-exp(-rate*dt), so slicing a frame does not change the result; timers differ by at most one step', () => {
  const pos = [0, 0, -0.12];
  const run1 = slices => { const p = createPull(); p.begin([0, 0, 0], 'right'); let v; for (let i = 0; i < 6; i++) for (let k = 0; k < slices; k++) v = p.step(pos, true, 0.1 / slices); return v; };
  const a = run1(1), b = run1(10), c = run1(100);
  assert.ok(Math.abs(a - b) < 1e-12 && Math.abs(a - c) < 1e-12, `${a} ${b} ${c}`);
  assert.ok(Math.abs(a - (0.085 - 0.085 * Math.exp(-14 * 0.6))) < 1e-12, 'closed form');
  const settleAt = dt => { const p = createPull(); p.begin([0, 0, 0], 'left'); p.step([0, 0, -0.3], true, 0.1); let t = 0; p.cancel(); while (p.offset > 0 && t < 5) { p.step([0, 0, 0], true, dt); t += dt; } return t; };
  assert.ok(Math.abs(settleAt(0.005) - settleAt(0.05)) <= 0.06);
  const returnTime = dt => { const st = toHeld(mk('low')); st.step(0.02, IN(null, R(0, false))); let t = st.snapshot().returnProgress * 0.6; while (st.state === 'RETURNING' && t < 5) { st.step(dt, IN(null, null)); t += dt; } return t; };
  for (const dt of [0.005, 0.02, 0.1]) { const t = returnTime(dt); assert.ok(Math.abs(t - 0.6) <= dt + 1e-9, `return ${dt} ${t}`); }
  const big = mk('low'); big.step(10, IN(null, null)); assert.equal(big.state, 'WORN');
});

// ---------------------------------------------------------------- approach and pull ports
test('approach: right and left over-shoulder accepted, body-crossing, hitches, jumps and expiry rejected (Godot suite cases)', () => {
  const a = createApproach(); const SH = 0.35; const o = (s, p, dt = DT) => a.observe(s, true, p, SH, dt);
  for (const p of [[0.18, 0.4, 0], [0.18, 0.38, 0.15], [0.12, 0.2, 0.27], [0.08, 0.1, 0.36]]) o('right', p);
  assert.deepEqual(a.check('right', [0.08, 0.1, 0.36], SH), { allowed: true, reason: 'over_shoulder' });
  for (const p of [[-0.18, 0.4, 0], [-0.18, 0.38, 0.15], [-0.12, 0.2, 0.27], [-0.08, 0.1, 0.36]]) o('left', p);
  assert.equal(a.check('left', [-0.08, 0.1, 0.36], SH).allowed, true);
  a.reset('right'); assert.equal(a.check('right', [0.08, 0.1, 0.36], SH).reason, 'back_approach_required'); assert.equal(a.check('left', [-0.08, 0.1, 0.36], SH).allowed, true);
  a.reset(); o('right', [0.18, 0.4, 0]); assert.equal(a.check('right', [0.18, 0.2, 0.15], SH).reason, 'back_approach_path');
  a.reset(); a.observe('right', true, [0.2, 0.3, 0.2], SH, 0.16); assert.equal(a.check('right', [0.2, 0.3, 0.2], SH).reason, 'back_approach_required');
  a.reset(); o('right', [0.18, 0.4, 0]); a.observe('right', true, [0.18, 0.4, 0.5], 0, DT); assert.equal(a.check('right', [0.18, 0.4, 0.5], SH).reason, 'back_approach_required');
  assert.equal(a.check('middle', [0, 0, 0], SH).reason, 'back_approach_invalid');
  a.reset(); for (const p of [[0.18, 0.4, 0], [0.18, 0.38, 0.15]]) o('right', p); for (let i = 0; i < 9; i++) o('right', [0.18, 0.4, 0.15], 0.15);
  assert.equal(a.check('right', [0.18, 0.4, 0.15], SH).reason, 'back_approach_expired');
});

test('system wiring: approach observation from body-local input, tier minimal keeps it, off tier resets', () => {
  const sys = createBackpackSystem({ profile: EXAMPLE, inventory: createMemoryInventory(), quality: 'low' });
  for (const p of [[0.18, 0.4, 0], [0.18, 0.38, 0.15], [0.12, 0.2, 0.27], [0.08, 0.1, 0.36]])
    sys.step(DT, { shoulderY: 0.35, hands: { left: NONE, right: { tracked: true, grip: false, local: [0, 0, 0], bodyLocal: p } } });
  assert.equal(sys.checkApproach('right', [0.08, 0.1, 0.36], 0.35).allowed, true);
  sys.setQuality('off'); assert.equal(sys.checkApproach('right', [0.08, 0.1, 0.36], 0.35).reason, 'back_approach_required');
  sys.setQuality('mid'); assert.equal(sys.quality, 'medium'); assert.throws(() => sys.setQuality('ultra'), RangeError);
});

// ---------------------------------------------------------------- container ledger
function setup(tier = 'high') {
  const inventory = createMemoryInventory();
  const sys = createBackpackSystem({ profile: EXAMPLE, inventory, quality: tier });
  const add = (id, category, size = [0.1, 0.05, 0.03], owner = 'world') => { assert.ok(inventory.registerItem(id, category, size, owner), id); return id; };
  return { inventory, sys, add, ledger: sys.ledger, bag: sys.bag };
}
const LH = H([-0.2, 0.1, 0]);
function open(bag) { toHeld(bag); bag.step(DT, IN(LH, R(0))); assert.equal(bag.open().ok, true); run(bag, 30, DT, IN(LH, R(0))); assert.equal(bag.state, 'HELD_OPEN'); }

test('ledger: capacity, rejection reasons (FULL/WRONG_ITEM/TOO_LARGE/INVALID_SIZE) and access by bag state', () => {
  const { sys, ledger, add, bag, inventory } = setup('low');
  add('t1', 'tool'); add('s1', 'supply'); add('s2', 'supply'); add('s3', 'supply'); add('s4', 'supply'); add('p1', 'pistol'); add('big', 'supply', [0.5, 0.1, 0.1]);
  assert.deepEqual(ledger.store('s1', 'main_supply'), { ok: false, reason: 'NOT_ACCESSIBLE' }, 'the closed worn bag keeps inner pockets shut');
  assert.equal(ledger.store('t1', 'side_pouch').ok, true, 'worn-access pocket works on the body');
  assert.equal(ledger.store('s1', 'left_hip').reason, 'WRONG_ITEM', 'supply is not a left_hip category');
  open(bag);
  for (const id of ['s1', 's2', 's3']) assert.equal(ledger.store(id, 'main_supply').ok, true);
  assert.deepEqual([ledger.store('s4', 'main_supply').reason, ledger.check('s4', 'main_supply').reason], ['FULL', 'FULL']);
  assert.equal(ledger.store('p1', 'main_tool').reason, 'WRONG_ITEM'); assert.equal(ledger.store('big', 'main_case').reason, 'TOO_LARGE');
  assert.equal(ledger.store('nope', 'main_case').reason, 'UNKNOWN_ITEM'); assert.equal(ledger.store('s4', 'nowhere').reason, 'UNKNOWN_POCKET');
  assert.equal(ledger.store('s3', 'main_case').reason, 'NOT_OWNED', 'an item already in a pocket is not owned by the world');
  const odd = { ...inventory, itemInfo: id => (id === 'zero' ? { category: 'supply', size: [0, 0.1, 0.1], owner: 'world' } : inventory.itemInfo(id)) };
  assert.equal(createContainerLedger({ profile: EXAMPLE, inventory: Object.assign(createMemoryInventory(), { itemInfo: odd.itemInfo }) }).check('zero', 'main_supply').reason, 'INVALID_SIZE');
  assert.equal(ledger.freeCells('main_supply'), 0); assert.deepEqual(ledger.itemsIn('main_supply'), ['s1', 's2', 's3']);
  const out = ledger.retrieve('main_supply', { itemId: 's2', newOwner: 'hand:left' });
  assert.deepEqual([out.ok, out.itemId], [true, 's2']); assert.equal(inventory.itemInfo('s2').owner, 'hand:left');
  assert.equal(ledger.retrieve('main_supply', { itemId: 'zzz' }).reason, 'NOT_FOUND'); assert.equal(ledger.retrieve('main_case').reason, 'EMPTY');
  assert.equal(ledger.store('s4', 'main_supply').cell, 'field_pack/main_supply/1', 'first free cell, stable naming');
  sys.dispose();
});

test('mounts stay on the body: hip and long-gun slots work in every bag state, bag pockets do not', () => {
  const { ledger, add, bag } = setup('high');
  add('gun', 'pistol'); add('mag', 'magazine'); add('rifle', 'long_gun', [0.9, 0.2, 0.08]);
  const states = []; const probe = (label) => { states.push(label); assert.equal(ledger.check('gun', 'left_hip').ok, true, label); assert.equal(ledger.check('rifle', 'back_long').ok, true, label); assert.equal(ledger.check('mag', 'main_tool').reason, label === 'WORN' ? 'NOT_ACCESSIBLE' : ledger.check('mag', 'main_tool').reason); };
  probe('WORN');
  assert.equal(ledger.store('gun', 'left_hip').ok, true); assert.equal(ledger.store('rifle', 'back_long').ok, true);
  toHeld(bag); assert.equal(ledger.check('mag', 'right_hip').ok, true); assert.equal(ledger.check('mag', 'main_tool').reason, 'NOT_ACCESSIBLE');
  bag.step(DT, IN(null, R(0, false), { surface: SURFACE })); assert.equal(bag.state, 'PLACED'); assert.equal(ledger.retrieve('left_hip').ok, true); assert.equal(ledger.store('gun', 'left_hip').ok, true);
  bag.step(DT, IN(null, null, { bagDistanceM: 99 })); assert.equal(bag.state, 'RETURNING'); assert.equal(ledger.retrieve('back_long').itemId, 'rifle'); assert.equal(ledger.store('rifle', 'back_long').ok, true);
  run(bag, 40, DT, IN(null, null)); assert.equal(bag.state, 'WORN'); assert.deepEqual(ledger.itemsIn('left_hip'), ['gun']); assert.deepEqual(ledger.itemsIn('back_long'), ['rifle']);
  assert.equal(states.length, 1);
});

test('bag state never touches item ownership: items stay in their pockets through every transition, only bag access changes', () => {
  const { ledger, add, bag, inventory } = setup('high');
  add('m', 'medical'); add('t', 'tool');
  open(bag); assert.equal(ledger.store('m', 'main_supply').ok, true); assert.equal(ledger.store('t', 'main_tool').ok, true);
  const owners = () => ['m', 't'].map(id => `${inventory.itemInfo(id).owner}@${inventory.slotOf(id)}`).join();
  const before = owners();
  bag.step(DT, IN(null, R(0, false), { surface: SURFACE })); assert.equal(owners(), before);
  bag.die(); assert.equal(owners(), before); toHeld(bag); assert.equal(owners(), before);
  bag.step(DT, IN(null, R(0, false))); run(bag, 40, DT, IN(null, null)); assert.equal(owners(), before); assert.equal(bag.state, 'WORN');
  assert.deepEqual(ledger.locate('m'), { pocketId: 'main_supply', cell: 'field_pack/main_supply/0' });
});

/** Provider whose store()/retrieve() throw once a budget of successful calls is used up (to prove rollback). */
function flaky(inner) {
  const f = { budget: Infinity, ...inner };
  for (const m of ['store', 'retrieve']) f[m] = (...a) => { if (f.budget-- === 0) throw new Error('provider failed'); return inner[m](...a); };
  return f;
}
const dump = (inv, ids) => ids.map(id => `${id}:${inv.itemInfo(id).owner}@${inv.slotOf(id)}`).join(' ');

test('ledger transfers are atomic: a provider failure rolls back (move, storeAll, restore), IDs never change', () => {
  const real = createMemoryInventory(); const inv = flaky(real);
  const bag = createBackpackState({ profile: EXAMPLE, tier: 'high' }); open(bag);
  const ledger = createContainerLedger({ profile: EXAMPLE, inventory: inv, canAccess: id => bag.canAccess(id) });
  const ids = ['a', 'b', 'c', 'd'];
  for (const id of ids) real.registerItem(id, 'supply', [0.1, 0.05, 0.03]);
  assert.equal(ledger.store('a', 'main_supply').ok, true); assert.equal(ledger.store('b', 'main_supply').ok, true);
  const clean = dump(real, ids);
  inv.budget = 1; // retrieve ok, store throws
  const moved = ledger.move('a', 'main_case'); assert.deepEqual([moved.ok, moved.reason], [false, 'PROVIDER_REJECTED']);
  inv.budget = Infinity; assert.equal(dump(real, ids), clean, 'move rolled back');
  inv.budget = 1; const all = ledger.storeAll(['c', 'd'], 'main_case'); assert.equal(all.ok, false);
  inv.budget = Infinity; assert.equal(dump(real, ids), clean, 'storeAll rolled back (nothing half-stored)');
  inv.budget = 0; assert.equal(ledger.store('c', 'main_case').reason, 'PROVIDER_REJECTED'); inv.budget = Infinity; assert.equal(dump(real, ids), clean);
  assert.equal(ledger.storeAll(['c', 'd'], 'main_supply').reason, 'FULL', 'capacity is checked before anything moves'); assert.equal(dump(real, ids), clean);
  assert.equal(ledger.storeAll(['c', 'c'], 'main_case').ok, false);
  assert.equal(ledger.storeAll(['c'], 'main_case').ok, true); assert.equal(ledger.move('c', 'main_supply').ok, true);
  assert.deepEqual(ledger.locate('c'), { pocketId: 'main_supply', cell: 'field_pack/main_supply/2' }); assert.equal(ledger.move('c', 'main_supply').ok, true, 'same pocket is a no-op');
  assert.equal(ledger.move('c', 'left_hip').reason, 'WRONG_ITEM'); assert.equal(ledger.move('d', 'main_tool').reason, 'NOT_FOUND');
  const cp = ledger.capture(); const snapshot = dump(real, ids);
  inv.budget = 3; // restore: retrieve x3 ok, then store throws -> rolls back to the snapshot
  const target = JSON.parse(JSON.stringify(cp)); target.cells['field_pack/main_supply/0'] = 'c'; target.cells['field_pack/main_supply/2'] = 'a';
  const plan = ledger.prepareRestore(target); assert.throws(() => plan.commit(), /rolled back/); inv.budget = Infinity;
  assert.equal(dump(real, ids), snapshot, 'restore rolled back');
  ledger.restore(target); assert.equal(real.slotOf('c'), 'field_pack/main_supply/0'); assert.equal(real.slotOf('a'), 'field_pack/main_supply/2');
});

test('checkpoint: bag state and ledger round-trip as JSON; transient states restore WORN; PLACED keeps pose and openness; bad data changes nothing', () => {
  const { sys, add, ledger, bag, inventory } = setup('low');
  add('x', 'supply'); open(bag); ledger.store('x', 'main_supply');
  bag.step(DT, IN(null, R(0, false), { surface: SURFACE }));
  const cp = JSON.parse(JSON.stringify(sys.capture()));
  assert.equal(cp.bag.state, 'PLACED'); assert.deepEqual(cp.bag.placedPose, SURFACE.position && { position: SURFACE.position, rotation: SURFACE.rotation }); assert.equal(cp.bag.openFraction, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(cp)), cp, 'JSON safe');
  bag.die(); ledger.retrieve('main_supply'); inventory.unregisterItem('zz');
  sys.restore(cp); assert.equal(bag.state, 'PLACED'); assert.deepEqual(sys.capture(), cp, 'capture -> restore -> capture is identical');
  assert.equal(bag.canAccess('main_supply'), true, 'a placed open bag is still open'); assert.deepEqual(ledger.itemsIn('main_supply'), ['x']);
  bag.die(); toHeld(bag); assert.equal(bag.capture().state, 'WORN'); assert.equal(bag.capture().owner, 'worn');
  const keep = JSON.stringify(sys.capture());
  const bads = [{ ...cp, schema: 'x' }, { ...cp, bag: { ...cp.bag, profileId: 'other' } }, { ...cp, bag: { ...cp.bag, state: 'HELD_OPEN' } }, { ...cp, bag: { ...cp.bag, placedPose: null } },
    { ...cp, bag: { ...cp.bag, openFraction: 3 } }, { ...cp, bag: { ...cp.bag, placedPose: { position: [0, 0, 'x'], rotation: [0, 0, 0, 1] } } }, { ...cp, ledger: { ...cp.ledger, cells: {} } },
    { ...cp, ledger: { ...cp.ledger, cells: { ...cp.ledger.cells, 'field_pack/main_supply/1': 'x' } } }, { ...cp, ledger: { ...cp.ledger, cells: { ...cp.ledger.cells, 'field_pack/main_supply/1': 'ghost' } } }];
  for (const bad of bads) { assert.throws(() => sys.prepareRestore(bad)); assert.equal(JSON.stringify(sys.capture()), keep, 'a rejected restore changes nothing'); }
  assert.throws(() => bag.prepareRestore({ ...cp.bag, extra: Number.NaN }));
  const lowOnly = createBackpackState({ profile: EXAMPLE, tier: 'minimal' }); lowOnly.restore(cp.bag); assert.equal(lowOnly.state, 'WORN', 'a tier that cannot hold a detached bag restores it WORN');
});

// ---------------------------------------------------------------- adapters, audio, host
test('adapters: interfaces are listed, assertAdapter names the missing method, audio hook hears grab/open/place/rustle', () => {
  assert.deepEqual(Object.keys(ADAPTER_METHODS).sort(), ['audio', 'bodyAnchor', 'input', 'inventory']);
  assert.throws(() => assertAdapter('inventory', { store() {} }), /needs addSlot/); assert.throws(() => assertAdapter('nothing', {}), RangeError);
  assert.throws(() => createBackpackSystem({ profile: EXAMPLE, inventory: {} }), TypeError);
  assert.doesNotThrow(() => assertAdapter('bodyAnchor', Object.fromEntries(ADAPTER_METHODS.bodyAnchor.map(m => [m, () => {}]))));
  const audio = createRecordingAudio(); const inventory = createMemoryInventory();
  const sys = createBackpackSystem({ profile: EXAMPLE, inventory, audio, quality: 'low' }); inventory.registerItem('k', 'tool', [0.1, 0.05, 0.03]);
  open(sys.bag); sys.ledger.store('k', 'main_tool'); sys.bag.step(DT, IN(null, R(0, false), { surface: SURFACE })); sys.bag.close(); run(sys.bag, 30, DT, IN(null, null));
  const names = audio.calls.map(c => c.name);
  for (const n of ['bag_strap_grab', 'bag_unzip', 'item_rustle', 'bag_set_down']) assert.ok(names.includes(n), n);
});

test('host extension: loads with five tiers, follows the global level, off is inert, update() does not cancel a pull', async () => {
  const host = createHost({ maxLevel: 4 });
  const api = await host.load(backpackExtension, { profile: EXAMPLE, inventory: createMemoryInventory() });
  assert.ok(api && api.bag); host.setQuality(4); assert.equal(host.tier('backpack'), 'high');
  host.setQuality(0); assert.equal(host.tier('backpack'), 'off'); assert.equal(api.quality, 'off');
  host.setQuality(1); assert.equal(api.quality, 'minimal'); host.setQuality(2); assert.equal(api.quality, 'low'); host.setQuality(3); assert.equal(api.quality, 'medium');
  host.setQuality(4); api.bag.step(DT, IN(null, R(0.2))); api.bag.grab('right', { handleDistanceM: 0.05 }); host.update(0.1); assert.equal(api.bag.state, 'DRAWING');
  assert.equal(host.setTier('backpack', 'low'), 'low'); assert.deepEqual(backpackExtension().quality, ['off', 'minimal', 'low', 'medium', 'high']);
  host.dispose();
});

// ---------------------------------------------------------------- P2: mounts, materialisation limit, one refresh path, checkpoint v2, stash
const SZ = [0.1, 0.05, 0.03];
const withProfile = (fn, base = EXAMPLE) => { const p = JSON.parse(JSON.stringify(base)); fn(p); return p; };
const STASH = JSON.parse(read('profile.stash.example.json'));
const mkLedger = (profile = EXAMPLE, extra = {}) => { const inventory = createMemoryInventory(); const events = []; const ledger = createContainerLedger({ profile, inventory, emit: (t, d) => events.push(t.replace('backpack:', '') + ':' + (d.itemId ?? '')), ...extra }); return { inventory, ledger, events }; };

test('P2 profile: kind, BackpackMount and the materialisation limit are optional and backward compatible', () => {
  assert.deepEqual(parseProfile(EXAMPLE).kind, 'pack', 'a profile without kind is a pack');
  const m = parseProfile(withProfile(p => { p.pockets[4].mount = { acceptOnly: ['pistol_a'] }; p.bagMount = {}; }));
  assert.deepEqual(m.pockets[4].mount, { acceptOnly: ['pistol_a'], snapMode: 'range', returnDelayS: 0 }, 'mount defaults are filled in');
  assert.deepEqual(m.bagMount, { snapMode: 'range', returnDelayS: 0 });
  const bad = fn => assert.throws(() => parseProfile(withProfile(fn)));
  bad(p => { p.pockets[0].mount = { acceptOnly: [] }; }); bad(p => { p.pockets[0].mount = { snapMode: 'magnet' }; }); bad(p => { p.pockets[0].mount = { returnDelayS: -1 }; });
  bad(p => { p.pockets[0].mount = { colour: 1 }; }); bad(p => { p.kind = 'crate'; }); bad(p => { p.tiers = { high: { physicalItemsMax: 13 } }; }); bad(p => { p.tiers = { high: { physicalItemsMax: 7.5 } }; });
  assert.equal(parseProfile(withProfile(p => { p.tiers = { high: { physicalItemsMax: 12 } }; })).tiers.high.physicalItemsMax, 12);
  assert.equal(materialLimit(parseProfile(withProfile(p => { p.tiers = { high: { physicalItemsMax: 5 } }; })), 'high'), 5);
  assert.equal(materialLimit(parseProfile(EXAMPLE), 'low'), 0, 'low tiers use the slot view');
  assert.ok(BACKPACK_DATA.VIEW.MAX_PHYSICAL_PROXIES <= 12 && BACKPACK_DATA.VIEW.MAX_PHYSICAL_PROXIES >= 8);
  const schema = JSON.parse(read('profile.schema.json'));
  assert.ok(schema.properties.kind && schema.properties.bagMount && schema.properties.pockets.items.properties.mount && schema.$defs.mount, 'schema documents the new optional fields');
  assert.ok(!schema.required.includes('kind') && !schema.required.includes('handle'), 'schema stays backward compatible');
  const cases = profileCasesAll(EXAMPLE); assert.ok(cases.length >= 60 && new Set(cases.map(c => c.name)).size === cases.length);
});

test('P2 existing results are unchanged: the P0/P1 golden vectors still reproduce exactly (no existing state or result changed)', () => {
  const golden = JSON.parse(read('backpack.golden.json')); const files = { profiles: golden.profiles };
  const first = profileCases(EXAMPLE).map(c => c.name);
  assert.deepEqual(golden.profileCases.slice(0, first.length).map(v => v.name), first, 'old profile cases come first and keep their order');
  assert.equal(golden.state.length >= 24, true);
  for (const v of golden.state) assert.equal(firstDiff(runState(v, files), v.expected), '', v.name);
});

test('P2 mount: acceptOnly (id or tag), snap modes, returnDelayS timeout and pre/post events in order', () => {
  const profile = withProfile(p => { p.pockets[4].mount = { acceptOnly: ['sidearm', 'pistol_a'], snapMode: 'dropped', returnDelayS: 0.5 }; });
  const { inventory, ledger, events } = mkLedger(profile);
  inventory.registerItem('pa', 'pistol', SZ, 'world', ['pistol_a']); inventory.registerItem('pb', 'pistol', SZ); inventory.registerItem('pc', 'pistol', SZ, 'world', ['sidearm', 'x']);
  const hip = profile.pockets[4].id;
  assert.equal(ledger.store('pb', hip).reason, 'NOT_ACCEPTED'); assert.equal(ledger.check('pb', hip).reason, 'NOT_ACCEPTED');
  assert.equal(ledger.offer('pa', hip).reason, 'NOT_RELEASED'); assert.equal(ledger.offer('pa', hip, { released: true }).ok, true);
  assert.deepEqual(events, ['placing:pa', 'stored:pa', 'placed:pa']);
  assert.equal(ledger.retrieve(hip).ok, true); assert.deepEqual(events.slice(3), ['removing:pa', 'retrieved:pa', 'removed:pa']);
  assert.deepEqual(ledger.mountOf(hip), { acceptOnly: ['sidearm', 'pistol_a'], snapMode: 'dropped', returnDelayS: 0.5 });
  ledger.scheduleReturn('pc', hip); assert.deepEqual(ledger.tick(0.3), []); assert.equal(ledger.tick(0.3)[0].ok, true); assert.equal(ledger.locate('pc').pocketId, hip);
  const none = mkLedger(withProfile(p => { p.pockets[4].mount = { snapMode: 'none' }; }));
  none.inventory.registerItem('a', 'pistol', SZ); assert.equal(none.ledger.offer('a', hip).reason, 'SNAP_DISABLED'); assert.equal(none.ledger.store('a', hip).ok, true, 'snapMode none only turns off snapping, a direct store still works');
  const v = mkLedger(); v.inventory.registerItem('a', 'supply', SZ); v.ledger.addValidator(e => e.kind !== 'placing');
  assert.equal(v.ledger.store('a', 'main_supply').reason, 'VETOED'); assert.equal(v.inventory.slotOf('a'), ''); assert.deepEqual(v.events, []);
});

test('P2 view: at most physicalItemsMax proxies, tab/page choice, held items left out, ONE refresh path with a re-entrancy guard', () => {
  const profile = withProfile(p => { p.tiers = { high: { physicalItemsMax: 3 } }; });
  const { inventory, ledger } = mkLedger(profile, { tier: 'high' });
  for (const id of ['a', 'b', 'c']) inventory.registerItem(id, 'supply', SZ); for (const id of ['t1', 't2']) inventory.registerItem(id, 'tool', SZ);
  for (const id of ['a', 'b', 'c']) ledger.store(id, 'main_supply'); for (const id of ['t1', 't2']) ledger.store(id, 'main_tool');
  const v1 = ledger.view(); assert.equal(v1.mode, 'physical'); assert.equal(v1.items.length, 3); assert.equal(v1.total, 5); assert.equal(v1.pages, 2); assert.equal(v1.truncated, true);
  assert.equal(ledger.view({ page: 1 }).items.length, 2); assert.equal(ledger.view({ page: 99 }).page, 1, 'pages are clamped'); assert.equal(ledger.view({ page: NaN }).page, 0);
  assert.deepEqual(ledger.view({ tab: 'main_tool' }).items.map(i => i.itemId), ['t1', 't2']); assert.equal(ledger.view({ tab: 'nowhere' }).tab, '*');
  ledger.hold('a'); assert.ok(!ledger.view({ tab: 'main_supply' }).items.some(i => i.itemId === 'a'), 'an item in a hand is not also a proxy'); ledger.unhold('a');
  inventory.transfer; ledger.setTier('low'); const slots = ledger.view({ tab: 'main_supply' }); assert.equal(slots.mode, 'slots'); assert.equal(slots.items.length, 3 /* capacity */); assert.equal(ledger.materialLimit, 0);
  ledger.setTier('high');
  const big = mkLedger(withProfile(p => { p.tiers = { high: { physicalItemsMax: 12 } }; p.pockets[1].capacity = 20; })); for (let i = 0; i < 20; i++) { big.inventory.registerItem(`s${i}`, 'supply', SZ); big.ledger.store(`s${i}`, 'main_supply'); }
  assert.ok(big.ledger.view({ tab: 'main_supply' }).items.length <= 12, 'never more than 12 physical proxies');
  // one refresh path: every change is exactly one refresh; a listener that changes the ledger is coalesced and bounded
  const r = mkLedger(profile); const seen = []; r.ledger.onRefresh(v => seen.push(v.total));
  for (const id of ['a', 'b']) r.inventory.registerItem(id, 'supply', SZ);
  const base = r.ledger.refreshStats().refreshes; r.ledger.store('a', 'main_supply'); assert.equal(r.ledger.refreshStats().refreshes, base + 1); assert.deepEqual(seen, [1]);
  let first = true; r.ledger.onRefresh(() => { if (first) { first = false; r.ledger.store('b', 'main_supply'); } });
  r.ledger.hold('a'); assert.equal(r.inventory.slotOf('b') !== '', true); assert.ok(r.ledger.refreshStats().deferred >= 1);
  const loop = mkLedger(profile); let n = 0; loop.ledger.onRefresh(() => { n++; loop.ledger.refresh(); }); loop.ledger.refresh();
  assert.ok(n <= BACKPACK_DATA.VIEW.MAX_REFRESH_PASSES, `bounded passes: ${n}`);
});

test('P2 checkpoint v2: backpack layer only, a missing backpack state is accepted, old shapes still load, bad data changes nothing', () => {
  const { inventory, ledger } = mkLedger(); inventory.registerItem('a', 'supply', SZ); inventory.registerItem('t', 'tool', SZ); ledger.store('a', 'main_supply'); ledger.store('t', 'main_tool');
  const bag = createBackpackState({ profile: EXAMPLE, tier: 'high' });
  const cp = captureCheckpoint({ ledger, bag }); assert.equal(cp.schema, CHECKPOINT_SCHEMA); assert.deepEqual(Object.keys(cp).sort(), ['bag', 'ledger', 'profileId', 'schema']);
  assert.deepEqual(JSON.parse(JSON.stringify(cp)), cp, 'JSON-safe'); assert.equal(captureCheckpoint({ ledger }).bag, null);
  assert.ok(!('items' in cp) && !('slots' in cp), 'the provider checkpoint is not part of it');
  ledger.retrieve('main_supply'); restoreCheckpoint({ ledger, bag }, cp); assert.equal(inventory.slotOf('a'), 'field_pack/main_supply/0');
  const absent = prepareCheckpoint({ ledger }, undefined); assert.equal(absent.absent, true); absent.commit(); absent.notify(); assert.equal(prepareCheckpoint({ ledger }, null).absent, true);
  assert.equal(inventory.slotOf('a'), 'field_pack/main_supply/0', 'absent state touches nothing');
  assert.equal(prepareCheckpoint({ ledger }, ledger.capture()).version, 1); assert.equal(prepareCheckpoint({ ledger }, { schema: 'gamesystems.backpack-system.v1', ledger: ledger.capture(), bag: null }).version, 1);
  const before = JSON.stringify(ledger.capture());
  for (const bad of [{ ...cp, profileId: 'other' }, { ...cp, schema: 'gamesystems.backpack-checkpoint.v3' }, { ...cp, bag: 3 }, { ...cp, ledger: undefined }, 'junk', 7, { ...cp, ledger: { ...cp.ledger, cells: { ...cp.ledger.cells, 'field_pack/main_tool/0': 'ghost' } } }])
    assert.throws(() => prepareCheckpoint({ ledger, bag }, bad), Error);
  assert.equal(JSON.stringify(ledger.capture()), before, 'bad data changes nothing');
  const sys = createBackpackSystem({ profile: EXAMPLE, inventory: createMemoryInventory() });
  assert.equal(typeof sys.captureCheckpoint, 'function'); const c2 = sys.captureCheckpoint(); assert.equal(c2.schema, CHECKPOINT_SCHEMA); sys.restoreCheckpoint(c2); sys.restoreCheckpoint(undefined);
  sys.restoreCheckpoint(sys.capture());
});

test('P2 stash: stationary profile kind, same ledger, no carry states, open/close only, checkpoint round-trip', () => {
  const inventory = createMemoryInventory(); const stash = createStash({ profile: STASH, inventory });
  assert.equal(stash.profile.kind, 'stash'); assert.equal(stash.profile.detachable, false); assert.equal('state' in stash, false); assert.equal('bag' in stash, false);
  for (const id of ['t1', 't2']) inventory.registerItem(id, 'tool', SZ);
  assert.equal(stash.ledger.store('t1', 'drawer').ok, true, 'always pockets are reachable closed'); assert.equal(stash.ledger.store('t2', 'shelf').reason, 'NOT_ACCESSIBLE');
  stash.open(); assert.equal(stash.ledger.store('t2', 'shelf').ok, true);
  const cp = JSON.parse(JSON.stringify(stash.capture())); stash.close(); assert.equal(stash.isOpen, false); stash.restore(cp); assert.equal(stash.isOpen, true);
  assert.throws(() => stash.restore({ ...cp, open: 'yes' })); assert.throws(() => stash.restore({ ...cp, profileId: 'x' }));
  for (const bad of [{ ...STASH, handle: { local: [0, 0, 0] } }, { ...STASH, detachable: true }, { ...STASH, recall: {} }, { ...STASH, tiers: { low: { detach: true } } }]) assert.throws(() => parseProfile(bad), Error);
  assert.throws(() => createStash({ profile: EXAMPLE, inventory: createMemoryInventory() }), TypeError);
  assert.equal(STASH.kind, 'stash'); assert.ok(ledgerVectors.some(v => v.profile === 'stash'));
});

test('P2 ledger golden vectors cover every rejection reason and the new events', () => {
  const golden = JSON.parse(read('backpack.golden.json')); const files = { profiles: golden.profiles };
  const reasons = new Set(), events = new Set();
  for (const v of golden.ledger) for (const o of runLedger(v, files)) { if (o.result.reason) reasons.add(o.result.reason); for (const e of o.events) events.add(e.split(':')[0]); }
  for (const r of ['FULL', 'WRONG_ITEM', 'TOO_LARGE', 'INVALID_SIZE', 'NOT_ACCEPTED', 'NOT_ACCESSIBLE', 'UNKNOWN_ITEM', 'UNKNOWN_POCKET', 'NOT_OWNED', 'PROVIDER_REJECTED', 'VETOED', 'SNAP_DISABLED', 'NOT_RELEASED', 'EMPTY', 'NOT_FOUND']) assert.ok(reasons.has(r), `vector for ${r}`);
  for (const e of ['placing', 'placed', 'removing', 'removed', 'stored', 'retrieved', 'moved', 'mount_return', 'stash_open', 'ledger-restored']) assert.ok(events.has(e), `event ${e}`);
});

// ---------------------------------------------------------------- golden vectors and Godot parity
test('golden: the checked-in vectors are exactly what the JS core produces, and the Godot copies are byte-identical', async () => {
  const text = goldenText(await buildGolden());
  assert.equal(read('backpack.golden.json'), text, 'run: node extensions/backpack/tools/gen_golden.mjs');
  for (const name of COPIED) assert.equal(readFileSync(`${GODOT_DATA_DIR}/${name}`, 'utf8'), read(name), `godot copy of ${name}`);
});

test('golden: every vector (approach, pull, profile, state) reproduces its expected outcome', () => {
  const golden = JSON.parse(read('backpack.golden.json')); const files = { profiles: golden.profiles }; let ops = 0;
  assert.ok(golden.approach.length >= 14 && golden.pull.length >= 9 && golden.state.length >= 24 && golden.profileCases.length >= 60 && golden.ledger.length >= 16);
  for (const v of golden.approach) { assert.equal(firstDiff(runApproach(v), v.expected), '', v.name); ops += v.ops.length; }
  for (const v of golden.pull) { assert.equal(firstDiff(runPull(v), v.expected), '', v.name); ops += v.ops.length; }
  for (const v of golden.profileCases) { assert.equal(firstDiff(runProfile(v), v.expected), '', v.name); ops++; }
  for (const v of golden.state) { assert.equal(firstDiff(runState(v, files), v.expected), '', v.name); ops += v.ops.length; }
  for (const v of golden.ledger) { assert.equal(firstDiff(runLedger(v, files), v.expected), '', v.name); ops += v.ops.length; }
  assert.ok(ops > 1900, `${ops} ops`);
});

const GODOT = process.env.GODOT ?? new URL('../../../NightfallContractsGodot/.tools/godot/editor/Godot_v4.7.2-stable_win64_console.exe', import.meta.url);
test('parity: Godot headless (GDScript) gives identical results for every golden vector', { skip: existsSync(GODOT) ? false : 'Godot binary not found (set GODOT)' }, async () => {
  const r = await compareParity(typeof GODOT === 'string' ? GODOT : fileURLToPath(GODOT));
  assert.deepEqual(r.problems, []); assert.equal(r.godotStatus, 0, r.godotSummary);
  assert.ok(r.vectors >= 125 && r.ops > 1900, `${r.vectors} vectors / ${r.ops} ops`);
  console.log(`# backpack parity: ${r.vectors} vectors, ${r.ops} ops identical (${r.godotSummary})`);
});
