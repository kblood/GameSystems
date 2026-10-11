import test from 'node:test';
import assert from 'node:assert/strict';
import { createThermalSystem } from '../../extensions/thermal/index.js';
import { createPoolsSystem } from '../../extensions/pools/index.js';

function setup() {
  const thermal = createThermalSystem();
  thermal.addRoom('west'); thermal.addRoom('east');
  const pools = createPoolsSystem({ thermal });
  pools.deposit({ id: 'fuel', surfaceId: 'floor', roomId: 'west', position: [2, 0, 0], ml: 100, kind: 'diesel' });
  return { thermal, pools };
}

test('invalid snapshot fields leave pools and thermal objects untouched', () => {
  for (const change of [p => { p.blanket = NaN; }, p => { p.wetMl = -1; }, p => { p.sourceMl = -2; },
    p => { p.components = { toString: 100 }; }]) {
    const { thermal, pools } = setup(); pools.heat('fuel', 3000);
    const before = pools.save(), heatBefore = thermal.objects(), bad = structuredClone(before);
    change(bad.pools[0]);
    assert.throws(() => pools.restore(bad));
    assert.deepEqual(pools.save(), before);
    assert.deepEqual(thermal.objects(), heatBefore);
  }
});

test('restore preserves wet cooling and cannot immediately reignite a wet pool', () => {
  const { thermal, pools } = setup(); pools.ignite('fuel'); pools.cool('fuel', 20);
  const saved = pools.save(), wet = thermal.state('pool:fuel').wetMl;
  pools.restore(saved);
  assert.equal(thermal.state('pool:fuel').wetMl, wet);
  assert.equal(pools.ignite('fuel'), false);
});

test('burning below ignition but above extinction restores without extra ignition heat', () => {
  const { thermal, pools } = setup(); pools.ignite('fuel');
  thermal.configure('pool:fuel', { temperature: 100 });
  const saved = pools.save(); pools.restore(saved);
  assert.equal(pools.state('fuel').temperature, 100);
  assert.equal(pools.state('fuel').burning, true);
});

test('foreign thermal object id collision is rejected before existing pools are replaced', () => {
  const { thermal, pools } = setup();
  thermal.add('pool:foreign', { material: 'metal' });
  const before = pools.save(), bad = structuredClone(before); bad.pools[0].id = 'foreign';bad.activeOrder=['foreign'];
  assert.throws(() => pools.restore(bad));
  assert.deepEqual(pools.save(), before);
  assert.equal(thermal.state('pool:foreign').flammability, 0);
});

test('restore keeps explicit thermal links to pool ids that still exist', () => {
  const { thermal, pools } = setup(); thermal.add('pipe', { fuelJ: 0, cooling: 0, temperature: 20 });
  pools.heat('fuel', 5000); thermal.connect('pool:fuel', 'pipe', 10);
  pools.restore(pools.save()); thermal.step(1);
  assert.ok(thermal.state('pipe').temperature > 20);
});

test('existing pool id accepts context-free refill but rejects another surface or room', () => {
  const { pools } = setup(); pools.deposit({ id: 'fuel', ml: 10, kind: 'water' });
  assert.equal(pools.state('fuel').components.water, 10);
  const before = pools.save();
  assert.throws(() => pools.deposit({ id: 'fuel', surfaceId: 'different', ml: 10, kind: 'diesel' }));
  assert.throws(() => pools.deposit({ id: 'fuel', roomId: 'east', ml: 10, kind: 'diesel' }));
  assert.deepEqual(pools.save(), before);
});

test('restored generated pool ids cannot be silently reused for a new distant deposit', () => {
  const { pools } = setup(); const saved = pools.save(); saved.pools[0].id = 'puddle-1';saved.activeOrder=['puddle-1']; saved.nextId = 1;
  pools.restore(saved); const added = pools.deposit({ surfaceId: 'other', position: [5, 0, 0], ml: 50, kind: 'water' });
  assert.notEqual(added.id, 'puddle-1'); assert.equal(pools.all().length, 2);
  assert.equal(pools.state('puddle-1').ml, 100);
});

test('snapshot source attribution is detached and checked before restore', () => {
  const { pools } = setup(); const before = pools.save(), bad = structuredClone(before);
  bad.pools[0].sources.external.diesel = 200;
  assert.throws(() => pools.restore(bad)); assert.deepEqual(pools.save(), before);
  const state = pools.state('fuel'); state.sources.external.diesel = 0;
  assert.equal(pools.state('fuel').sources.external.diesel, 100);
});
