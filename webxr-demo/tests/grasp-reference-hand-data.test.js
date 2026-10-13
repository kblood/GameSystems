import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import REF from '../../extensions/grasp/reference_hand.json' with { type: 'json' };
import { referenceHand } from '../../extensions/grasp/record.js';
import { referenceHand as vendoredReferenceHand } from '../src/vendor/extensions/grasp/record.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const round = value => typeof value === 'number' ? Math.round(value * 1e12) / 1e12
  : Array.isArray(value) ? value.map(round)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, round(item)])) : value;

test('canonical reference-hand fixture and public geometry preserve historical values', () => {
  // Captured from the existing canonical fixture and API before adding the Godot reader.
  assert.equal(hash(REF), '867378756208e5dfb5c3cbc54353df2ebf065c6c84b9f66bf7a833d85b4d7c7c');
  for (const api of [referenceHand, vendoredReferenceHand]) {
    const cases = ['left', 'right'].flatMap(side => [null, 1, 2].map(scale => ({
      side, scale, expected: api(side, scale === null ? {} : { scale }),
    })));
    // Quantize only the historical output hash to 1e-12 to avoid pinning last-bit trig noise.
    assert.equal(hash(round(cases)), 'a3de7b810d1fdc5c1f9444c3b160c7ad4663c666591bd91f9b24d18357428b3f');
  }
});

test('reference-hand API preserves default caching, side independence and scale behavior', () => {
  for (const api of [referenceHand, vendoredReferenceHand]) {
    const left = api('left'), right = api('right');
    assert.equal(api('left'), left);
    assert.equal(api('left', { scale: REF.scale }), left);
    assert.notEqual(left, right);
    assert.equal(left.side, 'left');
    assert.equal(right.side, 'right');
    const unit = api('left', { scale: 1 }), doubled = api('left', { scale: 2 });
    assert.notEqual(api('left', { scale: 1 }), unit, 'custom-scale calls remain uncached');
    assert.equal(doubled.length, unit.length * 2);
    assert.equal(left.length, unit.length * REF.scale);
    assert.deepEqual(doubled.fingers, unit.fingers, 'finger geometry stays in rig metres');
    for (const [name, finger] of Object.entries(REF.hands.left.fingers)) assert.deepEqual(left.fingers[name].len, finger.len);
  }
});
