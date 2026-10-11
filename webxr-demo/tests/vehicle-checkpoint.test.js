import test from 'node:test';
import assert from 'node:assert/strict';
import {createVehicleSystem,createFuelStore,createBatteryStore} from '../../extensions/vehicle/index.js';
import {createSupplySystem,createFuelAdapter} from '../../extensions/supply/index.js';
import {createEnergyStore} from '../../extensions/electricity/storage.js';
import {createVehicleSceneProvider} from '../../extensions/checkpoint/vehicle-scene.js';
import {createCheckpointSystem} from '../../extensions/checkpoint/index.js';
function scene(){const supply=createSupplySystem();supply.add('tank',{capacityMl:52000,components:{petrol:28000,water:100}});const sharedPower=createEnergyStore({capacityWh:720,energyWh:540,voltage:12.6}),standaloneFuel=createFuelStore(),standalonePower=createBatteryStore(),vehicles=createVehicleSystem();
  vehicles.registerAdapters('shared',{fuel:createFuelAdapter(supply,'tank'),power:sharedPower});vehicles.registerAdapters('standalone',{fuel:standaloneFuel,power:standalonePower});vehicles.add('car',{adapterKey:'shared'});
  const application={capture:()=>({}),prepareRestore:()=>({commit(){}})},provider=createVehicleSceneProvider({vehicles,supply,sharedPower,standaloneFuel,standalonePower,tankId:'tank',application}),cp=createCheckpointSystem({sceneId:'car'});cp.register('scene',provider);return {vehicles,supply,sharedPower,standaloneFuel,standalonePower,cp};}
test('owned car checkpoint restores movement, panel animation, engine and reserves with neutral inputs',()=>{
  const cars=createVehicleSystem();cars.add('car');cars.start('car');cars.setPart('car','hood',1);cars.setControls('car',{throttle:.5,steer:.3,handbrake:false});cars.step(.2);const saved=cars.capture();cars.step(1);cars.restore(saved);
  assert.deepEqual(cars.capture(),saved);assert.equal(cars.state('car').controls.throttle,0);assert.equal(cars.state('car').controls.steer,0);assert.equal(cars.state('car').running,true);cars.step(.1);assert.ok(cars.state('car').parts.hood.fraction>saved.vehicles[0].parts.hood.fraction);
});
test('named scene checkpoint restores inactive reserves, source mixture and previous adapter binding',()=>{
  const w=scene();w.vehicles.start('car');w.vehicles.step(1);const saved=w.cp.capture();w.vehicles.bindAdapters('car','standalone');w.vehicles.step(2);w.sharedPower.draw(100);w.supply.fill('tank',1000,{kind:'diesel'});w.cp.restore(saved);
  assert.deepEqual(w.cp.capture(),saved);assert.equal(w.vehicles.state('car').adapterKey,'shared');assert.equal(w.supply.state('tank').components.water,100);
});
test('disabled modes and standalone binding restore without charging starter twice',()=>{
  const w=scene();w.vehicles.bindAdapters('car','standalone');w.vehicles.setModes('car',{fuel:'disabled',power:'disabled'});w.vehicles.start('car');const saved=w.cp.capture();w.vehicles.bindAdapters('car','shared');w.vehicles.setModes('car',{fuel:'adapter',power:'adapter'});w.cp.restore(saved);assert.deepEqual(w.cp.capture(),saved);
});
test('bad vehicle fields or source disagreement reject every owner before commit',()=>{
  const w=scene();w.vehicles.start('car');const saved=w.cp.capture();for(const modify of [d=>d.vehicles.vehicles[0].parts.hood.fraction=2,d=>d.vehicles.vehicles[0].fuel.amountL+=2,d=>d.vehicles.vehicles[0].adapterKey='missing',d=>d.standalonePower.energyWh=1000]){
    const bad=structuredClone(saved);modify(bad.state.scene);assert.throws(()=>w.cp.restore(bad));assert.deepEqual(w.cp.capture(),saved);
  }
});
test('anonymous adapters fail checkpoint explicitly and external restore requires staged resources',()=>{
  const w=scene();assert.throws(()=>w.vehicles.restore(w.vehicles.capture()));w.vehicles.setAdapters('car',{fuel:createFuelStore()});assert.throws(()=>w.vehicles.capture(),/registered key/);
});
test('owned resource validation is atomic and closed stores preserve enabled/voltage semantics',()=>{
  const fuel=createFuelStore(),power=createBatteryStore({energyWh:0,enabled:false});const saved=power.capture();power.charge(100);power.prepareRestore(saved).commit();assert.equal(power.state().voltage,0);const bad={...fuel.capture(),amountL:100};assert.throws(()=>fuel.prepareRestore(bad));assert.equal(fuel.state().amountL,28);
});
test('checkpoint stage rejects later vehicle replacement and disposal',()=>{
  const cars=createVehicleSystem();cars.add('car');const p=cars.prepareRestore(cars.capture());cars.remove('car');cars.add('car');assert.throws(()=>p.commit());cars.dispose();assert.throws(()=>cars.capture());
});
test('native resource ownership can be restored after temporarily binding external sources',()=>{
  const cars=createVehicleSystem();cars.add('car');cars.start('car');const saved=cars.capture(),fuel=createFuelStore({amountL:5}),power=createBatteryStore({energyWh:100});cars.registerAdapters('other',{fuel,power});cars.bindAdapters('car','other');cars.step(1);const external=fuel.state().amountL;cars.restore(saved);assert.deepEqual(cars.capture(),saved);assert.equal(fuel.state().amountL,external);
});
test('staged vehicle view is detached and cannot change pending panel data',()=>{
  const cars=createVehicleSystem();cars.add('car');const saved=cars.capture(),p=cars.prepareRestore(saved);const view=p.state('car');view.parts.hood.fraction=1;view.modes.fuel='disabled';p.commit();assert.deepEqual(cars.capture(),saved);
});
test('scene composition refuses colliding resource names and async commit plans before mutation',()=>{
  const w=scene(),application={capture:()=>({}),prepareRestore:()=>({async commit(){}})},options={...w,tankId:'tank',application};
  assert.throws(()=>createVehicleSceneProvider({...options,sharedKey:'same',standaloneKey:'same'}));
  const provider=createVehicleSceneProvider(options),before=w.cp.capture();assert.throws(()=>provider.prepareRestore(provider.capture()),/synchronous/);assert.deepEqual(w.cp.capture(),before);
});
