// Fire in the bottle demo (bar-fire.js): strong alcohol is a burnable liquid kind (pools LIQUID_FIRE_PRESETS 'spirits'),
// wine and unknown liquids are not, and the demo tags its catalog items accordingly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createThermalSystem } from '../src/vendor/extensions/thermal/index.js';
import { createPoolsSystem, LIQUID_FIRE_PRESETS } from '../src/vendor/extensions/pools/index.js';
import { liquidKindOf } from '../src/bar-fire.js';

function world() {
  let pools = null; // the pools extension's own wiring: burned thermal energy consumes the pool's liquid
  const thermal = createThermalSystem({ emit: (type, data) => { if (type === 'thermal:burned') pools.burned(data.id, data.joules); } });
  pools = createPoolsSystem({ thermal });
  return { thermal, pools };
}

test('spilled spirits light and burn down; wine and unknown liquids do not', () => {
  const { thermal, pools } = world();
  const spirits = pools.deposit({ ml: 120, kind: 'spirits', position: [0, 0, 0], surfaceId: 'floor' }).id;
  const wine = pools.deposit({ ml: 120, kind: 'wine', position: [2, 0, 0], surfaceId: 'floor' }).id;
  const beer = pools.deposit({ ml: 120, kind: 'beer', position: [4, 0, 0], surfaceId: 'floor' }).id;
  assert.equal(pools.ignite(wine), false); assert.equal(pools.ignite(beer), false);
  assert.ok(pools.ignite(spirits));
  const before = pools.state(spirits).ml;
  for (let i = 0; i < 40; i++) thermal.step(0.05);
  const after = pools.state(spirits);
  assert.ok(after.burning, 'still burning after 2 s'); assert.ok(after.ml < before, `fuel is consumed (${after.ml} < ${before})`);
});

test('spirits light easier but carry less energy and smoke less than diesel', () => {
  const { spirits, diesel } = LIQUID_FIRE_PRESETS;
  assert.ok(spirits.ignition < diesel.ignition && spirits.fuelJPerMl < diesel.fuelJPerMl && spirits.smokeYield < diesel.smokeYield);
});

test('the demo tags diesel, strong alcohol and wine from the catalog ids', () => {
  assert.equal(liquidKindOf('container_jerrycan', 'container_jerrycan_fuel'), 'diesel');
  for (const id of ['bottle_whiskey', 'bottle_v2_whisky', 'bottle_v2_spirit', 'container_hipflask']) assert.equal(liquidKindOf(id), 'spirits', id);
  assert.equal(liquidKindOf('bottle_wine'), 'wine'); assert.equal(liquidKindOf('bottle_v2_bordeaux'), 'wine');
  assert.equal(liquidKindOf('bottle_beer'), undefined); assert.equal(liquidKindOf('container_jerrycan', ''), undefined);
});

test('pouring more fuel onto a burning pool feeds it; water still puts it out', () => {
  const { thermal, pools } = world();
  const id = pools.deposit({ ml: 60, kind: 'spirits', position: [0, 0, 0], surfaceId: 'floor' }).id;
  assert.ok(pools.ignite(id));
  pools.deposit({ id, ml: 160, kind: 'spirits', position: [0, 0, 0], surfaceId: 'floor' });
  for (let i = 0; i < 10; i++) thermal.step(0.05);
  assert.ok(pools.state(id).burning, 'a burning pool fed with more spirits keeps burning');
  pools.deposit({ id, ml: 400, kind: 'water', position: [0, 0, 0], surfaceId: 'floor' });
  for (let i = 0; i < 10; i++) thermal.step(0.05);
  assert.equal(pools.state(id).burning, false, 'water quenches it');
});
