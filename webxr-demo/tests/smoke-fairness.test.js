import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createThermalSystem} from '../../extensions/thermal/index.js';
import {createSmokeSystem} from '../../extensions/smoke/index.js';
function fixture(quality='minimal'){
  const t=createThermalSystem();t.addRoom('first',{smoke:20});t.addRoom('second',{smoke:20});
  for(let i=0;i<20;i++){t.add(`f${i}`,{roomId:'first',burnPower:3000});t.ignite(`f${i}`);}
  const s=createSmokeSystem({THREE,scene:new THREE.Scene(),thermal:t,quality});
  s.addRoomBounds('first',{min:[-2,0,-2],max:[0,3,2]});s.addRoomBounds('second',{min:[0,0,-2],max:[2,3,2]});
  return {t,s};
}
function balanced(s){const {particles,cap,rooms}=s.stats();assert.ok(particles<=cap);assert.equal(Object.values(rooms).reduce((n,x)=>n+x,0),particles);assert.ok(rooms.first>0&&rooms.second>0);assert.ok(Math.abs(rooms.first-rooms.second)<=1);}
test('smoke: many early fire emitters cannot monopolize low-budget reservoir visibility',()=>{
  const {t,s}=fixture(),before=t.capture();s.step(1);balanced(s);assert.deepEqual(t.capture(),before);
  for(let i=0;i<30;i++)s.step(1);balanced(s);assert.deepEqual(t.capture(),before);s.dispose();
});
test('smoke: quality reduction trims the most represented rooms, not all late-room particles',()=>{
  const {s}=fixture('high');s.step(10);assert.ok(s.stats().rooms.first<=80&&s.stats().rooms.second>0);s.setQuality('minimal');balanced(s);
  const stats=s.stats();stats.rooms.first=999;assert.notEqual(s.stats().rooms.first,999);
  s.setQuality('high');s.step(10);assert.ok(s.stats().rooms.first<=80&&s.stats().rooms.second>0);s.dispose();
});
test('smoke: bounds removal and thermal room removal remove ghost puffs and free budget',()=>{
  const {t,s}=fixture();s.step(1);assert.equal(s.removeRoomBounds('second'),true);assert.equal(s.stats().rooms.second,undefined);
  s.addRoomBounds('second',{min:[0,0,-2],max:[2,3,2]});s.step(1);balanced(s);
  t.removeRoom('second');s.step(.1);assert.equal(s.stats().rooms.second,undefined);
  assert.equal(s.mesh.count,s.stats().particles);s.dispose();assert.equal(s.stats().particles,0);
});
test('smoke: late smoky room gains visible particles without resetting the active room',()=>{
  const {t,s}=fixture();s.removeRoomBounds('second');s.step(1);assert.equal(s.stats().rooms.first,12);
  s.addRoomBounds('second',{min:[0,0,-2],max:[2,3,2]});s.step(1);balanced(s);
  s.prime();assert.ok(s.stats().rooms.first>0&&s.stats().rooms.second>0);s.clear();assert.deepEqual(s.stats().rooms,{});
  s.step(1);balanced(s);s.dispose();
});
test('smoke: more rooms than particle slots rotate representation within the hard budget',()=>{
  const t=createThermalSystem(),s=createSmokeSystem({THREE,scene:new THREE.Scene(),thermal:t,quality:'minimal'});
  for(let i=0;i<20;i++){t.addRoom(`r${i}`,{smoke:20});s.addRoomBounds(`r${i}`,{min:[i,0,0],max:[i+1,3,1]});}
  const seen=new Set();for(let i=0;i<30;i++){s.step(.1);assert.ok(s.stats().particles<=12);for(const id of Object.keys(s.stats().rooms))seen.add(id);}
  assert.equal(seen.size,20);s.dispose();
});
