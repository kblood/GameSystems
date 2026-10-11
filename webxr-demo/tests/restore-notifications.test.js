import test from 'node:test';
import assert from 'node:assert/strict';
import {createThermalSystem} from '../../extensions/thermal/index.js';
import {createPoolsSystem} from '../../extensions/pools/index.js';
import {createCheckpointSystem} from '../../extensions/checkpoint/index.js';
test('restore notifications: same-id thermal replacements cannot re-enter the saved batch',()=>{
  let t,n=0;t=createThermalSystem({emit:(e,s)=>{if(e==='thermal:changed'){assert.ok(++n<=1);t.remove(s.id);t.add(s.id,{fuelJ:0});}}});t.add('a');t.restore(t.capture());assert.equal(n,1);assert.equal(t.state('a').fuelJ,0);
});
test('restore notifications: removed/replaced objects and newly added rooms are not ghost-notified',()=>{
  let t,events=[];t=createThermalSystem({emit:(e,s)=>{events.push(`${e}:${s.id}`);if(e==='thermal:changed'&&s.id==='a'){t.remove('b');t.add('b',{fuelJ:0});t.removeRoom('r');t.addRoom('r');}}});
  t.addRoom('r');t.add('a');t.add('b');t.restore(t.capture());assert.deepEqual(events,['thermal:changed:a']);
});
test('restore notifications: room replacement and disposal stop the original round',()=>{
  let t,n=0;t=createThermalSystem({emit:(e,s)=>{if(e==='thermal:room'){assert.ok(++n<=1);t.removeRoom(s.id);t.addRoom(s.id);}}});t.addRoom('r');t.restore(t.capture());assert.equal(n,1);
  let u,events=[];u=createThermalSystem({emit:e=>{events.push(e);u.dispose();}});u.add('a');u.add('b');u.addRoom('r');u.restore(u.capture());assert.deepEqual(events,['thermal:changed']);
});
test('restore notifications: nested restore, prepared commit, notify and step are rejected without corrupting the owner',()=>{
  let t,saved,plan;t=createThermalSystem({emit:e=>{if(e==='thermal:changed'){assert.throws(()=>t.restore(saved));assert.throws(()=>plan.commit());assert.throws(()=>plan.notify());assert.throws(()=>t.step(.05));}}});t.add('a');saved=t.capture();plan=t.prepareRestore(saved);t.restore(saved);assert.deepEqual(t.capture(),saved);t.step(.05);
});
test('restore notifications: a direct observer error releases the phase guard for later work',()=>{
  let fail=true;const t=createThermalSystem({emit:e=>{if(e==='thermal:changed'&&fail)throw new Error('observer');}});t.add('a');const saved=t.capture();assert.throws(()=>t.restore(saved),/observer/);fail=false;t.restore(saved);t.step(.05);assert.ok(t.stats().clock>0);
});
test('restore notifications: pool snapshots skip replaced records and reject recursive restore',()=>{
  const thermal=createThermalSystem();let p,enabled=false,mutating=false,visits=0,saved,plan;
  p=createPoolsSystem({thermal,emit:(e,s)=>{if(e!=='pools:changed'||!enabled||mutating)return;assert.ok(++visits<=1);assert.throws(()=>p.restore(saved));assert.throws(()=>plan.commit());assert.throws(()=>plan.notify());mutating=true;p.remove('b');p.deposit({id:'b',ml:10,kind:'water',position:[10,0,0]});mutating=false;}});
  p.deposit({id:'a',ml:10,kind:'water'});p.deposit({id:'b',ml:10,kind:'water',position:[10,0,0]});saved=p.save();plan=p.prepareRestore(saved);enabled=true;p.restore(saved);assert.equal(visits,1);assert.equal(p.all().length,2);
});
test('restore notifications: checkpoint reports observer failure after committing rather than rolling back valid state',()=>{
  let t,saved;t=createThermalSystem({emit:e=>{if(e==='thermal:changed')t.restore(saved);}});t.add('a');saved=t.capture();const cp=createCheckpointSystem({sceneId:'test'});cp.register('thermal',t);const snapshot=cp.capture();t.addHeat('a',100);
  const result=cp.restore(snapshot);assert.equal(result.restored,true);assert.equal(result.observerErrors.length,1);assert.deepEqual(t.capture(),saved);cp.dispose();
});
