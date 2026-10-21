// Hit reaction (extensions/hitreact, step 1): config, springs, impulse -> offsets, hit chains, stability thresholds and
// physical states, balance step, planted feet. Pure modules only (no three.js, no physics). The ragdoll is in
// hitreact-ragdoll.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_HIT_REACT_CONFIG, resolveHitReactConfig, validateHitReactConfig, createHitReaction, hitChain, regionClass, springStep, peakDisplacement,
  chooseStep, applyReaction, blendPoses, solveLeg, PHYSICAL_STATES } from '../../extensions/hitreact/index.js';
import { PHYSICAL_STATES as AI_STATES } from '../../extensions/ai/index.js';
import { headsFromSidecar, fkPositions, poseToWorld, qAngle } from '../../extensions/humanoid/index.js';

const H = headsFromSidecar(JSON.parse(readFileSync(new URL('../public/avatar-assets/base_body.joints.json', import.meta.url), 'utf8')));
const DT = 1 / 60, PISTOL = 2.7;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const finiteDeep = v => typeof v === 'number' ? Number.isFinite(v) : Array.isArray(v) ? v.every(finiteDeep) : v && typeof v === 'object' ? Object.values(v).every(finiteDeep) : true;
const REST = { joints: {}, root: [0, 0, 0] }, P0 = fkPositions(H, REST);
const chestHit = (impulse = PISTOL, extra = {}) => ({ region: 'chest', point: [0.04, 1.3, 0.12], direction: [0, 0, -1], impulse, heads: P0, ...extra });
function run(r, seconds, onFrame) { let f; for (let i = 0; i < Math.round(seconds / DT); i++) { f = r.update(DT); onFrame?.(f, i); } return f; }

test('config: defaults are valid, the ragdoll is opt-in (off), layers merge and problems are named', () => {
  assert.deepEqual(validateHitReactConfig(DEFAULT_HIT_REACT_CONFIG), { ok: true, errors: [] });
  assert.equal(DEFAULT_HIT_REACT_CONFIG.ragdoll.enabled, false);
  assert.equal(DEFAULT_HIT_REACT_CONFIG.ragdoll.shotImpulse, 4.5);
  const cfg = resolveHitReactConfig({ chain: { kick: 3 } }, { ragdoll: { enabled: true } });
  assert.equal(cfg.chain.kick, 3); assert.equal(cfg.chain.falloff, DEFAULT_HIT_REACT_CONFIG.chain.falloff); assert.equal(cfg.ragdoll.enabled, true);
  assert.equal(DEFAULT_HIT_REACT_CONFIG.chain.kick, 7, 'defaults are not mutated');
  assert.throws(() => resolveHitReactConfig({ chain: { damping: -1 }, ragdoll: { enabled: 'yes' } }), /chain\.damping.*ragdoll\.enabled/);
  assert.throws(() => resolveHitReactConfig({ stability: { destabilizedAt: 5, downAt: 1 } }), /destabilizedAt must not exceed/);
  assert.throws(() => resolveHitReactConfig(7), /must be objects/);
});

test('the physical states are the ai extension states', () => {
  assert.deepEqual([...PHYSICAL_STATES], [...AI_STATES]);
});

test('springs: implicit steps stay stable at any dt, decay to rest, and the analytic peak matches a fine simulation', () => {
  for (const dt of [1 / 240, 1 / 60, 0.1, 0.5]) {
    const x = [0, 0, 0], v = [3, 0, 0];
    for (let i = 0; i < 2000; i++) { springStep(x, v, dt, 2.6, 0.42); assert.ok(Math.abs(x[0]) < 1, `bounded at dt ${dt}`); }
    assert.ok(Math.abs(x[0]) < 1e-6 && Math.abs(v[0]) < 1e-5, `settles at dt ${dt}`);
  }
  for (const [f, z] of [[1.6, 0.75], [2.6, 0.42], [1, 1], [1, 2]]) {
    const x = [0, 0, 0], v = [1, 0, 0]; let peak = 0;
    for (let i = 0; i < 20000; i++) { springStep(x, v, 1e-4, f, z); peak = Math.max(peak, x[0]); }
    assert.ok(Math.abs(peakDisplacement(1, f, z) - peak) / peak < 0.01, `peak f ${f} z ${z}: ${peakDisplacement(1, f, z)} vs ${peak}`);
  }
  assert.equal(peakDisplacement(0, 2, 0.5), 0);
});

test('hit chains run from the hit region up to the spine', () => {
  assert.deepEqual(hitChain('leftLowerArm'), ['leftLowerArm', 'leftUpperArm', 'leftShoulder', 'upperChest', 'chest', 'spine']);
  assert.deepEqual(hitChain('rightHand'), ['rightHand', 'rightLowerArm', 'rightUpperArm', 'rightShoulder', 'upperChest', 'chest', 'spine']);
  assert.deepEqual(hitChain('cranium'), ['head', 'neck', 'upperChest', 'chest', 'spine']);
  assert.deepEqual(hitChain('neck'), ['neck', 'upperChest', 'chest', 'spine']);
  assert.deepEqual(hitChain('leftUpperLeg'), ['hips', 'spine']);
  assert.deepEqual(hitChain('belly'), ['hips', 'spine']);
  assert.deepEqual(hitChain('chestLeft'), ['upperChest', 'chest', 'spine']);
  for (const r of ['leftLowerArm', 'cranium', 'leftFoot', 'chest', 'belly']) assert.ok(hitChain(r).at(-1) === 'spine');
  assert.deepEqual(['jaw', 'rightHand', 'leftFoot', 'belly'].map(regionClass), ['head', 'arm', 'leg', 'chest']);
});

test('a pistol chest hit pushes the chain and the pelvis along the impulse, then decays back to the animated pose', () => {
  const r = createHitReaction(resolveHitReactConfig());
  const res = r.hit(chestHit());
  assert.equal(res.ignored, false); assert.ok(Math.abs(res.kick - PISTOL * DEFAULT_HIT_REACT_CONFIG.impulseScale) < 1e-9);
  let maxRoot = 0, minZ = 0, maxAngle = 0, last;
  last = run(r, 3, f => {
    maxRoot = Math.max(maxRoot, Math.hypot(...f.root)); minZ = Math.min(minZ, f.root[2]);
    for (const v of Object.values(f.offsets)) maxAngle = Math.max(maxAngle, Math.hypot(...v));
  });
  assert.ok(minZ < -0.01, `pelvis pushed back along -Z (${minZ})`);
  assert.ok(maxRoot <= DEFAULT_HIT_REACT_CONFIG.root.maxOffset + 1e-9);
  assert.ok(maxAngle > 0.05 && maxAngle <= DEFAULT_HIT_REACT_CONFIG.chain.maxAngle + 1e-9, `chain turned ${maxAngle}`);
  assert.equal(last.active, false, 'settled');
  assert.deepEqual(last.offsets, {});
  // a stronger hit pushes further (monotonic in the impulse)
  const peakFor = impulse => { const q = createHitReaction(resolveHitReactConfig()); q.hit(chestHit(impulse)); let m = 0; run(q, 1, f => { m = Math.max(m, Math.hypot(...f.root)); }); return m; };
  assert.ok(peakFor(1) < peakFor(2.7) && peakFor(2.7) < peakFor(6));
});

test('the lever arm sets the turn axis: a hit right of the spine twists the trunk the other way than a hit left of it', () => {
  const axisFor = x => { const r = createHitReaction(resolveHitReactConfig()); r.hit(chestHit(PISTOL, { point: [x, 1.25, 0.12] })); return r.update(DT).offsets.spine[1]; };
  assert.ok(axisFor(0.15) * axisFor(-0.15) < 0, 'opposite yaw for left / right hits');
});

test('states: a chest hit staggers (destabilized) and recovers; an arm graze does not; the state is the ai meaning', () => {
  const r = createHitReaction(resolveHitReactConfig());
  r.hit({ region: 'leftHand', point: [0.6, 1.0, 0.1], direction: [0, 0, -1], impulse: PISTOL, heads: P0 });
  assert.equal(r.state, 'standing', 'an arm hit alone does not stagger');
  r.hit(chestHit());
  assert.equal(r.state, 'destabilized');
  const changes = [];
  run(r, 3, f => { if (f.changed) changes.push(`${f.changed}->${f.state}`); });
  assert.deepEqual(changes, ['standing->destabilized', 'destabilized->standing']);
});

test('many hits in a short window, or one large impulse, knock the body down; it recovers through recovering', () => {
  const cfg = resolveHitReactConfig();
  const r = createHitReaction(cfg), changes = [];
  for (let i = 0; i < cfg.stability.downHits; i++) { r.hit({ region: 'leftHand', impulse: 0.5, direction: [0, 0, -1] }); run(r, 0.1); }
  assert.equal(r.state, 'downed', 'downHits within hitWindow');
  const fall = cfg.downed.fallSeconds + cfg.downed.seconds;
  run(r, fall + cfg.downed.recoverSeconds + 0.3, (f, i) => { if (f.changed) changes.push([`${f.changed}->${f.state}`, +(i * DT).toFixed(2)]); });
  assert.deepEqual(changes.map(c => c[0]), ['downed->recovering', 'recovering->standing']);
  assert.ok(Math.abs(changes[0][1] - (fall - 0.1)) < 0.05, `downed for its time ${JSON.stringify(changes)}`);   // the last hit's 0.1 s already ran
  const big = createHitReaction(cfg);
  big.hit(chestHit(cfg.stability.downAt / cfg.impulseScale + 0.1));
  assert.equal(big.state, 'downed', 'instability past downAt');
  // with a ragdoll the host decides when the body has settled
  const held = createHitReaction(cfg, { externalRecovery: true });
  held.hit(chestHit(20));
  run(held, 10);
  assert.equal(held.state, 'downed');
  held.recover(); assert.equal(held.state, 'recovering');
});

test('the IK knockdown slumps the body with the feet still planted; recovering lifts it back', () => {
  const cfg = resolveHitReactConfig(), r = createHitReaction(cfg);
  r.hit(chestHit(30));
  const f = run(r, cfg.downed.fallSeconds + 0.1);
  assert.equal(f.state, 'downed'); assert.equal(f.collapse, 1);
  const P = fkPositions(H, applyReaction(REST, H, f, cfg));
  assert.ok(P.hips[1] < P0.hips[1] - 0.3, `pelvis drops (${P.hips[1]})`);
  for (const s of ['left', 'right']) assert.ok(dist(P[`${s}Foot`], P0[`${s}Foot`]) < 0.005, `${s} foot planted`);
  const end = run(r, cfg.downed.seconds + cfg.downed.recoverSeconds + 0.2);
  assert.equal(end.state, 'standing'); assert.equal(end.collapse, 0);
});

test('inert (dead) ignores hits; reset brings it back', () => {
  const r = createHitReaction(resolveHitReactConfig());
  r.kill(); assert.equal(r.state, 'inert');
  assert.equal(r.hit(chestHit(50)).ignored, true);
  run(r, 5); assert.equal(r.state, 'inert');
  r.reset(); assert.equal(r.state, 'standing');
  assert.throws(() => r.setState('lying'), /one of standing/);
  const off = createHitReaction(resolveHitReactConfig({ enabled: false }));
  assert.equal(off.hit(chestHit(50)).ignored, true);
});

test('balance step: a large push steps the leading / trailing foot out and back; a pistol shot does not step', () => {
  const cfg = resolveHitReactConfig();
  const small = createHitReaction(cfg); assert.equal(small.hit(chestHit()).step, false);
  const r = createHitReaction(cfg);
  assert.equal(r.hit(chestHit(7)).step, true);
  const phases = new Set(); let side = null, maxOut = 0, maxLift = 0;
  run(r, 3, f => { if (f.step) { phases.add(f.step.phase); side = f.step.side; maxOut = Math.max(maxOut, Math.hypot(f.step.offset[0], f.step.offset[2])); maxLift = Math.max(maxLift, f.step.offset[1]); } });
  assert.deepEqual([...phases], ['out', 'hold', 'back']);
  assert.ok(maxOut >= cfg.balance.minStep - 1e-9 && maxOut <= cfg.balance.maxStep + 1e-9, `step length ${maxOut}`);
  assert.ok(maxLift > 0.5 * cfg.balance.stepHeight);
  assert.ok(side === 'left' || side === 'right');
  // sideways pushes step with the leading foot (+X is the character's left)
  assert.equal(chooseStep([1, 0, 0.1], 0.1, cfg.balance, P0).side, 'left');
  assert.equal(chooseStep([-1, 0, 0], 0.1, cfg.balance, P0).side, 'right');
  assert.equal(chooseStep([0, 1, 0], 0.1, cfg.balance, P0), null, 'no horizontal push, no step');
});

test('planted feet: while the pelvis and trunk are pushed, the ankles stay where the animation put them (except a stepping foot)', () => {
  const cfg = resolveHitReactConfig(), r = createHitReaction(cfg);
  r.hit(chestHit(6, { direction: [0.4, 0, -1] }));
  let slip = 0, hipTravel = 0, stepTravel = 0;
  run(r, 2, f => {
    const pose = applyReaction(REST, H, f, cfg), P = fkPositions(H, pose);
    assert.ok(finiteDeep(pose));
    hipTravel = Math.max(hipTravel, dist(P.hips, P0.hips));
    for (const s of ['left', 'right']) {
      const d = dist(P[`${s}Foot`], P0[`${s}Foot`]);
      if (f.step?.side === s) stepTravel = Math.max(stepTravel, d); else slip = Math.max(slip, d);
    }
  });
  assert.ok(hipTravel > 0.03, `the pelvis moved ${hipTravel}`);
  assert.ok(slip < 0.003, `planted feet slid ${slip} m`);
  assert.ok(stepTravel > 0.1, `the stepping foot moved ${stepTravel}`);
  // the foot keeps its animated orientation
  const f = createHitReaction(cfg); f.hit(chestHit(6)); const fr = f.update(DT);
  const W = poseToWorld(applyReaction(REST, H, fr, cfg).joints);
  assert.ok(qAngle(W.leftFoot, [0, 0, 0, 1]) < 1e-6);
});

test('applyReaction returns the input for an idle frame; blendPoses hits both ends; solveLeg reaches and never NaNs', () => {
  const cfg = resolveHitReactConfig(), r = createHitReaction(cfg);
  const idle = r.update(DT);
  assert.equal(applyReaction(REST, H, idle, cfg), REST);
  const a = { joints: { spine: [0, 0, 0.0998, 0.995] }, root: [0, 0, 0] }, b = { joints: { spine: [0.0998, 0, 0, 0.995] }, root: [0, 0.1, 0] };
  assert.equal(blendPoses(a, b, 0), a); assert.equal(blendPoses(a, b, 1), b);
  const mid = blendPoses(a, b, 0.5); assert.ok(Math.abs(mid.root[1] - 0.05) < 1e-12);
  const s = solveLeg([0, 1, 0], [0, 0.2, 0.1], 0.45, 0.45, [0, 0, 1]);
  assert.ok(Math.abs(dist(s.mid, [0, 1, 0]) - 0.45) < 1e-9 && Math.abs(dist(s.mid, s.end) - 0.45) < 1e-9 && dist(s.end, [0, 0.2, 0.1]) < 1e-9);
  assert.ok(s.mid[2] > 0.1, 'the knee bends toward the pole');
  for (const t of [[0, 1, 0], [0, -5, 0], [0, 1 + 1e-12, 0]]) assert.ok(finiteDeep(solveLeg([0, 1, 0], t, 0.45, 0.45, [0, 1, 0])));
});

test('determinism: the same hits give the same frames', () => {
  const go = () => { const r = createHitReaction(resolveHitReactConfig()); const out = []; r.hit(chestHit(5)); run(r, 0.5, f => out.push(f.root.map(v => v.toFixed(9)).join())); r.hit({ region: 'rightLowerArm', impulse: 2.7, direction: [1, 0, 0], point: [-0.4, 1.1, 0], heads: P0 }); run(r, 0.5, f => out.push(JSON.stringify(f.offsets))); return out; };
  assert.deepEqual(go(), go());
});
