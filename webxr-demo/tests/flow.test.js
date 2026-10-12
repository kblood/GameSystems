import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupplySystem} from '../../extensions/supply/index.js';
import {createFlowSystem} from '../../extensions/flow/index.js';
import {createHost} from '../../extensions/host/index.js';
import thermalExtension from '../../extensions/thermal/index.js';
import poolsExtension from '../../extensions/pools/index.js';
import supplyExtension from '../../extensions/supply/index.js';
import flowExtension from '../../extensions/flow/index.js';
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
test('committed flow still publishes both receipts before surfacing an apply failure',()=>{
  const failure=new Error('effect sink failed'),events=[],w=world({apply(){throw failure;},emit:(name,data)=>events.push([name,data])});
  assert.throws(()=>w.flow.pulse('hose',80),error=>error===failure);
  near(w.supply.state('tank').ml,1120);near(w.flow.state('hose').emittedMl,80);near(w.flow.state('hose').pulsedMl,80);
  assert.deepEqual(events.map(([name])=>name),['flow:deposit','liquid:deposit']);near(events[0][1].ml,80);near(events[1][1].ml,80);
});
test('a throwing first event emitter cannot suppress the authoritative liquid receipt',()=>{
  const failure=new Error('first event failed'),events=[],w=world({emit:(name,data)=>{events.push([name,data]);if(name==='flow:deposit')throw failure;}});
  assert.throws(()=>w.flow.pulse('hose',80),error=>error===failure);
  near(w.supply.state('tank').ml,1120);near(w.flow.state('hose').emittedMl,80);near(w.flow.state('hose').pulsedMl,80);
  assert.deepEqual(events.map(([name])=>name),['flow:deposit','liquid:deposit']);near(events[1][1].ml,80);
});
test('step finishes later emitters after one committed delivery callback fails, then rethrows',()=>{
  const failure=new Error('first emitter observer failed'),events=[];let thrown=false;
  const supply=createSupplySystem();supply.add('tank',{capacityMl:300,components:{water:300}});
  const flow=createFlowSystem({supply,emit:(name,data)=>{events.push([name,data]);if(!thrown&&name==='flow:deposit'){thrown=true;throw failure;}}});
  flow.add('a',{tankId:'tank',sourceKey:'hose-a',rateMlPerSecond:100,target});
  flow.add('b',{tankId:'tank',sourceKey:'hose-b',rateMlPerSecond:100,target});flow.start('a');flow.start('b');
  assert.throws(()=>flow.step(1),error=>error===failure);
  near(supply.state('tank').ml,100);near(flow.state('a').emittedMl,100);near(flow.state('b').emittedMl,100);
  near(flow.state('a').flowMlPerSecond,100);near(flow.state('b').flowMlPerSecond,100);
  assert.deepEqual(events.map(([name,data])=>[name,data.emitterId]),[
    ['flow:deposit','a'],['liquid:deposit','a'],['flow:deposit','b'],['liquid:deposit','b'],
  ]);
  supply.dispose();flow.dispose();
});
test('throwing supply change observers cannot orphan committed flow deliveries',()=>{
  const failure=new Error('supply observer failed'),events=[];let armed=false,thrown=false;
  const supply=createSupplySystem({emit:name=>{if(armed&&!thrown&&name==='supply:changed'){thrown=true;throw failure;}}});
  supply.add('tank',{capacityMl:300,components:{water:300}});armed=true;
  const flow=createFlowSystem({supply,emit:(name,data)=>events.push([name,data])});
  flow.add('a',{tankId:'tank',sourceKey:'hose-a',rateMlPerSecond:100,target});
  flow.add('b',{tankId:'tank',sourceKey:'hose-b',rateMlPerSecond:100,target});flow.start('a');flow.start('b');
  assert.throws(()=>flow.step(1),error=>error===failure);
  near(supply.state('tank').ml,100);near(supply.state('tank').drawnMl,200);
  near(flow.state('a').emittedMl,100);near(flow.state('b').emittedMl,100);
  assert.deepEqual(events.map(([name,data])=>[name,data.emitterId]),[
    ['flow:deposit','a'],['liquid:deposit','a'],['flow:deposit','b'],['liquid:deposit','b'],
  ]);
  supply.dispose();flow.dispose();
});
test('held-flow rate excludes a nested pulse committed before an observer throws',()=>{
  const failure=new Error('outer observer failed');let flow,nested=false;
  const supply=createSupplySystem();supply.add('tank',{capacityMl:300,components:{water:300}});
  flow=createFlowSystem({supply,emit:(name,data)=>{if(!nested&&name==='flow:deposit'&&data.emitterId==='a'){nested=true;flow.pulse('a',50);throw failure;}}});
  flow.add('a',{tankId:'tank',sourceKey:'hose-a',rateMlPerSecond:100,target});
  flow.add('b',{tankId:'tank',sourceKey:'hose-b',rateMlPerSecond:100,target});flow.start('a');flow.start('b');
  assert.throws(()=>flow.step(1),error=>error===failure);
  near(supply.state('tank').ml,50);near(flow.state('a').emittedMl,150);near(flow.state('a').pulsedMl,50);
  near(flow.state('a').flowMlPerSecond,100);near(flow.state('b').emittedMl,100);near(flow.state('b').flowMlPerSecond,100);
  supply.dispose();flow.dispose();
});
test('nested held-flow steps are rejected without duplicating the outer batch',()=>{
  let flow,attempted=false;const supply=createSupplySystem();supply.add('tank',{capacityMl:300,components:{water:300}});
  flow=createFlowSystem({supply,apply:()=>{if(!attempted){attempted=true;flow.step(.5);}}});
  flow.add('a',{tankId:'tank',sourceKey:'hose-a',rateMlPerSecond:100,target});
  flow.add('b',{tankId:'tank',sourceKey:'hose-b',rateMlPerSecond:100,target});flow.start('a');flow.start('b');
  assert.throws(()=>flow.step(1),/Flow step is not reentrant/);
  near(supply.state('tank').ml,100);near(flow.state('a').emittedMl,100);near(flow.state('b').emittedMl,100);
  near(flow.state('a').flowMlPerSecond,100);near(flow.state('b').flowMlPerSecond,100);
  flow.step(.5);near(supply.state('tank').ml,0);near(flow.state('a').flowMlPerSecond,100);near(flow.state('b').flowMlPerSecond,100);
  supply.dispose();flow.dispose();
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
test('host flow deposits one water dose into an active pool and pool ownership prevents double cooling',async()=>{
  const errors=[],host=createHost({onError:error=>errors.push(error.message)});
  const thermal=await host.load(thermalExtension),pools=await host.load(poolsExtension);pools.deposit({id:'fire',surfaceId:'floor',position:[0,0,0],ml:100,kind:'diesel',sourceKey:'can'});assert.equal(pools.ignite('fire'),true);
  const supply=await host.load(supplyExtension);supply.add('tank',{capacityMl:20,components:{water:20}});
  const flow=await host.load(flowExtension);flow.add('hose',{tankId:'tank',sourceKey:'hose'});
  let deposit;host.on('liquid:deposit',event=>{deposit=event;});
  flow.pulse('hose',20,{targetId:'pool:fire',thermalId:'pool:fire',surfaceId:'floor',position:[0,0,0]});
  const puddle=pools.state('fire');assert.equal(puddle.wetMl,20);assert.equal(puddle.components.water,20);assert.equal(puddle.sources.hose.water,20);assert.equal(puddle.burning,false);assert.equal(supply.state('tank').ml,0);assert.deepEqual(errors,[]);
  assert.equal(deposit.thermalId,'pool:fire');
  host.dispose();
});
test('invalid simple-source adapters cannot poison emitter history or publish liquid',()=>{
  for(const out of [{ml:NaN,components:{}},{ml:20,components:{water:20}},{ml:10,components:{water:9}}]){
    const events=[],flow=createFlowSystem({supply:{state:()=>({ml:100}),draw:()=>out},emit:(...args)=>events.push(args)});flow.add('hose',{tankId:'tank',target});const before=flow.capture();assert.throws(()=>flow.pulse('hose',10));assert.deepEqual(flow.capture(),before);assert.equal(events.length,0);
  }
});
