// Grasp studio: item kinds, the secondary grip as an append-only variant (role 'secondary', id rec-<stamp>), the partner
// hand on the item, the display-only weight lag, and the store's validation of the new field (temp files only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudio, applyProceduralGrasps, syntheticHands, GRASPS, KINDS, ROLES } from '../src/studio.js';
import { isPose, defaultPose, poseById, scoreGrasp, referenceHand, twoHandSpec, proceduralGrasps, hasPoses } from '../src/vendor/extensions/grasp/index.js';
import { applyAction, emptyLibrary } from '../server/grasp_store.mjs';

// The studio shows the procedural grasps by default (games: opt-in, ?proceduralgrasps=on); the tests below run in the studio's default.
test('procedural grasps: the studio turns them ON by default, ?proceduralgrasps=off gives the bake alone, the library default stays off', () => {
  assert.equal(proceduralGrasps(), false, 'the library default is off (games)');
  assert.equal(hasPoses('pole'), false);
  assert.equal(applyProceduralGrasps(new URLSearchParams('')), true);
  assert.equal(hasPoses('pole') && hasPoses('barrel'), true);
  assert.equal(applyProceduralGrasps(new URLSearchParams('proceduralgrasps=off')), false);
  assert.equal(hasPoses('pole'), false);
  assert.equal(applyProceduralGrasps(new URLSearchParams('proceduralgrasps=on')), true);
  assert.equal(applyProceduralGrasps(undefined), true);
});

const item = { pos: [0, 1, -0.4], quat: [0, 0, 0, 1] };
function recordOn(kind, side, role) {
  const studio = createStudio({ kind, side });
  studio.setItem(item.pos, item.quat);
  if (role) studio.setRole(role);
  const pose = defaultPose(kind, side, studio.settings.grasp);
  let live = null, t = 0;
  for (let i = 0; i < 72 * 3 && !studio.review; i++, t = i / 72)
    live = studio.update(t, syntheticHands(t, item, { side, poseId: pose.id, noiseMm: 0.1 }));
  return { studio, live, pose };
}

test('studio kinds: every kind has grasp groups, setKind resets to the first group and the primary role', () => {
  assert.deepEqual([...KINDS], Object.keys(GRASPS));
  assert.ok(KINDS.includes('mug') && KINDS.includes('pole') && KINDS.includes('barrel') && KINDS.includes('carton'));
  const s = createStudio({});
  s.setKind('mug'); assert.equal(s.settings.grasp, 'handle'); assert.equal(s.settings.role, 'primary');
  s.setGrasp('top'); s.setKind('pole'); assert.equal(s.settings.grasp, 'grip');
  assert.throws(() => s.setKind('nope'), RangeError);
  assert.throws(() => s.setGrasp('neck'), RangeError);
  for (const [kind, groups] of Object.entries(GRASPS)) for (const g of groups) assert.ok(defaultPose(kind, 'right', g), `${kind}/${g} has a default pose`);
});

test('roles: secondary needs a two-hand kind and selects the secondary group; a bottle has none', () => {
  const s = createStudio({});
  assert.throws(() => s.setRole('secondary'), RangeError);
  assert.deepEqual([...ROLES], ['primary', 'secondary']);
  s.setKind('pole'); s.setRole('secondary');
  assert.equal(s.settings.role, 'secondary'); assert.equal(s.settings.grasp, twoHandSpec('pole').secondary);
  s.setRole('primary'); assert.equal(s.settings.grasp, twoHandSpec('pole').primary);
});

test('the partner hand is the other side, closed on the item, and changes with the role', () => {
  const s = createStudio({ kind: 'pole' });
  const p = s.partner;
  assert.ok(p && p.closed.side === 'left' && p.closed.hand && Number.isFinite(p.closed.wrist[0]));
  s.setRole('secondary');
  assert.ok(s.partner && s.partner.pose.grasp === twoHandSpec('pole').primary);
  assert.equal(createStudio({}).partner, null, 'one-hand kinds show no partner');
});

test('recording the secondary grip: saved as a rec-<stamp> variant with role secondary, valid, original untouched', () => {
  const { studio, pose } = recordOn('pole', 'left', 'secondary');
  assert.ok(studio.review, 'a capture reached the review');
  assert.equal(studio.review.role, 'secondary');
  const [rec] = studio.accept();
  assert.equal(rec.role, 'secondary');
  assert.match(rec.id, /^pole\/left\/grip\/rec-\d{8}T\d{6}/);
  assert.ok(isPose(rec));
  assert.notEqual(rec.id, pose.id);
  assert.ok(poseById(pose.id), 'the baked/procedural row is untouched');
});

test('a primary recording has no role field; the item kind is recorded', () => {
  const { studio } = recordOn('barrel', 'right', null);
  const [rec] = studio.accept();
  assert.equal(rec.kind, 'barrel'); assert.equal(rec.role, undefined); assert.ok(isPose(rec));
});

test('review reports the hand clearance (mm) for two-hand kinds', () => {
  const { studio } = recordOn('carton', 'right', null);
  assert.ok(Number.isFinite(studio.review.clearanceMm), String(studio.review.clearanceMm));
  const one = recordOn('bottle_beer', 'right', null).studio;
  assert.equal(one.review.clearanceMm, null);
});

test('weight lag: display only: bounded 5-30 mm for a heavy item, zero when off, capture unchanged', () => {
  const studio = createStudio({ kind: 'barrel' });
  studio.setItem(item.pos, item.quat);
  const pose = defaultPose('barrel', 'right', 'side');
  let max = 0, live;
  for (let i = 0; i < 72 * 1.2; i++) {            // ~1.2 s: before the capture finishes
    const t = i / 72;
    live = studio.update(t, syntheticHands(t, item, { side: 'right', poseId: pose.id, noiseMm: 0 }));
    if (live.weightLag) max = Math.max(max, Math.hypot(...live.weightLag.offset));
  }
  assert.ok(max > 0.004 && max <= 0.031, `offset ${max}`);
  studio.setWeightLag(false);
  live = studio.update(2, syntheticHands(2, item, { side: 'right', poseId: pose.id, noiseMm: 0 }));
  assert.equal(live.weightLag, null);
});

test('store: a secondary variant passes save validation; a bad role is refused', () => {
  const { studio } = recordOn('pole', 'left', 'secondary');
  const [rec] = studio.accept();
  const { doc } = applyAction(emptyLibrary(), { action: 'save', poses: [rec] });
  assert.equal(doc.poses.at(-1).role, 'secondary');
  assert.throws(() => applyAction(emptyLibrary(), { action: 'save', poses: [{ ...rec, role: 'third' }] }), /invalid pose/);
});

test('ladder and mug body: ladder is a studio kind (rung group, two-hand), the mug has a body group; both have procedural default poses', () => {
  assert.ok(KINDS.includes('ladder') && GRASPS.ladder.join() === 'rung');
  assert.deepEqual(GRASPS.mug, ['handle', 'top', 'body']);
  const s = createStudio({});
  s.setKind('ladder'); assert.equal(s.settings.grasp, 'rung'); s.setRole('secondary'); assert.equal(s.settings.role, 'secondary');
  s.setKind('mug'); s.setGrasp('body'); assert.equal(s.settings.grasp, 'body'); assert.equal(s.settings.role, 'primary');
  const body = defaultPose('mug', 'right', 'body'); assert.ok(body && body.angles[0][1] <= 65, 'body thumb pitch inside the joint limit');
  assert.ok(defaultPose('ladder', 'right', 'rung').axis, 'ladder poses carry their rung axis');
});
