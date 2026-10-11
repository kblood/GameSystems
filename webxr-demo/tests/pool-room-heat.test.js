import test from 'node:test';
import assert from 'node:assert/strict';
import {createThermalSystem} from '../../extensions/thermal/index.js';
import {createPoolsSystem} from '../../extensions/pools/index.js';
import {createPoolInterestSystem} from '../../extensions/pool-interest/index.js';
function world(options={}){
  let pools;const thermal=createThermalSystem({emit:(e,s)=>{if(e==='thermal:burned')pools.burned(s.id,s.joules);}});
  thermal.addRoom('hot',{temperature:400});thermal.addRoom('cold');
  pools=createPoolsSystem({thermal,maxPools:1,airConductance:10,...options});
  const interest=createPoolInterestSystem({thermal,pools,maxChecks:8,maxCells:1});
  pools.deposit({id:'spare',ml:10,kind:'water',roomId:'cold'});return {thermal,pools,interest};
}
test('room heat: distant dormant fuel wakes from hot room air, burns and preserves source accounting',()=>{
  const {thermal,pools,interest}=world();pools.deposit({id:'fuel',ml:20,kind:'diesel',roomId:'hot',position:[10000,0,0],sourceKey:'tank'});
  interest.step(.25);assert.equal(pools.state('fuel').active,true);assert.equal(pools.state('spare').active,false);
  thermal.step(1);assert.equal(pools.state('fuel').burning,true);const ledger=pools.ledger();
  assert.ok(ledger.burnedMl>0);assert.ok(Math.abs(ledger.initialMl-ledger.remainingMl-ledger.burnedMl-ledger.removedMl)<1e-6);
  assert.ok(Math.abs(pools.state('fuel').sources.tank.diesel+ledger.burnedMl-20)<1e-6);
});
test('room heat: linked room paging respects budget across many distant cells and retains cursor after restore',()=>{
  const {pools,interest}=world();for(let i=0;i<100;i++)pools.deposit({id:`water${i}`,ml:1,kind:'water',roomId:'hot',position:[i*100,0,0]});
  pools.deposit({id:'fuel',ml:20,kind:'diesel',roomId:'hot',position:[100000,0,0]});
  interest.step(.25);assert.equal(interest.stats().checks,8);assert.equal(pools.state('fuel').active,false);
  const saved=interest.capture();interest.step(.25);const next=interest.capture();interest.restore(saved);interest.step(.25);assert.deepEqual(interest.capture(),next);
  for(let i=0;i<20&&!pools.state('fuel').active;i++){interest.step(.25);assert.ok(interest.stats().checks<=8&&interest.stats().cells<=1&&interest.stats().activated<=1);}
  assert.equal(pools.state('fuel').active,true);
});
test('room heat: cold rooms, inert fluid and uncoupled fuel do not spend activation slots',()=>{
  const {pools,interest}=world({airConductance:0});pools.deposit({id:'off',ml:20,kind:'diesel',roomId:'hot',position:[100,0,0]});interest.step(.25);assert.equal(pools.state('off').active,false);
  const w=world();w.pools.deposit({id:'coldfuel',ml:20,kind:'diesel',roomId:'cold',position:[100,0,0]});w.pools.deposit({id:'inert',ml:20,kind:'water',roomId:'hot',position:[200,0,0]});w.interest.step(.25);assert.equal(w.interest.stats().activated,0);
});
test('room heat: active coupled pools are protected before heating, and burning pools cannot be evicted',()=>{
  const {pools,interest}=world();pools.remove('spare');pools.deposit({id:'first',ml:20,kind:'diesel',roomId:'hot'});pools.deposit({id:'second',ml:20,kind:'diesel',roomId:'hot',position:[100,0,0]});
  interest.step(.25);assert.equal(pools.state('first').active,true);assert.equal(pools.state('second').active,false);assert.ok(interest.stats().blocked>0);
  pools.ignite('first');interest.step(.25);assert.equal(pools.state('first').burning,true);assert.equal(pools.state('second').active,false);
});
test('room heat: coupling persists through pool replacement, validates atomic shared state and supports legacy snapshots',()=>{
  const {thermal,pools,interest}=world();pools.deposit({id:'fuel',ml:20,kind:'diesel',roomId:'hot',position:[100,0,0]});interest.step(.25);
  const saved=pools.save(),heat=thermal.capture();pools.restore(saved);assert.equal(thermal.state('pool:fuel').airConductance,10);
  const mismatch=structuredClone(saved);mismatch.pools.find(p=>p.id==='fuel').airConductance=1;assert.throws(()=>pools.prepareRestore(mismatch,{thermalPlan:thermal.prepareRestore(heat)}));assert.deepEqual(pools.save(),saved);
  const bad=structuredClone(saved);bad.pools[0].airConductance=-1;assert.throws(()=>pools.restore(bad));assert.deepEqual(pools.save(),saved);
  const legacy=structuredClone(saved);for(const p of legacy.pools)delete p.airConductance;pools.restore(legacy);assert.equal(thermal.state('pool:fuel').airConductance,0);
});
test('room query: removal of the next entry restarts safely and filter/cursor views are detached',()=>{
  const {pools}=world();for(let i=0;i<5;i++)pools.deposit({id:`fuel${i}`,ml:20,kind:'diesel',roomId:'hot',position:[i*100,0,0]});
  const args={roomId:'hot',maxChecks:2,limit:2,coupledOnly:true};const a=pools.scanDormantRoom(args);pools.remove(a.cursor.nextId);
  const b=pools.scanDormantRoom({...args,cursor:a.cursor});assert.ok(b.items.length>0);b.items[0].components.diesel=0;assert.equal(pools.state(b.items[0].id).components.diesel,20);
  const before=pools.save();assert.throws(()=>pools.scanDormantRoom({...args,maxChecks:0}));assert.deepEqual(pools.save(),before);
});
test('room heat: sub-tenth-degree warming can sleep without losing heat while meaningful heat stays protected',()=>{
  const {thermal,pools}=world();pools.deposit({id:'fuel',ml:20,kind:'diesel',roomId:'hot',position:[100,0,0]});
  thermal.configure('pool:spare',{temperature:20.05});assert.equal(pools.activate('fuel'),true);assert.equal(pools.state('spare').temperature,20.05);
  assert.equal(pools.deactivate('fuel'),true);assert.equal(pools.activate('spare'),true);assert.equal(thermal.state('pool:spare').temperature,20.05);
  thermal.configure('pool:spare',{temperature:20.2});assert.equal(pools.activate('fuel'),false);assert.equal(pools.state('spare').active,true);
});
