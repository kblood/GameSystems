import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createHost } from '../src/vendor/extensions/host/index.js';

// The avatar needs the CharacterCreator files (character-cc vendor/cc, generated in Contracts) synced into
// src/vendor/extensions; without them these tests are skipped (grab_findings 1.7) instead of failing the run with
// ERR_MODULE_NOT_FOUND. The extensions themselves are always synced.
const synced = existsSync(new URL('../src/vendor/extensions/character-cc/vendor/cc/character.js', import.meta.url));
const skip = !synced && 'Contracts not synced: kør npm run sync med CONTRACTS_DIR';
const avatar = synced ? await import('../src/avatar.js') : null;
const grasp = await import('../src/vendor/extensions/grasp/index.js');

test('bottles map to the nearest baked kind by height (wine above 0.3 m)', { skip }, () => {
  const { graspKind } = avatar;
  assert.equal(graspKind({ height: 0.256 }), 'bottle_beer');
  assert.equal(graspKind({ height: 0.3 }), 'bottle_beer');
  assert.equal(graspKind({ height: 0.3001 }), 'bottle_wine');
  assert.equal(graspKind({ height: 0.34 }), 'bottle_wine');
});

test('grasp wrist follows the bottle radius, is capped to the body and mirrors between hands', { skip }, () => {
  const { graspFor } = avatar;
  const slim = graspFor({ height: 0.256, radius: 0.0325 }, 'right'), wide = graspFor({ height: 0.256, radius: 0.045 }, 'right');
  const r = g => Math.hypot(g.wrist[0], g.wrist[2]);
  assert.ok(Math.abs(r(wide) - r(slim) - 0.0125) < 1e-9, 'radial wrist distance moves with the bottle radius');
  assert.equal(slim.wrist[1], slim.pose.wrist[1], 'a beer-sized bottle keeps the baked height');
  for (const side of ['left', 'right']) assert.ok(Math.abs(graspFor({ height: 0.1, radius: 0.03 }, side).wrist[1] - 0.055) < 1e-12, `${side}: capped at 0.55 h`);
  assert.equal(graspFor({ height: 0.05, radius: 0.03 }, 'right').wrist[1], 0.05, 'never below 5 cm');
  for (const height of [0.256, 0.34]) {
    const left = graspFor({ height, radius: 0.034 }, 'left'), right = graspFor({ height, radius: 0.034 }, 'right');
    assert.ok(left.pose.default && right.pose.default, 'both hands use a real default (grab_findings 1.3)');
    assert.ok(Math.sign(left.wrist[2]) === -Math.sign(right.wrist[2]) && Math.sign(left.wrist[0]) === Math.sign(right.wrist[0]), 'left is the right grasp mirrored across the bottle (item z)');
  }
});

test('the hand on a bottle gets valid finger rows from the open approach to the closed grip (grab_findings 1.4)', { skip }, () => {
  const { validateRows, rowsFromState, fingerState } = grasp;
  for (const kind of ['bottle_beer', 'bottle_wine']) for (const side of ['left', 'right']) {
    const g = avatar.graspFor({ height: kind === 'bottle_beer' ? 0.256 : 0.34, radius: 0.034 }, side);
    for (const close of [0, 0.5, 1]) assert.ok(validateRows(rowsFromState(fingerState(g.pose, close))).ok, `${kind}/${side} at ${close}`);
  }
});

// A plain synthetic hand (straight fingers, rig metres) in the shape closure.handGeometry() reads; the game passes the
// avatar's own rest hand (player.restHand(side) -> handGeometry). It only checks the wiring here; the closure itself is tested in Contracts.
const syntheticHand = side => {
  const m = side === 'left' ? -1 : 1, chain = (base, dir, lens) => {
    const pts = [base]; for (const l of lens) { const q = pts[pts.length - 1]; pts.push(q.map((v, i) => v + dir[i] * l)); }
    return { pts, len: lens };
  };
  const along = [0, 0, 1], fingers = {
    Thumb: chain([0.02 * m, -0.01, 0.03], [0.6 * m, -0.3, 0.74], [0.04, 0.032, 0.028]),
    Index: chain([0.025 * m, 0, 0.09], along, [0.045, 0.026, 0.022]), Middle: chain([0.005 * m, 0, 0.092], along, [0.048, 0.03, 0.024]),
    Ring: chain([-0.014 * m, 0, 0.088], along, [0.044, 0.028, 0.023]), Little: chain([-0.031 * m, 0, 0.08], along, [0.035, 0.021, 0.02]) };
  return grasp.handGeometry({ side, frame: { F: [0, 0, 1], D: [0, 1, 0] }, wrist: [0, 0, 0], fingers });
};

test('with the avatar hand the bottle grasp is closed to contact once per bottle and hand, in the joint ranges (step 3)', { skip }, () => {
  const { validateRows, rowsFromState, fingerState } = grasp;
  assert.equal(grasp.graspQuality(), 'mid');
  for (const side of ['left', 'right']) {
    const bottle = { height: 0.256, radius: 0.034 }, hand = syntheticHand(side);
    const plain = avatar.graspFor(bottle, side), held = avatar.graspFor(bottle, side, hand);
    assert.equal(held.pose.id, plain.pose.id, 'the same baked grasp');
    assert.ok(held.pose.contact, 'closed to contact');
    assert.equal(avatar.graspFor(bottle, side, hand).pose, held.pose, 'memoised per bottle and hand');
    for (const close of [0, 0.5, 1]) assert.ok(validateRows(rowsFromState(fingerState(held.pose, close))).ok, `${side} at ${close}`);
  }
});

test('avatar hands follow the core events: grab, release, broken (1.1), disconnect, XR enter/exit recalibration (1.9)', { skip }, async () => {
  const host = createHost({ onError: e => { throw e; } }), holds = new Map();
  let resets = 0;
  await host.load({ id: 'avatar', init: ctx => { avatar.bindAvatarEvents(ctx, { holds, player: { resetTracking: () => resets++ } }); } });
  const beer = { height: 0.256, radius: 0.0325 }, wine = { height: 0.35, radius: 0.0375 };
  host.emit('grab', { owner: 0, bottle: beer, side: 'left' });
  host.emit('grab', { owner: 'desktop', bottle: wine, side: 'right' });
  host.emit('grab', { owner: 1, bottle: beer, side: null }); // controller without handedness: no hand
  assert.deepEqual([...holds.keys()], [0, 'desktop']);
  assert.equal(holds.get(0).side, 'left');
  host.emit('broken', { bottle: beer });
  assert.deepEqual([...holds.keys()], ['desktop']);
  host.emit('disconnect', { owner: 'desktop' });
  assert.equal(holds.size, 0);
  host.emit('grab', { owner: 'desktop', bottle: wine, side: 'right' });
  host.emit('release', { owner: 'desktop', bottle: wine });
  assert.equal(holds.size, 0);
  host.emit('xrStart', {}); host.emit('xrEnd', {});
  assert.equal(resets, 2);
  host.dispose();
});

test('the avatar module is an extension factory with off/low/high tiers', { skip }, () => {
  const ext = avatar.default();
  assert.equal(ext.id, 'avatar');
  assert.deepEqual(ext.quality, ['off', 'low', 'high']);
  assert.deepEqual(avatar.AVATAR_TIER, { off: 'off', low: 'arms', high: 'full' }, 'low = hands and arms only, high = full body');
  for (const k of ['init', 'update', 'setQuality', 'dispose']) assert.equal(typeof ext[k], 'function');
});
