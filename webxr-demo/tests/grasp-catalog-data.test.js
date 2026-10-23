import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import DATA from '../../extensions/grasp/data/catalog.data.json' with { type: 'json' };
import * as source from '../../extensions/grasp/catalog.js';
import * as vendored from '../src/vendor/extensions/grasp/catalog.js';

test('catalog data preserves historical records, kinds order and mutable export boundaries', () => {
  const values = { DEFAULT_MASS: source.DEFAULT_MASS, CATALOG: source.CATALOG };
  assert.deepEqual(DATA, { schema: 'gamesystems.grasp-catalog-data.v1', ...values });
  // pole, barrel and ladder were appended after the extraction (two-hand items); the original five kinds are unchanged
  const original = { DEFAULT_MASS: values.DEFAULT_MASS, CATALOG: Object.fromEntries(['bottle_beer', 'bottle_wine', 'mug', 'can', 'carton'].map(k => [k, values.CATALOG[k]])) };
  // Captured before extracting the JS literals, including every profile/color/prop field.
  assert.equal(createHash('sha256').update(JSON.stringify(original)).digest('hex'),
    'db86154794779c1b9f0e27d1e81ceb4fdda6e2b18bc508aea2aa6594127b4ef8');
  assert.deepEqual(vendored.CATALOG, source.CATALOG);
  assert.equal(vendored.DEFAULT_MASS, source.DEFAULT_MASS);
  for (const api of [source, vendored]) {
    assert.deepEqual(api.KINDS, ['bottle_beer', 'bottle_wine', 'mug', 'can', 'carton', 'pole', 'barrel', 'ladder']);
    assert.equal(api.entry('mug'), api.CATALOG.mug);
    assert.throws(() => api.entry('missing-prop'), /Unknown prop kind/);
    for (const object of [api.CATALOG, api.CATALOG.mug, api.CATALOG.mug.shape.parts,
      api.CATALOG.bottle_beer.shape.profile, api.CATALOG.bottle_beer.shape.profile[0]]) {
      assert.equal(Object.isFrozen(object), false);
    }
  }
});

test('catalog extraction preserves SDF outputs for interiors, boundaries, shoulders and union offsets', () => {
  // Recorded from the original JS catalog/SDF before extraction, in item-local metres.
  const cases = [
    ['bottle_beer', [0, 0.1, 0], -0.0325], ['bottle_beer', [0.0325, 0.1, 0], 0],
    ['bottle_beer', [0.04, 0.18, 0], 0.015573662880039285], ['bottle_beer', [0, -0.01, 0], 0.01],
    ['bottle_wine', [0, 0.1, 0], -0.0375], ['bottle_wine', [0.04, 0.25, 0], 0.013924564306442786],
    ['bottle_wine', [0, 0.36, 0], 0.010000000000000009], ['can', [0, 0, 0], -0.037],
    ['can', [0.037, 0, 0], 0], ['can', [0.05, 0.075, 0], 0.018034688796871434],
    ['carton', [0, 0, 0], -0.07], ['carton', [0.11, 0, 0], 0],
    ['carton', [0.12, 0.08, 0.09], 0.017320508075688763], ['mug', [0, 0, 0], -0.0525],
    ['mug', [0.1, 0, 0], -0.007], ['mug', [0.079, 0, 0], 0.014000000000000005],
    ['mug', [0.079, 0.037, 0], -0.0065], ['mug', [0.11, 0, 0], 0.002999999999999995],
  ];
  for (const api of [source, vendored]) for (const [kind, point, expected] of cases) {
    assert.ok(Math.abs(api.signedDistance(api.CATALOG[kind].shape, point) - expected) < 1e-12, `${kind} at ${point}`);
  }
});
