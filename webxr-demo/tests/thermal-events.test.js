import test from 'node:test';
import assert from 'node:assert/strict';
import {createThermalSystem} from '../../extensions/thermal/index.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('thermal callbacks: burnt object removal and room teardown do not leave stale simulation work',()=>{
  let t,burns=0;t=createThermalSystem({emit:(e,s)=>{if(e==='thermal:burned'){burns++;t.remove(s.id);t.removeRoom('r');}}});
  t.addRoom('r');t.add('wood',{roomId:'r'});t.ignite('wood');assert.doesNotThrow(()=>t.step(1));assert.equal(burns,1);assert.equal(t.objects().length,0);assert.equal(t.roomStates().length,0);
});
test('thermal callbacks: removing a linked object rebuilds automatic neighbours inside catch-up steps',()=>{
  let t;t=createThermalSystem({autoSpread:true,emit:(e,s)=>{if(e==='thermal:burned'&&s.id==='a')t.remove('a');}});
  t.add('a',{position:[0,0,0]});t.add('b',{position:[.1,0,0],fuelJ:0});t.connect('a','b');t.ignite('a');assert.doesNotThrow(()=>t.step(1));assert.equal(t.hasObject('a'),false);assert.equal(t.stats().spreadLinks,0);
});
test('thermal callbacks: deleting a queued fire consumes air only for actual released energy',()=>{
  let t,released=0;t=createThermalSystem({oxygenCost:.0001,emit:(e,s)=>{if(e==='thermal:burned'){released+=s.joules;if(s.id==='a')t.remove('b');}}});
  t.addRoom('r',{volume:10});for(const id of ['a','b']){t.add(id,{roomId:'r'});t.ignite(id);}t.step(.05);
  near(t.roomState('r').oxygen,1-released*.0001/10);near(released,50);assert.equal(t.hasObject('b'),false);
});
test('thermal callbacks: removal during ignition aborts combustion and same-id replacements wait for next fixed step',()=>{
  let t;t=createThermalSystem({emit:(e,s)=>{if(e==='thermal:ignited'&&s.id==='hot')t.remove('hot');if(e==='thermal:burned'&&s.id==='old'){t.remove('old');t.add('old',{heaterW:0,temperature:20});}}});
  t.add('hot',{temperature:200});t.add('old');t.ignite('old');t.step(.05);assert.equal(t.hasObject('hot'),false);assert.equal(t.state('old').temperature,20);assert.equal(t.state('old').fuelJ,30000);
});
test('thermal callbacks: water applied to a queued fire prevents its already-planned burn',()=>{
  let t;t=createThermalSystem({emit:(e,s)=>{if(e==='thermal:burned'&&s.id==='a')t.water('b',100);}});
  for(const id of ['a','b']){t.add(id);t.ignite(id);}t.step(.05);assert.equal(t.state('b').burning,false);assert.equal(t.state('b').fuelJ,30000);
});
test('thermal callbacks: change observers can remove remaining changed objects safely',()=>{
  let t;t=createThermalSystem({emit:(e,s)=>{if(e==='thermal:changed'&&s.id==='a')t.remove('b');}});t.add('a',{temperature:200,fuelJ:0});t.add('b',{temperature:200,fuelJ:0});assert.doesNotThrow(()=>t.step(.05));assert.equal(t.hasObject('b'),false);
});
test('thermal callbacks: disposal aborts further events; nested steps and restores are explicitly rejected',()=>{
  let t,events=[];t=createThermalSystem({emit:(e,s)=>{events.push(e);if(e==='thermal:burned')t.dispose();}});t.add('a');t.ignite('a');t.step(1);assert.deepEqual(events,['thermal:ignited','thermal:burned']);assert.throws(()=>t.step(.05));
  let u,plan;u=createThermalSystem({emit:e=>{if(e==='thermal:burned'){assert.throws(()=>u.step(.05));assert.throws(()=>u.restore(u.capture()));assert.throws(()=>plan.commit());}}});u.add('a');u.ignite('a');plan=u.prepareRestore(u.capture());u.step(.05);u.step(.05);near(u.stats().clock,.1);
});
test('thermal callbacks: observer exceptions surface after the requested fixed-step batch completes',()=>{
  const seen=[];let t;t=createThermalSystem({fixedStep:.05,emit:(event,payload)=>{if(event==='thermal:burned'){seen.push(payload.joules);throw new Error('observer failed');}}});t.add('fire',{temperature:200,ignition:100,fuelJ:1000,burnPower:1000,heatCapacity:1000,cooling:0});t.ignite('fire');assert.throws(()=>t.step(.1),/observer failed/);near(t.stats().clock,.1);near(t.state('fire').fuelJ,900);assert.equal(seen.length,2);assert.throws(()=>t.step(.05),/observer failed/);near(t.stats().clock,.15);near(t.state('fire').fuelJ,850);
  const nullThrow=createThermalSystem({fixedStep:.05,emit:event=>{if(event==='thermal:burned')throw null;}});nullThrow.add('fire',{temperature:200,ignition:100,fuelJ:100,burnPower:100,heatCapacity:100,cooling:0});nullThrow.ignite('fire');assert.throws(()=>nullThrow.step(.05),error=>error===null);near(nullThrow.stats().clock,.05);near(nullThrow.state('fire').fuelJ,95);
});
