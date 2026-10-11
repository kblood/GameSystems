import test from 'node:test';
import assert from 'node:assert/strict';
import {createThermalSystem} from '../../extensions/thermal/index.js';
import {createPoolsSystem} from '../../extensions/pools/index.js';
import {createCheckpointSystem} from '../../extensions/checkpoint/index.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
function setup(options={}){const thermal=createThermalSystem(options.thermal);thermal.addRoom('room');const events=[];const pools=createPoolsSystem({thermal,maxPools:1,...options.pools,emit:(name,data)=>events.push([name,data])});return {thermal,pools,events};}
function deposit(pools,id,ml,x,kind='diesel',sourceKey='can'){return pools.deposit({id,ml,position:[x,0,0],roomId:'room',kind,sourceKey});}
test('full active budget retains every deposited ml, source and distinct position',()=>{
  const {pools,thermal,events}=setup();deposit(pools,'a',20,0);const overflow=deposit(pools,'b',40,5);
  assert.equal(overflow.active,false);near(pools.ledger().remainingMl,60);near(pools.state('b').sources.can.diesel,40);assert.deepEqual(pools.state('b').position,[5,0,0]);
  assert.equal(thermal.objects().length,1);assert.deepEqual(pools.stats(),{records:2,active:1,dormant:1,maxActive:1});assert.equal(events.find(([name])=>name==='pools:budget')[1].retained,true);
});
test('refill of dormant pool keeps mixes, provenance and ledger while budget stays bounded',()=>{
  const {pools,thermal}=setup();deposit(pools,'a',20,0);deposit(pools,'b',40,5);pools.deposit({id:'b',ml:10,kind:'water',sourceKey:'hose'});
  const b=pools.state('b');near(b.components.diesel,40);near(b.components.water,10);near(b.sources.hose.water,10);near(pools.ledger().remainingMl,70);assert.equal(thermal.objects().length,1);
});
test('explicit activation evicts only a safe cold pool and lets deferred fuel ignite',()=>{
  const {pools,thermal}=setup();deposit(pools,'a',20,0);deposit(pools,'b',40,5);assert.equal(pools.ignite('b'),true);
  assert.equal(pools.state('a').active,false);assert.equal(pools.state('b').burning,true);assert.equal(thermal.objects().length,1);near(pools.ledger().remainingMl,60);
  assert.equal(pools.activate('a'),false);assert.equal(pools.deactivate('b'),false);
});
test('dormant ignition checks oxygen without capturing the full thermal world',()=>{
  const thermal=createThermalSystem();thermal.addRoom('room');let captures=0;const capture=thermal.capture.bind(thermal);thermal.capture=()=>{captures++;return capture();};
  const pools=createPoolsSystem({thermal,maxPools:1});deposit(pools,'a',20,0);deposit(pools,'b',40,5);captures=0;
  assert.equal(pools.ignite('b'),true);assert.equal(captures,0);
});
test('failed ignition of dormant water, wet, foamed or oxygen-starved pools does not evict active fuel',()=>{
  for(const kind of ['water','wet','foam','oxygen']){const {pools,thermal}=setup();deposit(pools,'a',20,0);deposit(pools,'b',40,5,kind==='water'?'water':'diesel');if(kind==='wet')pools.cool('b',1);if(kind==='foam')pools.foam('b',1);if(kind==='oxygen')thermal.configureRoom('room',{oxygen:0});assert.equal(pools.ignite('b'),false);assert.equal(pools.state('a').active,true);assert.equal(pools.state('b').active,false);assert.equal(thermal.objects().length,1);}
});
test('linked, wet, warm and authored thermal state cannot be silently evicted',()=>{
  for(const mode of ['link','wet','warm','authored']){const {pools,thermal}=setup();deposit(pools,'a',20,0);deposit(pools,'b',40,5);
    if(mode==='link'){thermal.add('pipe',{fuelJ:0});thermal.connect('pool:a','pipe');}
    if(mode==='wet')pools.cool('a',1);if(mode==='warm')pools.heat('a',10);if(mode==='authored')thermal.configure('pool:a',{ignition:50});
    assert.equal(pools.activate('b'),false);assert.equal(pools.state('a').active,true);near(pools.state('b').ml,40);
  }
});
test('externally moved thermal pools cannot be evicted and lose their authored position',()=>{
  const {pools,thermal}=setup();deposit(pools,'a',20,0);deposit(pools,'b',40,5);thermal.setPosition('pool:a',[2,0,0]);assert.equal(pools.activate('b'),false);assert.equal(pools.state('a').active,true);assert.deepEqual(thermal.state('pool:a').position,[2,0,0]);
});
test('remove dormant liquid accounts its own source once and cannot remove another node',()=>{
  const {pools,thermal,events}=setup();deposit(pools,'a',20,0);deposit(pools,'b',40,5,'oil','other');pools.remove('b');
  near(pools.ledger().removedMl,40);near(pools.ledger().remainingMl,20);near(events.find(([n])=>n==='pools:removed')[1].sourceVolumes.other,40);assert.equal(thermal.hasObject('pool:a'),true);
  pools.clear();assert.equal(thermal.objects().length,0);near(pools.ledger().initialMl,0);
});
test('dormant heat, water, foam and active status roundtrip without allocating extra nodes',()=>{
  const {pools,thermal}=setup();deposit(pools,'a',20,0);pools.ignite('a');deposit(pools,'b',40,5);pools.heat('b',4000);pools.cool('b',1);pools.foam('b',.8);
  const saved=pools.save();pools.restore(JSON.parse(JSON.stringify(saved)));assert.deepEqual(pools.save(),saved);assert.equal(thermal.objects().length,1);
});
test('dormant heat and water overflow reject before mutating saved or active pool state',()=>{
  const {pools,thermal}=setup();deposit(pools,'a',20,0);deposit(pools,'b',40,5);pools.ignite('a');let rejected=false;
  for(let i=0;i<32;i++){const before=pools.state('b');try{pools.heat('b',Number.MAX_VALUE);}catch(error){assert.ok(error instanceof RangeError);assert.deepEqual(pools.state('b'),before);rejected=true;break;}}
  assert.equal(rejected,true);assert.equal(pools.state('a').active,true);assert.equal(pools.state('b').active,false);assert.equal(thermal.objects().length,1);
  const activation=setup();deposit(activation.pools,'a',20,0);deposit(activation.pools,'b',40,5);const saved=activation.pools.save();saved.pools.find(p=>p.id==='b').temperature=1.7e308;saved.hotOrder.push('b');activation.pools.restore(saved);const poolBefore=activation.pools.state('b'),thermalBefore=activation.thermal.capture();assert.throws(()=>activation.pools.heat('b',Number.MAX_VALUE),RangeError);assert.deepEqual(activation.pools.state('b'),poolBefore);assert.deepEqual(activation.thermal.capture(),thermalBefore);assert.equal(activation.pools.state('a').active,true);assert.equal(activation.pools.state('b').active,false);
  const water=setup();deposit(water.pools,'a',20,0);deposit(water.pools,'b',40,5);water.pools.ignite('a');water.pools.cool('b',Number.MAX_VALUE);const before=water.pools.state('b');assert.throws(()=>water.pools.cool('b',Number.MAX_VALUE),RangeError);assert.deepEqual(water.pools.state('b'),before);assert.equal(water.pools.state('a').active,true);assert.equal(water.pools.state('b').active,false);assert.equal(water.thermal.objects().length,1);
});
test('refill profile overflow is rejected before pool provenance or thermal state changes',()=>{
  const {pools,thermal}=setup();deposit(pools,'a',20,0);const poolBefore=pools.save(),thermalBefore=thermal.capture(),ledgerBefore=pools.ledger();assert.throws(()=>pools.deposit({id:'a',ml:1e307,kind:'diesel',sourceKey:'overflow'}),RangeError);assert.deepEqual(pools.save(),poolBefore);assert.deepEqual(thermal.capture(),thermalBefore);assert.deepEqual(pools.ledger(),ledgerBefore);
});
test('dormant refill rejects a foreign thermal id collision before changing pool ledgers',()=>{
  const {pools,thermal}=setup();deposit(pools,'a',20,0);deposit(pools,'b',40,5);pools.remove('a');thermal.add('pool:b',{fuelJ:0});const poolBefore=pools.save(),thermalBefore=thermal.capture();assert.throws(()=>pools.deposit({id:'b',ml:1,kind:'water',sourceKey:'hose'}),/already owned/);assert.deepEqual(pools.save(),poolBefore);assert.deepEqual(thermal.capture(),thermalBefore);
});
test('failed generated-pool deposits leave the id counter and all snapshots untouched',()=>{
  const {pools}=setup();const before=pools.save();assert.throws(()=>pools.deposit({ml:1e307,kind:'diesel'}),/profile exceeds/);assert.deepEqual(pools.save(),before);const created=pools.deposit({ml:10,kind:'water'});assert.equal(created.id,'puddle-1');
});
test('extreme dormant cooling matches thermal overflow behavior without mutation',()=>{
  const {pools,thermal}=setup({thermal:{ambient:-1e308}});deposit(pools,'a',20,0);deposit(pools,'b',40,5);pools.ignite('a');const saved=pools.save();saved.pools.find(p=>p.id==='b').temperature=1e308;saved.hotOrder.push('b');pools.restore(saved);const before=pools.state('b');assert.throws(()=>pools.cool('b',Number.MAX_VALUE),RangeError);assert.deepEqual(pools.state('b'),before);assert.equal(pools.state('a').active,true);assert.equal(thermal.objects().length,1);
});
test('finite midpoint refill remains accepted when subtracting extreme temperatures would overflow',()=>{
  const {pools}=setup({thermal:{ambient:-1e308}});deposit(pools,'a',20,0);deposit(pools,'b',40,5);const saved=pools.save();saved.pools.find(p=>p.id==='b').temperature=1e308;saved.hotOrder.push('b');pools.restore(saved);const result=pools.deposit({id:'b',ml:160,kind:'water'});assert.ok(Number.isFinite(result.temperature));assert.ok(result.temperature<0);assert.equal(result.wetMl,160);assert.equal(result.ml,200);
});
test('restore rejects finite dormant components whose derived profile overflows atomically',()=>{
  const {pools,thermal}=setup();deposit(pools,'a',20,0);const before=pools.save(),thermalBefore=thermal.capture(),bad=structuredClone(before);bad.pools[0].active=false;bad.pools[0].components={diesel:1e307};bad.pools[0].sources={can:{diesel:1e307}};bad.pools[0].sourceMl=1e307;bad.pools[0].ml=1e307;bad.activeOrder=[];bad.hotOrder=[];bad.ledger={initialMl:1e307,remainingMl:1e307,burnedMl:0,removedMl:0};assert.throws(()=>pools.restore(bad),/profile exceeds/);assert.deepEqual(pools.save(),before);assert.deepEqual(thermal.capture(),thermalBefore);
});
test('clear prevents removal observers from recreating orphaned thermal pools',()=>{
  const thermal=createThermalSystem();let pools,blocked=false,attempted=false;thermal.addRoom('room');pools=createPoolsSystem({thermal,maxPools:2,emit(name){if(name==='pools:removed'&&!attempted){attempted=true;try{pools.deposit({id:'b',ml:10,kind:'water',position:[5,0,0]});}catch(error){blocked=/during clear/.test(error.message);}}}});pools.deposit({id:'a',ml:10,kind:'water'});pools.clear();assert.equal(blocked,true);assert.equal(pools.stats().records,0);assert.equal(thermal.objects().length,0);
});
test('snapshot accepts many dormant records but rejects active budget and dormant fire atomically',()=>{
  const {pools,thermal}=setup();for(let i=0;i<8;i++)deposit(pools,`p${i}`,10,i*5);const saved=pools.save();pools.restore(saved);assert.equal(pools.all().length,8);
  for(const change of [b=>b.active=true,b=>b.burning=true,b=>b.active=null]){const bad=structuredClone(saved);change(bad.pools[1]);const before=thermal.capture();assert.throws(()=>pools.restore(bad));assert.deepEqual(pools.save(),saved);assert.deepEqual(thermal.capture(),before);}
});
test('combined thermal/pool checkpoint validates only active nodes while restoring dormant metadata',()=>{
  const {pools,thermal}=setup();deposit(pools,'a',20,0);deposit(pools,'b',40,5);
  const cp=createCheckpointSystem({sceneId:'budget'});cp.register('world',{capture(){return {heat:thermal.capture(),liquid:pools.save()};},prepareRestore(data){const h=thermal.prepareRestore(data.heat),p=pools.prepareRestore(data.liquid,{thermalPlan:h});return {commit(){h.commit();p.commit();},notify(){h.notify();p.notify();}};}});
  const saved=cp.capture();pools.ignite('b');cp.restore(saved);assert.equal(pools.state('a').active,true);assert.equal(pools.state('b').active,false);near(pools.state('b').ml,40);assert.equal(thermal.objects().length,1);
});
test('thermal budget exhaustion also retains logical deposits and avoids id collisions',()=>{
  const {pools,thermal}=setup({thermal:{maxObjects:1}});thermal.add('solid',{fuelJ:0});const b=deposit(pools,'b',40,5);assert.equal(b.active,false);near(pools.ledger().remainingMl,40);
  thermal.remove('solid');assert.equal(pools.activate('b'),true);
  const before=pools.save();thermal.addRoom('other');assert.throws(()=>pools.deposit({id:'b',ml:1,roomId:'other'}));assert.deepEqual(pools.save(),before);
});
test('custom ambient is retained during cold deposition and deferred cooling',()=>{
  const {pools}=setup({thermal:{ambient:35}});deposit(pools,'a',20,0);deposit(pools,'b',40,5);near(pools.state('a').temperature,35);near(pools.state('b').temperature,35);
  pools.ignite('a');pools.heat('b',1000);pools.cool('b',100);near(pools.state('b').temperature,35);
});
test('render query caps graphics independently of retained records and prioritizes active pools',()=>{
  const {pools,thermal}=setup();for(let i=0;i<1000;i++)deposit(pools,`p${i}`,10,i*5);
  assert.equal(pools.stats().records,1000);assert.equal(thermal.objects().length,1);assert.equal(pools.visible(16).length,16);assert.equal(pools.visible(16)[0].active,true);
  near(pools.ledger().remainingMl,10000);assert.equal(pools.nextDormant().id,'p1');pools.remove('p1');assert.equal(pools.nextDormant().id,'p2');
  const saved=pools.save();pools.restore(saved);near(pools.ledger().remainingMl,9990);assert.equal(pools.visible(16).length,16);
});
test('spatial merge across a cell boundary preserves the earliest authored pool choice',()=>{
  const {pools}=setup();deposit(pools,'first',10,.99);deposit(pools,'second',10,1.1);
  const merged=pools.deposit({ml:5,position:[1.05,0,0],roomId:'room',kind:'water'});assert.equal(merged.id,'first');near(pools.state('second').ml,10);
  pools.restore(pools.save());assert.equal(pools.deposit({ml:5,position:[1.05,0,0],roomId:'room'}).id,'first');
});
test('old snapshots without activity fields restore as fully active within their old budget',()=>{
  const {pools}=setup();deposit(pools,'a',20,0);const legacy=pools.save();delete legacy.pools[0].active;pools.restore(legacy);assert.equal(pools.state('a').active,true);
});
