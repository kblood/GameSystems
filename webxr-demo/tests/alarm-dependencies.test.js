import test from 'node:test';
import assert from 'node:assert/strict';
import {createThermalSystem} from '../../extensions/thermal/index.js';
import {createAlarmSystem} from '../../extensions/alarms/index.js';
test('alarm dependencies: invalid power reads preserve timer phase and all detector states',()=>{
  const t=createThermalSystem();t.addRoom('r',{temperature:100});let valid=false;
  const a=createAlarmSystem({thermal:t,isPowered:id=>id==='a'||valid?true:undefined});a.add('a',{roomId:'r'});a.add('b',{roomId:'r'});a.step(.05);const before=a.capture();assert.throws(()=>a.step(.25));assert.deepEqual(a.capture(),before);
  valid=true;a.step(.45);assert.ok(a.all().every(d=>d.triggered));
});
test('alarm dependencies: invalid temperature or density fails before advancing the phase',()=>{
  let reading={temperature:20,smokeDensity:0};const a=createAlarmSystem({thermal:{roomState:()=>reading}});a.add('a',{roomId:'r'});a.step(.05);const before=a.capture();
  for(const bad of [{temperature:NaN,smokeDensity:0},{temperature:20,smokeDensity:-1}]){reading=bad;assert.throws(()=>a.step(.25));assert.deepEqual(a.capture(),before);}
  reading={temperature:100,smokeDensity:0};a.step(.45);assert.equal(a.state('a').triggered,true);
});
test('alarm dependencies: removed rooms suppress output, preserve latch and recover after reconstruction',()=>{
  const t=createThermalSystem();t.addRoom('r',{temperature:100});const a=createAlarmSystem({thermal:t});a.add('a',{roomId:'r'});a.step(.5);assert.equal(a.state('a').audible,true);
  t.removeRoom('r');a.step(.1);assert.equal(a.state('a').fault,'room-missing');assert.equal(a.state('a').audible,false);assert.equal(a.state('a').triggered,true);assert.equal(a.state('a').dwellSeconds,0);assert.equal(a.reset('a'),false);
  const missing=a.capture();a.restore(missing);assert.deepEqual(a.capture(),missing);t.addRoom('r');a.step(.1);assert.equal(a.state('a').fault,null);assert.equal(a.state('a').audible,true);assert.equal(a.reset('a'),true);
  t.removeRoom('r');a.step(.1);t.addRoom('r');assert.equal(a.reset('a'),true);assert.equal(a.state('a').fault,null);assert.equal(a.state('a').powered,true);
});
test('alarm dependencies: fault snapshots validate consistency and legacy detectors remain supported',()=>{
  const t=createThermalSystem();t.addRoom('r');const a=createAlarmSystem({thermal:t});a.add('a',{roomId:'r'});const before=a.capture();
  const bad=structuredClone(before);bad.detectors[0].fault='room-missing';assert.throws(()=>a.restore(bad));assert.deepEqual(a.capture(),before);
  const legacy=structuredClone(before);delete legacy.detectors[0].fault;a.restore(legacy);assert.deepEqual(a.capture(),before);
});
test('alarm dependencies: power reader mutations cannot replace sensors forever or undo disable',()=>{
  const t=createThermalSystem();t.addRoom('r',{temperature:100});let a,replace=false;
  a=createAlarmSystem({thermal:t,isPowered:id=>{if(replace){a.remove(id);a.add(id,{roomId:'r'});}else a.setEnabled(id,false);return true;}});a.add('a',{roomId:'r'});a.step(.5);assert.equal(a.state('a').enabled,false);assert.equal(a.state('a').powered,false);assert.equal(a.state('a').triggered,false);
  a.setEnabled('a',true);replace=true;a.step(.5);assert.equal(a.all().length,1);assert.equal(a.state('a').triggered,false);
});
