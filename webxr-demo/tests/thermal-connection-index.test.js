import test from 'node:test';
import assert from 'node:assert/strict';
import {createThermalSystem} from '../../extensions/thermal/index.js';
import {createPoolsSystem} from '../../extensions/pools/index.js';
test('connection index: updates and removals maintain each endpoint without duplicate edges',()=>{
  const t=createThermalSystem();for(const id of ['a','b','c'])t.add(id);t.connect('a','b');t.connect('b','a',2);t.connect('b','c');assert.equal(t.hasConnections('a'),true);assert.equal(t.hasConnections('c'),true);assert.equal(t.hasConnections('missing'),false);
  t.remove('a');assert.equal(t.hasConnections('a'),false);assert.equal(t.hasConnections('b'),true);t.remove('c');assert.equal(t.hasConnections('b'),false);assert.equal(t.capture().links.length,0);
});
test('connection index: nearby batches and restore rebuild the same derived index',()=>{
  const t=createThermalSystem();for(const id of ['a','b','c'])t.add(id);t.connectNearby(1);const saved=t.capture();t.remove('b');assert.equal(t.hasConnections('b'),false);t.restore(saved);assert.ok(['a','b','c'].every(id=>t.hasConnections(id)));assert.deepEqual(t.capture(),saved);
  t.dispose();assert.equal(t.hasConnections('a'),false);
});
test('connection index: scoped replacement preserves same-id links and prunes absent endpoints',()=>{
  const t=createThermalSystem();t.add('a');t.add('b');t.connect('a','b');t.replaceObjects(['a'],[{id:'a',fuelJ:0}]);assert.equal(t.hasConnections('a'),true);
  t.replaceObjects(['a'],[]);assert.equal(t.hasConnections('a'),false);assert.equal(t.hasConnections('b'),false);
});
test('connection index: failed atomic batches cannot add phantom protections',()=>{
  const t=createThermalSystem({maxLinks:1});for(const id of ['a','b','c'])t.add(id);t.connect('a','b');assert.throws(()=>t.connectNearby(1));assert.throws(()=>t.connect('a','c'));assert.equal(t.hasConnections('c'),false);assert.equal(t.hasConnections('a'),true);
});
test('connection index: cold pool eviction avoids captures and still protects linked pools',()=>{
  const t=createThermalSystem();t.add('solid',{fuelJ:0});const p=createPoolsSystem({thermal:t,maxPools:2});for(const [id,x]of [['a',0],['b',5],['c',10]])p.deposit({id,ml:20,kind:'water',position:[x,0,0]});t.connect('pool:a','solid');
  let captures=0;const original=t.capture;t.capture=()=>{captures++;return original();};for(let i=0;i<100;i++)assert.equal(p.activate(i%2?'b':'c'),true);
  assert.equal(captures,0);assert.equal(p.state('a').active,true);assert.equal(p.deactivate('a'),false);assert.equal(captures,0);
  t.hasConnections=undefined;assert.equal(p.deactivate('a'),false);assert.ok(captures>0);
});
