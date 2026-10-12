import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupplySystem, createFuelAdapter } from '../../extensions/supply/index.js';
import { createSprinklerSystem } from '../../extensions/sprinklers/index.js';
import { createThermalSystem } from '../../extensions/thermal/index.js';
import { createEnergyStore } from '../../extensions/electricity/storage.js';
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
function setup({ water = 100, rate = 100, heads = 1, powered } = {}) {
  const supply = createSupplySystem(), thermal = createThermalSystem(), events = [];
  supply.add('tank', { capacityMl: 1000, components: { water } });
  thermal.addRoom('room'); thermal.add('chair', { roomId: 'room', position: [0, 0, 0], temperature: 300, cooling: 0 });
  const system = createSprinklerSystem({ supply, thermal, powered, emit: (name, data) => events.push([name, data]) });
  for (let i = 0; i < heads; i++) system.add(`h${i}`, { tankId: 'tank', roomId: 'room', rateMlPerSecond: rate, responseSeconds: 0.01 });
  return { supply, thermal, system, events };
}
test('supply: proportional mixes, overflow, transfer and conservation', () => {
  const s = createSupplySystem(); s.add('a', { capacityMl: 100, components: { water: 20, diesel: 20 } }); s.add('b', { capacityMl: 10 });
  near(s.fill('a', 100, { kind: 'oil' }).acceptedMl, 60);
  const output = s.transfer('a', 'b', 20); near(output.ml, 10); near(output.components.diesel, 2);
  const draw = s.draw('a', 1000); near(draw.ml, 90); near(s.state('a').ml, 0);
  for (const t of s.all()) near(t.initialMl + t.filledMl - t.drawnMl, t.ml);
});
test('supply: invalid mixture is atomic and unusual kind names survive', () => {
  const s = createSupplySystem(); s.add('a'); const before = s.capture();
  assert.throws(() => s.fill('a', 10, { components: { water: 9 } })); assert.deepEqual(s.capture(), before);
  s.fill('a', 10, { kind: '__proto__' }); near(s.draw('a', 5).components.__proto__, 5);
});
test('supply: checkpoint detaches and validates all tanks before commit', () => {
  const s = createSupplySystem(); s.add('a', { components: { water: 20 } }); s.add('b');
  const saved = s.capture(), plan = s.prepareRestore(saved); saved.tanks[0].components.water = 999;
  s.draw('a', 10); plan.commit(); near(s.state('a').ml, 20);
  const bad = s.capture(); bad.tanks[1].drawnMl = 5; const before = s.capture();
  assert.throws(() => s.restore(bad)); assert.deepEqual(s.capture(), before);
});
test('supply: reentrant observer batches defer the rest of the notification queue', () => {
  const events = []; let supply, nestedToken = null, armed = false;
  supply = createSupplySystem({ emit: (_name, state) => {
    events.push([state.id, state.ml]);
    if (armed && state.id === 'a' && nestedToken === null) {
      nestedToken = supply.beginBatch();
      supply.draw('b', 1);
    }
  } });
  supply.add('a', { capacityMl: 10, components: { water: 10 } });
  supply.add('b', { capacityMl: 10, components: { water: 10 } });
  events.length = 0; armed = true;
  const token = supply.beginBatch(); supply.draw('a', 1); supply.flush(token);
  assert.deepEqual(events, [['a', 9]], 'the new batch prevents remaining queued notifications from leaking through');
  supply.flush(nestedToken);
  assert.deepEqual(events, [['a', 9], ['b', 9]], 'the deferred tank state is published exactly once when its batch closes');
});
test('vehicle fuel adapter converts units and leaves wrong fuel in storage', () => {
  const events = [], s = createSupplySystem({ emit: name => events.push(name) }); s.add('car', { capacityMl: 5000 }); const a = createFuelAdapter(s, 'car');
  events.length = 0;
  near(a.refill(2), 2); assert.deepEqual(events, ['supply:changed']);
  near(a.refill(1, 'diesel'), 1); near(a.state().amountL, 2);
  near(a.consume(0.5), 0.5); assert.equal(events.filter(name => name === 'supply:changed').length, 3,
    'direct adapter transfers keep the synchronous supply notification contract');
  near(a.consume(5), 1.5); near(s.state('car').components.diesel, 1000); near(a.state().amountL, 0);
});
test('sprinkler triggers from heat, extinguishes, runs dry and keeps discharged volume', () => {
  const { system, thermal, supply, events } = setup(); thermal.ignite('chair'); system.step(2);
  assert.equal(system.state('h0').triggered, true); assert.equal(thermal.state('chair').burning, false);
  near(supply.state('tank').ml, 0); near(system.state('h0').deliveredMl, 100);
  near(events.filter(([n]) => n === 'liquid:deposit').reduce((n, [, e]) => n + e.ml, 0), 100);
  near(system.state('h0').flowMlPerSecond, 0);
});
test('sprinkler heads share limited supply fairly', () => {
  const { system, supply } = setup({ water: 15, heads: 2 }); system.step(0.1);
  near(system.state('h0').deliveredMl, 7.5); near(system.state('h1').deliveredMl, 7.5); near(supply.state('tank').ml, 0);
});
test('sprinkler respects rooms and supply fluid identity', () => {
  const { system, supply, thermal, events } = setup({ water: 0 }); supply.fill('tank', 100, { kind: 'diesel' });
  thermal.addRoom('other'); thermal.add('other-chair', { roomId: 'other', temperature: 400, cooling: 0 });
  system.step(1); near(thermal.state('chair').temperature, 300); near(thermal.state('other-chair').wetMl, 0);
  assert.equal(events.find(([n]) => n === 'liquid:deposit')[1].components.diesel, 10);
});
test('sprinkler valve and optional power gate consume nothing while shut off', () => {
  let powered = false; const { system, supply } = setup({ powered: () => powered }); system.step(1); near(supply.state('tank').ml, 100);
  powered = true; system.setOpen('h0', false); system.step(1); near(supply.state('tank').ml, 100);
  system.setOpen('h0', true); system.step(0.1); near(supply.state('tank').ml, 90);
});
test('sprinkler fixed steps preserve outcome across quality and timestep', () => {
  const a = setup({ water: 1000 }), b = setup({ water: 1000 }); b.system.setQuality('minimal');
  a.system.step(1); for (let i = 0; i < 100; i++) b.system.step(0.01);
  near(a.supply.state('tank').ml, b.supply.state('tank').ml); near(a.thermal.state('chair').temperature, b.thermal.state('chair').temperature);
});
test('sprinkler checkpoint restores phase and trigger; invalid restore is atomic', () => {
  const { system } = setup(); system.step(0.15); const saved = system.capture(); system.reset('h0'); system.restore(saved);
  assert.deepEqual(system.capture(), saved); const bad = structuredClone(saved); bad.heads[0].tankId = 'other';
  assert.throws(() => system.restore(bad)); assert.deepEqual(system.capture(), saved);
  assert.throws(() => system.step(11)); assert.deepEqual(system.capture(), saved);
});
test('sprinkler rejects reentrant steps and restore commits during spray callbacks', () => {
  const supply = createSupplySystem(), thermal = createThermalSystem(); supply.add('tank', { capacityMl: 100, components: { water: 100 } });
  thermal.addRoom('room'); thermal.add('chair', { roomId: 'room', position: [0, 0, 0], temperature: 300, cooling: 0 });
  let system, plan, restoringNotify = false, nestedStepError = '', nestedCaptureError = '', nestedPrepareError = '', nestedRestoreError = '', restoreCaptureError = '';
  const mutationErrors = [];
  system = createSprinklerSystem({ supply, thermal, emit: name => {
    if (restoringNotify && name === 'sprinklers:changed') {
      try { system.capture(); } catch (error) { restoreCaptureError = error.message; }
      return;
    }
    if (name !== 'sprinklers:spray') return;
    try { system.step(0.1); } catch (error) { nestedStepError = error.message; }
    try { system.capture(); } catch (error) { nestedCaptureError = error.message; }
    try { system.prepareRestore({}); } catch (error) { nestedPrepareError = error.message; }
    try { plan.commit(); } catch (error) { nestedRestoreError = error.message; }
    for (const mutate of [
      () => system.add('late', { tankId: 'tank' }),
      () => system.setOpen('head', false),
      () => system.trigger('head'),
      () => system.reset('head'),
      () => system.dispose(),
    ]) { try { mutate(); } catch (error) { mutationErrors.push(error.message); } }
  } });
  system.add('head', { tankId: 'tank', roomId: 'room', rateMlPerSecond: 100 }); system.trigger('head');
  plan = system.prepareRestore(system.capture());
  system.step(0.1);
  assert.match(nestedStepError, /during a sprinkler step/); assert.match(nestedCaptureError, /during a sprinkler step/);
  assert.match(nestedPrepareError, /during a sprinkler step/);
  assert.match(nestedRestoreError, /during a sprinkler step/);
  assert.equal(mutationErrors.length, 5); assert.ok(mutationErrors.every(message => message.includes('during a sprinkler step')));
  assert.equal(system.state('head').open, true); assert.equal(system.all().length, 1, 'callbacks cannot mutate the live head registry');
  near(supply.state('tank').ml, 90); near(system.state('head').deliveredMl, 10);
  assert.doesNotThrow(() => system.prepareRestore(system.capture()));
  plan.commit(); restoringNotify = true; plan.notify(); restoringNotify = false;
  assert.match(restoreCaptureError, /during a sprinkler step or restore/);
  assert.equal(system.state('head').deliveredMl, 0, 'restore works after the active tick exits');
});
test('sprinkler releases its step guard after callback failure and blocks invalid partial checkpoints', () => {
  const supply = createSupplySystem(), thermal = createThermalSystem(); supply.add('tank', { capacityMl: 100, components: { water: 100 } });
  thermal.addRoom('room'); thermal.add('chair', { roomId: 'room', position: [0, 0, 0], temperature: 300, cooling: 0 });
  let throwOnce = true;
  const system = createSprinklerSystem({ supply, thermal,
    powerFraction: () => { if (throwOnce) { throwOnce = false; throw new Error('pump callback failed'); } return 1; } });
  system.add('head', { tankId: 'tank', roomId: 'room', rateMlPerSecond: 100 }); system.trigger('head');
  assert.throws(() => system.step(0.2), /pump callback failed/);
  near(supply.state('tank').ml, 100);
  assert.throws(() => system.capture(), /unprocessed sprinkler steps/);
  system.step(0);
  near(supply.state('tank').ml, 90); near(system.state('head').deliveredMl, 10);
  near(system.capture().pending, 0);
});
test('sprinkler completes liquid effects before surfacing a spray observer error', () => {
  const supply = createSupplySystem(), thermal = createThermalSystem(), events = [];
  supply.add('tank', { capacityMl: 100, components: { water: 100 } });
  thermal.addRoom('room'); thermal.add('chair', { roomId: 'room', position: [0, 0, 0], temperature: 300, cooling: 0 });
  let failSpray = true;
  const system = createSprinklerSystem({ supply, thermal, emit: name => {
    events.push(name);
    if (name === 'sprinklers:spray' && failSpray) { failSpray = false; throw new Error('spray observer failed'); }
  } });
  system.add('head', { tankId: 'tank', roomId: 'room', rateMlPerSecond: 100 }); system.trigger('head');
  assert.throws(() => system.step(0.1), /spray observer failed/);
  near(supply.state('tank').ml, 90); near(system.state('head').deliveredMl, 10);
  assert.ok(events.includes('liquid:deposit'), 'puddle deposit still emits before observer error returns');
  near(system.capture().pending, 0);
  system.step(0.1);
  near(supply.state('tank').ml, 80); near(system.state('head').deliveredMl, 20);
});
test('battery supplies bounded energy, charges and balances portable state', () => {
  const b = createEnergyStore({ capacityWh: 2 }); near(b.supplyWatts(3600, 1), 3600); near(b.draw(9), 1); near(b.draw(1), 0);
  near(b.charge(5), 2); b.setEnabled(false); near(b.draw(1), 0);
  const saved = b.capture(); b.setEnabled(true); b.draw(1); b.restore(saved); assert.deepEqual(b.capture(), saved);
  const bad = { ...saved, energyWh: NaN }; assert.throws(() => b.restore(bad)); assert.deepEqual(b.capture(), saved);
  assert.throws(() => b.draw(-1));
});
test('disabled electricity store preserves partial charge and ledgers until enabled refund and fill', () => {
  const battery = createEnergyStore({ capacityWh: 10, energyWh: 2, enabled: false });
  const before = battery.capture();
  near(battery.draw(1), 0); near(battery.charge(3), 0); assert.deepEqual(battery.capture(), before);
  battery.setEnabled(true);
  near(battery.draw(1.25), 1.25); near(battery.charge(1.25), 1.25); near(battery.state().energyWh, 2);
  near(battery.charge(20), 8);
  const after = battery.state(); near(after.energyWh, 10);
  near(after.initialWh + after.chargedWh - after.suppliedWh, after.energyWh);
});
test('disposed supply, sprinkler and battery reject mutation', () => {
  const { system, supply } = setup(); system.dispose(); assert.throws(() => system.step(1)); supply.dispose(); assert.throws(() => supply.fill('tank', 1));
  const b = createEnergyStore(); b.dispose(); assert.throws(() => b.charge(1));
});
