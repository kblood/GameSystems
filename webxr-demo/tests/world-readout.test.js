import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createWorldReadout} from '../src/world-readout.js';
function fixture(options={}){const drawn=[],context={fillRect(){},measureText:s=>({width:s.length*20}),fillText:s=>drawn.push(s)},canvas={getContext:()=>context},parent=new THREE.Group();return {drawn,parent,readout:createWorldReadout({THREE,parent,canvas,...options})};}
test('world readout: hidden state avoids uploads; changed text is coalesced at 5Hz',()=>{
  const {readout:r}=fixture();assert.equal(r.update('hidden',{now:0}),false);r.setVisible(true);assert.equal(r.update('one',{now:0}),true);
  assert.equal(r.update('two',{now:100}),false);assert.equal(r.update('three',{now:200}),true);assert.equal(r.stats().text,'three');
  assert.equal(r.update('three',{now:1000}),false);assert.equal(r.stats().updates,2);r.dispose();
});
test('world readout: re-entry draws current status immediately using the same owned texture',()=>{
  const {readout:r}=fixture(),texture=r.mesh.material.map;r.setVisible(true);r.update('old',{now:0});r.setVisible(false);r.update('paused',{now:1});r.setVisible(true);
  assert.equal(r.update('new',{now:2}),true);assert.equal(r.mesh.material.map,texture);assert.equal(r.stats().text,'new');r.dispose();
});
test('world readout: paragraphs wrap and overflow is bounded by canvas height',()=>{
  const {readout:r,drawn}=fixture({width:128,height:128});r.setVisible(true);r.update('one two three\nfour five six\nseven',{now:0});
  assert.ok(drawn.length<=2);assert.equal(drawn.at(-1),'…');r.dispose();
});
test('world readout: disposal removes and releases each owned resource exactly once',()=>{
  const {readout:r,parent}=fixture();let releases=0;for(const resource of [r.mesh.geometry,r.mesh.material,r.mesh.material.map])resource.addEventListener('dispose',()=>releases++);
  r.dispose();r.dispose();assert.equal(parent.children.length,0);assert.equal(releases,3);assert.equal(r.update('late',{now:0}),false);r.setVisible(true);assert.equal(r.stats().visible,false);
});
test('world readout: dimensions, timing and transient visibility are validated',()=>{
  assert.throws(()=>fixture({intervalMs:NaN}));assert.throws(()=>fixture({worldWidth:0}));assert.throws(()=>fixture({width:0}));
  const {readout:r}=fixture();assert.throws(()=>r.setVisible('yes'));r.setVisible(true);assert.throws(()=>r.update('x',{now:NaN}));r.dispose();
});
