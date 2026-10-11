import test from 'node:test';
import assert from 'node:assert/strict';
import {createThermalSystem} from '../../extensions/thermal/fire.js';

function building(open=1){
  const t=createThermalSystem({autoSpread:true,spreadRadius:1,spreadConductance:10});
  t.addRoom('a');t.addRoom('b');t.addRoom('c');
  t.addVent('door',{a:'a',b:'b',open,flow:0});
  t.add('hot',{roomId:'a',temperature:500,heatCapacity:1000,fuelJ:0,cooling:0});
  t.add('cold',{roomId:'b',position:[.1,0,0],fuelJ:0,cooling:0});
  return t;
}
const warming=t=>{const before=t.state('cold').temperature;t.step(.05);return t.state('cold').temperature-before;};

test('thermal rooms: small apertures reduce heat transfer and closure stops it',()=>{
  const closed=warming(building(0)),small=warming(building(.01)),full=warming(building(1));
  assert.equal(closed,0);assert.ok(small>0&&small<full*.02);
  const t=building();warming(t);t.setVent('door',0);assert.equal(warming(t),0);
  t.setVent('door',.01);assert.ok(warming(t)>0);
});
test('thermal rooms: parallel openings use strongest aperture, independent of insertion order',()=>{
  const a=building(.01);a.addVent('second',{a:'b',b:'a',open:.8,flow:0});
  const b=building(.8);b.addVent('second',{a:'a',b:'b',open:.01,flow:0});
  assert.equal(warming(a),warming(b));
  a.removeVent('second');b.setVent('door',.01);assert.equal(warming(a),warming(b));
});
test('thermal rooms: moving hot objects rebuilds neighbours without jumping indirect room links',()=>{
  const t=building();t.addVent('next',{a:'b',b:'c',open:1,flow:0});
  t.setPosition('cold',[.1,0,0],'c');assert.equal(warming(t),0);
  t.setPosition('cold',[.1,0,0],'a');assert.ok(warming(t)>0);
  t.setPosition('cold',[3,0,0]);assert.equal(warming(t),0);
});
test('thermal rooms: moving fire into depleted air extinguishes immediately and saves valid hot fuel',()=>{
  const events=[],t=createThermalSystem({emit:(name,state)=>events.push({name,state})});
  t.addRoom('air');t.addRoom('sealed',{oxygen:0});t.add('chair',{roomId:'air',cooling:0});t.ignite('chair');
  const before=t.state('chair');t.setPosition('chair',[1,0,0],'sealed');
  const after=t.state('chair');assert.equal(after.burning,false);assert.equal(after.temperature,before.temperature);assert.equal(after.fuelJ,before.fuelJ);
  assert.equal(events.filter(e=>e.name==='thermal:extinguished').length,1);
  assert.equal(events.at(-1).state.roomId,'sealed');
  const saved=t.capture();t.restore(saved);assert.deepEqual(t.capture(),saved);
  t.setPosition('chair',[0,0,0],null);t.step(.05);assert.equal(t.state('chair').burning,true);
});
test('thermal rooms: invalid moves leave positions, rooms and burning state intact',()=>{
  const t=building();t.ignite('hot');const before=t.capture();
  for(const room of ['missing','',false,0])assert.throws(()=>t.setPosition('hot',[1,0,0],room));
  assert.throws(()=>t.setPosition('hot',[NaN,0,0],'b'));assert.deepEqual(t.capture(),before);
});
