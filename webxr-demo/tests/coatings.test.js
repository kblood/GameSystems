import test from 'node:test';
import assert from 'node:assert/strict';
import {createThermalSystem} from '../../extensions/thermal/index.js';
import {createPoolsSystem} from '../../extensions/pools/index.js';
import {createCoatingSystem} from '../../extensions/coatings/index.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function world(options={}){let coats;const thermal=createThermalSystem(),pools=createPoolsSystem({thermal,emit:(name,e)=>{if(name==='pools:deposited')coats?.deposited(e);}});coats=createCoatingSystem({thermal,pools,...options});return {thermal,pools,coats};}
function surface(w,id,areaM2=1,normal=[0,1,0],heightM=0){w.thermal.add(id,{ignition:100,fuelJ:10000});w.coats.add(id,{areaM2,normal,heightM});}
test('finite dose covers smaller surfaces more strongly and stops their actual combustion',()=>{
  const w=world();surface(w,'small',.1);surface(w,'large',1);w.thermal.ignite('small');w.thermal.ignite('large');w.coats.apply('small',8);w.coats.apply('large',8);near(w.coats.state('small').coverage,1);near(w.coats.state('large').coverage,.1);assert.equal(w.thermal.state('small').burning,false);assert.equal(w.thermal.state('large').burning,true);
});
test('upward, vertical and underside faces retain different amounts; grazing jet misses',()=>{
  const w=world();for(const [id,n]of [['up',[0,1,0]],['side',[0,0,1]],['down',[0,-1,0]]]){surface(w,id,1,n);w.coats.apply(id,80);}
  near(w.coats.state('up').coverage,1);near(w.coats.state('side').coverage,.5);near(w.coats.state('down').coverage,.1);surface(w,'grazing');w.coats.apply('grazing',80,{jetDirection:[1,0,0]});near(w.coats.state('grazing').coverage,0);
});
test('height, vertical orientation and heat erode coating while quality keeps the same rules',()=>{
  const w=world();surface(w,'low',1,[0,0,1],0);surface(w,'high',1,[0,0,1],2);w.coats.apply('low',160);w.coats.apply('high',160);w.coats.setQuality('minimal');w.coats.step(1);assert.ok(w.coats.state('high').coverage<w.coats.state('low').coverage);
  const before=w.coats.state('low').coverage;w.thermal.configure('low',{temperature:500});w.coats.step(1);assert.ok(before-w.coats.state('low').coverage>.002);
});
test('foam stays an inert fluid component and coats its actual receiving puddle',()=>{
  const w=world();w.pools.deposit({id:'fuel',ml:100,kind:'diesel'});w.pools.ignite('fuel');w.pools.deposit({id:'fuel',ml:150,kind:'foam',sourceKey:'foam-nozzle'});assert.equal(w.pools.state('fuel').burning,false);near(w.pools.state('fuel').components.foam,150);near(w.pools.state('fuel').sources['foam-nozzle'].foam,150);near(w.pools.ledger().remainingMl,250);
  w.pools.deposit({id:'pure',ml:100,kind:'foam',position:[5,0,0]});assert.equal(w.pools.ignite('pure'),false);
});
test('fresh liquid dilutes existing pool blanket by footprint; foam dose adds coverage afterward',()=>{
  const w=world();w.pools.deposit({id:'p',ml:100,kind:'water'});w.pools.foam('p',1);w.pools.deposit({id:'p',ml:100,kind:'water'});near(w.pools.state('p').blanket,.5);w.pools.deposit({id:'p',ml:100,kind:'foam'});near(w.pools.state('p').blanket,1);
});
test('dormant foam pool retains blanket without creating a thermal node and active decay resumes',()=>{
  const thermal=createThermalSystem(),pools=createPoolsSystem({thermal,maxPools:1});const coats=createCoatingSystem({thermal,pools});pools.deposit({id:'a',ml:10});pools.ignite('a');pools.deposit({id:'b',ml:100,kind:'foam',position:[5,0,0]});coats.deposited({id:'b',components:{foam:100},previousMl:0,previousBlanket:0});assert.equal(pools.state('b').active,false);coats.step(5);near(pools.state('b').blanket,1);pools.remove('a');pools.activate('b');coats.step(1);assert.ok(pools.state('b').blanket<1);
});
test('checkpoint validates author geometry and coverage remains owned by thermal',()=>{
  const w=world();surface(w,'surface',.5);w.coats.apply('surface',20);const state=w.coats.capture(),heat=w.thermal.capture();const bad=structuredClone(state);bad.surfaces[0].areaM2=2;assert.throws(()=>w.coats.restore(bad));assert.deepEqual(w.thermal.capture(),heat);assert.deepEqual(w.coats.capture(),state);
});
test('invalid vectors/time/doses cannot alter coverage and disposal stops work',()=>{
  const w=world();surface(w,'s');assert.throws(()=>w.coats.apply('s',20,{normal:[0,0,0]}));assert.throws(()=>w.coats.apply('s',NaN));assert.throws(()=>w.coats.step(11));near(w.coats.state('s').coverage,0);w.coats.dispose();assert.throws(()=>w.coats.step(1));
});
test('invalid deposited foam cannot dilute a valid live blanket before failing',()=>{
  const w=world();w.pools.deposit({id:'p',ml:100,kind:'water'});w.pools.foam('p',.5);const saved=w.pools.save();assert.throws(()=>w.coats.deposited({id:'p',previousMl:50,previousBlanket:.5,components:{foam:NaN}}));assert.deepEqual(w.pools.save(),saved);
});
test('coverage decay is independent of frame partition and quality at the same temperature',()=>{
  const a=world(),b=world();surface(a,'s');surface(b,'s');a.coats.apply('s',80);b.coats.apply('s',80);b.coats.setQuality('minimal');a.coats.step(1);for(let i=0;i<100;i++)b.coats.step(.01);near(a.coats.state('s').coverage,b.coats.state('s').coverage);
});
test('combined owner checkpoint preserves coverage without a second independent blanket store',()=>{
  const w=world();surface(w,'s');w.coats.apply('s',40);const heat=w.thermal.capture(),liquid=w.pools.save(),coat=w.coats.capture();w.coats.apply('s',80);
  const h=w.thermal.prepareRestore(heat),p=w.pools.prepareRestore(liquid,{thermalPlan:h}),c=w.coats.prepareRestore(coat,{thermalPlan:h});h.commit();p.commit();c.commit();near(w.coats.state('s').coverage,.5);
});
test('pool dilution plus fresh foam publish one final coverage; decay emits a reusable change event',()=>{
  const changes=[],w=world({emit:(name,e)=>{if(name==='coatings:changed')changes.push(e);}});w.pools.deposit({id:'p',ml:100,kind:'water'});w.pools.foam('p',.5);changes.length=0;w.pools.deposit({id:'p',ml:20,kind:'foam'});assert.equal(changes.length,1);near(changes[0].coverage,w.pools.state('p').blanket);w.coats.step(1);assert.equal(changes.length,2);
});
