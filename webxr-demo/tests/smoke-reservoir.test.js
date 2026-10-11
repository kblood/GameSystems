import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createThermalSystem} from '../../extensions/thermal/index.js';
import {createSmokeSystem} from '../../extensions/smoke/index.js';
function world(smoke=20,bounds={min:[0,0,0],max:[2,3,2]}){const t=createThermalSystem();t.addRoom('r',{smoke});const s=createSmokeSystem({THREE,scene:new THREE.Scene(),thermal:t});s.addRoomBounds('r',bounds);return {t,s};}
test('smoke reservoir: clearing canonical smoke removes old clouds on the next visual tick',()=>{
  const {t,s}=world();s.prime();assert.ok(s.stats().particles>0);t.configureRoom('r',{smoke:0});const state=t.capture();s.step(.1);assert.equal(s.stats().particles,0);assert.equal(s.mesh.count,0);assert.deepEqual(s.stats().rooms,{});assert.deepEqual(t.capture(),state);s.dispose();
});
test('smoke reservoir: ventilation fades existing opacity without resetting the graphics',()=>{
  const {t,s}=world();s.prime();const opacity=s.mesh.geometry.attributes.puffOpacity.array[0];t.configureRoom('r',{smoke:.1});s.step(.1);assert.ok(s.stats().particles>0);assert.ok(s.mesh.geometry.attributes.puffOpacity.array[0]<opacity*.1);s.dispose();
});
test('smoke layer height survives thermal checkpoint restore and places new particles inside the saved floor/ceiling',()=>{
  const t=createThermalSystem();t.addRoom('r',{volume:20,smoke:1,floor:2,ceiling:6});
  const s=createSmokeSystem({THREE,scene:new THREE.Scene(),thermal:t});s.addRoomBounds('r',{min:[0,2,0],max:[2,6,2]});
  const saved=t.capture();t.removeRoom('r');t.addRoom('r',{volume:20,smoke:20,floor:0,ceiling:3});
  assert.equal(t.roomState('r').floor,0);assert.equal(t.roomState('r').ceiling,3);t.restore(saved);s.prime();
  const room=t.roomState('r');assert.equal(room.floor,2);assert.equal(room.ceiling,6);assert.equal(room.smokeLayerBottom,5.4);
  assert.ok(s.mesh.count>0);
  for(let i=0;i<s.mesh.count;i++)assert.ok(Math.abs(s.mesh.instanceMatrix.array[i*16+13]-room.smokeLayerBottom)<1e-6);
  s.dispose();
});
test('smoke reservoir: live smoky fires retain early plumes; stopped sources with clean air do not',()=>{
  const {t,s}=world(0);t.add('fire',{roomId:'r',position:[1,.5,1],burnPower:3000});t.ignite('fire');s.step(1);assert.ok(s.stats().particles>0);
  t.water('fire',100);s.step(.1);assert.equal(s.stats().particles,0);s.dispose();
});
test('smoke reservoir: explicitly smoke-free combustion does not invent visible smoke',()=>{
  const {t,s}=world(0);t.add('clean',{roomId:'r',smokeYield:0,burnPower:3000});t.ignite('clean');t.step(1);assert.equal(t.state('clean').burning,true);assert.equal(t.roomState('r').smoke,0);s.step(1);assert.equal(s.stats().particles,0);s.dispose();
});
test('smoke bounds: thin boxes and resized bounds keep every particle center inside',()=>{
  const {s}=world(20,{min:[0,0,0],max:[2,.03,2]});s.prime();for(let i=0;i<s.mesh.count;i++)assert.ok(s.mesh.instanceMatrix.array[i*16+13]>=0&&s.mesh.instanceMatrix.array[i*16+13]<=.03);
  s.addRoomBounds('r',{min:[1,1,1],max:[1.02,1.03,1.02]});s.step(.1);for(let i=0;i<s.mesh.count;i++)for(let k=0;k<3;k++){const value=s.mesh.instanceMatrix.array[i*16+12+k];assert.ok(value>=1&&value<=[1.02,1.03,1.02][k]);}
  s.dispose();assert.throws(()=>s.addRoomBounds('r',{min:[0,0,0],max:[2,3,2]}));
});
test('smoke ticks: a 0.3-second update matches three 0.1-second updates',()=>{
  const a=world(),b=world();a.s.step(.3);for(let i=0;i<3;i++)b.s.step(.1);assert.equal(a.s.stats().simSteps,3);assert.deepEqual(a.s.stats(),b.s.stats());assert.deepEqual(a.s.mesh.instanceMatrix.array,b.s.mesh.instanceMatrix.array);a.s.dispose();b.s.dispose();
});
test('smoke lifecycle: disposed visual systems cannot recreate particles or upload released resources',()=>{
  const {s}=world();s.prime();assert.ok(s.stats().particles>0);const scene=s.mesh.parent;s.dispose();assert.equal(s.stats().particles,0);assert.equal(s.mesh.count,0);assert.equal(s.mesh.parent,null);assert.equal(scene.children.includes(s.mesh),false);s.step(1);s.clear();assert.equal(s.removeRoomBounds('r'),false);assert.equal(s.stats().particles,0);assert.throws(()=>s.prime(),/disposed/);assert.throws(()=>s.setQuality('minimal'),/disposed/);assert.throws(()=>s.addRoomBounds('r',{min:[0,0,0],max:[2,3,2]}),/disposed/);s.dispose();
});
