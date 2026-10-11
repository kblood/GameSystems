import test from 'node:test';
import assert from 'node:assert/strict';
import {assessFireHazards,createThermalSystem} from '../../extensions/thermal/index.js';
const assess=t=>assessFireHazards({rooms:t.roomStates(),objects:t.objects()});
test('hazards: clear requires cooling, smoke clearance and recovered relative air in every room',()=>{
  const t=createThermalSystem();t.addRoom('west');t.addRoom('east',{temperature:80,smoke:2,oxygen:.2});
  const r=assess(t);assert.equal(r.clear,false);assert.equal(r.rooms[0].clear,true);assert.deepEqual(r.rooms[1].reasons,['heat','smoke','air']);
  t.addVent('window',{a:'east',flow:100});t.step(10);assert.equal(assess(t).clear,true);
});
test('hazards: suppression preserves hot fuel warning; depleted and inert fuel do not warn',()=>{
  const t=createThermalSystem();t.addRoom('r');t.add('wood',{roomId:'r'});t.ignite('wood');t.suppress('wood');
  assert.deepEqual(assess(t).reasons,['hot-fuel']);t.configure('wood',{fuelJ:0});assert.equal(assess(t).clear,true);
  t.add('metal',{roomId:'r',material:'metal',temperature:500});assert.equal(assess(t).clear,true);
});
test('hazards: outside fires, armed charges and dormant fuel cannot disappear from clearance',()=>{
  const t=createThermalSystem();t.addRoom('r');t.add('fire');t.ignite('fire');t.add('charge',{roomId:'r',material:'powder',blast:{}});t.arm('charge');
  const r=assessFireHazards({rooms:t.roomStates(),objects:t.objects(),hotDormant:[{roomId:'r'}]});
  assert.equal(r.outside.fires,1);assert.equal(r.rooms[0].charges,1);assert.equal(r.rooms[0].hotDormant,1);assert.equal(r.clear,false);
});
test('hazards: configurable gameplay limits, detached reports and checkpoints agree',()=>{
  const t=createThermalSystem();t.addRoom('r',{temperature:60,oxygen:.5,smoke:.4});
  assert.deepEqual(assess(t).reasons,['heat']);assert.equal(assessFireHazards({rooms:t.roomStates()},{heatLimit:70}).clear,true);
  const before=t.capture(),r=assess(t);r.rooms[0].temperature=999;r.reasons.length=0;assert.deepEqual(t.capture(),before);
  t.restore(before);assert.deepEqual(assess(t).reasons,['heat']);
  assert.throws(()=>assessFireHazards({}, {airLimit:2}));assert.throws(()=>assessFireHazards({}, {heatLimit:NaN}));
  assert.throws(()=>assessFireHazards({objects:[{roomId:'missing'}]}));
});
