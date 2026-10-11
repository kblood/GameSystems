import test from 'node:test';
import assert from 'node:assert/strict';
import {createThermalSystem} from '../../extensions/thermal/index.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
test('room profiles: combustion uses per-room heat fraction and capacity',()=>{
  const t=createThermalSystem({oxygenCost:0});
  t.addRoom('heavy',{volume:10,heatCapacityPerVolume:1200,heatFraction:1,coolingRate:0});t.addRoom('light',{volume:10,heatCapacityPerVolume:300,heatFraction:1,coolingRate:0});
  for(const id of ['heavy','light']){t.add(id,{roomId:id,flammability:1,burnPower:1000,cooling:0});t.ignite(id);}t.step(1);
  near(t.roomState('heavy').temperature,20+1000/12000);near(t.roomState('light').temperature,20+1000/3000);
});
test('room profiles: insulated and uninsulated rooms lose heat at independent rates',()=>{
  const t=createThermalSystem();t.addRoom('sealed',{temperature:100,coolingRate:0});t.addRoom('loss',{temperature:100,coolingRate:.1});t.step(1);
  near(t.roomState('sealed').temperature,100);near(t.roomState('loss').temperature,20+80*Math.exp(-.1));
});
test('room profiles: vents conserve energy across rooms with different effective capacities',()=>{
  const t=createThermalSystem();t.addRoom('hot',{volume:10,temperature:200,heatCapacityPerVolume:300,coolingRate:0});t.addRoom('cold',{volume:20,temperature:20,heatCapacityPerVolume:1200,coolingRate:0});t.addVent('door',{a:'hot',b:'cold',flow:100});
  const energy=200*3000+20*24000;t.step(5);near(t.roomState('hot').temperature*3000+t.roomState('cold').temperature*24000,energy);
  assert.ok(t.roomState('hot').temperature>20&&t.roomState('cold').temperature<200);near(t.roomState('hot').temperature,t.roomState('cold').temperature);
});
test('room profiles: room/object exchange respects authored capacity and total energy',()=>{
  const t=createThermalSystem();t.addRoom('r',{volume:1,temperature:200,heatCapacityPerVolume:300,coolingRate:0});t.add('cold',{roomId:'r',temperature:20,fuelJ:0,cooling:0,airConductance:100,heatCapacity:100});t.step(1);
  near(t.roomState('r').temperature*300+t.state('cold').temperature*100,200*300+20*100);
});
test('room profiles: invalid multi-field configuration and snapshots leave all owners unchanged',()=>{
  const t=createThermalSystem();t.addRoom('r');t.add('wood',{roomId:'r'});t.ignite('wood');const before=t.capture();
  for(const edit of [{temperature:400,heatCapacityPerVolume:0},{oxygen:0,heatFraction:2},{smoke:1,coolingRate:-1},{volume:2},{oxygen:NaN}]){assert.throws(()=>t.configureRoom('r',edit));assert.deepEqual(t.capture(),before);}
  assert.throws(()=>t.configureRoom('r',{heatCapacityPerVolume:1e308}));assert.deepEqual(t.capture(),before);
  const bad=structuredClone(before);bad.rooms[0].heatFraction=-1;assert.throws(()=>t.restore(bad));assert.deepEqual(t.capture(),before);
  t.configureRoom('r',{oxygen:0});assert.equal(t.state('wood').burning,false);t.prepareRestore(t.capture());
});
test('room profiles: checkpoints preserve future behavior and legacy rooms get original defaults',()=>{
  const t=createThermalSystem();t.addRoom('r',{temperature:200,coolingRate:.02,heatCapacityPerVolume:400,heatFraction:.4});const saved=t.capture();t.step(1);const expected=t.capture();t.restore(saved);t.step(1);assert.deepEqual(t.capture(),expected);
  const old=structuredClone(saved);for(const key of ['heatFraction','heatCapacityPerVolume','coolingRate'])delete old.rooms[0][key];t.restore(old);const r=t.roomState('r');assert.equal(r.heatFraction,.08);assert.equal(r.heatCapacityPerVolume,1200);assert.equal(r.coolingRate,.005);
});
