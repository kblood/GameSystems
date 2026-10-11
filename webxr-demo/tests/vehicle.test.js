import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import vehicle, { createVehicleSystem, createFuelStore, createBatteryStore, VEHICLE_PARTS } from '../../extensions/vehicle/index.js';
import { bindVehicleVisual } from '../../extensions/vehicle/visuals.js';
import { createSupplySystem, createFuelAdapter } from '../../extensions/supply/index.js';
import { createEnergyStore } from '../../extensions/electricity/storage.js';
import { createHost } from '../../extensions/host/host.js';

const near = (a, b, e = 1e-7) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
test('vehicle: standalone stores conserve resources and reject invalid input', () => {
  const fuel = createFuelStore({ capacityL: 10, amountL: 8 });
  near(fuel.consume(3), 3); near(fuel.refill(7), 5); near(fuel.refill(2, 'water'), 0); near(fuel.consume(20), 10);
  assert.throws(() => fuel.consume(-1)); assert.throws(() => fuel.refill(NaN));
  const battery = createBatteryStore({ capacityWh: 10, energyWh: 8 });
  near(battery.draw(3), 3); near(battery.charge(7), 5); near(battery.draw(20), 10); near(battery.state().voltage, 0);
  battery.setEnabled(false); near(battery.charge(2), 0); near(battery.draw(1), 0);
});
test('vehicle: start gates fuel, compatible fluid and finite starter energy', () => {
  const s = createVehicleSystem();
  s.add('empty', { fuel: createFuelStore({ amountL: 0 }) }); assert.equal(s.start('empty').reason, 'fuel-empty');
  s.add('wrong', { fuel: createFuelStore({ kind: 'water' }) }); assert.equal(s.start('wrong').reason, 'wrong-fuel');
  s.add('flat', { power: createBatteryStore({ energyWh: 0 }) }); assert.equal(s.start('flat').reason, 'battery-flat');
  s.add('car'); const before = s.state('car').power.energyWh;
  assert.equal(s.start('car').started, true); near(before - s.state('car').power.energyWh, .35);
  s.start('car'); near(before - s.state('car').power.energyWh, .35);
});
test('vehicle: adapters must declare reversible transfers before they can be bound', () => {
  const s=createVehicleSystem();
  const fuel={state:()=>({amountL:10,capacityL:10,kind:'petrol'}),consume:()=>0,refill:()=>0};
  assert.throws(()=>s.add('unsafe',{fuel,power:createBatteryStore()}),/reversible transfers must be declared/);
  s.dispose();
});
test('vehicle: fuel exhaustion stops exactly once without negative fuel', () => {
  const events = [], s = createVehicleSystem({ emit: (...args) => events.push(args) });
  s.add('car', { fuel: createFuelStore({ amountL: .001 }) }); s.start('car'); s.step(10);
  const state = s.state('car'); near(state.fuel.amountL, 0); near(state.consumedL, .001);
  assert.equal(state.running, false); assert.equal(state.lastStop, 'fuel-empty');
  s.step(10); assert.equal(events.filter(([event]) => event === 'vehicle:stopped').length, 1);
});
test('vehicle: partial runtime power delivery limits fuel consumption to the powered interval', () => {
  let started = false;
  const power = {
    reversible: true,
    state: () => ({ energyWh: 10, capacityWh: 10, voltage: 12.6, enabled: true }),
    draw(wh) { if (!started) { started = true; return wh; } return 0; },
    charge: () => 0,
  };
  const fuel = createFuelStore({ amountL: 10 });
  const s = createVehicleSystem(); s.add('car', { fuel, power, idleLps: 1, driveLps: 0, alternatorW: 0 });
  assert.equal(s.start('car').started, true);
  s.step(1);
  near(fuel.state().amountL, 10);
  near(s.state('car').consumedL, 0);
  assert.equal(s.state('car').running, false);
  assert.equal(s.state('car').lastStop, 'power-loss');
});
test('vehicle: supply observers cannot block a partial-power fuel refund', () => {
  const events = [];
  const supply = createSupplySystem({ emit: (name, value) => {
    events.push(name);
    if (name === 'supply:changed' && supply.state('tank').freeMl > 0) supply.fill('tank', supply.state('tank').freeMl, { kind: 'water' });
  } });
  supply.add('tank', { capacityMl: 1000, components: { petrol: 1000 } });
  supply.add('x', { capacityMl: 1, components: { water: 1 } }); supply.add('y', { capacityMl: 1 });
  let energy = .36, drawCount = 0, cars, fuel;
  const power = {
    reversible: true,
    state: () => ({ energyWh: energy, capacityWh: 1, voltage: 12.6, enabled: true }),
    draw(wh) { drawCount++; if (drawCount === 1) { energy -= .35; return Math.min(wh, .35); } cars.withdrawFuel('car', 0); fuel.flush(); supply.transfer('x','y',1); return 0; },
    charge: () => 0,
  };
  fuel = createFuelAdapter(supply, 'tank');
  cars = createVehicleSystem(); cars.add('car', { fuel, power, idleLps: 1, driveLps: 0, alternatorW: 0 });
  assert.equal(cars.start('car').started, true);
  assert.doesNotThrow(() => cars.step(1));
  assert.equal(cars.state('car').lastStop, 'power-loss');
  assert.ok(supply.state('tank').components.petrol >= 999.999);
  assert.equal(supply.state('tank').components.water, undefined);
  assert.ok(events.includes('supply:changed'));
});
test('vehicle: partial fuel delivery limits battery draw to the actual engine interval', () => {
  let amountL=10;
  const fuel={
    reversible:true,
    state:()=>({amountL,capacityL:10,kind:'petrol'}),
    consume(liters){const taken=Math.min(liters,amountL,.1);amountL-=taken;return taken;},
    refill(liters){const taken=Math.min(liters,10-amountL);amountL+=taken;return taken;},
  };
  const power=createBatteryStore({capacityWh:10,energyWh:10});
  const s=createVehicleSystem();s.add('car',{fuel,power,idleLps:1,driveLps:0,alternatorW:0});
  assert.equal(s.start('car').started,true);const before=power.state().energyWh;
  s.step(1);
  // 0.1 s running at 88 W, followed by 0.9 s of 3 W idle consumption.
  near(before-power.state().energyWh,(88*.1+3*.9)/3600);
  near(s.state('car').consumedL,.1);
  assert.equal(s.state('car').running,false);
});
test('vehicle: lights drain a parked battery and alternator recharges while running', () => {
  const s = createVehicleSystem(); s.add('car', { power: createBatteryStore({ energyWh: .5 }) });
  s.setLights('car', true); s.step(3600); near(s.state('car').power.energyWh, 0); assert.equal(s.state('car').electrics, false);
  near(s.charge('car', 10), 10); s.start('car'); const before = s.state('car').power.energyWh; s.step(10);
  assert.ok(s.state('car').power.energyWh > before); assert.equal(s.state('car').electrics, true);
});
test('vehicle: swappable public supply/power adapters use petrol only and preserve state', () => {
  const supply = createSupplySystem(); supply.add('tank', { capacityMl: 52000, components: { petrol: 1000, water: 100 } });
  const power = createEnergyStore({ capacityWh: 720, energyWh: 400, voltage: 12.6 });
  const fuel = createFuelAdapter(supply, 'tank', { kind: 'petrol' });
  const s = createVehicleSystem(); s.add('car', { fuel, power }); s.start('car'); s.step(10);
  assert.ok(supply.state('tank').components.petrol < 1000); near(supply.state('tank').components.water, 100);
  near(s.state('car').fuel.amountL * 1000, supply.state('tank').components.petrol);
  const old = fuel.state().amountL; s.setAdapters('car', { fuel: createFuelStore({ amountL: 5 }) }); s.step(10);
  near(fuel.state().amountL, old); assert.ok(s.state('car').fuel.amountL < 5);
});
test('vehicle: disabled resource modes bypass stores explicitly', () => {
  const s = createVehicleSystem(); s.add('car', { fuel: createFuelStore({ amountL: 0 }), power: createBatteryStore({ energyWh: 0 }), resourceModes: { fuel: 'disabled', power: 'disabled' } });
  assert.equal(s.start('car').started, true); s.setControls('car', { handbrake: false, throttle: 1 }); s.step(1);
  const state = s.state('car'); assert.ok(state.speed > 0); assert.ok(state.position[2] > 0); near(state.fuel.amountL, 0); near(state.power.energyWh, 0);
  assert.throws(() => s.setModes('car', { fuel: 'infinite' }));
});
test('vehicle: all seven panels animate, lock and refueling uses the physical flap', () => {
  const s = createVehicleSystem(); s.add('car'); const before = s.state('car').fuel.amountL;
  near(s.refuel('car', 5), 0);
  for (const part of Object.keys(VEHICLE_PARTS)) assert.equal(s.setPart('car', part, 1), true);
  s.step(1); for (const part of Object.values(s.state('car').parts)) near(part.fraction, 1);
  near(s.refuel('car', 5, 'water'), 0); near(s.refuel('car', 5), 5); near(s.state('car').fuel.amountL, before + 5);
  s.setLocked('car', 'door_fl', true); assert.equal(s.setPart('car', 'door_fl', 0), false);
  s.start('car'); near(s.refuel('car', 5), 0);
});
test('vehicle: defensive snapshots, atomic invalid controls/adapters, disposal', () => {
  const s = createVehicleSystem(); s.add('car'); const state = s.state('car'); state.parts.hood.fraction = 1; state.position[0] = 99;
  near(s.state('car').parts.hood.fraction, 0); near(s.state('car').position[0], 0);
  assert.throws(() => s.setControls('car', { throttle: 1, steer: NaN })); near(s.state('car').controls.throttle, 0);
  assert.throws(() => s.setAdapters('car', { fuel: createFuelStore({ amountL: 1 }), power: {} })); near(s.state('car').fuel.amountL, 28);
  assert.throws(() => s.step(-1)); s.dispose(); assert.throws(() => s.step(1)); assert.throws(() => s.add('new'));
});
test('vehicle: visual binding rotates exact pivots without accumulated transforms', () => {
  const root = new THREE.Group();
  for (const part of Object.values(VEHICLE_PARTS)) { const object = new THREE.Group(); object.name = part.node; root.add(object); }
  const s = createVehicleSystem(); s.add('car'); const binding = bindVehicleVisual(root, { THREE });
  s.setPart('car', 'door_fl', 1); s.setPart('car', 'hood', 1); s.step(1);
  binding.update(s.state('car')); const q = root.getObjectByName('Door_FL').quaternion.clone(); binding.update(s.state('car'));
  near(q.angleTo(root.getObjectByName('Door_FL').quaternion), 0); near(root.getObjectByName('Hood').rotation.x, -1.1);
  binding.dispose(); assert.throws(() => bindVehicleVisual(new THREE.Group(), { THREE }));
});
test('vehicle: optional host module loads and runs without fluid/electricity dependencies', async () => {
  const host = createHost(); const api = await host.load(vehicle); assert.ok(api); api.add('car'); assert.equal(api.start('car').started, true); host.dispose();
});
test('vehicle: exported asset includes physical pivots, PBR and all opening animations', () => {
  const path = new URL('../../export/vehicles/aster_sedan.glb', import.meta.url); assert.ok(existsSync(path), 'Rebuild scripts/car_aster.py');
  const data = readFileSync(path); assert.equal(data.readUInt32LE(0), 0x46546c67);
  const gltf = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
  const metadata = JSON.parse(readFileSync(new URL('../../export/vehicles/aster_sedan.vehicle.json', import.meta.url)));
  for (const [key, part] of Object.entries(VEHICLE_PARTS)) {
    const node = gltf.nodes.find(n => n.name === part.node); assert.ok(node, part.node); assert.ok(node.children?.length);
    assert.ok(Math.hypot(...(node.translation || [])) > .1, `${part.node} pivot must not be origin`);
    near(metadata.parts[key].openAngleRad, part.angle);
    assert.ok(gltf.animations.some(a => a.name === `Open_${part.node}`), `animation ${part.node}`);
  }
  assert.ok(gltf.materials.some(m => m.extensions?.KHR_materials_clearcoat));
  assert.ok(gltf.materials.some(m => m.extensions?.KHR_materials_transmission));
  assert.ok(gltf.meshes.length <= 130, `${gltf.meshes.length} runtime meshes exceed budget`);
  const lowData = readFileSync(new URL('../../export/vehicles/aster_sedan_low.glb', import.meta.url));
  const low = JSON.parse(lowData.subarray(20, 20 + lowData.readUInt32LE(12)).toString());
  const triangles = asset => asset.meshes.flatMap(m => m.primitives).reduce((sum, p) => sum + asset.accessors[p.indices].count / 3, 0);
  assert.ok(triangles(low) < 100000 && triangles(low) < triangles(gltf) * .5, 'Low model must stay below its triangle budget');
  for (const part of Object.values(VEHICLE_PARTS)) {
    const hiNode = gltf.nodes.find(n => n.name === part.node), lowNode = low.nodes.find(n => n.name === part.node);
    assert.deepEqual(lowNode.translation, hiNode.translation); assert.ok(low.animations.some(a => a.name === `Open_${part.node}`));
  }
});
