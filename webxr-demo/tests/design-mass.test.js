import test from 'node:test';
import assert from 'node:assert/strict';
import { liquidMassKg, resolveMassFill } from '../src/vendor/extensions/bottles/index.js';

test('bottle design liquid mass uses authored density and fill fraction', () => {
  assert.equal(liquidMassKg({ capacity_ml: 500, density: 0.8 }, 0.25), 0.1);
  assert.equal(liquidMassKg({ capacity_ml: 500, density: 1.01, fill_default: 0.8 }), 0.404);
});

test('bottle design mass defaults missing density to water and clamps fill to its volume', () => {
  assert.equal(liquidMassKg({ capacity_ml: 500 }, 0.6), 0.3);
  assert.equal(liquidMassKg({ capacity_ml: 500, density: 1.4 }, 1.5), 0.7);
  assert.equal(liquidMassKg({ capacity_ml: 500, density: 1.4 }, -0.2), 0);
});

test('design mass fill precedence is explicit query, live fill, load fill, authored default', () => {
  const info = { fill_default: 0.8 };
  assert.equal(resolveMassFill(info, 0.25, undefined, undefined), 0.25);
  assert.equal(resolveMassFill(info, undefined, undefined, 0.4), 0.4);
  assert.equal(resolveMassFill(info, undefined, undefined, undefined), 0.8);
  assert.equal(resolveMassFill(info, undefined, 0.5, 0.4), 0.5);
});

test('invalid design mass data never produces non-finite gameplay mass', () => {
  assert.equal(liquidMassKg({ capacity_ml: -1, density: 1 }, 1), 0);
  assert.equal(liquidMassKg({ capacity_ml: 500, density: Number.NaN }, 1), 0);
  assert.equal(liquidMassKg({ capacity_ml: 500, density: 1 }, Number.NaN), 0);
  assert.equal(liquidMassKg({ capacity_ml: 1e308, density: 1e308 }, 1), 0);
});
