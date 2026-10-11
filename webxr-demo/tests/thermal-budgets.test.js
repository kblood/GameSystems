import test from 'node:test';
import assert from 'node:assert/strict';
import {createThermalSystem} from '../../extensions/thermal/index.js';
test('thermal budgets: all count limits are integers; optional graph budgets may be zero',()=>{
  for(const key of ['maxObjects','maxRooms','maxNeighbours','maxVents','maxLinks'])for(const value of [1.5,-1,NaN,Infinity])assert.throws(()=>createThermalSystem({[key]:value}));
  const t=createThermalSystem({maxLinks:0,maxVents:0});t.addRoom('r');t.add('a');t.add('b');assert.throws(()=>t.connect('a','b'));assert.throws(()=>t.addVent('v',{a:'r'}));t.restore(t.capture());
});
test('thermal budgets: vent creation and restore share the same limit without partial changes',()=>{
  const t=createThermalSystem({maxVents:1});t.addRoom('r');t.addVent('a',{a:'r'});const before=t.capture();assert.throws(()=>t.addVent('b',{a:'r'}));assert.deepEqual(t.capture(),before);
  t.setVent('a',.5);const saved=t.capture();t.restore(saved);assert.deepEqual(t.capture(),saved);assert.equal(t.stats().vents,1);
  const lower=createThermalSystem({maxVents:0});const baseline=lower.capture();assert.throws(()=>lower.restore(saved));assert.deepEqual(lower.capture(),baseline);
});
test('thermal budgets: connection updates work at capacity while new connections are rejected atomically',()=>{
  const t=createThermalSystem({maxLinks:1});for(const id of ['a','b','c'])t.add(id);t.connect('a','b',1);t.connect('b','a',2);assert.equal(t.capture().links.length,1);assert.equal(t.capture().links[0].conductance,2);
  const before=t.capture();assert.throws(()=>t.connect('a','c'));assert.deepEqual(t.capture(),before);t.restore(before);assert.deepEqual(t.capture(),before);
  const lower=createThermalSystem({maxLinks:0});assert.throws(()=>lower.prepareRestore(before));
});
test('thermal budgets: connectNearby validates the whole batch before altering existing links',()=>{
  const t=createThermalSystem({maxLinks:2});for(const id of ['a','b','c'])t.add(id);t.connect('a','b',7);const before=t.capture();assert.throws(()=>t.connectNearby(1,2));assert.deepEqual(t.capture(),before);
  t.remove('c');t.connectNearby(1,3);assert.equal(t.capture().links[0].conductance,3);t.prepareRestore(t.capture());
});
test('thermal budgets: encoded endpoint pairs do not collide for ids containing separators',()=>{
  const t=createThermalSystem({maxLinks:2});for(const id of ['a\0b','c','a','b\0c'])t.add(id);t.connect('a\0b','c',1);t.connect('a','b\0c',2);assert.equal(t.stats().connections,2);
  const saved=t.capture();t.restore(saved);assert.deepEqual(t.capture(),saved);t.connect('c','a\0b',3);assert.equal(t.stats().connections,2);
});
test('thermal budgets: invalid vent ids cannot enter snapshots',()=>{
  const t=createThermalSystem();t.addRoom('r');const before=t.capture();for(const id of ['',0,null])assert.throws(()=>t.addVent(id,{a:'r'}));assert.deepEqual(t.capture(),before);
});
