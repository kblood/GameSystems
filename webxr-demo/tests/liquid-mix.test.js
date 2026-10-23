// Mixing a pour into a bottle that already holds liquid (pour.js -> liquid_color.js receiveLiquidColour): ml-weighted
// absorbance, exact logical colour on every tier, shader colour faded (mid/high) or switched once (minimal/low),
// liquid kind 'mixed', volume ledger intact, overflow, empty receivers, and the viscosity table.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PourSystem, BOTTLE_QUALITY, absorbanceOfSRGB, transmission, REF_PATH_M, bottleViscosity, dischargeScale,
  bottleDischargeScale, LIQUID_VISCOSITY } from '../src/vendor/extensions/bottles/index.js';

const RED = [0.9, 0.08, 0.08], BLUE = [0.08, 0.1, 0.9];
const near = (a, b, eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < eps);
const weighted = (ml1, a1, ml2, a2) => a1.map((v, i) => (ml1 * v + ml2 * a2[i]) / (ml1 + ml2));
const rgb = a => transmission(a, REF_PATH_M).toArray().slice(0, 3);

function world(tier) {
  const scene = new THREE.Scene();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(4, 0.1, 4)); floor.position.y = -0.05; scene.add(floor);
  const factory = { bottles: new Set(), quality: 2, settings: BOTTLE_QUALITY[tier] };
  return { scene, factory, pour: new PourSystem(scene, factory, { play() {} }, [floor]) };
}
function receiver(w, { fillMl, color = RED, capacity = 500, kind }) {
  const root = new THREE.Group(), liquidMesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.05));
  liquidMesh.position.y = 0.1; root.add(liquidMesh); root.updateMatrixWorld(true);
  const uniform = new THREE.Color().setRGB(...color, THREE.SRGBColorSpace);
  const rim = Array.from({ length: 12 }, (_, i) => [Math.cos(i * Math.PI / 6) * 0.02, 0.2, Math.sin(i * Math.PI / 6) * 0.02]);
  const b = { id: 'glass', root, fillMl, capacity, open: true, broken: false, holes: [], lastPour: 0, radius: 0.03, height: 0.2,
    liquid: { liquid: liquidMesh, info: { color, rim_points: rim }, uniforms: { uLiquidColor: { value: uniform } }, fill: fillMl / capacity, agitate() {},
      lut: { offset: () => 1, fillAt: () => 0, spill: (_up, fill) => ({ fill }) } } };
  if (kind) b.liquidKind = kind;
  w.factory.bottles.add(b); w.pour.register(b);
  return { b, uniform };
}
const source = (srgb, kind) => ({ id: 'src', liquid: { info: { color: srgb } }, ...(kind ? { liquidKind: kind } : {}) });
const pourIn = (w, ml, src) => { w.pour.initialMl += ml; w.pour.emit(ml, new THREE.Vector3(0, 0.45, 0), new THREE.Vector3(), src); };
const run = (pour, s = 1.5) => { for (let i = 0; i < s * 60; i++) pour.step(1 / 60); };
const uni = u => [u.r, u.g, u.b];

test('red + blue 50/50: dark purple in the shader, exact ml-weighted logical colour, volume balances', () => {
  const w = world('high'), { b, uniform } = receiver(w, { fillMl: 100 });
  const aR = absorbanceOfSRGB(RED), aB = absorbanceOfSRGB(BLUE), before = uni(uniform);
  pourIn(w, 100, source(BLUE)); run(w.pour, 2);
  assert.ok(Math.abs(b.fillMl - 200) < 1e-9);
  assert.ok(near(b.absorbance, weighted(100, aR, 100, aB), 1e-6));
  assert.ok(near(uni(uniform), rgb(b.absorbance), 1e-6), 'the shader ended at the mixed colour');
  const r = transmission(aR, REF_PATH_M), bl = transmission(aB, REF_PATH_M);
  assert.ok(uniform.g < (r.g + bl.g) / 2 && uniform.r < (r.r + bl.r) / 2, 'subtractive: darker than the linear average');
  assert.ok(uniform.r > uniform.g && uniform.b > uniform.g, 'purple');
  assert.notDeepEqual(before, uni(uniform));
  assert.equal(w.pour.fading.size, 0, 'nothing keeps fading afterwards');
  assert.ok(Math.abs(w.pour.ledger().errorMl) < 1e-6);
});

test('skewed ml distribution: 10 ml of blue in 190 ml of red stays red, 190 ml of blue in 10 ml of red turns blue', () => {
  const aR = absorbanceOfSRGB(RED), aB = absorbanceOfSRGB(BLUE);
  const a = world('mid'), ra = receiver(a, { fillMl: 190 });
  pourIn(a, 10, source(BLUE)); run(a.pour, 2);
  assert.ok(near(ra.b.absorbance, weighted(190, aR, 10, aB), 1e-6));
  assert.ok(ra.uniform.r > ra.uniform.b * 3, 'still clearly red');
  const c = world('mid'), rc = receiver(c, { fillMl: 10 });
  pourIn(c, 190, source(BLUE)); run(c.pour, 2);
  assert.ok(near(rc.b.absorbance, weighted(10, aR, 190, aB), 1e-6));
  assert.ok(rc.uniform.b > rc.uniform.r * 3, 'clearly blue');
  for (const x of [a, c]) assert.ok(Math.abs(x.pour.ledger().errorMl) < 1e-6);
});

test('overflow: only the ml that fit are mixed in; the rest flies on, ledger error < 2%', () => {
  const w = world('high'), { b } = receiver(w, { fillMl: 450 });
  const aR = absorbanceOfSRGB(RED), aB = absorbanceOfSRGB(BLUE);
  pourIn(w, 100, source(BLUE)); run(w.pour, 3);
  assert.ok(Math.abs(b.fillMl - 500) < 1e-9, 'full');
  assert.ok(near(b.absorbance, weighted(450, aR, 50, aB), 1e-6), 'weighted by the 50 ml accepted, not the 100 ml poured');
  const led = w.pour.ledger();
  assert.ok(Math.abs(led.errorMl) / led.initialMl < 0.02, `error ${led.errorMl}`);
  assert.ok(Math.abs(led.errorMl) < 1e-6);
  assert.ok(led.puddleMl + led.inFlightMl + led.lostMl >= 49.9, 'the overflow ended up somewhere');
});

test('empty receiver takes the colour at once (no fade, no foreign liquid)', () => {
  const w = world('high'), { b, uniform } = receiver(w, { fillMl: 0, kind: 'wine' });
  const aB = absorbanceOfSRGB(BLUE);
  pourIn(w, 20, source(BLUE, 'water'));
  for (let i = 0; i < 90 && b.fillMl < 20 - 1e-9; i++) w.pour.step(1 / 60);
  assert.ok(Math.abs(b.fillMl - 20) < 1e-9);
  assert.ok(near(b.absorbance, aB, 1e-9), 'exactly the incoming colour');
  assert.ok(near(uni(uniform), rgb(aB), 1e-9), 'shown immediately');
  assert.equal(w.pour.fading.size, 0);
  assert.equal(b.liquidKind, 'water', 'no stale wine label on an empty glass');
  assert.ok(Math.abs(w.pour.ledger().errorMl) < 1e-6);
});

test('the liquid kind of a mixture is "mixed" (never the receiver\'s old type) and the composition adds to one', () => {
  const w = world('mid'), { b } = receiver(w, { fillMl: 100, kind: 'spirits' });
  pourIn(w, 50, source(BLUE, 'wine')); run(w.pour, 2);
  assert.equal(b.liquidKind, 'mixed');
  const c = b.liquidComposition, sum = Object.values(c).reduce((n, v) => n + v, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9 && Math.abs(c.spirits - 2 / 3) < 1e-9 && Math.abs(c.wine - 1 / 3) < 1e-9);
  const w2 = world('mid'), r2 = receiver(w2, { fillMl: 100, kind: 'wine' });
  pourIn(w2, 10, source(RED, 'wine')); run(w2.pour, 1);
  assert.equal(r2.b.liquidKind, 'wine', 'the same kind into a pure bottle keeps its kind');
});

test('mid/high: the shader colour fades smoothly (monotone, no pop) while the logical colour is exact at once', () => {
  const w = world('mid'), { b, uniform } = receiver(w, { fillMl: 100 });
  const start = uni(uniform), aR = absorbanceOfSRGB(RED), aB = absorbanceOfSRGB(BLUE);
  pourIn(w, 100, source(BLUE));
  let landed = false; const trace = [];
  for (let i = 0; i < 180; i++) {
    w.pour.step(1 / 60);
    if (!landed && b.fillMl > 150) landed = true;
    if (landed) trace.push(uniform.b);
  }
  assert.ok(landed && trace.length > 20);
  const end = rgb(weighted(1, aR, 1, aB));
  assert.ok(Math.abs(trace.at(-1) - end[2]) < 1e-3, 'ends at the mix');
  const total = Math.abs(end[2] - start[2]);
  assert.ok(Math.abs(trace[0] - start[2]) < total * 0.5, 'the first frame after landing is not already there');
  for (let i = 1; i < trace.length; i++) assert.ok(trace[i] <= trace[i - 1] + 1e-12 || end[2] > start[2], 'monotone');
  for (let i = 1; i < trace.length; i++) assert.ok(Math.abs(trace[i] - trace[i - 1]) < total * 0.5, 'no single-frame jump');
  assert.equal(w.pour.fading.size, 0);
});

test('tier low/minimal: logical mix exact, shader keeps its colour until half is foreign, then switches once', () => {
  for (const tier of ['minimal', 'low']) {
    const w = world(tier), { b, uniform } = receiver(w, { fillMl: 100 });
    const aR = absorbanceOfSRGB(RED), aB = absorbanceOfSRGB(BLUE), start = uni(uniform);
    pourIn(w, 40, source(BLUE)); run(w.pour, 1.5);
    assert.ok(near(b.absorbance, weighted(100, aR, 40, aB), 1e-6), `${tier}: logical mix is exact`);
    assert.deepEqual(uni(uniform), start, `${tier}: 40 of 140 ml foreign: shader unchanged`);
    assert.equal(w.pour.fading.size, 0, `${tier}: never fades`);
    pourIn(w, 60, source(BLUE)); run(w.pour, 1.5);
    assert.ok(near(b.absorbance, weighted(100, aR, 100, aB), 1e-6));
    assert.ok(near(uni(uniform), rgb(b.absorbance), 1e-6), `${tier}: switched to the mix once half was foreign`);
    assert.ok(Math.abs(w.pour.ledger().errorMl) < 1e-6);
  }
});

test('setQuality from high to low finishes a running fade and leaves nothing in the fade set', () => {
  const w = world('high'), { b, uniform } = receiver(w, { fillMl: 100 });
  pourIn(w, 100, source(BLUE));
  for (let i = 0; i < 90 && b.fillMl < 150; i++) w.pour.step(1 / 60);
  assert.equal(w.pour.fading.size, 1);
  w.pour.setQuality(BOTTLE_QUALITY.low);
  assert.equal(w.pour.fading.size, 0);
  assert.ok(near(uni(uniform), rgb(b.absorbance), 1e-9));
});

test('viscosity table: water 1, honey slower, mixtures use the composition, unknown kinds count as water', () => {
  assert.equal(dischargeScale(1), 1);
  assert.ok(dischargeScale(LIQUID_VISCOSITY.honey) < 0.65 && dischargeScale(LIQUID_VISCOSITY.honey) > 0.5);
  assert.ok(dischargeScale(LIQUID_VISCOSITY.oil) < dischargeScale(LIQUID_VISCOSITY.wine));
  assert.equal(bottleDischargeScale({ liquidKind: 'unknown' }), 1);
  assert.equal(bottleViscosity({}), 1);
  const mix = { liquidKind: 'mixed', liquidComposition: { water: 0.5, honey: 0.5 } };
  assert.ok(Math.abs(bottleViscosity(mix) - 100) < 1e-9, 'geometric mean of 1 and 10000');
  assert.ok(bottleDischargeScale(mix) < 1 && bottleDischargeScale(mix) > dischargeScale(LIQUID_VISCOSITY.honey));
});
