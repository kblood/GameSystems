import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as g from '../../extensions/grasp/index.js';
import DATA from '../../extensions/grasp/data/procedural_grasps.data.json' with { type: 'json' };

const ITEMS = ['mug', 'carton', 'pole', 'barrel'];
// Procedural grasps are OPT-IN (default off = the bake alone). Every test below runs with them on, except the ones that say
// 'default' (they switch them off first); the setting is restored to the default after each test.
beforeEach(() => g.setProceduralGrasps(true));
afterEach(() => g.setProceduralGrasps(false));
const hands = scale => Object.fromEntries(['left', 'right'].map(side => { const r = g.referenceHand(side); return [side, g.referenceHand(side, { scale: r.scale * scale })]; }));

test('procedural grasps: schema, ids unique, every row passes the recorded-pose validator and its own score', () => {
  assert.equal(DATA.schema, 'gamesystems.procedural-grasps.v1');
  assert.equal(g.PROCEDURAL.length, DATA.poses.length, 'no pose is dropped by isPose');
  const ids = new Set(g.PROCEDURAL.map(p => p.id));
  assert.equal(ids.size, g.PROCEDURAL.length);
  for (const p of g.PROCEDURAL) {
    assert.ok(g.isPose(p), p.id);
    assert.equal(p.source, 'procedural');
    assert.ok(g.CATALOG[p.kind], p.id);
    assert.ok(g.scoreGrasp(p, g.referenceHand(p.side)).ok, p.id);
  }
  // none of them reuses a baked id (the bake itself is unchanged)
  const baked = new Set(g.BAKED.poses.map(p => p.id));
  for (const p of g.PROCEDURAL) assert.ok(!baked.has(p.id), p.id);
});

test('the generator is reproducible: --check regenerates the same rows', async () => {
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.execPath, ['extensions/grasp/tools/make_procedural_grasps.mjs', '--check'], { cwd: new URL('../../', import.meta.url), encoding: 'utf8' });
  assert.match(out, new RegExp(`accepted ${g.PROCEDURAL.length} `));
  assert.match(out, /dropped 0/);
});

test('default: the library is the bake alone (BASE_POSES), no procedural pose, the baked mug handle rows untouched', () => {
  g.setProceduralGrasps(false);
  assert.equal(g.proceduralGrasps(), false);
  assert.equal(g.POSES, g.BASE_POSES);
  assert.equal(g.BASE_POSES.length, g.BAKED.poses.length);
  assert.ok(g.BASE_POSES.every((p, i) => p === g.BAKED.poses[i]), 'the same rows in the same order');
  assert.ok(!g.POSES.some(p => p.source === 'procedural'));
  assert.ok(g.POSES.some(p => p.kind === 'mug' && p.grasp === 'handle' && p.source !== 'procedural'), 'baked handle rows stay');
  for (const kind of ['pole', 'barrel']) assert.equal(g.hasPoses(kind), false, `${kind} has no pose by default`);
  assert.equal(g.posesFor('carton', 'right').filter(p => p.grasp === 'side').length, 0, 'no procedural carton side group by default');
  // the explicit library builder matches the two states without touching the active one
  assert.equal(g.buildLibrary([]), g.BASE_POSES);
  assert.equal(g.buildLibrary([], { procedural: true }), g.PROCEDURAL_POSES);
  assert.equal(g.POSES, g.BASE_POSES);
});

test('opt-in: setProceduralGrasps(true) adds the groups and replaces mug/*/handle only then; unparsable values change nothing; off restores the default', () => {
  assert.equal(g.setProceduralGrasps(true), true);
  assert.equal(g.setProceduralGrasps('banana'), true, 'an unparsable value leaves the setting');
  assert.equal(g.setProceduralGrasps('off'), false);
  assert.equal(g.POSES, g.BASE_POSES);
  assert.equal(g.setProceduralGrasps('on'), true);
  assert.equal(g.POSES, g.PROCEDURAL_POSES);
  assert.equal(g.PROCEDURAL_POSES.length, g.BAKED.poses.length - g.BAKED.poses.filter(p => p.kind === 'mug' && p.grasp === 'handle').length + g.PROCEDURAL.length);
  // it keeps a recorded-variant selection and survives setGraspVariants
  const before = g.graspVariantSelection();
  g.setGraspVariants('recorded');
  try { assert.ok(g.POSES.some(p => p.source === 'procedural')); } finally { g.setGraspVariants(before); }
  assert.equal(g.setProceduralGrasps(false), false);
  assert.equal(g.POSES, g.BASE_POSES);
});

test('every group has a default per side; with procedural on the library keeps the mug body but replaces its handle group', () => {
  for (const [kind, groups] of Object.entries({ mug: ['handle', 'top'], carton: ['side', 'face'], pole: ['grip'], barrel: ['side'] })) for (const side of ['left', 'right']) for (const grasp of groups) {
    const rows = g.posesFor(kind, side).filter(p => p.grasp === grasp);
    assert.ok(rows.length > 0, `${kind}/${side}/${grasp}`);
    assert.equal(rows.filter(p => p.default).length, 1, `${kind}/${side}/${grasp} default count`);
  }
  assert.ok(g.PROCEDURAL_POSES.some(p => p.kind === 'mug' && p.grasp === 'body'), 'the mug body rows stay');
  assert.ok(!g.PROCEDURAL_POSES.some(p => p.kind === 'mug' && p.grasp === 'handle' && p.source !== 'procedural'), 'baked handle rows replaced');
  assert.ok(g.BAKED.poses.some(p => p.kind === 'mug' && p.grasp === 'handle'), 'BAKED itself is unchanged');
});

test('closure hit-rate on the new items: 100 % of the two-hand grip rows pass the bone-model verdict on hands of 0.9, 1.0 and 1.1 scale', () => {
  for (const kind of ITEMS) {
    const spec = g.twoHandSpec(kind);
    for (const scale of [0.9, 1, 1.1]) {
      const h = hands(scale); let ok = 0, n = 0;
      for (const side of ['left', 'right']) for (const p of g.posesFor(kind, side)) {
        if (![spec.primary, spec.secondary].includes(p.grasp)) continue;
        n++; if (g.scoreGrasp(p, h[side]).ok) ok++;
      }
      assert.ok(n >= 8, `${kind} has rows (${n})`);
      assert.equal(ok / n, 1, `${kind} @${scale}: ${ok}/${n}`);
    }
  }
});

test('graspPose closes every procedural default on a hand (mid and high quality) with finite rows', () => {
  const was = g.graspQuality();
  try {
    for (const q of ['mid', 'high']) {
      g.setGraspQuality(q);
      for (const p of g.PROCEDURAL.filter(x => x.default)) {
        const hand = g.referenceHand(p.side), r = g.graspPose(p, hand);
        assert.ok([...r.wrist, ...r.quat, ...r.angles.flat()].every(Number.isFinite), `${q} ${p.id}`);
      }
    }
  } finally { g.setGraspQuality(was); }
});

test('procedural rows are not clamped by the exempt-kind rule (they are inside the joint ranges)', () => {
  const was = g.graspQuality();
  try {
    g.setGraspQuality('mid');
    const mug = g.PROCEDURAL.find(p => p.kind === 'mug' && p.grasp === 'handle');
    const rows = g.runtimeRows(mug);
    assert.ok(rows.angles.every((r, i) => r.every((v, k) => Math.abs(v - mug.angles[i][k]) < 20)), 'rows stay close to the stored ones');
  } finally { g.setGraspQuality(was); }
});

test('two hands on one body never collide: every primary has a left secondary grip with clear skin gap (right primary, left secondary)', () => {
  const R = g.referenceHand('right'), L = g.referenceHand('left');
  const report = {};
  for (const kind of ITEMS) {
    const spec = g.twoHandSpec(kind), shape = g.CATALOG[kind].shape;
    let primaries = 0, served = 0, pairs = 0, clear = 0;
    for (const p1 of g.posesFor(kind, 'right').filter(p => p.grasp === spec.primary)) {
      primaries++;
      const c1 = g.closeToContact(p1, R, shape); let any = false;
      for (const p2 of g.secondaryPoses(kind, 'left', p1)) {
        const c2 = g.closeToContact(p2, L, shape), gap = g.handsClearance(R, c1, L, c2);
        pairs++; if (gap >= 0) { clear++; any = true; }
      }
      if (any) served++;
    }
    report[kind] = { primaries, served, pairs, clear };
    assert.ok(served === primaries, `${kind}: ${served}/${primaries} primaries have a clear partner`);
    assert.ok(clear / pairs >= 0.85, `${kind}: ${clear}/${pairs} pairs clear`);
  }
});

test('handsClearance sees overlapping hands (negative) and separated hands (positive)', () => {
  const R = g.referenceHand('right'), shape = g.CATALOG.carton.shape;
  const p = g.posesFor('carton', 'right').find(x => x.grasp === 'side' && x.default), c = g.closeToContact(p, R, shape);
  assert.ok(g.handsClearance(R, c, R, c) < 0, 'a hand on itself overlaps');
  const far = { ...c, wrist: [c.wrist[0] + 1, c.wrist[1], c.wrist[2]] };
  assert.ok(g.handsClearance(R, c, R, far) > 0.5);
});

test('pickSecondary: never closer than minSeparation, skips role primary, null for one-hand kinds', () => {
  const p1 = g.defaultPose('pole', 'right', 'grip');
  const spec = g.twoHandSpec('pole');
  const pick = g.pickSecondary('pole', 'left', { pos: p1.wrist, quat: p1.quat }, { primary: p1 });
  assert.ok(pick && g.gripSeparation(pick.pose, p1) >= spec.minSeparation - 1e-9);
  assert.equal(g.pickSecondary('can', 'left', { pos: [0, 0, 0], quat: [0, 0, 0, 1] }, { primary: p1 }), null);
  // a recorded secondary variant (role) is accepted by the validator, a bad role is not
  assert.ok(g.isPose({ ...p1, role: 'secondary' })); assert.ok(!g.isPose({ ...p1, role: 'nope' }));
  const rec = g.recordedPose({ side: 'left', wrist: pick.pose.wrist, quat: pick.pose.quat, angles: pick.pose.angles, handLength: 0.19 }, { kind: 'pole', grasp: 'grip', role: 'secondary', at: '2026-10-23T10:00:00Z' });
  assert.equal(rec.id, 'pole/left/grip/rec-20261023T100000');
  assert.equal(rec.role, 'secondary');
  assert.equal(g.mirrorPose(rec).role, 'secondary');
  assert.ok(g.isPose(rec));
});

test('the baked bake file on disk is untouched by the procedural merge', () => {
  const raw = JSON.parse(readFileSync(new URL('../../extensions/grasp/baked_grasps.data.json', import.meta.url), 'utf8'));
  assert.equal(raw.poses.length, 255);
  assert.equal(raw.poses.filter(p => p.source === 'procedural').length, 0);
});
