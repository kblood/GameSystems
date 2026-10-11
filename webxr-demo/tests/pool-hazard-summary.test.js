import test from 'node:test';
import assert from 'node:assert/strict';
import {createThermalSystem,assessFireHazards} from '../../extensions/thermal/index.js';
import {createPoolsSystem} from '../../extensions/pools/index.js';
function fixture(){const thermal=createThermalSystem();thermal.addRoom('west');thermal.addRoom('east');const pools=createPoolsSystem({thermal,maxPools:1});pools.deposit({id:'occupied',ml:100,kind:'diesel'});pools.ignite('occupied');return {thermal,pools};}
function latent(pools,id,roomId,position=[0,0,0]){pools.deposit({id,roomId,position,ml:20,kind:'diesel'});pools.heat(id,2000);}
test('dormant hazards: summary covers every room and outside, without relying on preview limit',()=>{
  const {thermal,pools}=fixture();latent(pools,'west','west');latent(pools,'east','east');latent(pools,'outside',null,[100,0,0]);
  const summary=pools.hotDormantSummary();assert.equal(summary.count,3);assert.equal(pools.hotDormant().length,1);
  const r=assessFireHazards({rooms:thermal.roomStates(),hotDormantSummary:summary});assert.equal(r.rooms[0].clear,false);assert.equal(r.rooms[1].clear,false);assert.equal(r.outside.hotDormant,1);
  assert.deepEqual(r,assessFireHazards({rooms:thermal.roomStates(),hotDormant:pools.hotDormant(10)}));
});
test('dormant hazards: cooling, dilution, removal and activation maintain exact counters',()=>{
  const {pools}=fixture();latent(pools,'a','west');latent(pools,'b','west',[10,0,0]);latent(pools,'c','east');
  assert.deepEqual(pools.hotDormantSummary().rooms,[{roomId:'east',count:1},{roomId:'west',count:2}]);
  pools.cool('a',1);assert.equal(pools.hotDormantSummary().count,2);
  pools.deposit({id:'b',ml:1000,kind:'water'});assert.equal(pools.hotDormantSummary().count,1);
  pools.remove('occupied');assert.equal(pools.activate('c'),true);assert.equal(pools.hotDormantSummary().count,0);
  pools.remove('c');pools.clear();assert.deepEqual(pools.hotDormantSummary(),{count:0,rooms:[]});
});
test('dormant hazards: owner restore reconstructs counters and does not change latent priority',()=>{
  const {pools}=fixture();latent(pools,'a','west');latent(pools,'b','east');const before=pools.hotDormantSummary(),saved=pools.save();
  pools.clear();pools.restore(saved);assert.deepEqual(pools.hotDormantSummary(),before);assert.deepEqual(pools.save().hotOrder,saved.hotOrder);
  const view=pools.hotDormantSummary();view.rooms[0].count=900;view.count=0;assert.deepEqual(pools.hotDormantSummary(),before);
  pools.remove('a');assert.equal(pools.hotDormantSummary().count,1);pools.clear({account:false});assert.equal(pools.hotDormantSummary().count,0);
});
test('dormant hazards: large metadata sets produce compact room aggregates',()=>{
  const {pools}=fixture();for(let i=0;i<1000;i++)latent(pools,`p${i}`,i%2?'west':'east',[i*10,0,0]);
  assert.deepEqual(pools.hotDormantSummary(),{count:1000,rooms:[{roomId:'east',count:500},{roomId:'west',count:500}]});
});
test('dormant hazards: inconsistent and ambiguous summaries are rejected',()=>{
  const {thermal}=fixture(),rooms=thermal.roomStates();
  for(const summary of [{count:2,rooms:[{roomId:'east',count:1}]},{count:1,rooms:[{roomId:'east',count:-1}]},{count:2,rooms:[{roomId:'east',count:1},{roomId:'east',count:1}]},{count:1,rooms:[{roomId:'missing',count:1}]}])assert.throws(()=>assessFireHazards({rooms,hotDormantSummary:summary}));
  assert.throws(()=>assessFireHazards({rooms,hotDormant:[{roomId:'east'}],hotDormantSummary:{count:0,rooms:[]}}));
});
