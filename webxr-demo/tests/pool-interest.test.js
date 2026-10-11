import test from 'node:test';
import assert from 'node:assert/strict';
import {createThermalSystem} from '../../extensions/thermal/index.js';
import {createPoolsSystem} from '../../extensions/pools/index.js';
import {createPoolInterestSystem} from '../../extensions/pool-interest/index.js';
function world({maxPools=1,interestOptions={}}={}){
  let pools;const thermal=createThermalSystem({autoSpread:true,spreadRadius:1,spreadConductance:12,emit:(name,e)=>{if(name==='thermal:burned')pools?.burned(e.id,e.joules);}});thermal.addRoom('a');thermal.addRoom('b');
  pools=createPoolsSystem({thermal,maxPools});const interest=createPoolInterestSystem({pools,thermal,...interestOptions});return {pools,thermal,interest};
}
function liquid(w,id,x,kind='diesel',roomId='a'){return w.pools.deposit({id,ml:10,kind,position:[x,0,0],roomId});}
function hot(w,roomId='a'){w.thermal.add('hot',{roomId,position:[0,0,0],temperature:600,heatCapacity:1000000,fuelJ:0,cooling:0});}
test('heat interest awakens retained fuel and actual thermal spread ignites it',()=>{
  const w=world();liquid(w,'far',5);liquid(w,'near',.3);hot(w);w.interest.step(.25);assert.equal(w.pools.state('near').active,true);assert.equal(w.pools.state('far').active,false);assert.equal(w.pools.stats().active,1);
  w.thermal.step(2);assert.equal(w.pools.state('near').burning,true);assert.ok(w.pools.ledger().burnedMl>0);
});
test('closed rooms prevent activation across wall; opening shared vent permits it',()=>{
  const w=world();liquid(w,'far',5);liquid(w,'other',.3,'diesel','b');hot(w);w.thermal.addVent('door',{a:'a',b:'b',open:0});w.interest.step(.25);assert.equal(w.pools.state('other').active,false);
  w.thermal.setVent('door',1);w.interest.step(.25);assert.equal(w.pools.state('other').active,true);
});
test('ongoing fire is preserved when no safe activation slot exists',()=>{
  const w=world();liquid(w,'burning',5);w.pools.ignite('burning');liquid(w,'near',.3);hot(w);w.interest.step(.25);assert.equal(w.pools.state('burning').burning,true);assert.equal(w.pools.state('near').active,false);assert.ok(w.interest.stats().blocked>0);
});
test('just-awakened neighbours cannot be thrashed before thermal heats them',()=>{
  const w=world();liquid(w,'far',5);liquid(w,'first',.3);liquid(w,'second',.4);hot(w);w.interest.step(.25);w.interest.step(.25);
  assert.equal(w.pools.state('first').active,true);assert.equal(w.pools.state('second').active,false);
});
test('bounded linked-cell paging advances through a crowded cell without skipping its tail',()=>{
  const w=world();liquid(w,'far',5);for(let i=0;i<100;i++)liquid(w,`water${i}`,.3,'water');liquid(w,'fuel',.3);
  let cursor=null,found=false;for(let i=0;i<20;i++){const page=w.pools.scanDormant({position:[0,0,0],roomId:'a',radius:1,combustibleOnly:true,maxChecks:8,maxCells:8,limit:1,cursor});assert.ok(page.checks<=8);assert.ok(page.cells<=8);cursor=page.cursor;if(page.items.length){assert.equal(page.items[0].id,'fuel');found=true;break;}}
  assert.equal(found,true);
});
test('query cursor survives owner restore and removal of the next entry safely restarts that cell',()=>{
  const w=world();liquid(w,'far',5);for(let i=0;i<20;i++)liquid(w,`p${i}`,.3);const options={position:[0,0,0],roomId:'a',radius:1,maxChecks:4,maxCells:64,limit:4};
  const page=w.pools.scanDormant(options);assert.equal(page.items[0].id,'p0');const saved=w.pools.save(),expected=w.pools.scanDormant({...options,cursor:page.cursor});w.pools.restore(saved);assert.deepEqual(w.pools.scanDormant({...options,cursor:page.cursor}),expected);
  w.pools.remove(page.cursor.nextId);assert.doesNotThrow(()=>w.pools.scanDormant({...options,cursor:page.cursor}));
});
test('stored latent heat resumes once a protected burning slot becomes cold and removable',()=>{
  const w=world();liquid(w,'old',5);w.pools.ignite('old');liquid(w,'queued',20);w.pools.heat('queued',2000);assert.equal(w.pools.hotDormant()[0].id,'queued');w.interest.step(.25);assert.equal(w.pools.state('queued').active,false);
  w.pools.remove('old');w.interest.step(.25);assert.equal(w.pools.state('queued').active,true);assert.equal(w.pools.hotDormant().length,0);w.thermal.step(.1);assert.equal(w.pools.state('queued').burning,true);
});
test('scheduler state preserves bounded-query progress and rejects invalid restore atomically',()=>{
  const w=world({interestOptions:{maxChecks:2}});liquid(w,'far',5);for(let i=0;i<20;i++)liquid(w,`water${i}`,.3,'water');hot(w);w.interest.step(.3);const saved=w.interest.capture();w.interest.step(.25);w.interest.restore(saved);assert.deepEqual(w.interest.capture(),saved);
  const bad=structuredClone(saved);bad.cursors[0].cursor.cellIndex=-1;assert.throws(()=>w.interest.restore(bad));assert.deepEqual(w.interest.capture(),saved);
  const reordered={...saved,settings:Object.fromEntries(Object.entries(saved.settings).reverse())};assert.doesNotThrow(()=>w.interest.restore(reordered));
});
test('source rotation gives distinct heat regions a turn and obeys activation budget',()=>{
  const w=world({maxPools:2});liquid(w,'far1',10);liquid(w,'far2',20);liquid(w,'a',.3);liquid(w,'b',3.3);hot(w);w.thermal.add('warm',{position:[3,0,0],roomId:'a',temperature:600,fuelJ:0});
  w.interest.step(.25);assert.equal(w.interest.stats().activated,1);w.interest.step(.25);assert.equal(w.pools.state('b').active,true);assert.equal(w.pools.stats().active,2);
});
test('invalid spatial/time budgets do not mutate retained records or phase; dispose stops work',()=>{
  const w=world();liquid(w,'a',5);const before=w.pools.save();assert.throws(()=>w.pools.scanDormant({position:[0,0,0],radius:9}));assert.deepEqual(w.pools.save(),before);const state=w.interest.capture();assert.throws(()=>w.interest.step(11));assert.deepEqual(w.interest.capture(),state);w.interest.dispose();assert.throws(()=>w.interest.step(1));
});
test('shared thermal budget can replace a cold owned node before the pool-local budget is full',()=>{
  const thermal=createThermalSystem({maxObjects:2});thermal.add('hot',{temperature:600,position:[0,0,0],fuelJ:0});const pools=createPoolsSystem({thermal,maxPools:2});
  pools.deposit({id:'far',ml:10,position:[5,0,0]});pools.deposit({id:'near',ml:10,kind:'diesel',position:[.3,0,0]});const interest=createPoolInterestSystem({thermal,pools});
  interest.step(.25);assert.equal(pools.state('near').active,true);assert.equal(pools.state('far').active,false);assert.equal(thermal.objects().length,2);
});
test('checkpoint preserves active eviction order after previously dormant records return',()=>{
  const w=world({maxPools:2});liquid(w,'a',5);liquid(w,'b',6);liquid(w,'c',7);w.pools.activate('c');w.pools.activate('a');
  const saved=w.pools.save();assert.deepEqual(saved.activeOrder,['c','a']);w.pools.activate('b');const expected=w.pools.save();w.pools.restore(saved);w.pools.activate('b');assert.deepEqual(w.pools.save(),expected);
});
test('checkpoint retains latent heat priority even when it differs from record creation order',()=>{
  const w=world();liquid(w,'old',5);w.pools.ignite('old');liquid(w,'a',20);liquid(w,'b',30);w.pools.heat('b',2000);w.pools.heat('a',2000);
  const saved=w.pools.save();assert.deepEqual(saved.hotOrder,['b','a']);w.pools.restore(saved);w.pools.remove('old');w.interest.step(.25);assert.equal(w.pools.state('b').active,true);assert.equal(w.pools.state('a').active,false);
});
test('default interest radius follows the thermal owner spread distance',()=>{
  const thermal=createThermalSystem({spreadRadius:.4});thermal.add('hot',{temperature:600,fuelJ:0});const pools=createPoolsSystem({thermal,maxPools:1});
  pools.deposit({id:'far',ml:10,position:[5,0,0]});pools.deposit({id:'outside',ml:10,kind:'diesel',position:[.6,0,0]});const interest=createPoolInterestSystem({thermal,pools});interest.step(.25);
  assert.equal(interest.capture().settings.radius,.4);assert.equal(pools.state('outside').active,false);
});
