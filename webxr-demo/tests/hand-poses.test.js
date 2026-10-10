// Hand poses in the demo (extensions plan step 7): the bottle grab plays the avatar's grab clip instead of the linear
// open -> closed lerp, the held grip follows the pour clip with the bottle's tilt, both inside the joint ranges, and
// hand-pose tier 'low' gives back the old linear behaviour exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const synced = existsSync(new URL('../src/vendor/extensions/character-cc/vendor/cc/character.js', import.meta.url));
const skip = !synced && 'Contracts not synced: kør npm run sync med CONTRACTS_DIR';
const avatar = synced ? await import('../src/avatar.js') : null;
const grasp = await import('../src/vendor/extensions/grasp/index.js');
const hands = await import('../src/vendor/extensions/avatar/handposes.js');

test('grab and pour clips keep every bottle grasp valid at every hand-pose tier; low = the old linear lerp', { skip }, () => {
  const { validateRows, rowsFromState, fingerState, runtimeRows } = grasp;
  for (const kind of ['bottle_beer', 'bottle_wine']) for (const side of ['left', 'right']) {
    const g = avatar.graspFor({ height: kind === 'bottle_beer' ? 0.256 : 0.34, radius: 0.034 }, side), rows = runtimeRows(g.pose);
    for (const quality of hands.HAND_POSE_QUALITY) {
      for (const t of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
        const v = validateRows(rowsFromState(hands.grabFingerState(rows, t, { quality })));
        assert.ok(v.ok, `${kind}/${side} grab ${quality} at ${t}: ${JSON.stringify(v.hard)}`);
      }
      for (const p of [0, 0.5, 1]) assert.ok(validateRows(rowsFromState(hands.pourFingerState(rows, p, { quality }))).ok, `${kind}/${side} pour ${quality} at ${p}`);
    }
    // the clip's ends are the grasp's own rows; 'low' is exactly grasp fingerState
    const same = (a, b) => Object.keys(b).every(f => ['dyaw', 'pitch', 'bend1', 'bend2'].every(k => Math.abs(a[f][k] - b[f][k]) < 1e-9));
    for (const t of [0, 1]) assert.ok(same(hands.grabFingerState(rows, t, { quality: 'high' }), fingerState(g.pose, t)), `${kind}/${side} end ${t}`);
    for (const t of [0.3, 0.7]) assert.ok(same(hands.grabFingerState(rows, t, { quality: 'low' }), fingerState(g.pose, t)), `${kind}/${side} low ${t}`);
  }
});

test('pour progress follows the bottle tilt (upright 0, past horizontal 1)', { skip }, () => {
  const { pourProgress } = avatar;
  assert.equal(pourProgress(0), 0);
  assert.equal(pourProgress(Math.PI / 6), 0);
  assert.equal(pourProgress(Math.PI * 0.7), 1);
  assert.ok(pourProgress(Math.PI / 2) > 0.3 && pourProgress(Math.PI / 2) < 0.9);
});
