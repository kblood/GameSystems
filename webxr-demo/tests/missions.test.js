import test from 'node:test';
import assert from 'node:assert/strict';
import {createMissionSystem} from '../../extensions/missions/index.js';
test('missions: interrupted clearance resets the hold; success occurs at the exact hold boundary',()=>{
  let clear=true;const m=createMissionSystem({evaluate:()=>({clear})});m.start({timeLimit:10});m.step(2);clear=false;m.step(1);assert.equal(m.state().clearElapsed,0);clear=true;m.step(5);assert.equal(m.state().status,'succeeded');assert.equal(m.state().elapsed,6);assert.equal(m.state().clearElapsed,3);m.step(5);assert.equal(m.state().elapsed,6);
});
test('missions: timeout, condition failure and exact success/timeout tie are deterministic',()=>{
  const timeout=createMissionSystem({evaluate:()=>({clear:false})});timeout.start({timeLimit:1});timeout.step(10);assert.equal(timeout.state().failureKind,'timeout');assert.equal(timeout.state().elapsed,1);
  const fail=createMissionSystem({evaluate:()=>({clear:false,failed:true,reason:'east fire'})});fail.start();fail.step(.1);assert.equal(fail.state().reason,'east fire');
  const tie=createMissionSystem({evaluate:()=>({clear:true})});tie.start({timeLimit:3});tie.step(10);assert.equal(tie.state().status,'succeeded');assert.equal(tie.state().elapsed,3);
});
test('missions: frame rate, quality and checkpoint continuation preserve the same outcome',()=>{
  function run(dt,quality){const m=createMissionSystem({evaluate:()=>({clear:true}),quality});m.start({data:{scenario:'fire'}});for(let i=0;i<Math.round(4/dt);i++)m.step(dt);return m.capture();}
  assert.deepEqual(run(1/30,'minimal'),run(1/120,'high'));
  const m=createMissionSystem({evaluate:()=>({clear:true})});m.start();m.step(1);const saved=m.capture();m.step(3);const expected=m.capture();m.restore(saved);m.step(3);assert.deepEqual(m.capture(),expected);
});
test('missions: input and corrupt state validation are atomic; views cannot mutate the run',()=>{
  let valid=true;const m=createMissionSystem({evaluate:()=>({clear:valid?false:undefined})});m.start({data:{name:'fire'}});const before=m.capture();valid=false;assert.throws(()=>m.step(1));assert.deepEqual(m.capture(),before);assert.throws(()=>m.step(11));assert.deepEqual(m.capture(),before);
  const bad=structuredClone(before);bad.run.status='succeeded';assert.throws(()=>m.restore(bad));assert.deepEqual(m.capture(),before);
  const impossible=structuredClone(before);impossible.run.clearElapsed=1;assert.throws(()=>m.restore(impossible));assert.deepEqual(m.capture(),before);
  m.state().data.name='other';assert.equal(m.state().data.name,'fire');const plan=m.prepareRestore(before);plan.state().data.name='changed';plan.commit();assert.deepEqual(m.capture(),before);
});
test('missions: callbacks may reset runs without stale completion, and recursive operations are rejected',()=>{
  let m,completed=0;m=createMissionSystem({evaluate:()=>{m.reset();return {clear:true};},emit:e=>{if(e==='missions:completed')completed++;}});m.start();m.step(5);assert.equal(m.state().status,'idle');assert.equal(completed,0);
  let u;u=createMissionSystem({evaluate:()=>{assert.throws(()=>u.step(.1));assert.throws(()=>u.restore(u.capture()));return {clear:false};}});u.start();u.step(.1);assert.equal(u.state().elapsed,.1);u.dispose();assert.throws(()=>u.step(.1));
});
test('missions: started observers cannot recursively start, and the guard releases after errors',()=>{
  let m,started=0,nestedError=null,mode='recurse';
  m=createMissionSystem({evaluate:()=>({clear:false}),emit:event=>{if(event==='missions:started'){started++;if(mode==='recurse'){try{m.start();}catch(error){nestedError=error;}}else if(mode==='throw')throw new Error('observer failed');}}});
  m.start({data:{run:1}});assert.equal(started,1);assert.match(nestedError.message,/start is reentrant/);assert.deepEqual(m.state().data,{run:1});
  mode='throw';assert.throws(()=>m.start({data:{run:2}}),/observer failed/);assert.equal(started,2);
  mode='ok';m.start({data:{run:3}});assert.equal(started,3);assert.deepEqual(m.state().data,{run:3});
});
