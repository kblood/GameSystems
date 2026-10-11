import test from 'node:test';
import assert from 'node:assert/strict';
import { createThermalSystem } from '../../extensions/thermal/index.js';

test('invalid multi-field configuration leaves the live fire unchanged', () => {
  const t = createThermalSystem(); t.add('wood'); t.ignite('wood');
  const before = t.state('wood');
  assert.throws(() => t.configure('wood', { flammability: 0, heatCapacity: 0 }));
  assert.deepEqual(t.state('wood'), before);
  assert.throws(() => t.configure('wood', { ignition: 50, burnPower: NaN }));
  assert.deepEqual(t.state('wood'), before);
});

test('lowering temperature past extinction turns off combustion immediately', () => {
  const t = createThermalSystem(); t.add('wood'); t.ignite('wood');
  t.configure('wood', { temperature: t.state('wood').extinction - 1 });
  assert.equal(t.state('wood').burning, false);
  assert.equal(t.state('wood').intensity, 0);
});

test('explicit extinction threshold stays independent of ignition edits', () => {
  const t = createThermalSystem(); t.add('wood', { extinction: 80 });
  t.configure('wood', { ignition: 200 });
  assert.equal(t.state('wood').extinction, 80);
  const before = t.state('wood');
  assert.throws(() => t.configure('wood', { ignition: 60 }));
  assert.deepEqual(t.state('wood'), before);
});

test('NaN oxygen cutoff and unsafe step budgets are rejected', () => {
  assert.throws(() => createThermalSystem({ oxygenCutoff: NaN }));
  const t = createThermalSystem({ fixedStep: 1e-12 }); t.add('wood');
  const before = t.state('wood'), stats = t.stats();
  assert.throws(() => t.step(1));
  assert.deepEqual(t.state('wood'), before);
  assert.deepEqual(t.stats(), stats);
});

test('automatic spread does not change when the same objects register in another order', () => {
  function run(order) {
    const t = createThermalSystem({ autoSpread: true, maxNeighbours: 1, spreadRadius: 1, spreadConductance: 10 });
    for (const id of order) t.add(id, { position: [({ a: 0, b: .1, c: .2 })[id], 0, 0],
      temperature: id === 'a' ? 500 : 20, fuelJ: 0, cooling: 0 });
    t.step(1);
    return ['a', 'b', 'c'].map(id => t.state(id).temperature);
  }
  assert.deepEqual(run(['a', 'b', 'c']), run(['c', 'b', 'a']));
});
