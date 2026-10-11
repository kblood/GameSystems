import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createThermalSystem } from '../../extensions/thermal/index.js';
import thermal from '../src/vendor/extensions/thermal/index.js';
import pools,{createPoolsSystem} from '../../extensions/pools/index.js';
import {createSmokeSystem,SMOKE_BUDGETS} from '../../extensions/smoke/index.js';
import {createHost} from '../src/vendor/extensions/host/index.js';
import bottles from '../src/vendor/extensions/bottles/index.js';
import {connectBottlePools} from '../../extensions/pools/bottle-bridge.js';
import {createFakePhysics} from './fake-physics.js';
import {dropComponents,receiveComponents} from '../../extensions/bottles/liquid_components.js';
const near=(a,b,eps=1e-5)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
const advance=(s,t)=>{for(let i=0;i<t;i++)s.step(1);};

test('fire: nonflammable metal never ignites; ignition threshold and flammability control burning',()=>{
  const t=createThermalSystem();t.add('metal',{material:'metal'});assert.equal(t.ignite('metal'),false);
  t.add('wood',{material:'wood',temperature:179,cooling:0});t.step(1);assert.equal(t.state('wood').burning,false);t.addHeat('wood',100);t.step(1);assert.equal(t.state('wood').burning,true);
  const initial=t.state('wood').fuelJ;t.configure('wood',{flammability:.2});t.step(1);near(initial-t.state('wood').fuelJ,200);t.configure('wood',{flammability:0});assert.equal(t.state('wood').burning,false);
});
test('fire: spatially cached spread ignites nearby fuel, cannot jump a closed room wall',()=>{
  const t=createThermalSystem({autoSpread:true,spreadRadius:1,spreadConductance:100});t.addRoom('a');t.addRoom('b');t.addVent('door',{a:'a',b:'b',open:0});
  t.add('fire',{roomId:'a',position:[0,0,0],temperature:500,fuelJ:0,cooling:0,heatCapacity:1000});
  t.add('same',{roomId:'a',position:[.3,0,0],ignition:30,heatCapacity:10,cooling:0});t.add('other',{roomId:'b',position:[.4,0,0],ignition:30,heatCapacity:10,cooling:0});
  t.step(1);assert.equal(t.state('same').burning,true);near(t.state('other').temperature,20);
  t.setVent('door',1);t.step(1);assert.equal(t.state('other').burning,true);
});
test('fire: sealing a room starves fire, leaves hot fuel and smoke; reopening can reignite',()=>{
  const t=createThermalSystem();t.addRoom('room',{volume:1});t.addVent('window',{a:'room',flow:5,open:0});t.add('chair',{roomId:'room',fuelJ:100000,burnPower:3000,cooling:0});t.ignite('chair');advance(t,30);
  assert.equal(t.state('chair').burning,false);assert.ok(t.state('chair').fuelJ>0);assert.ok(t.roomState('room').oxygen<.14);assert.ok(t.roomState('room').smoke>0);
  const smoke=t.roomState('room').smoke;t.setVent('window',1);t.step(1);assert.equal(t.state('chair').burning,true);assert.ok(t.roomState('room').smoke<smoke);
});
test('fire: room-to-room smoke exchange conserves smoke; outside ventilation removes it',()=>{
  const t=createThermalSystem();t.addRoom('a',{volume:10,smoke:5});t.addRoom('b',{volume:20,smoke:0});t.addVent('door',{a:'a',b:'b',flow:20});t.step(5);
  near(t.roomState('a').smoke+t.roomState('b').smoke,5);assert.ok(t.roomState('b').smoke>0);t.addVent('outside',{a:'a',flow:10});t.step(5);assert.ok(t.roomState('a').smoke+t.roomState('b').smoke<5);
});
test('fire: oxygen budget shared fairly independent of object insertion order',()=>{
  function run(order){const t=createThermalSystem({oxygenCost:100});t.addRoom('r',{volume:1});for(const id of order){t.add(id,{roomId:'r',fuelJ:10000,burnPower:1000});t.ignite(id);}t.step(.05);return [t.state('a').fuelJ,t.state('b').fuelJ,t.roomState('r').oxygen];}
  const a=run(['a','b']),b=run(['b','a']);near(a[0],a[1]);near(a[0],b[0]);near(a[2],.12);
});
test('fire: fixed 20Hz simulation is independent of rendering frame rate and quality',()=>{
  function run(dt,quality){const t=createThermalSystem({quality});t.add('fire');t.ignite('fire');for(let i=0;i<Math.round(2/dt);i++)t.step(dt);return t.state('fire');}
  for(const q of ['minimal','low','mid','high']){const a=run(1/30,q),b=run(1/120,q);near(a.fuelJ,b.fuelJ);near(a.temperature,b.temperature);}
});
test('fire: neighbour links and object registration have explicit budgets',()=>{
  const t=createThermalSystem({autoSpread:true,maxObjects:20,maxNeighbours:3});for(let i=0;i<20;i++)t.add(`o${i}`,{position:[i*.001,0,0]});t.step(.05);assert.ok(t.stats().spreadLinks<=30);assert.throws(()=>t.add('too-many'));
});
test('fire: fictional timed charge emits one blast and respects walls',()=>{
  const blasts=[],t=createThermalSystem({emit:(e,d)=>{if(e==='thermal:blast')blasts.push(d);}});t.addRoom('a');t.addRoom('b');
  t.add('charge',{roomId:'a',material:'powder',blast:{fuseSeconds:.2,radius:2,strength:10}});t.add('near',{roomId:'a',position:[.5,0,0],fuelJ:0});t.add('wall',{roomId:'b',position:[.5,0,0],fuelJ:0});t.arm('charge');t.step(1);
  assert.equal(blasts.length,1);assert.ok(blasts[0].hits.some(h=>h.id==='near'));assert.ok(!blasts[0].hits.some(h=>h.id==='wall'));assert.equal(t.arm('charge'),false);t.step(1);assert.equal(blasts.length,1);
});
test('pools: diesel has flash/ignition threshold; water and unknown do not burn',()=>{
  const t=createThermalSystem(),p=createPoolsSystem({thermal:t});p.deposit({id:'diesel',ml:100,kind:'diesel'});p.deposit({id:'water',position:[2,0,0],ml:100,kind:'water'});
  assert.equal(p.ignite('water'),false);t.step(1);assert.equal(p.state('diesel').burning,false);p.heat('diesel',10000);t.step(1);assert.equal(p.state('diesel').burning,true);
  p.foam('diesel');assert.equal(p.state('diesel').burning,false);assert.ok(p.state('diesel').ml>0);
});
test('pools: deposited water cools and wets an active burning pool without losing liquid attribution',()=>{
  const t=createThermalSystem(),p=createPoolsSystem({thermal:t});p.deposit({id:'fuel',ml:100,kind:'diesel',sourceKey:'can'});p.heat('fuel',10000);t.step(1);assert.equal(p.state('fuel').burning,true);
  const before=p.state('fuel'),ledger=p.ledger();p.deposit({id:'fuel',ml:20,kind:'water',sourceKey:'hose'});const after=p.state('fuel');
  assert.equal(after.burning,false);assert.equal(after.wetMl,20);assert.ok(after.temperature<before.temperature);assert.equal(after.components.diesel,100);assert.equal(after.components.water,20);
  assert.equal(after.sources.can.diesel,100);assert.equal(after.sources.hose.water,20);assert.equal(p.ledger().initialMl,ledger.initialMl+20);assert.equal(p.ledger().remainingMl,ledger.remainingMl+20);
  assert.equal(p.ignite('fuel'),false);
});
test('pools: deposited water cools hot budget-dormant pools and preserves that state through restore',()=>{
  const t=createThermalSystem(),p=createPoolsSystem({thermal:t,maxPools:1});p.deposit({id:'blocker',ml:20,kind:'diesel'});p.ignite('blocker');p.deposit({id:'dormant',position:[5,0,0],ml:100,kind:'diesel'});
  p.heat('dormant',20000);assert.equal(p.state('dormant').active,false);const hot=p.state('dormant');assert.ok(hot.temperature>20);
  p.deposit({id:'dormant',ml:20,kind:'water',sourceKey:'sprinkler'});const cooled=p.state('dormant');assert.equal(cooled.active,false);assert.equal(cooled.burning,false);assert.equal(cooled.wetMl,20);assert.ok(cooled.temperature<hot.temperature);
  const saved=JSON.parse(JSON.stringify(p.save()));p.remove('blocker');p.restore(saved);const restored=p.state('dormant');assert.equal(restored.active,false);assert.equal(restored.wetMl,20);assert.equal(restored.temperature,cooled.temperature);assert.equal(restored.components.diesel,100);assert.equal(restored.components.water,20);assert.equal(restored.sources.sprinkler.water,20);
});
test('pools: combustible volume consumed conservatively, water remains, snapshot survives reload',()=>{
  const t=createThermalSystem(),p=createPoolsSystem({thermal:t});p.deposit({id:'p',ml:100,kind:'diesel'});p.deposit({id:'p',ml:50,kind:'water'});
  const before=p.state('p').fuelJ;t.configure('pool:p',{fuelJ:before-400});p.burned('pool:p',400);near(p.state('p').components.diesel,99);near(p.state('p').components.water,50);
  const l=p.ledger();near(l.initialMl,l.remainingMl+l.burnedMl+l.removedMl);const saved=JSON.parse(JSON.stringify(p.save()));p.clear();p.restore(saved);near(p.state('p').ml,149);near(p.ledger().burnedMl,1);
  const old=p.save();assert.throws(()=>p.restore({...saved,schema:'bad'}));assert.deepEqual(p.save(),old);
});
test('pools: deposits merge, remain permanent without flames, budget never evicts old fuel',()=>{
  const t=createThermalSystem(),p=createPoolsSystem({thermal:t,maxPools:1});p.deposit({ml:50,kind:'diesel'});p.deposit({position:[.1,0,0],ml:50,kind:'diesel'});assert.equal(p.all().length,1);near(p.all()[0].ml,100);
  const retained=p.deposit({position:[5,0,0],ml:100,kind:'oil'});assert.equal(retained.active,false);advance(t,200);near(p.all()[0].ml,100);near(p.state(retained.id).ml,100);near(p.ledger().remainingMl,200);
});
test('smoke: instanced VFX cap, quality trimming and disposal do not change reservoir state',()=>{
  const t=createThermalSystem(),scene=new THREE.Scene();t.addRoom('r',{smoke:10,volume:10});t.add('fire',{roomId:'r',burnPower:5000});t.ignite('fire');
  const s=createSmokeSystem({THREE,scene,thermal:t,quality:'high'});s.addRoomBounds('r',{min:[-1,0,-1],max:[1,3,1]});for(let i=0;i<100;i++)s.step(.1);
  assert.ok(s.stats().particles>0);assert.ok(s.stats().particles<=SMOKE_BUDGETS.high);const reservoir=t.roomState('r').smoke;s.setQuality('minimal');assert.ok(s.stats().particles<=12);near(t.roomState('r').smoke,reservoir);s.dispose();assert.equal(scene.children.length,0);
});
test('integration: real diesel drops become persistent pools; burning stays in bottle ledger after VFX eviction',async()=>{
  const physics=createFakePhysics(),scene=new THREE.Scene(),errors=[],host=createHost({THREE,scene,physics,onError:e=>errors.push(e.message)});
  const heat=await host.load(thermal),surface=new THREE.Mesh(new THREE.BoxGeometry(2,.2,2),new THREE.MeshStandardMaterial());surface.position.y=-.1;surface.userData.materialId='floor';scene.add(surface);
  const p=await host.load(pools),b=await host.load(bottles,{surfaces:[surface],audio:{play(){}}}),off=connectBottlePools({host,bottles:b,pools:p});b.pour.initialMl=100;b.pour.emit(100,new THREE.Vector3(0,.5,0),undefined,{liquidKind:'diesel'});
  for(let i=0;i<60;i++)physics.step(1/60);near(p.all()[0].ml,100);b.pour.setQuality({...b.pour.settings,maxPuddles:0});assert.equal(b.pour.puddles.length,0);
  p.ignite(p.all()[0].id);host.update(1);assert.ok(p.all()[0].ml<100);near(b.ledger().puddleMl,p.all()[0].ml);near(b.ledger().burnedMl,p.ledger().burnedMl);near(b.ledger().errorMl,0);assert.deepEqual(errors,[]);
  b.reset();assert.equal(p.all().length,0);off();host.dispose();
});
test('fire: cold idle objects require no heat exchanges or active object steps',()=>{
  const t=createThermalSystem({autoSpread:true});for(let i=0;i<100;i++)t.add(`o${i}`,{position:[i*.01,0,0]});t.step(1);assert.equal(t.stats().objectSteps,0);assert.equal(t.stats().linkSteps,0);t.addHeat('o0',10000);t.step(1);assert.ok(t.stats().objectSteps>0);
});
test('liquid composition survives receiving and re-pouring a mixed bottle',()=>{
  const b={fillMl:100,liquidKind:'diesel'};receiveComponents(b,{water:50},50,50);b.fillMl+=50;
  assert.equal(b.liquidKind,'mixed');const components=dropComponents(30,b.liquidKind,b);near(components.diesel,20);near(components.water,10);
});
test('pools: quality-limited mixed flight keeps diesel identity and applies water suppression',async()=>{
  const physics=createFakePhysics(),scene=new THREE.Scene(),host=createHost({THREE,scene,physics});await host.load(thermal);
  const floor=new THREE.Mesh(new THREE.BoxGeometry(2,.2,2),new THREE.MeshStandardMaterial());floor.position.y=-.1;scene.add(floor);const p=await host.load(pools),b=await host.load(bottles,{surfaces:[floor],audio:{play(){}}});
  b.pour.settings={...b.pour.settings,maxFlights:1};b.pour.initialMl=100;b.pour.emit(50,new THREE.Vector3(0,.5,0),undefined,{liquidKind:'diesel'});b.pour.emit(50,new THREE.Vector3(0,.5,0),undefined,{liquidKind:'water'});
  for(let i=0;i<60;i++)physics.step(1/60);const pool=p.all()[0];near(pool.components.diesel,50);near(pool.components.water,50);assert.ok(pool.fuelJ>0);assert.equal(pool.wetMl,50);assert.equal(p.ignite(pool.id),false);host.dispose();
});
test('source ledger restore accepts consumption rewind but rejects new deposits',async()=>{
  const physics=createFakePhysics(),scene=new THREE.Scene(),host=createHost({scene,physics});const b=await host.load(bottles,{audio:{play(){}}});b.pour.initialMl=100;b.pour.puddleMl=100;const saved=b.ledger();b.consumePuddleVolume(10);b.restorePuddleLedger(saved);near(b.ledger().errorMl,0);near(b.ledger().puddleMl,100);b.pour.initialMl+=10;b.pour.puddleMl+=10;assert.throws(()=>b.restorePuddleLedger(saved));host.dispose();
});
