import test from 'node:test';
import assert from 'node:assert/strict';
import {createThermalSystem} from '../../extensions/thermal/index.js';
const near=(a,b,eps=1e-7)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
test('thermal air: hot room air heats and ignites a distant object without spatial links',()=>{
  const t=createThermalSystem();t.addRoom('hot',{temperature:400});t.addRoom('cold');
  t.add('wood',{roomId:'hot',material:'wood',position:[100,0,0],airConductance:100,cooling:0});
  t.add('protected',{roomId:'cold',material:'wood',airConductance:100,cooling:0});
  t.step(1);assert.equal(t.state('wood').burning,true);assert.equal(t.state('protected').temperature,20);
});
test('thermal air: simultaneous exchange conserves energy and cannot overshoot at large conductance',()=>{
  const t=createThermalSystem();t.addRoom('r',{volume:1,temperature:200});
  t.add('cold',{roomId:'r',temperature:20,fuelJ:0,cooling:0,heatCapacity:100,airConductance:1e300});
  t.add('hot',{roomId:'r',temperature:400,fuelJ:0,cooling:0,heatCapacity:300,airConductance:1e300});
  const energy=200*1200+20*100+400*300;t.step(.05);
  const roomBeforeLoss=20+(t.roomState('r').temperature-20)/Math.exp(-.005*.05);
  near(roomBeforeLoss*1200+t.state('cold').temperature*100+t.state('hot').temperature*300,energy);
  for(const id of ['cold','hot']){const s=t.state(id);assert.ok(s.temperature>=20&&s.temperature<=400);near(s.temperature,roomBeforeLoss);}
});
test('thermal air: insertion order and render timestep preserve the same room/object trajectory',()=>{
  function run(order,dt){const t=createThermalSystem();t.addRoom('r',{temperature:300});for(const id of order)t.add(id,{roomId:'r',temperature:id==='a'?20:100,fuelJ:0,cooling:0,airConductance:10});for(let i=0;i<Math.round(2/dt);i++)t.step(dt);return [t.state('a').temperature,t.state('b').temperature,t.roomState('r').temperature];}
  const a=run(['a','b'],1/30),b=run(['b','a'],1/120);a.forEach((x,i)=>near(x,b[i]));
});
test('thermal air: conductance persists, legacy objects stay uncoupled and invalid edits are atomic',()=>{
  const t=createThermalSystem();t.addRoom('r',{temperature:200});t.add('wood',{roomId:'r',airConductance:10});
  const before=t.capture();assert.throws(()=>t.configure('wood',{fuelJ:0,airConductance:-1}));assert.deepEqual(t.capture(),before);
  const corrupt=structuredClone(before);corrupt.objects[0].airConductance=-1;assert.throws(()=>t.restore(corrupt));assert.deepEqual(t.capture(),before);
  t.step(1);const next=t.capture();t.restore(before);t.step(1);assert.deepEqual(t.capture(),next);
  const legacy=structuredClone(before);delete legacy.objects[0].airConductance;t.restore(legacy);t.step(1);assert.equal(t.state('wood').temperature,20);
});
test('thermal air: movement follows new room, uncoupled outdoor objects and cold rooms stay idle',()=>{
  const t=createThermalSystem();t.addRoom('hot',{temperature:400});t.addRoom('cold');t.add('metal',{roomId:'cold',material:'metal',airConductance:10});
  t.step(1);assert.equal(t.stats().objectSteps,0);t.setPosition('metal',[0,0,0],'hot');t.step(1);assert.ok(t.state('metal').temperature>20);
  t.configure('metal',{temperature:20});t.setPosition('metal',[0,0,0],null);t.step(1);assert.equal(t.state('metal').temperature,20);
});
test('thermal air: building balance preserves fabric spread while a closed partition protects neighbours',()=>{
  const t=createThermalSystem({autoSpread:true,spreadRadius:1,spreadConductance:12});
  t.addRoom('west',{volume:16});t.addRoom('east',{volume:16});t.addVent('window',{a:'west',flow:8});t.addVent('door',{a:'west',b:'east',open:0,flow:3});
  for(const [id,position,material,roomId]of [['chair',[-1.1,.32,-.5],'wood','west'],['curtain',[-.25,.7,-.5],'fabric','west'],['east-chair',[.45,.32,-.5],'wood','east'],['charge',[-1.8,.18,-.8],'powder','west']])
    t.add(id,{position,roomId,material,fuelJ:material==='powder'?3000:500000,heatCapacity:100,airConductance:.5,burnPower:material==='powder'?3000:1800,smokeYield:.00014,...(id==='charge'?{blast:{fuseSeconds:2,radius:1.4,strength:12}}:{})});
  t.ignite('chair');let spread=false;for(let i=0;i<1200;i++){t.step(.05);if(t.state('curtain').burning){spread=true;break;}}
  assert.equal(spread,true);assert.equal(t.state('east-chair').burning,false);assert.equal(t.state('east-chair').temperature,20);
});
