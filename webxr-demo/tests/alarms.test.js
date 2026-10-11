import test from 'node:test';
import assert from 'node:assert/strict';
import {createThermalSystem} from '../../extensions/thermal/index.js';
import {createAlarmSystem} from '../../extensions/alarms/index.js';
function world(options={}){const thermal=createThermalSystem();thermal.addRoom('r');const alarms=createAlarmSystem({thermal,...options});alarms.add('a',{roomId:'r'});return {thermal,alarms};}
test('alarms: heat and smoke independently trigger after continuous dwell; transient hazard is ignored',()=>{
  const {thermal:t,alarms:a}=world();t.configureRoom('r',{temperature:100});a.step(.4);assert.equal(a.state('a').triggered,false);t.configureRoom('r',{temperature:20});a.step(.1);assert.equal(a.state('a').dwellSeconds,0);
  t.configureRoom('r',{smoke:1});a.step(.5);assert.equal(a.state('a').triggered,true);assert.equal(a.state('a').reason,'smoke');assert.equal(a.state('a').audible,true);
});
test('alarms: silence preserves the latch and reset requires lower clear thresholds',()=>{
  const {thermal:t,alarms:a}=world();t.configureRoom('r',{temperature:100});a.step(.5);a.silence('a');assert.equal(a.state('a').audible,false);assert.equal(a.state('a').triggered,true);assert.equal(a.reset('a'),false);
  t.configureRoom('r',{temperature:55});assert.equal(a.reset('a'),false);t.configureRoom('r',{temperature:20});assert.equal(a.reset('a'),true);assert.equal(a.state('a').triggered,false);assert.equal(a.state('a').silenced,false);
});
test('alarms: optional power gate prevents triggering and disable preserves a latched alarm',()=>{
  let powered=false;const {thermal:t,alarms:a}=world({isPowered:()=>powered});t.configureRoom('r',{temperature:100});a.step(1);assert.equal(a.state('a').triggered,false);
  powered=true;a.step(.5);assert.equal(a.state('a').audible,true);a.setEnabled('a',false);assert.equal(a.state('a').audible,false);assert.equal(a.state('a').triggered,true);a.setEnabled('a',true);a.step(.1);assert.equal(a.state('a').audible,true);
});
test('alarms: detector modes and room boundaries are independent',()=>{
  const {thermal:t,alarms:a}=world();t.addRoom('other');a.add('heat',{roomId:'r',mode:'heat'});a.add('other',{roomId:'other'});t.configureRoom('r',{smoke:2});a.step(1);
  assert.equal(a.state('a').triggered,true);assert.equal(a.state('heat').triggered,false);assert.equal(a.state('other').triggered,false);
});
test('alarms: frame rate and quality preserve dwell and trigger timing',()=>{
  function run(dt,quality){const {thermal:t,alarms:a}=world({quality});t.configureRoom('r',{temperature:100});for(let i=0;i<Math.round(.5/dt);i++)a.step(dt);return a.capture();}
  assert.deepEqual(run(1/30,'minimal'),run(1/120,'high'));
});
test('alarms: checkpoint preserves pending phase, partial dwell, silence and enabled state',()=>{
  const {thermal:t,alarms:a}=world();t.configureRoom('r',{temperature:100});a.step(.35);const saved=a.capture();a.step(.25);const expected=a.capture();a.restore(saved);a.step(.25);assert.deepEqual(a.capture(),expected);
  a.silence('a');a.setEnabled('a',false);const quiet=a.capture();a.setEnabled('a',true);a.restore(quiet);assert.deepEqual(a.capture(),quiet);
});
test('alarms: invalid topology/state, time and detector budgets are atomic',()=>{
  const {thermal:t,alarms:a}=world({maxDetectors:1});assert.throws(()=>a.add('b',{roomId:'r'}));const before=a.capture();assert.throws(()=>a.step(11));assert.deepEqual(a.capture(),before);
  const bad=structuredClone(before);bad.detectors[0].silenced=true;assert.throws(()=>a.restore(bad));assert.deepEqual(a.capture(),before);
  const malformed=structuredClone(before);malformed.detectors[0].delaySeconds=10;assert.throws(()=>a.restore(malformed));assert.deepEqual(a.capture(),before);assert.throws(()=>createAlarmSystem({thermal:t,maxDetectors:0}));
  const extra=structuredClone(before);extra.detectors[0].unused={nested:true};a.restore(extra);assert.deepEqual(a.capture(),before);
});
test('alarms: trigger observers may remove sensors; notification batches and disposal are bounded',()=>{
  const thermal=createThermalSystem();thermal.addRoom('r',{temperature:100});let a,n=0;a=createAlarmSystem({thermal,emit:e=>{if(e==='alarms:triggered'){n++;a.remove('a');}}});a.add('a',{roomId:'r'});a.step(1);assert.equal(n,1);assert.equal(a.all().length,0);a.dispose();assert.throws(()=>a.step(.1));
});
test('alarms: restore notifications can replace a sensor once and reject recursive commits',()=>{
  const thermal=createThermalSystem();thermal.addRoom('r');let a,n=0,saved,plan;a=createAlarmSystem({thermal,emit:e=>{if(e==='alarms:changed'){assert.ok(++n<=1);assert.throws(()=>a.restore(saved));assert.throws(()=>plan.commit());a.remove('a');a.add('a',{roomId:'r'});}}});a.add('a',{roomId:'r'});saved=a.capture();plan=a.prepareRestore(saved);a.restore(saved);assert.equal(n,1);
});
