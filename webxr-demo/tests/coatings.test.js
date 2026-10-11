import test from 'node:test';
import assert from 'node:assert/strict';
import {createThermalSystem} from '../../extensions/thermal/index.js';
import {createPoolsSystem} from '../../extensions/pools/index.js';
import {createCoatingSystem} from '../../extensions/coatings/index.js';
import {createHost} from '../../extensions/host/index.js';
import thermalExtension from '../../extensions/thermal/index.js';
import poolsExtension from '../../extensions/pools/index.js';
import supplyExtension from '../../extensions/supply/index.js';
import coatingsExtension from '../../extensions/coatings/index.js';
import sprinklersExtension from '../../extensions/sprinklers/index.js';
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
test('removing a liquid source removes only its water suppression dose from a fuel pool',()=>{
  const w=world();w.pools.deposit({id:'p',ml:100,kind:'diesel',sourceKey:'fuel'});assert.equal(w.pools.ignite('p'),true);
  w.pools.deposit({id:'p',ml:100,kind:'water',sourceKey:'water-a'});w.pools.deposit({id:'p',ml:25,kind:'water',sourceKey:'water-b'});
  near(w.pools.state('p').wetMl,125);assert.equal(w.pools.state('p').burning,false);
  w.pools.removeSource('water-a');near(w.pools.state('p').wetMl,25);assert.equal(w.pools.state('p').components.water,25);
  w.pools.removeSource('water-b');near(w.pools.state('p').wetMl,0);assert.equal(w.pools.state('p').components.water,undefined);
  w.pools.heat('p',10000);w.thermal.step(.05);assert.equal(w.pools.state('p').burning,true,'remaining fuel can reignite after the removed source no longer wets it');
});
test('removing pre-fuel water preserves unrelated cooling dose and source attribution survives pool restore',()=>{
  const w=world();w.pools.deposit({id:'p',ml:100,kind:'water',sourceKey:'early-water'});w.pools.deposit({id:'p',ml:100,kind:'diesel',sourceKey:'fuel'});
  w.pools.cool('p',50);near(w.pools.state('p').wetMl,50);w.pools.removeSource('early-water');near(w.pools.state('p').wetMl,50);
  const checkpoint=world();checkpoint.pools.deposit({id:'p',ml:100,kind:'diesel',sourceKey:'fuel'});checkpoint.pools.deposit({id:'p',ml:100,kind:'water',sourceKey:'water'});checkpoint.pools.cool('p',50);
  const saved=checkpoint.pools.save();checkpoint.pools.removeSource('water');near(checkpoint.pools.state('p').wetMl,50);checkpoint.pools.restore(saved);checkpoint.pools.removeSource('water');near(checkpoint.pools.state('p').wetMl,50);
});
test('source wetness decays proportionally and follows dormant pool activation',()=>{
  const thermal=createThermalSystem(),pools=createPoolsSystem({thermal,maxPools:1});
  pools.deposit({id:'blocker',ml:10,kind:'diesel'});pools.ignite('blocker');
  pools.deposit({id:'target',ml:100,kind:'diesel',sourceKey:'fuel',position:[5,0,0]});pools.deposit({id:'target',ml:100,kind:'water',sourceKey:'water',position:[5,0,0]});pools.cool('target',100);
  assert.equal(pools.state('target').active,false);pools.remove('blocker');assert.equal(pools.activate('target'),true);
  thermal.step(.1);near(pools.state('target').wetMl,199.995);pools.removeSource('water');near(pools.state('target').wetMl,99.9975);
});
test('removing a fully dried source water leaves a checkpoint-valid wetness ledger',()=>{
  const thermal=createThermalSystem({fixedStep:10}),pools=createPoolsSystem({thermal});
  pools.deposit({id:'p',ml:100,kind:'diesel',sourceKey:'fuel'});pools.deposit({id:'p',ml:100,kind:'water',sourceKey:'water'});
  for(let i=0;i<200;i++)thermal.step(10);
  near(pools.state('p').wetMl,0);pools.removeSource('water');const snapshot=pools.save();
  assert.equal(Object.hasOwn(snapshot.pools[0].wetSources,'water'),false);pools.restore(snapshot);near(pools.state('p').wetMl,0);
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

test('host sprinkler preserves fluid provenance and only water or foam suppresses a burning fuel pool',async()=>{
  for(const kind of ['foam','water','diesel','oil']){
    const errors=[],host=createHost({onError:error=>errors.push(error.message)});
    try{
      const thermal=await host.load(thermalExtension);
      const pools=await host.load(poolsExtension);
      const supply=await host.load(supplyExtension);
      const coatings=await host.load(coatingsExtension);
      const sprinklers=await host.load(sprinklersExtension);
      let spray=null,deposit=null;const poolCoverage=[];
      host.on('sprinklers:spray',event=>{spray=event;});
      host.on('liquid:deposit',event=>{deposit=event;});
      host.on('coatings:changed',event=>{if(event.id==='pool:fuel')poolCoverage.push(event.coverage);});
      // The existing pool is in the spray radius but outside the floor-impact
      // merge radius; pool targeting must still reach it directly.
      pools.deposit({id:'fuel',surfaceId:'ground',position:[3,0,0],ml:100,kind:'diesel',sourceKey:'can'});
      assert.equal(pools.ignite('fuel'),true);
      pools.heat('fuel',10000);
      supply.add('tank',{capacityMl:100,components:{[kind]:100}});
      sprinklers.add('head',{tankId:'tank',position:[0,2.5,0],surfaceId:'ground',floorY:0,radius:4,rateMlPerSecond:1000});
      sprinklers.trigger('head');sprinklers.step(.1);

      const pool=pools.state('fuel'),tank=supply.state('tank');
      assert.ok(spray.targets.includes('pool:fuel'),'spray explicitly targets the existing fuel pool');
      assert.equal(spray.id,'head','spray event retains the sprinkler identity');
      assert.equal(deposit.id,'fuel','targeted pool receives a direct pool-owned deposit');
      assert.equal(deposit.emitterId,'head','liquid deposit retains the sprinkler identity as emitterId');
      assert.equal(pools.all().length,1,`${kind} reaches the existing puddle instead of creating a sprinkler-id pool`);
      assert.equal(tank.ml,0,`${kind} leaves no unaccounted tank volume`);
      near(tank.drawnMl,100);
      near(pool.components.diesel,100+(kind==='diesel'?100:0));
      near(pool.sources.can.diesel,100);
      near(pool.sources['sprinkler:head'][kind],100);
      near(pools.ledger().remainingMl,200);
      assert.deepEqual(pool.position,[3,0,0],'targeted pool stays at its authored location');
      if(kind==='foam'){
        assert.ok(pool.blanket>=.95,`sprinkler foam coats the receiving fuel pool (coverage ${pool.blanket})`);
        assert.equal(poolCoverage.length,1,'pool receives one coating application through deposit, without double coverage');
        assert.equal(pool.burning,false,'foam blanket suppresses the existing pool fire');
        assert.equal(pool.wetMl,0,'foam does not invent water cooling');
      }else if(kind==='water'){
        assert.equal(pool.burning,false,'sprinkler water cools the existing pool fire');
        near(pool.wetMl,100);
        assert.equal(pool.blanket,0,'water does not invent foam coverage');
      }else{
        assert.equal(pool.burning,true,`${kind} remains fuel rather than suppressing the fire`);
        assert.equal(pool.blanket,0,`${kind} does not create foam coverage`);
        assert.ok(pool.fuelJ>0,`${kind} adds combustible energy`);
      }
      assert.deepEqual(errors,[]);
    }finally{host.dispose();}
  }
});
