// Procedural crawl and limp of the avatar NPC animation (extensions/avatar/crawl.js via createNPCAnimator gait input):
// the fall from standing, prone pose, planted hand pulls, one-arm and helpless variants, limp asymmetry, no NaN,
// determinism. docs/gore_system.md ("Mobility").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareRig } from '../src/vendor/extensions/avatar/rigdata.js';
import { createNPCAnimator, createCrawlGait, CRAWL_DEFAULTS } from '../src/vendor/extensions/avatar/index.js';
import { headsFromSidecar, fkPositions, poseToWorld } from '../src/vendor/extensions/humanoid/index.js';
import { qRotate, ry } from '../src/vendor/extensions/avatar/qx.js';

const rig = prepareRig(headsFromSidecar(JSON.parse(readFileSync(new URL('../public/avatar-assets/base_body.joints.json', import.meta.url), 'utf8'))));
const DT = 1 / 60;
const ALL = { leftArm: true, rightArm: true, leftLeg: true, rightLeg: true };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const finiteDeep = v => typeof v === 'number' ? Number.isFinite(v) : Array.isArray(v) ? v.every(finiteDeep)
  : v && typeof v === 'object' ? Object.values(v).every(finiteDeep) : true;

/** World joint positions of an animator frame placed at position/yaw/scale (tilt and offset included, as the entity does). */
function worldJoints(frame, position, yaw = 0, scale = 1) {
  assert.deepEqual(frame.tilt, [0, 0, 0]); assert.deepEqual(frame.offset, [0, 0, 0]);
  const P = fkPositions(rig.H, frame.pose), out = {};
  for (const [j, p] of Object.entries(P)) { const r = qRotate(ry(yaw), p); out[j] = [position[0] + r[0] * scale, position[1] + r[1] * scale, position[2] + r[2] * scale]; }
  return out;
}

/** Stand, then crawl forward along the yaw at `speed` m/s for `seconds` (the host moves the position). */
function run({ limbs = ALL, speed = 0.16, seconds = 8, yaw = 0.4, scale = 1, seed = 'z', standFor = 0.5 } = {}) {
  const animator = createNPCAnimator(rig, { seed });
  const frames = [];
  let position = [1, 0, -2];
  const dir = qRotate(ry(yaw), [0, 0, 1]);
  for (let t = 0; t < standFor; t += DT) animator.update({ position, yaw, scale, state: 'alert', aimPoint: [0, 1.6, 10] }, DT);
  for (let i = 0; i < seconds / DT; i++) {
    const frame = animator.update({ position, yaw, scale, speed, moving: true, state: 'alert', gait: 'crawl', limbs, aimPoint: [0, 1.6, 10] }, DT);
    frames.push({ frame, position: [...position], W: worldJoints(frame, position, yaw, scale) });
    if (frame.down >= 1) position = position.map((v, n) => v + dir[n] * speed * DT);
  }
  return frames;
}

test('a crawl starts with a fall from standing and ends prone, hips on the floor, head up', () => {
  const frames = run({ seconds: 4 });
  const first = frames[0], prone = frames.filter(f => f.frame.down >= 1);
  assert.ok(first.W.hips[1] > 0.7, `starts standing (hips ${first.W.hips[1]})`);
  assert.ok(first.frame.down < 0.05);
  const fallFrames = frames.findIndex(f => f.frame.down >= 1);
  assert.ok(Math.abs(fallFrames * DT - CRAWL_DEFAULTS.fallSeconds) < 0.1, `fall takes ${fallFrames * DT}s`);
  // the pelvis only goes down during the fall
  for (let i = 1; i < fallFrames; i++) assert.ok(frames[i].W.hips[1] <= frames[i - 1].W.hips[1] + 1e-3);
  for (const { W, frame } of prone) {
    assert.equal(frame.gait, 'crawl');
    assert.ok(W.hips[1] < 0.2 && W.hips[1] > 0.05, `hips near the floor (${W.hips[1]})`);
    assert.ok(W.head[1] > W.hips[1] + 0.25, 'head raised over the hips');
    const look = qRotate(poseToWorld(frame.pose.joints).head, [0, 0, 1]);
    assert.ok(look[2] > 0.6 && look[1] > -0.5, `head faces forward toward the target, not the floor (${look})`);
    for (const j of ['leftFoot', 'rightFoot', 'leftLowerLeg', 'rightLowerLeg']) assert.ok(W[j][1] > 0.02 && W[j][1] < 0.25, `${j} on the floor (${W[j][1]})`);
  }
});

test('hands plant ahead of the shoulders and stay planted (world-fixed) through the pull; the arms alternate', () => {
  const frames = run({ seconds: 8 }).filter(f => f.frame.down >= 1);
  const plants = { left: 0, right: 0 }, order = [];
  for (const side of ['left', 'right']) {
    const hand = side + 'Hand';
    let anchor = null, span = 0, spans = 0;
    for (const { frame, W, position } of frames) {
      const c = frame.contacts[hand];
      if (!c.planted) { if (span > 10) spans++; anchor = null; span = 0; continue; }
      assert.ok(dist(c.position, W[hand]) < 0.006, 'the posed hand is on its contact');
      assert.ok(W[hand][1] - position[1] < 0.06, 'planted hand on the floor');
      if (!anchor) {
        anchor = [...c.position];
        // planted ahead of the shoulder (character forward = yaw 0.4)
        const fwd = qRotate(ry(0.4), [0, 0, 1]), ahead = (c.position[0] - W[side + 'UpperArm'][0]) * fwd[0] + (c.position[2] - W[side + 'UpperArm'][2]) * fwd[2];
        if (span === 0 && frame.events.some(e => e.side === side)) assert.ok(ahead > 0.2, `lands ahead (${ahead})`);
      } else assert.ok(dist(anchor, c.position) < 1e-9, 'planted hand does not slide');
      span++;
    }
    assert.ok(spans >= 3, `${side} arm pulls repeatedly (${spans})`);
  }
  for (const { frame } of frames) for (const e of frame.events) { assert.equal(e.type, 'handplant'); plants[e.side]++; order.push(e.side); }
  assert.ok(plants.left >= 3 && plants.right >= 3);
  for (let i = 1; i < order.length; i++) assert.notEqual(order[i], order[i - 1], 'pulls alternate');
});

test('one-arm crawl pulls with the remaining arm only; the stump never plants', () => {
  const frames = run({ limbs: { ...ALL, leftArm: false, leftLeg: false }, seconds: 8 }).filter(f => f.frame.down >= 1);
  let rightPlants = 0;
  for (const { frame, W } of frames) {
    assert.equal(frame.contacts.leftHand.planted, false);
    assert.ok(!frame.events.some(e => e.side === 'left'));
    rightPlants += frame.events.filter(e => e.side === 'right').length;
    assert.ok(W.hips[1] < 0.2);
  }
  assert.ok(rightPlants >= 3, `right arm pulls (${rightPlants})`);
  // the body rolls into the one-sided pull
  const rolls = frames.map(f => qRotate(poseToWorld(f.frame.pose.joints).chest, [1, 0, 0])[1]);
  assert.ok(Math.max(...rolls) - Math.min(...rolls) > 0.04);
});

test('no arms and no legs: helpless, no contacts planted or events, stays put and finite', () => {
  const frames = run({ limbs: { leftArm: false, rightArm: false, leftLeg: false, rightLeg: false }, seconds: 4 });
  for (const { frame, W } of frames.filter(f => f.frame.down >= 1)) {
    assert.equal(frame.events.length, 0);
    for (const c of Object.values(frame.contacts)) assert.equal(c.planted, false);
    assert.ok(W.hips[1] < 0.2 && finiteDeep(frame));
  }
});

test('legs-only crawl shoves with the legs; bone lengths are preserved in every variant', () => {
  const variants = [ALL, { ...ALL, rightLeg: false }, { ...ALL, leftArm: false, rightArm: false }];
  for (const limbs of variants) {
    for (const { frame } of run({ limbs, seconds: 3 })) {
      const P = fkPositions(rig.H, frame.pose);
      for (const [a, b] of [['leftUpperArm', 'leftLowerArm'], ['rightLowerArm', 'rightHand'], ['leftUpperLeg', 'leftLowerLeg'], ['rightLowerLeg', 'rightFoot'], ['hips', 'spine']]) {
        assert.ok(Math.abs(dist(P[a], P[b]) - dist(rig.H[a], rig.H[b])) < 1e-6);
      }
    }
  }
  const legsOnly = run({ limbs: { ...ALL, leftArm: false, rightArm: false }, seconds: 5 }).filter(f => f.frame.down >= 1);
  const knee = legsOnly.map(f => f.W.leftFoot[2] - f.W.hips[2]);
  assert.ok(Math.max(...knee) - Math.min(...knee) > 0.1, 'feet draw up and push');
});

test('crawl and limp never produce NaN, even from hostile input', () => {
  const animator = createNPCAnimator(rig, { seed: 3 });
  const inputs = [
    { gait: 'crawl', position: [NaN, 0, 0], yaw: Infinity, speed: NaN, moving: true },
    { gait: 'crawl', limbs: { leftArm: false }, speed: 50, moving: true, scale: 0 },
    { gait: 'crawl', aimPoint: [0, 0, 0], speed: 0.2, moving: true, state: 'dead' },
    { gait: 'limp', limpSide: 'right', speed: 1, moving: true },
    { gait: 'crawl', limbs: { leftArm: false, rightArm: false, leftLeg: false, rightLeg: false }, moving: true, speed: 1 },
    { gait: 'walk', speed: 1.2, moving: true },
  ];
  for (const input of inputs) for (const dt of [0, DT, 0.5, NaN, DT, DT]) {
    const frame = animator.update(input, dt);
    assert.ok(finiteDeep(frame), JSON.stringify(input));
  }
  const gait = createCrawlGait(rig);
  for (let i = 0; i < 50; i++) assert.ok(finiteDeep(gait.update({ moving: true, speed: 0.3, position: [0, 0, i * 0.01] }, DT)));
});

test('the crawl is deterministic for a seed and inputs', () => {
  const a = run({ seconds: 3, seed: 'd' }).map(f => f.frame), b = run({ seconds: 3, seed: 'd' }).map(f => f.frame);
  assert.deepEqual(a, b);
});

test('dying while crawling settles prone and stays still', () => {
  const animator = createNPCAnimator(rig, { seed: 5 });
  for (let i = 0; i < 120; i++) animator.update({ gait: 'crawl', moving: true, speed: 0.15, position: [0, 0, i * 0.0025] }, DT);
  let last;
  for (let i = 0; i < 90; i++) last = animator.update({ gait: 'crawl', state: 'dead', position: [0, 0, 0.3] }, DT);
  assert.equal(last.death, 1);
  const again = animator.update({ gait: 'crawl', state: 'dead', position: [0, 0, 0.3] }, DT);
  assert.deepEqual(again.pose, last.pose);
  assert.ok(fkPositions(rig.H, last.pose).hips[1] < 0.2);
});

test('limp: the hurt leg gets a short stance, a low swing and a hip drop', () => {
  const animator = createNPCAnimator(rig, { seed: 9 });
  let position = [0, 0, 0];
  const stance = { left: 0, right: 0 }, lift = { left: 0, right: 0 }, hipsY = [];
  for (let i = 0; i < 600; i++) {
    const frame = animator.update({ gait: 'limp', limpSide: 'left', position, speed: 0.6, moving: true, state: 'alert' }, DT);
    position = [0, 0, position[2] + 0.6 * DT];
    if (i < 120) continue;
    for (const side of ['left', 'right']) {
      if (frame.contacts[side].planted) stance[side]++;
      lift[side] = Math.max(lift[side], fkPositions(rig.H, frame.pose)[side + 'Foot'][1]);
    }
    hipsY.push(fkPositions(rig.H, frame.pose).hips[1]);
  }
  assert.ok(stance.left < stance.right * 0.8, `short stance on the hurt leg (${stance.left} vs ${stance.right})`);
  assert.ok(lift.left < lift.right - 0.02, `hurt foot swings low (${lift.left} vs ${lift.right})`);
  assert.ok(Math.max(...hipsY) - Math.min(...hipsY) > 0.03, 'hip drop bobs the pelvis');
  // a normal walk is symmetric
  const walk = createNPCAnimator(rig, { seed: 9 }), even = { left: 0, right: 0 };
  position = [0, 0, 0];
  for (let i = 0; i < 600; i++) {
    const frame = walk.update({ position, speed: 0.6, moving: true, state: 'alert' }, DT);
    position = [0, 0, position[2] + 0.6 * DT];
    if (i >= 120) for (const side of ['left', 'right']) if (frame.contacts[side].planted) even[side]++;
  }
  assert.ok(Math.abs(even.left - even.right) < even.right * 0.1);
});
