import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupplySystem} from '../../extensions/supply/index.js';
import {createFlowSystem} from '../../extensions/flow/index.js';
import {createFireSceneProvider} from '../../extensions/checkpoint/fire-scene.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const target={targetId:'chair',roomId:'room',surfaceId:'floor',position:[1,0,0],impactPosition:[1,.5,0]};
function world({ml=1200,rate=240,...opts}={}){const supply=createSupplySystem(),events=[];supply.add('tank',{capacityMl:1200,components:{water:ml}});const flow=createFlowSystem({supply,emit:(name,data)=>events.push([name,data]),...opts});flow.add('hose',{tankId:'tank',sourceKey:'hose',rateMlPerSecond:rate,target});return {supply,flow,events};}
test('held flow is proportional to duration including sub-frame holds and finite exhaustion',()=>{
  const {flow,supply}=world();flow.start('hose');flow.step(.02);flow.stop('hose');near(supply.state('tank').ml,1195.2);flow.step(1);near(supply.state('tank').ml,1195.2);
  flow.start('hose');flow.step(10);near(supply.state('tank').ml,0);near(flow.state('hose').emittedMl,1200);flow.step(1);near(flow.state('hose').flowMlPerSecond,0);
});
test('two input owners share one nozzle rate and release independently',()=>{
  const {flow,supply}=world();flow.start('hose','left');flow.start('hose','right');flow.step(1);near(supply.state('tank').ml,960);flow.stop('hose','left');flow.step(1);near(supply.state('tank').ml,720);flow.stop('hose','right');flow.step(1);near(supply.state('tank').ml,720);
});
test('pulse supports paused application edits and retains exact mixture without inventing water',()=>{
  const {flow,supply,events}=world({ml:0});supply.fill('tank',80,{components:{water:20,diesel:60}});const out=flow.pulse('hose',100);near(out.ml,80);assert.deepEqual(out.components,{water:20,diesel:60});near(flow.state('hose').pulsedMl,80);
  const receipt=events.find(([name])=>name==='liquid:deposit')[1];assert.equal(receipt.emitterId,'hose');assert.equal('id'in receipt,false);assert.equal(receipt.sourceKey,'hose');
});
test('invalid or absent aiming target cannot draw from tank',()=>{
  const w=world({resolveTarget:()=>null});w.flow.start('hose');w.flow.step(1);near(w.supply.state('tank').ml,1200);
  assert.throws(()=>w.flow.pulse('hose',10,{...target,position:[NaN,0,0]}));near(w.supply.state('tank').ml,1200);
});
test('frame partition and quality do not change total emitted volume',()=>{
  const a=world(),b=world();a.flow.start('hose');b.flow.start('hose');b.flow.setQuality('minimal');a.flow.step(1);for(let i=0;i<100;i++)b.flow.step(.01);near(a.flow.state('hose').emittedMl,b.flow.state('hose').emittedMl);
});
test('each delivery observer receives a detached payload and cannot change saved targeting',()=>{
  let received;const w=world({apply:r=>{r.position[0]=999;r.components.water=0;},emit:(name,r)=>{if(name==='flow:deposit')r.ml=999;if(name==='liquid:deposit')received=r;}});w.flow.pulse('hose',80);near(received.ml,80);near(received.components.water,80);near(w.flow.state('hose').target.position[0],1);
});
test('checkpoint restores liquid history while neutralizing transient held controls',()=>{
  const w=world();w.flow.start('hose');w.flow.step(.1);const saved=w.flow.capture();w.flow.step(.1);w.flow.restore(saved);assert.deepEqual(w.flow.capture(),saved);assert.equal(w.flow.state('hose').active,false);near(w.flow.state('hose').flowMlPerSecond,0);
});
test('source-aware checkpoint validates staged future source without changing live owners',()=>{
  const w=world();w.flow.pulse('hose',80);const source=w.supply.capture(),saved=w.flow.capture();w.flow.pulse('hose',80);
  const s=w.supply.prepareRestore(source),f=w.flow.prepareRestore(saved,{supplyPlan:s});s.commit();f.commit();near(w.supply.state('tank').ml,1120);near(w.flow.state('hose').emittedMl,80);
  const bad=structuredClone(saved);bad.emitters[0].emittedMl=200;const before=w.flow.capture();assert.throws(()=>w.flow.prepareRestore(bad,{supplyPlan:w.supply.prepareRestore(source)}));assert.deepEqual(w.flow.capture(),before);
});
test('invalid time and dispose cannot leave ongoing work or consume volume',()=>{
  const w=world();w.flow.start('hose');assert.throws(()=>w.flow.step(11));near(w.supply.state('tank').ml,1200);w.flow.stopAll();assert.equal(w.flow.state('hose').active,false);w.flow.dispose();assert.throws(()=>w.flow.pulse('hose',10));
});
test('stop from delivery callback leaves no displayed or continuing held flow',()=>{
  let w;w=world({apply:()=>w.flow.stopAll()});w.flow.start('hose');w.flow.step(.1);assert.equal(w.flow.state('hose').active,false);near(w.flow.state('hose').flowMlPerSecond,0);const remaining=w.supply.state('tank').ml;w.flow.step(1);near(w.supply.state('tank').ml,remaining);
});
test('complete finite mixture withdrawal cannot overflow component arithmetic',()=>{
  const supply=createSupplySystem();supply.add('large',{capacityMl:1e155,components:{water:5e154,diesel:5e154}});const out=supply.draw('large',1e155);assert.equal(out.components.water,5e154);assert.equal(out.components.diesel,5e154);assert.equal(supply.state('large').ml,0);
});
test('scene composition rejects ambiguous flow and bottle provenance before recording',()=>{
  const w=world();assert.throws(()=>createFireSceneProvider({supply:w.supply,flow:w.flow,bottles:{sourceKey:'hose'}}),/share a liquid source key/);
});
test('invalid simple-source adapters cannot poison emitter history or publish liquid',()=>{
  for(const out of [{ml:NaN,components:{}},{ml:20,components:{water:20}},{ml:10,components:{water:9}}]){
    const events=[],flow=createFlowSystem({supply:{state:()=>({ml:100}),draw:()=>out},emit:(...args)=>events.push(args)});flow.add('hose',{tankId:'tank',target});const before=flow.capture();assert.throws(()=>flow.pulse('hose',10));assert.deepEqual(flow.capture(),before);assert.equal(events.length,0);
  }
});
