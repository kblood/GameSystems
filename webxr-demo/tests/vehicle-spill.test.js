import test from 'node:test';
import assert from 'node:assert/strict';
import {createVehicleSystem,createFuelStore} from '../../extensions/vehicle/index.js';
import {createVehicleFuelPort} from '../../extensions/vehicle/fuel-port.js';
import {createSupplySystem,createFuelAdapter} from '../../extensions/supply/index.js';
import {createThermalSystem} from '../../extensions/thermal/index.js';
import {createPoolsSystem} from '../../extensions/pools/index.js';
import {createFlowSystem} from '../../extensions/flow/index.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function world(){const supply=createSupplySystem();supply.add('tank',{components:{petrol:1000,water:100},capacityMl:52000});const cars=createVehicleSystem();cars.add('c',{fuel:createFuelAdapter(supply,'tank')});
  let pools;const heat=createThermalSystem({emit:(name,e)=>{if(name==='thermal:burned')pools.burned(e.id,e.joules);}});pools=createPoolsSystem({thermal:heat});const port=createVehicleFuelPort(cars,'c');const flow=createFlowSystem({supply:port,emit:(name,e)=>{if(name==='liquid:deposit')pools.deposit(e);}});flow.add('leak',{tankId:'c',sourceKey:'vehicle:c:fuel',target:{surfaceId:'floor',position:[0,0,0]}});return {supply,cars,heat,pools,port,flow};}
test('petrol follows vehicle supply into world as combustible petrol, not unknown',()=>{
  const w=world();w.flow.pulse('leak',100);near(w.cars.state('c').fuel.amountL,.9);near(w.cars.state('c').spilledL,.1);near(w.cars.state('c').consumedL,0);near(w.supply.state('tank').components.water,100);
  const pool=w.pools.all()[0];assert.deepEqual(pool.components,{petrol:100});assert.equal(w.pools.ignite(pool.id),true);w.heat.step(.2);assert.ok(w.pools.ledger().burnedMl>0);near(w.pools.ledger().remainingMl+w.pools.ledger().burnedMl,100);
});
test('fuel port follows adapter switches and does not alter disconnected reserves',()=>{
  const w=world();w.flow.pulse('leak',100);const shared=w.cars.state('c').fuel.amountL;w.cars.setAdapters('c',{fuel:createFuelStore({amountL:.2,kind:'diesel'})});const out=w.flow.pulse('leak',50);assert.deepEqual(out.components,{diesel:50});near(w.supply.state('tank').components.petrol,shared*1000);
});
test('explicit source withdrawal clamps to reservoir and stops engine immediately when emptied',()=>{
  const w=world();w.cars.start('c');const out=w.flow.pulse('leak',5000);near(out.ml,1000);assert.equal(w.cars.state('c').running,false);near(w.port.state('c').ml,0);near(w.port.state('c').drawnMl,1000);near(w.pools.ledger().remainingMl,1000);
});
test('cold petrol respects ignition threshold and inert unknown liquid never gets fuel energy',()=>{
  const w=world();w.flow.pulse('leak',100);w.heat.step(.1);assert.equal(w.pools.all()[0].burning,false);const p=w.pools.deposit({id:'unknown',position:[5,0,0],ml:100,kind:'not-a-fuel'});assert.equal(p.fuelJ,0);assert.equal(w.pools.ignite('unknown'),false);
});
test('petrol composition and provenance survive pooled checkpoint',()=>{
  const w=world();w.flow.pulse('leak',100);const saved=w.pools.save();w.pools.clear();w.pools.restore(saved);assert.deepEqual(w.pools.save(),saved);near(w.pools.all()[0].sources['vehicle:c:fuel'].petrol,100);
});
test('invalid withdrawal/port id is atomic and disabled engine mode does not invent spill volume',()=>{
  const w=world();const before=w.cars.state('c');assert.throws(()=>w.port.draw('other',100));assert.throws(()=>w.cars.withdrawFuel('c',NaN));assert.deepEqual(w.cars.state('c'),before);w.cars.setModes('c',{fuel:'disabled'});w.flow.pulse('leak',2000);near(w.cars.state('c').spilledL,1);near(w.pools.ledger().remainingMl,1000);
});
