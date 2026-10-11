import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createCheckpointSystem} from '../../extensions/checkpoint/index.js';
import {createFireSceneProvider} from '../../extensions/checkpoint/fire-scene.js';
import {createThermalSystem} from '../../extensions/thermal/index.js';
import {createPoolsSystem} from '../../extensions/pools/index.js';
import {createMechanicsSystem} from '../../extensions/mechanics/index.js';
import {createBottleSystem} from '../src/vendor/extensions/bottles/index.js';
import {createFakePhysics} from './fake-physics.js';
import {mixComponents} from '../../extensions/bottles/liquid_components.js';

function scalar(initial, fail = () => false) {
  let value = initial;
  return {get value(){return value;},capture:()=>({value}),prepareRestore(data){
    if(!Number.isFinite(data.value))throw new Error('Invalid scalar');
    return {commit(){value=data.value;if(fail(value))throw new Error('Adapter failed');}};
  }};
}
function normalized(data){const copy=structuredClone(data);for(const b of copy.state.fire.bottles.bottles){delete b.lastImpactAgo;delete b.lastPourAgo;}return copy;}
function world(){
  const scene=new THREE.Scene(),physics=createFakePhysics(),events=[];
  const thermal=createThermalSystem({autoSpread:true,emit:(event,data)=>{events.push(event);if(event==='thermal:burned')pools.burned(data.id,data.joules);}});
  thermal.addRoom('room',{volume:10,oxygen:.8,smoke:.4,temperature:35});thermal.addVent('window',{a:'room',open:.2,flow:1});
  thermal.add('wood',{roomId:'room',position:[0,.3,0],temperature:100,heaterW:0});
  thermal.add('charge',{roomId:'room',position:[2,.3,0],material:'powder',blast:{fuseSeconds:2,radius:1,strength:5}});
  const pools=createPoolsSystem({thermal});pools.deposit({id:'diesel',roomId:'room',surfaceId:'floor',position:[-.5,.01,0],ml:20,kind:'diesel',sourceKey:'bottles'});
  const mechanics=createMechanicsSystem();mechanics.add('door',{kind:'hinge',max:Math.PI/2,value:.4});
  const floor=new THREE.Mesh(new THREE.BoxGeometry(4,.2,4),new THREE.MeshStandardMaterial());floor.position.y=-.1;floor.userData.materialId='floor';scene.add(floor);
  const source=createBottleSystem({scene,physics,surfaces:[floor],audio:{play(){}}});
  const root=new THREE.Group(),glass=new THREE.Mesh(new THREE.CylinderGeometry(.03,.03,.2,10),new THREE.MeshStandardMaterial());glass.position.y=.1;root.add(glass);
  const liquid={info:{},fill:.5,capOpen:false,uniforms:{uLiquidColor:{value:new THREE.Color(.4,.5,.2)}},agitate(){},update(){}};
  const bottle=source.adopt({id:'can',root,liquid,asset:{capacity_ml:200,height_m:.2},fill:.5,position:new THREE.Vector3(1,1,0)});bottle.checkpointId='can';bottle.liquidKind='diesel';
  bottle.fillMl=70;source.pour.puddleMl=20;source.pour.emit(10,new THREE.Vector3(1,.6,0),new THREE.Vector3(.1,-.2,0),bottle);physics.hold(bottle.entry,{position:[1,1,0],quaternion:[0,0,0,1]});
  let app={waterMl:800,paused:true,pourClock:1.5};
  const application={capture:()=>({...app}),prepareRestore(data){if(!Number.isFinite(data.waterMl)||data.waterMl<0)throw new Error('Invalid application');return {commit(){app={...data};}};}};
  const checkpoint=createCheckpointSystem({sceneId:'fixture'});checkpoint.register('fire',createFireSceneProvider({thermal,pools,bottles:source,mechanics,application}));
  return {checkpoint,thermal,pools,mechanics,source,bottle,physics,scene,events,app:()=>app};
}

test('checkpoint validates all providers before any commit or observer',()=>{
  const c=createCheckpointSystem({sceneId:'test'}),a=scalar(1),b=scalar(2);c.register('a',a);c.register('b',b);
  const saved=c.capture();saved.state.a.value=5;saved.state.b.value='bad';assert.throws(()=>c.restore(saved));assert.equal(a.value,1);assert.equal(b.value,2);
});
test('checkpoint rolls back earlier and partially failing commits',()=>{
  let failed=false;const c=createCheckpointSystem({sceneId:'test'}),a=scalar(1),b=scalar(2,v=>{if(v===99&&!failed){failed=true;return true;}return false;});c.register('a',a);c.register('b',b);
  const bad=c.capture();bad.state.a.value=5;bad.state.b.value=99;assert.throws(()=>c.restore(bad));assert.equal(a.value,1);assert.equal(b.value,2);
});
test('checkpoint stays restored when presentation observer fails',()=>{
  const c=createCheckpointSystem({sceneId:'test'}),a=scalar(1);c.register('a',{capture:a.capture,prepareRestore(data){const p=a.prepareRestore(data);return {...p,notify(){throw new Error('View failed');}};}});
  const saved=c.capture();saved.state.a.value=5;const result=c.restore(saved);assert.equal(a.value,5);assert.deepEqual(result.observerErrors,['View failed']);
});
test('checkpoint JSON roundtrip, scene ownership, providers, byte limits and disposal',()=>{
  const c=createCheckpointSystem({sceneId:'test',maxBytes:1024});c.register('a',scalar(1));assert.deepEqual(c.decode(c.encode()),c.capture());
  const bad=c.capture();bad.sceneId='other';assert.throws(()=>c.restore(bad));assert.throws(()=>c.decode('x'.repeat(2000)));assert.throws(()=>c.restore({...c.capture(),state:{unknown:{value:1}}}));
  c.dispose();assert.throws(()=>c.capture());assert.throws(()=>c.restore(bad));
});
test('full scene checkpoint restores rooms, charged timer, phase, liquids in flight, door and water together',()=>{
  const w=world();w.thermal.arm('charge');w.thermal.step(.03);const saved=w.checkpoint.capture();
  w.thermal.step(3);w.thermal.setVent('window',1);w.pools.remove('diesel');w.mechanics.setValue('door',1);w.bottle.fillMl=0;w.source.pour.flights=[];w.source.pour.lostMl=80;
  w.checkpoint.restore(saved);assert.deepEqual(normalized(w.checkpoint.capture()),normalized(saved));assert.equal(w.thermal.state('charge').blast.armed,true);assert.equal(w.source.ledger().inFlightMl,10);assert.equal(w.app().waterMl,800);
});
test('a corrupted application, room, pool attribution or bottle leaves all live owners unchanged',()=>{
  for(const corrupt of [s=>{s.application.waterMl=-1;},s=>{s.thermal.rooms[0].oxygen=2;},s=>{s.pools.pools[0].sources.bottles.diesel=100;},s=>{s.bottles.bottles[0].pose.quaternion=[0,0,0,0];}]){
    const w=world(),before=w.checkpoint.capture(),bad=structuredClone(before);corrupt(bad.state.fire);assert.throws(()=>w.checkpoint.restore(bad));assert.deepEqual(normalized(w.checkpoint.capture()),normalized(before));
  }
});
test('logical smoke, wetness, foam and hot empty pool traces survive serialized restore',()=>{
  const w=world();w.pools.cool('diesel',10);w.pools.foam('diesel',.8);w.thermal.configure('pool:diesel',{temperature:250});
  w.thermal.configure('pool:diesel',{fuelJ:0});w.pools.burned('pool:diesel',8000);
  const saved=w.checkpoint.capture();w.pools.clear({account:false});w.checkpoint.restore(JSON.parse(JSON.stringify(saved)));
  const p=w.pools.state('diesel');assert.equal(p.ml,0);assert.equal(p.temperature,250);assert.equal(p.wetMl,10);assert.equal(p.blanket,.8);assert.equal(w.thermal.roomState('room').smoke,.4);
});
test('thermal continuation is identical across restoring a fractional fixed-step phase',()=>{
  const a=world(),b=world();a.thermal.arm('charge');a.thermal.step(.13);b.checkpoint.restore(a.checkpoint.capture());
  for(let i=0;i<20;i++){a.thermal.step(.016);b.thermal.step(.016);}
  assert.deepEqual(a.thermal.capture(),b.thermal.capture());
});
test('pending source drops continue with the same volume, identity, position and colour',()=>{
  const a=world(),b=world();b.checkpoint.restore(a.checkpoint.capture());
  for(let i=0;i<4;i++){a.physics.step(.016);b.physics.step(.016);}
  assert.deepEqual(a.source.capture().flights,b.source.capture().flights);assert.deepEqual(a.source.ledger(),b.source.ledger());
});
test('source checkpoint recreates exit holes without increasing their radius on repeated restore',()=>{
  const w=world();w.source.breakage.addHoleLocal(w.bottle,new THREE.Vector3(.02,.05,0),new THREE.Vector3(1,0,0),.0025,true);
  const data=w.source.capture(),radius=w.bottle.holes[0].radius;
  for(let i=0;i<3;i++)w.source.restore(data);
  assert.equal(w.bottle.holes[0].radius,radius);assert.equal(w.bottle.holes[0].isExit,true);
});
test('checkpoint preserves pane cracks, holes and broken state while dropping transient shards',()=>{
  const w=world(),pane=w.source.breakage.pane('fixture-window',[0,1,-1],0,[1,1]);
  w.source.breakage.markPaneDamage(pane,new THREE.Vector3(.1,.2,0),'punched',.03);pane.damage=.2;
  const saved=w.checkpoint.capture(),savedPane=saved.state.fire.bottles.panes[0];
  assert.equal(savedPane.holes.length,1);assert.ok(savedPane.cracks.length>0);
  const invalid=structuredClone(saved);invalid.state.fire.bottles.panes[0].holes[0].radius=-1;
  assert.throws(()=>w.checkpoint.restore(invalid));assert.deepEqual(normalized(w.checkpoint.capture()),normalized(saved));
  w.source.breakage.breakPane(pane,new THREE.Vector3(0,1,-1),1e6,false);
  assert.equal(pane.broken,true);assert.ok(w.source.breakage.debris.length>0);
  w.checkpoint.restore(saved);
  assert.equal(pane.broken,false);assert.equal(pane.sheet.visible,true);assert.equal(pane.damage,.2);
  assert.equal(pane.holes.length,1);assert.equal(pane.holes[0].radius,.03);assert.equal(pane.cracks.length,savedPane.cracks.length);
  assert.equal(w.source.breakage.debris.length,0);assert.deepEqual(normalized(w.checkpoint.capture()),normalized(saved));
});
test('prepared pane checkpoint rejects changed topology and Float32-overflow geometry before mutation',()=>{
  const w=world(),pane=w.source.breakage.pane('pane-a',[0,1,-1],0,[1,1]);
  w.source.breakage.markPaneDamage(pane,new THREE.Vector3(.1,.2,0),'punched',.03);
  const plan=w.source.prepareRestore(w.source.capture());
  w.source.breakage.pane('pane-b',[2,1,-1],0,[1,1]);
  assert.throws(()=>plan.commit(),/Pane checkpoint topology changed/);
  assert.equal(w.source.breakage.panes.length,2);assert.equal(pane.holes.length,1);
  const replacementPlan=w.source.prepareRestore(w.source.capture()),oldPane=w.source.breakage.panes[1];
  w.source.breakage.panes.pop();const replacement=w.source.breakage.pane('pane-b',[2,1,-1],0,[1,1]);
  assert.notEqual(replacement,oldPane);assert.throws(()=>replacementPlan.commit(),/Pane checkpoint topology changed/);
  assert.equal(replacement.sheet.visible,true);
  const dimensionsPlan=w.source.prepareRestore(w.source.capture()),originalWidth=pane.w;
  pane.w=originalWidth+1;assert.throws(()=>dimensionsPlan.commit(),/Pane checkpoint topology changed/);pane.w=originalWidth;
  const saved=w.source.capture();saved.panes[0].holes[0].radius=1e308;
  assert.throws(()=>w.source.prepareRestore(saved),/Invalid saved pane hole/);
  saved.panes[0].holes[0].radius=.03;saved.panes[0].cracks[0].vertices[3]=1e308;
  assert.throws(()=>w.source.prepareRestore(saved),/Invalid saved pane crack/);
  assert.equal(pane.holes.length,1);assert.equal(pane.cracks.length>0,true);
});
test('source checkpoint captures streams and colour without exposing live absorbance arrays',()=>{
  const w=world();w.source.pour._stream(w.bottle,new THREE.Vector3(1,.2,0),new THREE.Vector3(0,-.2,0),80,.03,[.5,.7,.9]);
  const data=w.source.capture(),before=[...w.bottle.absorbance];data.streams[0].absorbance[0]=100;assert.deepEqual(w.bottle.absorbance,before);
  const saved=w.source.capture();w.source.restore(saved);assert.equal(w.source.pour.streams.size,1);
  assert.deepEqual(w.source.capture().streams,saved.streams);
});
test('quality changes and restoration retain logical flights while applying visual budgets immediately',()=>{
  const w=world();for(let i=0;i<1000;i++)w.source.pour.emit(1,new THREE.Vector3(0,1,0));w.source.pour.initialMl+=1000;
  const saved=w.source.capture();w.source.setQuality('minimal');w.source.restore(saved);
  assert.equal(w.source.pour.flights.length,1001);assert.ok(w.source.pour.flights.filter(f=>f.mesh.visible).length<=100);
  assert.ok(Math.abs(w.source.ledger().errorMl)<1e-5);
});
test('source checkpoint validates pane topology and rejects disposed runtime',()=>{
  const w=world();w.source.breakage.pane('window',[0,1,-1],0,[1,1]);const saved=w.source.capture();
  assert.throws(()=>w.source.prepareRestore({...saved,panes:[]}));
  w.source.dispose();assert.throws(()=>w.source.capture());assert.throws(()=>w.source.prepareRestore(saved));
});
test('failed checkpoint plan cleanup does not lock subsequent checkpoint operations',()=>{
  const c=createCheckpointSystem({sceneId:'test'}),a=scalar(1);c.register('a',{capture:a.capture,prepareRestore(data){return {...a.prepareRestore(data),dispose(){throw new Error('Cleanup failed');}};}});
  const saved=c.capture();saved.state.a.value=2;assert.equal(c.restore(saved).restored,true);assert.equal(c.capture().state.a.value,2);
});
test('prepared source plan refuses a later inventory reset before it mutates the new runtime',()=>{
  const w=world(),plan=w.source.prepareRestore(w.source.capture());w.source.reset();const before=w.source.ledger();
  assert.throws(()=>plan.commit());assert.deepEqual(w.source.ledger(),before);assert.equal(w.source.bottles.size,0);
});
test('declared asynchronous providers or commits are rejected before state changes',()=>{
  const c=createCheckpointSystem({sceneId:'test'});
  assert.throws(()=>c.register('async',{capture:async()=>({}),prepareRestore:()=>({commit(){}})}));
  let value=1;c.register('value',{capture:()=>({value}),prepareRestore(data){return {async commit(){value=data.value;}};}});
  const saved=c.capture();saved.state.value.value=2;assert.throws(()=>c.restore(saved));assert.equal(value,1);
});
test('liquid names matching object property names remain numeric components during mixing',()=>{
  const components={water:10};mixComponents(components,JSON.parse('{"constructor":5,"__proto__":2}'));
  assert.equal(components.constructor,5);assert.equal(components.__proto__,2);assert.equal(Object.getPrototypeOf(components),Object.prototype);
});
