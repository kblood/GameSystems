import test from 'node:test';
import assert from 'node:assert/strict';
import {createThermalSystem} from '../../extensions/thermal/index.js';
import {createPoolsSystem} from '../../extensions/pools/index.js';
import {createPoolInterestSystem} from '../../extensions/pool-interest/index.js';
const portal={min:[-.05,0,.3],max:[.05,2.1,1.1]};
function world(options={}){const t=createThermalSystem({autoSpread:true,spreadRadius:1,spreadConductance:100,...options});t.addRoom('a');t.addRoom('b');t.addVent('door',{a:'a',b:'b',flow:0,portal});return t;}
function object(t,id,roomId,position,hot=false){t.add(id,{roomId,position,temperature:hot?500:20,heatCapacity:hot?1000:10,fuelJ:hot?0:10000,cooling:0,ignition:30});}
test('portals: opening a door does not directly heat objects across its solid wall section',()=>{
  const t=world();object(t,'hot','a',[-.2,.5,-.5],true);object(t,'cold','b',[.2,.5,-.5]);t.step(1);assert.equal(t.state('cold').temperature,20);assert.equal(t.heatPath(t.state('hot'),t.state('cold')),null);
  t.setPosition('hot',[-.2,.5,.7]);t.setPosition('cold',[.2,.5,.7]);t.step(1);assert.equal(t.state('cold').burning,true);assert.equal(t.heatPath(t.state('hot'),t.state('cold')),.4);
});
test('portals: indirect routes are bounded; closure and alternate openings invalidate cached routes',()=>{
  const t=world(),a={roomId:'a',position:[-.2,.5,-.5]},b={roomId:'b',position:[.2,.5,-.5]};assert.equal(t.heatPath(a,b,1),null);assert.ok(t.heatPath(a,b,3)>.4);
  t.addVent('near',{a:'a',b:'b',flow:0,portal:{min:[-.05,0,-.7],max:[.05,2,-.3]}});assert.equal(t.heatPath(a,b),.4);t.setVent('near',0);assert.equal(t.heatPath(a,b),null);t.setVentPortal('door',{min:[-.05,0,-.7],max:[.05,2,-.3]});assert.equal(t.heatPath(a,b),.4);
});
test('portals: metadata is detached, validated atomically and restored with geometry; legacy vents remain abstract',()=>{
  const t=world();t.ventState('door').portal.min[0]=999;assert.equal(t.ventState('door').portal.min[0],-.05);const saved=t.capture();saved.vents[0].portal.min[0]=-999;assert.equal(t.ventState('door').portal.min[0],-.05);
  const before=t.capture();assert.throws(()=>t.setVentPortal('door',{min:[0,0,0],max:[0,0,0]}));assert.deepEqual(t.capture(),before);t.restore(before);assert.deepEqual(t.capture(),before);
  const plan=t.prepareRestore(before);plan.ventState('door').portal.max[2]=999;plan.commit();assert.deepEqual(t.capture(),before);
  const bad=structuredClone(before);bad.vents[0].portal.max=[-1,-1,-1];assert.throws(()=>t.restore(bad));assert.deepEqual(t.capture(),before);
  const legacy=structuredClone(before);delete legacy.vents[0].portal;t.restore(legacy);assert.equal(t.heatPath({roomId:'a',position:[-.2,.5,-.5]},{roomId:'b',position:[.2,.5,-.5]}),.4);
});
test('portals: interest skips blocked fuel and protects only reachable newly activated pools',()=>{
  const thermal=world(),pools=createPoolsSystem({thermal,maxPools:1});pools.deposit({id:'spare',ml:20,kind:'water',position:[10,0,0]});
  pools.deposit({id:'blocked',ml:20,kind:'diesel',roomId:'b',position:[.2,.01,-.5]});object(thermal,'hot','a',[-.2,.1,-.5],true);
  const interest=createPoolInterestSystem({thermal,pools});interest.step(.25);assert.equal(pools.state('blocked').active,false);
  thermal.setPosition('hot',[-.2,.1,.7]);pools.deposit({id:'reachable',ml:20,kind:'diesel',roomId:'b',position:[.2,.01,.7]});interest.step(.25);assert.equal(pools.state('reachable').active,true);assert.equal(pools.state('blocked').active,false);
});
test('portals: connectNearby honors declared openings when authoring links; direct material links stay explicit',()=>{
  const t=world();object(t,'hot','a',[-.2,.5,-.5],true);object(t,'cold','b',[.2,.5,-.5]);t.connectNearby(1,100);assert.equal(t.capture().links.length,0);
  t.connect('hot','cold',100);t.step(1);assert.equal(t.state('cold').burning,true);
});
test('portals: abstract game blasts follow the opening route and partial aperture',()=>{
  function run(z,open=1){const blasts=[],t=world({emit:(e,s)=>{if(e==='thermal:blast')blasts.push(s);}});t.setVent('door',open);object(t,'target','b',[.2,.5,z]);t.add('charge',{roomId:'a',position:[-.2,.5,z],fuelJ:0,blast:{fuseSeconds:0,radius:1,strength:10}});t.arm('charge');t.step(.05);return {hits:blasts[0].hits,temperature:t.state('target').temperature};}
  assert.equal(run(-.5).hits.length,0);assert.equal(run(-.5).temperature,20);const full=run(.7),partial=run(.7,.5);assert.equal(full.hits.length,1);assert.ok(Math.abs(partial.hits[0].strength-full.hits[0].strength*.5)<1e-8);
});
