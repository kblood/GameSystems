import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCameraSystem } from '../../extensions/cameras/index.js';
function setup(quality = 'high') {
  const scene = new THREE.Scene(), calls = [];
  const renderer = { target: null, viewport: new THREE.Vector4(1, 2, 3, 4), scissor: new THREE.Vector4(5, 6, 7, 8), scissorTest: true, xr: { enabled: true }, autoClear: false,
    getViewport(v) { return v.copy(this.viewport); }, getScissor(v) { return v.copy(this.scissor); }, getRenderTarget() { return this.target; }, getScissorTest() { return this.scissorTest; },
    setRenderTarget(t) { this.target = t; }, setViewport(...v) { v.length === 1 ? this.viewport.copy(v[0]) : this.viewport.set(...v); }, setScissor(v) { this.scissor.copy(v); }, setScissorTest(v) { this.scissorTest = v; },
    render(s, c) { calls.push({ scene: s, camera: c, xr: this.xr.enabled, target: this.target, monitorVisible: mesh.visible }); } };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial()); scene.add(mesh);
  const api = createCameraSystem({ THREE, scene, renderer, quality });
  return { api, scene, renderer, mesh, calls };
}
test('camera feeds render only selected feeds and screens share a single texture', () => {
  const { api, mesh, scene, calls } = setup(); api.addFeed('a', { camera: new THREE.PerspectiveCamera() }); api.addFeed('b', { camera: new THREE.PerspectiveCamera() });
  api.addScreen('screen', { mesh, feedId: 'a' }); const second = mesh.clone(); scene.add(second); api.addScreen('other', { mesh: second, feedId: 'a' });
  assert.equal(api.step(.1), 1); assert.equal(calls.length, 1); assert.equal(api.feedState('b').frames, 0); assert.equal(mesh.material.map, second.material.map);
  api.switchFeed('screen', 'b'); api.step(.1); assert.equal(mesh.material.map, api.texture('b'));
});
test('feed rendering restores XR, viewport, scissor, target and monitor visibility even on failure', () => {
  const { api, mesh, renderer, calls } = setup(); api.addFeed('a', { camera: new THREE.PerspectiveCamera() }); api.addScreen('screen', { mesh, feedId: 'a' });
  const prior = new THREE.WebGLRenderTarget(12, 12); renderer.target = prior;
  api.step(.1); assert.equal(calls[0].xr, false); assert.equal(calls[0].monitorVisible, false);
  renderer.render = () => { throw new Error('GPU failure'); }; assert.throws(() => api.step(1));
  assert.equal(mesh.visible, true); assert.equal(renderer.target, prior); assert.equal(renderer.xr.enabled, true); assert.equal(renderer.autoClear, false);
  assert.deepEqual(renderer.viewport.toArray(), [1, 2, 3, 4]); assert.deepEqual(renderer.scissor.toArray(), [5, 6, 7, 8]); assert.equal(renderer.scissorTest, true);
});
test('minimal quality limits updates and fairly services every selected feed', () => {
  const { api, mesh, scene, calls } = setup('minimal');
  for (const id of ['a', 'b', 'c']) { api.addFeed(id, { camera: new THREE.PerspectiveCamera() }); const m = mesh.clone(); scene.add(m); api.addScreen(id, { mesh: m, feedId: id }); }
  for (let i = 0; i < 3; i++) assert.equal(api.step(.01), 1);
  for (const id of ['a', 'b', 'c']) assert.equal(api.feedState(id).frames, 1);
  assert.equal(api.step(.01), 0); assert.equal(calls.length, 3); assert.equal(api.feedState('a').width, 128);
  api.setQuality('high'); assert.equal(api.feedState('a').width, 1024); assert.equal(api.step(.01), 2);
});
test('hidden/off monitors and disabled feeds avoid rendering and show blank', () => {
  const { api, mesh } = setup(); api.addFeed('a', { camera: new THREE.PerspectiveCamera() }); api.addScreen('s', { mesh, feedId: 'a' });
  mesh.visible = false; assert.equal(api.step(1), 0); mesh.visible = true; api.setScreenEnabled('s', false); assert.equal(api.step(1), 0);
  api.setScreenEnabled('s', true); api.setFeedEnabled('a', false); assert.equal(api.step(1), 0); assert.equal(mesh.material.map, null);
  api.setFeedEnabled('a', true); assert.equal(api.step(.01), 1);
});
test('camera checkpoint validates topology atomically and restores display selection', () => {
  const { api, mesh } = setup(); api.addFeed('a', { camera: new THREE.PerspectiveCamera() }); api.addScreen('s', { mesh, feedId: 'a' });
  const saved = api.capture(); api.switchFeed('s', null); api.restore(saved); assert.deepEqual(api.capture(), saved);
  const bad = structuredClone(saved); bad.screens[0].feedId = 'missing'; assert.throws(() => api.restore(bad)); assert.deepEqual(api.capture(), saved);
});
test('removing camera detaches selected screen and dispose restores original material once', () => {
  const { api, mesh, calls } = setup(), original = mesh.material; let disposed = 0;
  api.addFeed('a', { camera: new THREE.PerspectiveCamera() });
  api.addScreen('s', { mesh, feedId: 'a' }); api.step(.1); calls[0].target.addEventListener('dispose', () => disposed++);
  api.removeFeed('a'); assert.equal(disposed, 1); assert.equal(api.screenState('s').feedId, null); assert.equal(mesh.material.map, null);
  api.dispose(); api.dispose(); assert.equal(mesh.material, original); assert.throws(() => api.step(0));
});
test('portrait feed remains within maximum texture dimensions and hidden parent skips updates', () => {
  const { api, scene, mesh } = setup(); api.addFeed('portrait', { camera: new THREE.PerspectiveCamera(50, .25) });
  api.addScreen('s', { mesh, feedId: 'portrait' }); assert.equal(api.feedState('portrait').height, 1024); assert.equal(api.feedState('portrait').width, 256);
  const parent = new THREE.Group(); scene.add(parent); parent.add(mesh); parent.visible = false; assert.equal(api.step(1), 0);
});
test('camera budget and invalid switches leave current selection intact', () => {
  const { api, mesh } = setup(); api.addFeed('a', { camera: new THREE.PerspectiveCamera() }); api.addScreen('s', { mesh, feedId: 'a' });
  assert.throws(() => api.addFeed('a', { camera: new THREE.PerspectiveCamera() })); assert.throws(() => api.addScreen('duplicate', { mesh }));
  assert.throws(() => api.switchFeed('s', 'missing')); assert.equal(api.screenState('s').feedId, 'a'); assert.throws(() => api.step(NaN));
});
