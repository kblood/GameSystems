import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TYPE_IDS, typeSpec, parseSpec, BLOCKS, expandBlock, allTypes, FURNITURE_TIERS, createFurnitureSet, furnitureExtension, handleGrip, partGrips } from '../../extensions/furniture/index.js';
import { buildFurnitureMesh, disposeFurnitureCache } from '../src/vendor/extensions/furniture/mesh.js';
import { createMechanicsSystem } from '../../extensions/mechanics/index.js';
import { world, drag, fakeAudio } from './furniture-fixture.js';

const clone = o => JSON.parse(JSON.stringify(o));
const v3 = THREE.Vector3;

// ---------------------------------------------------------------- data model
test('at least 8 types, all validate, drawer and door are reusable blocks', () => {
  assert.ok(TYPE_IDS.length >= 8);
  for (const id of ['cabinet', 'dresser', 'wardrobe', 'desk', 'fridge', 'safe', 'locker', 'chest', 'door', 'drawer']) assert.ok(TYPE_IDS.includes(id), id);
  assert.ok(BLOCKS.door && BLOCKS.drawer);
  for (const id of TYPE_IDS) { const s = typeSpec(id); assert.equal(s.id, id); assert.ok(s.mass > 0); assert.deepEqual(parseSpec(clone(s)), s, `${id} parseSpec idempotent`); }
  assert.equal(allTypes().length, TYPE_IDS.length);
  assert.deepEqual([...FURNITURE_TIERS], ['minimal', 'low', 'mid', 'high']);
  assert.equal(typeof expandBlock, 'function');
});

test('validation rejects bad data with a readable path', () => {
  const base = typeSpec('cabinet');
  const doorIndex = base.parts.findIndex(p => p.id === 'doorL');
  const bad = (mut, re = /FurnitureSpec/) => { const s = clone(base); mut(s); assert.throws(() => parseSpec(s), re); };
  bad(s => { s.size = [1, -1, 1]; });
  bad(s => { s.parts[doorIndex].mechanism.max = -1; });
  bad(s => { s.parts.push(clone(s.parts[doorIndex])); });
  bad(s => { s.parts[doorIndex].material = 'unobtainium'; });
  bad(s => { s.parts[doorIndex].mechanism.type = 'teleport'; });
  bad(s => { s.locks = [{ id: 'l', kind: 'code', parts: ['nope'], code: '1' }]; });
  bad(s => { s.locks = [{ id: 'l', kind: 'laser', parts: ['doorL'] }]; });
  assert.throws(() => parseSpec(null), /FurnitureSpec/);
  assert.throws(() => typeSpec('nonexistent'));
  const s = clone(typeSpec('door')); s.parts.find(p => p.id === 'door').mechanism.resistance = 500; assert.throws(() => parseSpec(s), /FurnitureSpec/);
});

// ---------------------------------------------------------------- mechanics
test('drawer: a hand opens it, stops at the limit, clunks and fires events', () => {
  const a = fakeAudio(), w = world({ audio: a }), f = w.make('dresser');
  const res = drag(w, f, 'drawer1', 'R', [0, 0, 0.6], 1.5, 72, { hold: true });
  assert.ok(res.ok);
  const st = f.state('drawer1');
  assert.ok(st.value <= f.part('drawer1').max + 1e-9 && st.value > 0.3, `value ${st.value}`);
  assert.ok(f.isOpen('drawer1'));
  assert.ok(w.events.some(e => e.type === 'opened' && e.partId === 'drawer1'));
  f.release('drawer1', 'R'); w.run(1);
  assert.ok(f.isOpen('drawer1'), 'drawers stay open (no spring)');
  assert.ok(f.isAccessible('drawer1'));
  assert.ok(a.contacts.length >= 1);
});

test('self-closing fridge door closes on its own, clunks and fires closed', () => {
  const a = fakeAudio(), w = world({ audio: a }), f = w.make('fridge');
  drag(w, f, 'door', 'R', [-0.2, 0, 0.45], 1.2);
  assert.ok(f.state('door').value > 0.4);
  w.run(8);
  assert.equal(f.state('door').value, 0);
  assert.ok(w.events.some(e => e.type === 'closed'));
  assert.ok(a.contacts.length >= 1);
});

test('safe door needs two hands; one hand cannot open it, two can', () => {
  const w = world(), f = w.make('safe', { id: 's1' });
  assert.equal(f.enterCode('combo', '2580').ok, true);
  assert.equal(f.isLocked('door'), false);
  const h = f.handleWorld('door', 0);
  f.grab('door', 'L', h);
  for (let i = 0; i < 100; i++) { f.moveHand('door', 'L', [h[0] + 0.1, h[1], h[2] + 0.5]); w.run(1 / 72); }
  const oneHand = f.state('door').value;
  assert.ok(oneHand < 0.15, `one hand moved door to ${oneHand}`);
  f.grab('door', 'R', f.handleWorld('door', 0));
  for (let i = 0; i < 160; i++) { const t = [h[0] + 0.15, h[1], h[2] + 0.55]; f.moveHand('door', 'L', t); f.moveHand('door', 'R', t); w.run(1 / 72); }
  assert.ok(f.state('door').value > oneHand + 0.3, `two hands: ${f.state('door').value}`);
});

for (const hz of [36, 72, 144]) {
  test(`dt independence @${hz} Hz: a hinge door swings to the same rest`, () => {
    const ref = (() => { const w = world(), f = w.make('cabinet'); f.setOpen('doorL', true); w.run(6, 288); return f.state('doorL').value; })();
    const w = world(), f = w.make('cabinet'); f.setOpen('doorL', true); w.run(6, hz);
    assert.ok(Math.abs(f.state('doorL').value - ref) < 0.08, `${hz}: ${f.state('doorL').value} vs ${ref}`);
  });
  test(`dt independence @${hz} Hz: a drawer pulled by a hand ends at the stop`, () => {
    const w = world(), f = w.make('dresser');
    drag(w, f, 'drawer2', 'R', [0, 0, 0.7], 1.5, hz);
    assert.ok(Math.abs(f.state('drawer2').value - f.part('drawer2').max) < 0.03, `${hz}: ${f.state('drawer2').value}`);
  });
}

test('step rejects bad dt', () => {
  const w = world(), f = w.make('drawer');
  assert.throws(() => f.step(-1), RangeError); assert.throws(() => f.step(NaN), RangeError);
});

test('mechanics.moveHand maxForce is additive: default unchanged, cap limits force', () => {
  const mk = () => { const m = createMechanicsSystem({ emit() {} }); m.add('h', { kind: 'hinge', min: 0, max: 1.5, inertia: 1, damping: 0.5, resistance: 0, axis: [0, 1, 0], origin: [0, 0, 0] }); return m; };
  const run = cap => { const m = mk(); m.grab('h', 'a', [1, 0, 0]); for (let i = 0; i < 12; i++) { cap === undefined ? m.moveHand('h', 'a', [0, 0, -1], 80) : m.moveHand('h', 'a', [0, 0, -1], 80, cap); m.step(1 / 72); } return m.state('h').value; };
  assert.ok(run(0.2) < run() - 0.02, `${run(0.2)} vs ${run()}`);
  assert.equal(run(undefined), run());
});

// ---------------------------------------------------------------- locks
test('key lock: wrong key rejected with hook, right key unlocks, locked door will not move', () => {
  const rejects = [], w = world({ onReject: r => rejects.push(r.reason) }), f = w.make('locker');
  assert.equal(f.isLocked('door'), true);
  assert.equal(f.tryKey('lock', 'key_wrong').reason, 'WRONG_KEY');
  assert.ok(rejects.includes('WRONG_KEY'));
  drag(w, f, 'door', 'R', [-0.2, 0, 0.5], 1);
  assert.ok(f.state('door').value < 0.02);
  assert.equal(f.tryKey('lock', 'key_locker').ok, true);
  assert.equal(f.isLocked('door'), false);
  assert.ok(w.events.some(e => e.type === 'unlocked'));
  drag(w, f, 'door', 'R', [-0.2, 0, 0.5], 1.2, 72, { hold: true });
  assert.ok(f.state('door').value > 0.3);
  assert.equal(f.tryKey('lock', 'key_locker').ok, false, 'cannot lock an open door');
  f.release('door', 'R'); f.setOpen('door', false); w.run(4);
  assert.equal(f.state('door').value, 0);
  assert.equal(f.tryKey('lock', 'key_locker').ok, true);
  assert.equal(f.isLocked('door'), true);
  assert.ok(w.events.some(e => e.type === 'locked'));
});

test('code lock: wrong codes count, lockout after max attempts, timer releases', () => {
  const w = world(), f = w.make('safe');
  for (let i = 0; i < 4; i++) assert.equal(f.enterCode('combo', '0000').reason, 'WRONG_CODE');
  assert.equal(f.enterCode('combo', '0000').reason, 'LOCKED_OUT');
  assert.equal(f.enterCode('combo', '2580').reason, 'LOCKED_OUT');
  w.run(31);
  assert.equal(f.enterCode('combo', '2580').ok, true);
  assert.equal(f.isLocked('door'), false);
  assert.equal(f.tryKey('combo', 'x').reason, 'NOT_KEYED');
  assert.equal(f.enterCode('nope', '1').reason, 'UNKNOWN_LOCK');
});

test('power lock follows power state', () => {
  const s = clone(typeSpec('door')); s.locks = [{ id: 'p', kind: 'power', mode: 'secure', parts: ['door'], locked: false }];
  let on = false; const w = world({ powerOf: () => on }), f = w.make(s);
  assert.equal(f.isLocked('door'), false);
  on = true; w.run(0.1); assert.equal(f.isLocked('door'), true);
  assert.equal(f.setLocked('p', false).reason, 'POWERED');
  on = false; w.run(0.1); assert.equal(f.isLocked('door'), false);
});

// ---------------------------------------------------------------- contents
test('contents: drawer must be open; same reject reasons as the backpack', () => {
  const rejects = [], w = world({ onReject: r => rejects.push(r.reason) }), f = w.make('dresser');
  for (const id of ['b1', 'b2', 'b3', 'b4', 'b5']) w.item(id);
  w.item('big', 'bottle', [1, 1, 1]);
  assert.equal(f.store('b1', 'drawer1').ok, false);
  assert.ok(rejects.includes('NOT_ACCESSIBLE'), rejects.join());
  drag(w, f, 'drawer1', 'R', [0, 0, 0.7], 1.5); w.run(0.5);
  assert.ok(f.isAccessible('drawer1'));
  for (const id of ['b1', 'b2', 'b3', 'b4']) assert.equal(f.store(id, 'drawer1').ok, true, id);
  assert.equal(f.store('b5', 'drawer1').reason, 'FULL');
  assert.equal(f.store('big', 'drawer1').ok, false);
  assert.equal(f.itemCount(), 4);
  assert.equal(w.events.filter(e => e.type === 'itemStored').length, 4);
  const got = f.retrieve('drawer1', { itemId: 'b2' });
  assert.equal(got.ok, true); assert.equal(got.itemId, 'b2');
  assert.ok(w.events.some(e => e.type === 'itemRemoved'));
  assert.equal(f.itemCount(), 3);
  assert.equal(f.store('b1', 'body').ok, false);
});

test('contents without an inventory: NO_INVENTORY', () => {
  const w = world({ inventory: false }), f = w.make('dresser');
  assert.equal(f.store('x', 'drawer1').reason, 'NO_INVENTORY');
});

// ---------------------------------------------------------------- tiers
test('tiers: minimal freezes physics (state only), proxies only at high, <= 12', () => {
  const w = world({ quality: 'minimal' }), f = w.make('dresser', { quality: 'minimal' });
  f.grab('drawer1', 'R', f.handleWorld('drawer1'));
  assert.ok(f.state('drawer1').value > 0.3, 'minimal: a grab toggles the state');
  f.setOpen('drawer1', false); w.run(0.5);
  assert.equal(f.state('drawer1').value, 0);
  f.setOpen('drawer1', true); w.run(0.5);
  assert.ok(f.state('drawer1').value > 0.3, 'setOpen places the value at minimal');
  f.setQuality('mid'); assert.deepEqual(f.proxies(), []);
  f.setQuality('high');
  for (let i = 0; i < 4; i++) { w.item(`p${i}`); f.store(`p${i}`, 'drawer1'); }
  const px = f.proxies(); assert.ok(px.length > 0 && px.length <= 12);
  assert.ok(f.proxies(2).length <= 2);
  f.setQuality('low'); assert.equal(f.proxies().length, 0);
  assert.throws(() => f.setQuality('ultra'));
});

// ---------------------------------------------------------------- audio hooks
test('audio: events reach a fake audio host; no audio host still works', () => {
  const a = fakeAudio(), w = world({ audio: a }), f = w.make('cabinet');
  f.setOpen('doorL', true); w.run(3);
  assert.ok(a.contacts.length > 0 || a.plays.length > 0);
  for (const c of a.contacts) { assert.ok(Number.isFinite(c.speed)); assert.ok(Array.isArray(c.position)); }
  const w2 = world(), g = w2.make('cabinet'); g.setOpen('doorL', true); w2.run(2);
  assert.ok(g.state('doorL').value > 0);
});

// ---------------------------------------------------------------- blocking hook
test('blocking hook stops a part and reports it', () => {
  const w = world({ isBlocked: info => info.partId === 'drawer1' && info.value > 0.1 }), f = w.make('dresser');
  drag(w, f, 'drawer1', 'R', [0, 0, 0.7], 1.5); w.run(0.3);
  assert.ok(f.state('drawer1').value <= 0.11, `value ${f.state('drawer1').value}`);
  assert.ok(w.events.some(e => e.type === 'blocked'));
  drag(w, f, 'drawer2', 'R', [0, 0, 0.7], 1.5);
  assert.ok(f.state('drawer2').value > 0.3);
});

// ---------------------------------------------------------------- checkpoint
test('checkpoint roundtrip: positions, locks, contents; own state only; rejects foreign data', () => {
  const w = world(), f = w.make('dresser', { id: 'd1' }), s = w.make('safe', { id: 's1' });
  drag(w, f, 'drawer1', 'R', [0, 0, 0.7], 1.5); w.item('b1'); f.store('b1', 'drawer1');
  const cf = JSON.parse(JSON.stringify(f.capture())), cs = JSON.parse(JSON.stringify(s.capture()));
  assert.deepEqual(Object.keys(cf).sort(), ['containers', 'id', 'locks', 'parts', 'schema', 'type']);
  const v = f.state('drawer1').value;
  f.retrieve('drawer1', { itemId: 'b1' }); f.setOpen('drawer1', false); w.run(2); s.enterCode('combo', '2580');
  f.restore(cf); s.restore(cs);
  assert.ok(Math.abs(f.state('drawer1').value - v) < 1e-9);
  assert.equal(f.itemCount(), 1); assert.equal(s.isLocked('door'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.capture())), cf);
  assert.throws(() => f.restore(cs), /another piece/);
  const bad = clone(cf); bad.parts.drawer1.value = 99; assert.throws(() => f.restore(bad));
  const bad2 = clone(cf); delete bad2.parts.drawer2; assert.throws(() => f.restore(bad2));
  assert.deepEqual(JSON.parse(JSON.stringify(f.capture())), cf, 'failed restore changed nothing');
});

test('furniture set: capture/restore, duplicate id, dispose', () => {
  const w = world(), set = createFurnitureSet(w.host);
  const a = set.add('dresser', { id: 'a' }); set.add('chest', { id: 'b' });
  assert.throws(() => set.add('chest', { id: 'b' }), /Duplicate/);
  const run = sec => { for (let i = 0; i < sec * 72; i++) { set.step(1 / 72); w.mechanics.step(1 / 72); } };
  a.setOpen('drawer1', true); run(1);
  const snap = JSON.parse(JSON.stringify(set.capture()));
  a.setOpen('drawer1', false); run(2); assert.ok(a.state('drawer1').value < 0.1);
  set.restore(snap); assert.ok(a.state('drawer1').value > 0.2);
  assert.equal(set.remove('b'), true); assert.throws(() => set.restore(snap));
  set.dispose(); assert.deepEqual(set.ids, []);
});

test('extension manifest: id, requires mechanics, tiers', () => {
  const ext = furnitureExtension();
  assert.equal(ext.id, 'furniture'); assert.deepEqual(ext.requires, ['mechanics']); assert.deepEqual(ext.quality, [...FURNITURE_TIERS]);
});

test('dispose is idempotent and later steps are harmless', () => {
  const w = world(), f = w.make('dresser');
  f.dispose(); f.dispose(); f.step(0.1);
});

// ---------------------------------------------------------------- grips + geometry
test('grips: bar uses read-only pole poses, knob descriptor, library untouched', () => {
  const knob = typeSpec('dresser').parts.find(p => p.id === 'drawer1').handles[0];
  assert.equal(handleGrip(knob, 'left').mode, 'pinch');
  const wardrobe = typeSpec('wardrobe'), bar = wardrobe.parts.find(p => p.id === 'doorL').handles[0];
  const g = handleGrip(bar, 'right'); assert.equal(g.mode, 'wrap'); assert.ok(g.pose);
  const q0 = g.pose.quat[0]; g.pose.quat[0] = 99; assert.equal(handleGrip(bar, 'right').pose.quat[0], q0);
  assert.ok(partGrips(wardrobe.parts.find(p => p.id === 'doorL')).every(x => x.twoHand));
  assert.throws(() => handleGrip(bar, 'middle'), RangeError);
});

test('all types build geometry with few draw calls and a shared cache', () => {
  let total = 0;
  for (const id of TYPE_IDS) {
    const m = buildFurnitureMesh(id, { position: [1, 0, 2], yaw: 0.3 });
    assert.ok(m.stats.drawCalls >= 1 && m.stats.drawCalls <= 6, `${id}: ${m.stats.drawCalls}`);
    assert.ok(m.stats.triangles > 10);
    total += m.stats.drawCalls;
    m.group.rotation.y = 0; m.group.position.set(0, 0, 0); m.group.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(m.group).getSize(new v3()), spec = typeSpec(id);
    assert.ok(size.y > spec.size[1] * 0.8 && size.y < spec.size[1] * 1.3, `${id} height ${size.y}`);
    m.dispose();
  }
  assert.ok(total <= TYPE_IDS.length * 6);
  disposeFurnitureCache();
});

test('mesh update follows runtime values and does not allocate', () => {
  const w = world(), f = w.make('dresser'), m = buildFurnitureMesh('dresser');
  const piv = m.pivots.get('drawer1'), z0 = piv.position.z;
  f.setOpen('drawer1', true); w.run(1); m.update(f);
  assert.ok(piv.position.z > z0 + 0.2);
  const hinge = buildFurnitureMesh('cabinet'), g = w.make('cabinet'); g.setOpen('doorL', true); w.run(2); hinge.update(g);
  assert.ok(hinge.pivots.get('doorL').quaternion.w < 0.99);
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 20000; i++) hinge.update(g);
  assert.ok(process.memoryUsage().heapUsed - h0 < 8e6, 'update allocates nothing noticeable');
  m.dispose(); hinge.dispose(); disposeFurnitureCache();
});
