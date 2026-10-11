import test from 'node:test';
import assert from 'node:assert/strict';
import {createThermalSystem} from '../../extensions/thermal/index.js';
function building(){const t=createThermalSystem();for(let r=0;r<8;r++)t.addRoom(`r${r}`);for(let i=0;i<512;i++)t.add(`o${i}`,{roomId:`r${i%8}`,airConductance:1,fuelJ:0});return t;}
test('air cache: 512 idle coupled objects build once and need no repeated air-node checks',()=>{
  const t=building();t.step(1);assert.equal(t.stats().airRebuilds,1);assert.equal(t.stats().airNodeChecks,512);assert.equal(t.stats().airExchanges,0);
  const before=t.objects();t.step(10);assert.equal(t.stats().airRebuilds,0);assert.equal(t.stats().airNodeChecks,0);assert.equal(t.stats().objectSteps,0);assert.deepEqual(t.objects(),before);
});
test('air cache: external heat wakes only the relevant room without rebuilding stable groups',()=>{
  const t=building();t.step(.05);t.addHeat('o0',100);t.step(.05);assert.equal(t.stats().airNodeChecks,64);assert.equal(t.stats().airRebuilds,0);assert.ok(t.roomState('r0').temperature>20);assert.equal(t.roomState('r1').temperature,20);
});
test('air cache: heater, water and room ventilation wake sleeping groups',()=>{
  const t=building();t.step(.05);t.setHeater('o0',100);t.step(.05);t.step(.05);assert.ok(t.stats().airExchanges>0);t.setHeater('o0',0);t.water('o0',100);t.step(.05);assert.ok(t.stats().airNodeChecks>0);
  t.configureRoom('r0',{temperature:200});t.addVent('door',{a:'r0',b:'r1',flow:100});t.step(.05);assert.ok(t.state('o1').temperature>20);assert.equal(t.roomState('r2').temperature,20);
});
test('air cache: conductance/capacity changes, movement, same-id replacement and restore invalidate derived caches',()=>{
  const t=building();t.step(.05);t.configure('o0',{airConductance:10,heatCapacity:20});t.step(.05);assert.equal(t.stats().airRebuilds,1);
  t.setPosition('o0',[5,0,0],'r1');t.step(.05);assert.equal(t.stats().airRebuilds,1);
  t.configureRoom('r1',{heatCapacityPerVolume:300});t.step(.05);assert.equal(t.stats().airRebuilds,1);
  t.replaceObjects(['o0'],[{id:'o0',roomId:'r1',airConductance:20,temperature:100,fuelJ:0}]);t.step(.05);assert.ok(t.roomState('r1').temperature>20);
  const saved=t.capture();t.step(.05);const expected=t.capture();t.restore(saved);t.step(.05);assert.deepEqual(t.capture(),expected);assert.equal(t.stats().airRebuilds,1);
});
test('air cache: cold groups wake from conduction and timed game-blast heat',()=>{
  const t=createThermalSystem();t.addRoom('r');t.add('cold',{roomId:'r',airConductance:10,fuelJ:0});t.step(.05);
  t.add('hot',{temperature:500,fuelJ:0,cooling:0});t.connect('hot','cold',100);t.step(.05);assert.ok(t.stats().airExchanges>0);
  const u=createThermalSystem();u.addRoom('r');u.add('cold',{roomId:'r',airConductance:10,fuelJ:0});u.add('charge',{roomId:'r',fuelJ:0,position:[.1,0,0],blast:{strength:10,fuseSeconds:0}});u.step(.05);u.arm('charge');u.step(.05);u.step(.05);assert.ok(u.stats().airExchanges>0);
});
