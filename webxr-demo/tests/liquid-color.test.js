// Liquid colour in the bottles extension (liquid_color.js + pour.js): drops, streams and puddles carry the colour of the
// bottle they came from as Beer-Lambert absorbance; puddles are a thin layer of it; mixing is ml-weighted absorbance.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PourSystem, BOTTLE_QUALITY, absorbanceOfSRGB, transmission, mixAbsorbance, liquidAbsorbance, REF_PATH_M }
  from '../src/vendor/extensions/bottles/index.js';

const RED = [0.9, 0.08, 0.08], BLUE = [0.08, 0.1, 0.9];
const close = (a, b, eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < eps);

function world(tier = 'low') {
  const scene = new THREE.Scene();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(4, 0.1, 4)); floor.position.y = -0.05; scene.add(floor);
  const factory = { bottles: new Set(), quality: 2, settings: BOTTLE_QUALITY[tier] };
  const pour = new PourSystem(scene, factory, { play() {} }, [floor]);
  return { scene, factory, pour };
}
/** A source that is not a bottle on the shelf: only its liquid colour matters. */
const source = (srgb, id) => ({ id, liquid: { info: { color: srgb } } });
const run = (pour, seconds = 1.5) => { for (let i = 0; i < seconds * 60; i++) pour.step(1 / 60); };

test('a puddle has the colour of the liquid it came from, lighter than in the bottle (thin layer)', () => {
  const { pour } = world('low');
  const red = source(RED, 'red');
  pour.initialMl = 20;
  pour.emit(20, new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(), red);
  assert.ok(close(pour.flights[0].absorbance, absorbanceOfSRGB(RED)), 'the drop carries the source absorbance');
  assert.notEqual(pour.flights[0].mesh.material, pour.material, 'drops are tinted, not the old fixed amber');
  run(pour);
  assert.equal(pour.puddles.length, 1);
  const p = pour.puddles[0], a = absorbanceOfSRGB(RED);
  assert.ok(close(p.absorbance, a), 'puddle absorbance = source absorbance');
  const depth = p.ml * 1e-6 / (Math.PI * p.radius ** 2);
  const expected = transmission(a, 2 * depth);
  const c = p.mesh.material.color;
  assert.ok(Math.abs(c.r - expected.r) < 1e-6 && Math.abs(c.g - expected.g) < 1e-6 && Math.abs(c.b - expected.b) < 1e-6,
    'flat tier: colour = transmission through the layer (down and back up)');
  const inBottle = transmission(a, REF_PATH_M);
  assert.ok(c.r > inBottle.r && c.g > inBottle.g && c.b > inBottle.b, 'a thin puddle is lighter than the bottle');
  assert.ok(c.r > c.g && c.r > c.b, 'and still red');
  assert.ok(p.mesh.material.opacity < 0.92 && p.mesh.material.opacity > 0.2);
  assert.ok(Math.abs(pour.ledger().errorMl) < 1e-6);
});

test('A + B in one puddle mixes by ml in absorbance space (red + blue = dark purple, not a grey average)', () => {
  const { pour } = world('high');
  pour.initialMl = 40;
  pour.emit(30, new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(), source(RED, 'red'));
  pour.emit(10, new THREE.Vector3(0.01, 0.3, 0), new THREE.Vector3(), source(BLUE, 'blue'));
  run(pour);
  assert.equal(pour.puddles.length, 1);
  const aR = absorbanceOfSRGB(RED), aB = absorbanceOfSRGB(BLUE);
  const expected = aR.map((v, i) => (30 * v + 10 * aB[i]) / 40);
  assert.ok(close(pour.puddles[0].absorbance, expected), `${pour.puddles[0].absorbance} vs ${expected}`);
  // Subtractive: equal parts of red and blue are darker than the linear-colour average.
  const half = mixAbsorbance([...aR], 1, aB, 1), mixed = transmission(half, REF_PATH_M);
  const r = transmission(aR, REF_PATH_M), b = transmission(aB, REF_PATH_M);
  assert.ok(mixed.r < (r.r + b.r) / 2 && mixed.b < (r.b + b.b) / 2 && mixed.g < (r.g + b.g) / 2);
  assert.ok(mixed.r > mixed.g && mixed.b > mixed.g, 'purple');
  const material = pour.puddles[0].mesh.material, colors = pour.puddles[0].mesh.geometry.getAttribute('color');
  assert.ok(material.vertexColors && colors.itemSize === 4, 'high tier: centre-to-rim vertex colour and alpha');
  assert.ok(colors.getW(0) > colors.getW(1), 'the thick centre is more opaque than the rim');
  assert.ok(Math.abs(pour.ledger().errorMl) < 1e-6);
});

test('puddles that grow into each other merge: volume adds, colour mixes', () => {
  const { pour } = world('low');
  pour.initialMl = 60;
  pour.emit(10, new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(), source(RED, 'red'));
  pour.emit(10, new THREE.Vector3(0.09, 0.3, 0), new THREE.Vector3(), source(BLUE, 'blue'));
  run(pour);
  assert.equal(pour.puddles.length, 2, 'apart at first');
  pour.emit(40, new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(), source(RED, 'red'));
  run(pour);
  assert.equal(pour.puddles.length, 1, 'the grown red puddle swallowed the blue one');
  const aR = absorbanceOfSRGB(RED), aB = absorbanceOfSRGB(BLUE);
  assert.ok(Math.abs(pour.puddles[0].ml - 60) < 1e-9);
  assert.ok(close(pour.puddles[0].absorbance, aR.map((v, i) => (50 * v + 10 * aB[i]) / 60)));
  assert.ok(Math.abs(pour.ledger().errorMl) < 1e-6);
});

test('pouring one bottle into another mixes the target and updates its liquid shader colour', () => {
  const { pour, factory } = world('mid');
  const root = new THREE.Group(); const liquidMesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.05));
  liquidMesh.position.y = 0.1; root.add(liquidMesh); root.updateMatrixWorld(true);
  const uniform = new THREE.Color().setRGB(...RED, THREE.SRGBColorSpace);
  const rim = Array.from({ length: 12 }, (_, i) => [Math.cos(i * Math.PI / 6) * 0.02, 0.2, Math.sin(i * Math.PI / 6) * 0.02]);
  const target = { id: 'glass', root, fillMl: 100, capacity: 500, open: true, broken: false, holes: [], lastPour: 0, radius: 0.03, height: 0.2,
    liquid: { liquid: liquidMesh, info: { color: RED, rim_points: rim }, uniforms: { uLiquidColor: { value: uniform } }, fill: 0.2, agitate() {},
      lut: { offset: () => 1, fillAt: () => 0, spill: (_up, fill) => ({ fill }) } } };
  factory.bottles.add(target); pour.register(target);
  assert.ok(close(liquidAbsorbance(target), absorbanceOfSRGB(RED), 1e-6), 'starts as its own liquid (from the shader uniform)');
  const before = [...target.absorbance];
  pour.initialMl += 100;
  pour.emit(100, new THREE.Vector3(0, 0.45, 0), new THREE.Vector3(), source(BLUE, 'blue'));
  run(pour);
  assert.ok(Math.abs(target.fillMl - 200) < 1e-9, 'the bottle caught all of it');
  const aB = absorbanceOfSRGB(BLUE), expected = before.map((v, i) => (v + aB[i]) / 2);
  assert.ok(close(target.absorbance, expected, 1e-9));
  const shader = transmission(expected, REF_PATH_M);
  assert.ok(Math.abs(uniform.r - shader.r) < 1e-9 && Math.abs(uniform.g - shader.g) < 1e-9 && Math.abs(uniform.b - shader.b) < 1e-9,
    'uLiquidColor = colour of the mix through the reference path');
  assert.ok(uniform.b > 0.02 && uniform.r > uniform.g, 'red + blue: purple');
  assert.equal(pour.puddles.length, 0);
  assert.ok(Math.abs(pour.ledger().errorMl) < 1e-6, 'the volume ledger still balances');
  // What it pours out next has the mixed colour.
  pour.emit(5, new THREE.Vector3(1, 0.3, 0), new THREE.Vector3(), target);
  assert.ok(close(pour.flights.at(-1).absorbance, expected));
});

test('refill with another liquid mixes; the drop-material cache stays bounded', () => {
  const { pour } = world('minimal');
  const b = { fillMl: 100, capacity: 500, liquid: { info: { color: RED }, fill: 0.2 } };
  pour.register(b);
  pour.refill(b, 300, absorbanceOfSRGB(BLUE));
  const aR = absorbanceOfSRGB(RED), aB = absorbanceOfSRGB(BLUE);
  assert.ok(close(b.absorbance, aR.map((v, i) => (v + 3 * aB[i]) / 4)));
  for (let i = 0; i < 300; i++) pour.emit(0.1, new THREE.Vector3(0, 5, 0), new THREE.Vector3(), null, 'x', [i * 0.03, (i % 17) * 0.2, (i % 5) * 0.7]);
  assert.ok(pour.dropMaterials.size <= 48);
  assert.ok(pour.flights.every(f => f.mesh.material));
});
