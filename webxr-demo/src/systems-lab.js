import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { createHost } from './vendor/extensions/host/index.js';
import mechanics from './vendor/extensions/mechanics/index.js';
import electricity from './vendor/extensions/electricity/index.js';
import materials from './vendor/extensions/materials/index.js';
import thermal from './vendor/extensions/thermal/index.js';
import tools from './vendor/extensions/tools/index.js';
import acoustics from './vendor/extensions/acoustics/index.js';
import workshop from './vendor/extensions/workshop/index.js';
import {bindPageLifecycle} from './page-lifecycle.js';

const $ = id => document.getElementById(id), message = text => { $('message').textContent = text; };
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x17252b);
const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.02, 50);
camera.position.set(0, 2.8, 5.2);
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);
const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.xr.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace; document.body.prepend(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 1, 0); controls.enablePan = false; controls.update();
scene.add(new THREE.HemisphereLight(0xddeee1, 0x384448, 2.2));
const sun = new THREE.DirectionalLight(0xffdfa9, 3); sun.position.set(2, 5, 4); scene.add(sun);
const content = new THREE.Group(); scene.add(content);
let host, station, nodes, active = null, shorted = false, resetToken = 0, audio = null, audioListener, lastHammer = null, lastToolQuaternion = null;
const interactables = [], xrButtons = [], xrControllers = [];
const raycaster = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), pointer = new THREE.Vector2();
const point = new THREE.Vector3(), rotation = new THREE.Matrix4();

function box(size, pos, color, parent = content) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color, roughness: 0.65 }));
  mesh.position.set(...pos); parent.add(mesh); return mesh;
}
function cylinder(radius, height, pos, color, parent = content) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 24), new THREE.MeshStandardMaterial({ color, metalness: 0.25, roughness: 0.5 })); mesh.position.set(...pos); parent.add(mesh); return mesh;
}
function label(text, position, width = 0.7, parent = content) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#142420'; ctx.fillRect(0, 0, 512, 128); ctx.fillStyle = '#ebd5a8'; ctx.textAlign = 'center'; ctx.font = 'bold 34px system-ui'; ctx.fillText(text, 256, 78);
  const texture = new THREE.CanvasTexture(canvas), mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
  mesh.position.set(...position); parent.add(mesh); return mesh;
}
function build() {
  nodes = {}; interactables.length = 0;
  box([7, 0.1, 5], [0, -0.05, 0], 0x435451);
  box([4.2, 0.12, 1], [-0.3, 0.85, -0.25], 0x65756e);
  for (const x of [-2, 1.5]) box([0.12, 0.85, 0.8], [x, 0.425, -0.25], 0x3a4947);
  box([0.8, 0.9, 0.3], [-0.7, 1.5, -0.22], 0x324849);
  nodes.socket = box([0.14, 0.24, 0.04], [-0.7, 1.3, 0], 0xf0c266);
  nodes.drawer = box([0.75, 0.22, 0.5], [-1.6, 0.65, -0.15], 0x86623e); nodes.drawer.userData.mechanism = 'drawer'; interactables.push(nodes.drawer);
  nodes.fuse = box([0.055, 0.16, 0.055], [-1.6, 0.79, -0.15], 0xe8dcb5); nodes.fuse.userData.part = 'fuse'; interactables.push(nodes.fuse);
  nodes.switch = new THREE.Group(); nodes.switch.position.set(-0.7, 1.72, 0); content.add(nodes.switch); nodes.switch.userData.mechanism = 'switch'; interactables.push(nodes.switch);
  cylinder(0.13, 0.05, [0, 0, 0], 0xeaad54, nodes.switch).rotation.x = Math.PI / 2;
  box([0.025, 0.18, 0.02], [0, 0, 0.035], 0x253733, nodes.switch);
  nodes.valve = new THREE.Group(); nodes.valve.position.set(-0.15, 1.1, 0); content.add(nodes.valve); nodes.valve.userData.mechanism = 'valve'; interactables.push(nodes.valve);
  cylinder(0.14, 0.05, [0, 0, 0], 0x5c9aab, nodes.valve).rotation.x = Math.PI / 2;
  box([0.25, 0.02, 0.02], [0, 0, 0.035], 0xc4e3e2, nodes.valve);
  nodes.lamp = cylinder(0.1, 0.12, [-0.7, 2.03, 0], 0x77827d); nodes.light = new THREE.PointLight(0xffd87b, 0, 3); nodes.light.position.set(-0.7, 2.03, 0.2); content.add(nodes.light);
  nodes.doorPivot = new THREE.Group(); nodes.doorPivot.position.set(1.85, 0, -0.25); content.add(nodes.doorPivot);
  nodes.door = box([0.8, 2, 0.09], [0.4, 1, 0], 0x547467, nodes.doorPivot); nodes.door.userData.mechanism = 'door'; interactables.push(nodes.door);
  nodes.rag = box([0.24, 0.06, 0.25], [1.2, 0.97, 0], 0xae9672);
  nodes.wood = box([0.22, 0.1, 0.25], [1.5, 0.99, 0], 0x976748);
  nodes.wet = box([0.9, 0.003, 0.4], [0.9, 0.914, 0], 0x526c80); nodes.wet.material.transparent = true; nodes.wet.material.opacity = 0;
  nodes.flames = new THREE.Group(); nodes.flames.position.set(1.2, 1.03, 0); content.add(nodes.flames);
  for (let i = 0; i < 12; i++) { const flame = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.22, 6), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xf9b449 : 0xec6227 })); flame.position.set(Math.sin(i * 2.4) * 0.07, 0.08, Math.cos(i * 2.4) * 0.07); nodes.flames.add(flame); }
  nodes.screw = cylinder(0.025, 0.06, [0.4, 1, 0], 0xbbc9c7);
  nodes.nail = cylinder(0.018, 0.12, [0.7, 1.04, 0], 0xbbc9c7);
  nodes.tool = new THREE.Group(); content.add(nodes.tool); nodes.tool.visible = false;
  nodes.toolHandle = box([0.05, 0.16, 0.05], [0, 0.16, 0], 0xb67338, nodes.tool);
  nodes.toolShaft = cylinder(0.008, 0.13, [0, 0.05, 0], 0xbfcac8, nodes.tool);
  nodes.hammerHead = box([0.16, 0.05, 0.07], [0, 0, 0], 0x71847f, nodes.tool); nodes.hammerHead.visible = false;
  label('SIKRING', [-0.7, 1.06, 0.07], 0.55); label('SKRUE', [0.4, 0.75, 0.3], 0.45); label('SØM', [0.7, 0.75, 0.3], 0.35);
  label('VARME / VAND', [1.3, 0.75, 0.3], 0.85); label('KORRIDOR', [2.3, 2.2, -0.15], 0.8);
  nodes.guard = cylinder(0.08, 0.25, [2.9, 1.1, -0.4], 0x5e8597); label('LYTTER', [2.9, 1.5, -0.35], 0.6);
}
function renderState(s) {
  if (!nodes) return;
  nodes.drawer.position.z = -0.15 + s.drawer * 0.5;
  if (!active || active.kind !== 'fuse') { nodes.fuse.visible = !s.fuseInstalled; nodes.fuse.position.set(-1.6, 0.79, -0.15 + s.drawer * 0.5); }
  nodes.switch.rotation.z = station?.mechanics.state('switch').value ?? 0;
  nodes.valve.rotation.z = station?.mechanics.state('valve').value ?? 0;
  nodes.doorPivot.rotation.y = s.door * Math.PI / 2;
  nodes.lamp.material.emissive.setHex(s.powered ? 0xffba37 : 0); nodes.light.intensity = s.powered ? 3 : 0;
  nodes.socket.material.color.setHex(s.fuseBlown ? 0xbc5140 : s.fuseInstalled ? 0x6fac78 : 0xf0c266);
  nodes.wet.material.opacity = s.surface.wetness * 0.65;
  nodes.wet.material.color.setHex(s.surface.stain > 0.1 ? 0x94374b : 0x568ca6);
  nodes.rag.material.color.setHex(s.fire.burning ? 0x573a26 : s.fire.wetMl > 0 ? 0x5b7269 : 0xae9672);
  nodes.wood.material.emissive.setHex(s.wood.burning ? 0xb74215 : 0);
  nodes.flames.visible = s.fire.burning; nodes.screw.position.y = 1 - s.screw * 0.045; nodes.nail.position.y = 1.04 - s.nail * 0.09;
  $('door').disabled = s.locked; $('take-fuse').disabled = s.drawer < 0.5 || s.fuseInstalled;
  $('readout').textContent = `Strøm: ${s.powered ? 'TIL' : 'FRA'} · Dør: ${s.locked ? 'låst' : 'fri'}\nSikring: ${s.fuseBlown ? 'SPRUNGET' : s.fuseInstalled ? 'indsat' : 'mangler'}\nVådhed: ${Math.round(s.surface.wetness * 100)}% · Friktion: ${s.surface.friction.toFixed(2)}\nKlud: ${s.fire.temperature.toFixed(0)} °C · ${s.fire.burning ? 'BRÆNDER' : 'rolig'}\nTræ: ${s.wood.temperature.toFixed(0)} °C\nSkrue: ${Math.round(s.screw * 100)}% · Søm: ${Math.round(s.nail * 100)}%\nLytter: ${s.lastHeard ? `${s.lastHeard.db.toFixed(0)} dB · ${s.lastHeard.kind}` : 'ingen lyd'}`;
}
function audioReady() {
  if (!audio) { audio = new (window.AudioContext || window.webkitAudioContext)(); audioListener = audio.listener; }
  if (audio.state === 'suspended') audio.resume();
}
function playHeard(e) {
  if (!audio || audio.state !== 'running') return;
  const oscillator = audio.createOscillator(), gain = audio.createGain(), panner = audio.createPanner();
  oscillator.type = 'triangle'; oscillator.frequency.value = e.kind === 'tools:impact' ? 160 : 260;
  panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'; panner.positionX.value = e.position[0]; panner.positionY.value = e.position[1]; panner.positionZ.value = e.position[2];
  gain.gain.setValueAtTime(Math.min(0.2, e.gain * 0.25), audio.currentTime); gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.2);
  oscillator.connect(gain); gain.connect(panner); panner.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + 0.22);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); panner.disconnect(); };
}
function disposeMeshes(group) { group.traverse(o => { o.geometry?.dispose(); for (const mat of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) { mat.map?.dispose(); mat.dispose(); } }); group.clear(); }
async function reset() {
  const token = ++resetToken; release(true); host?.dispose(); station = null; disposeMeshes(content); shorted = false; $('short').textContent = 'Kortslut';
  for (const id of ['drawer', 'switch', 'door', 'valve']) $(id).value = 0;
  build(); host = createHost({ THREE, scene, renderer, camera, quality: +$('quality').value, onError(e, id, phase) { console.error(id, phase, e); message(`Fejl: ${id}: ${e.message}`); } });
  for (const system of [mechanics, electricity, materials, thermal, tools, acoustics]) { if (token !== resetToken) return; await host.load(system); }
  station = await host.load(workshop, { onState: renderState });
  if (!station || token !== resetToken) return;
  host.on('acoustics:heard', e => { nodes.guard.material.emissive.setHex(0x356b37); playHeard(e); });
  renderState(station.state()); window.__systems = { host, station, scene, camera, renderer, nodes, project, reset, selectTool };
  message('Åbn skuffen for at finde sikringen.');
}
function project(position) { const p = new THREE.Vector3(...position).project(camera); return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 }; }
function takeFuse(owner = 'desktop') {
  if (!station.takeFuse(owner)) { message('Åbn skuffen først.'); return false; }
  active = { kind: 'fuse', owner }; controls.enabled = false; nodes.fuse.quaternion.identity(); nodes.fuse.visible = true; message('Flyt sikringen til den gule holder.'); return true;
}
function selectTool(kind, owner = 'desktop') {
  release(); active = { kind, owner }; nodes.tool.visible = true; nodes.tool.position.set(kind === 'hammer' ? 0.7 : 0.4, 1.4, 0);
  nodes.hammerHead.visible = kind === 'hammer'; nodes.toolShaft.visible = kind !== 'hammer'; controls.enabled = false;
  lastHammer = null; lastToolQuaternion = null; nodes.tool.quaternion.identity(); message(kind === 'hammer' ? 'Flyt hammeren ned mod sømmet.' : 'Flyt spidsen til skruen og rul for at dreje.');
}
function release(cancel = false) {
  if (station && active) {
    if (active.kind === 'fuse') {
      const axis = new THREE.Vector3(0, 0, -1).applyQuaternion(nodes.fuse.quaternion).toArray();
      const inserted = cancel !== true && station.insertFuse(nodes.fuse.position.toArray(), axis, active.owner);
      if (!inserted) station.tools.release('spareFuse', active.owner);
      message(inserted ? 'Sikring indsat. Drej kontakten.' : 'Sikringen blev lagt tilbage i skuffen.');
    } else if (active.mechanism) station.mechanics.release(active.mechanism, active.owner);
  }
  active = null; lastHammer = null; controls.enabled = !renderer.xr.isPresenting; if (nodes?.tool) nodes.tool.visible = false;
  if (station && nodes) renderState(station.state());
}
function handPoint(worldPoint, dt = 1 / 60) {
  if (!active || !station) return;
  if (active.kind === 'fuse') nodes.fuse.position.copy(worldPoint);
  else if (active.mechanism) {
    const id = active.mechanism;
    station.mechanics.moveHand(id, active.owner, worldPoint.toArray());
  } else {
    nodes.tool.position.copy(worldPoint);
    if (active.kind === 'hammer') {
      const now = performance.now(), p = worldPoint.toArray();
      if (lastHammer && lastHammer.position[1] > 1.01 && p[1] <= 1.01) {
        const seconds = Math.max(0.005, (now - lastHammer.time) / 1000), speed = Math.max(0, (lastHammer.position[1] - p[1]) / seconds);
        const axis = new THREE.Vector3(0, -1, 0).applyQuaternion(nodes.tool.quaternion).toArray();
        const hit = station.tools.use('nail', { tool: 'hammer', position: [p[0], 1, p[2]], axis, energyJ: Math.min(10, 0.5 * 0.4 * speed * speed) });
        if (hit.accepted) message('Hammeren ramte sømmet.');
      }
      lastHammer = { position: p, time: now };
    }
  }
}
function turnTool(turns) {
  if (active?.kind !== 'screwdriver') return;
  const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(nodes.tool.quaternion).toArray();
  const result = station.tools.use('screw', { tool: 'screwdriver', position: nodes.tool.position.toArray(), axis, rotation: turns * 2 * Math.PI });
  if (result.accepted) { nodes.tool.rotation.y += turns * Math.PI * 2; renderState(station.state()); message('Skruen drejer.'); } else message('Placér spidsen ved skruen.');
}
function pointerRay(e) { pointer.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); raycaster.setFromCamera(pointer, camera); }
renderer.domElement.addEventListener('pointerdown', e => {
  audioReady(); if (!station) return; pointerRay(e);
  if (active) { if (raycaster.ray.intersectPlane(plane, point)) handPoint(point); renderer.domElement.setPointerCapture(e.pointerId); return; }
  const hit = raycaster.intersectObjects(interactables, true)[0]; if (!hit) return;
  let object = hit.object; while (!object.userData.part && !object.userData.mechanism && object.parent) object = object.parent;
  if (object.userData.part) takeFuse();
  else if (object.userData.mechanism) {
    const id = object.userData.mechanism; if (station.mechanics.state(id).locked) { message('Døren mangler strøm.'); return; }
    const horizontal = id === 'drawer' || id === 'door';
    active = { mechanism: id, owner: 'desktop', plane: new THREE.Plane(new THREE.Vector3(0, horizontal ? 1 : 0, horizontal ? 0 : 1), -(horizontal ? hit.point.y : hit.point.z)) }; controls.enabled = false;
    station.mechanics.grab(id, 'desktop', hit.point.toArray());
  }
  if (active) renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', e => { if (!active || renderer.xr.isPresenting) return; pointerRay(e); if (raycaster.ray.intersectPlane(active.plane ?? plane, point)) {
  handPoint(point);
} });
renderer.domElement.addEventListener('pointerup', () => { if (active?.kind === 'fuse' || active?.mechanism) release(); });
renderer.domElement.addEventListener('pointercancel', () => release(true));
renderer.domElement.addEventListener('wheel', e => { if (active?.kind === 'screwdriver') { e.preventDefault(); turnTool(-Math.sign(e.deltaY) * 0.125); } }, { passive: false });

for (const id of ['drawer', 'switch', 'door', 'valve']) $(id).addEventListener('input', () => { const max = id === 'drawer' ? 0.5 : Math.PI / 2; station?.mechanics.setValue(id, +$(id).value * max); });
const actions = {
  'take-fuse': (owner = 'desktop') => takeFuse(owner), 'remove-fuse': () => { release(); if (station.removeFuse()) { active = { kind: 'fuse', owner: 'desktop' }; nodes.fuse.visible = true; nodes.fuse.position.set(-0.7, 1.3, 0); controls.enabled = false; } },
  short: () => { shorted = !shorted; station.fault(shorted); $('short').textContent = shorted ? 'Fjern kortslutning' : 'Kortslut'; },
  repair: () => { station.repairFuse(); message(shorted ? 'Fjern kortslutningen før en ny sikring.' : 'Sikring skiftet.'); },
  water: () => { const ml = 100 * station.state().valve; if (ml > 0) { station.liquid(ml); message(`${Math.round(ml)} ml vand køler kluden.`); } else message('Åbn ventilen for at få vand.'); },
  wine: () => station.liquid(80, 'wine'), ignite: () => { message(station.thermal.ignite('rag') ? 'Kluden brænder. Åbn ventilen og brug vand.' : 'Kluden er våd eller har intet brændstof.'); },
  clean: () => station.materials.clean('bench'), sound: () => station.sound(), screwdriver: (owner = 'desktop') => selectTool('screwdriver', owner), hammer: (owner = 'desktop') => selectTool('hammer', owner), 'drop-tool': release, reset,
};
for (const [id, action] of Object.entries(actions)) $(id).addEventListener('click', () => { audioReady(); if (station) action(); });
$('quality').addEventListener('change', () => { host?.setQuality(+$('quality').value); renderer.setPixelRatio(Math.min(devicePixelRatio, [0.7, 1, 1.25, 1.5][+$('quality').value])); });

// World-space controls share the same action handlers as desktop; Quest users need no DOM in-session.
const xrPanel = new THREE.Group(); xrPanel.position.set(-1.7, 1.7, 1.1); scene.add(xrPanel); xrPanel.visible = false;
const buttonActions = ['take-fuse', 'water', 'ignite', 'sound', 'screwdriver', 'hammer', 'drop-tool', 'reset'];
buttonActions.forEach((id, i) => { const button = label($(id).textContent, [(i % 2) * 0.52, -Math.floor(i / 2) * 0.17, 0], 0.48, xrPanel); button.userData.action = id; xrButtons.push(button); });
for (let i = 0; i < 2; i++) {
  const controller = renderer.xr.getController(i), grip = renderer.xr.getControllerGrip(i); scene.add(controller, grip); xrControllers.push(controller);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -2)]), new THREE.LineBasicMaterial({ color: 0xe5cc91 })); controller.add(line);
  controller.addEventListener('selectstart', () => {
    audioReady(); rotation.extractRotation(controller.matrixWorld); raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld); raycaster.ray.direction.set(0, 0, -1).applyMatrix4(rotation);
    const hit = raycaster.intersectObjects(xrButtons)[0]; if (hit) { actions[hit.object.userData.action](`xr${i}`); return; }
    if (active?.kind === 'screwdriver') turnTool(0.125);
  });
  controller.addEventListener('squeezestart', () => {
    if (!station || active) return;
    rotation.extractRotation(controller.matrixWorld); raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld); raycaster.ray.direction.set(0, 0, -1).applyMatrix4(rotation);
    const hit = raycaster.intersectObjects(interactables, true)[0]; if (!hit || hit.distance > 1.5) return;
    let object = hit.object; while (!object.userData.part && !object.userData.mechanism && object.parent) object = object.parent;
    const owner = `xr${i}`;
    if (object.userData.part) { if (takeFuse(owner)) active.distance = hit.distance; }
    else if (object.userData.mechanism) { const id = object.userData.mechanism; if (station.mechanics.state(id).locked) return;
      active = { mechanism: id, owner, distance: hit.distance };
      station.mechanics.grab(id, owner, hit.point.toArray());
    }
  });
  controller.addEventListener('squeezeend', () => { if (active?.owner === `xr${i}`) release(); });
  controller.addEventListener('disconnected', () => { release(true); host?.emit('disconnect', {}); });
}
document.body.append(VRButton.createButton(renderer));
let xrSession;
const trackingVisibility = () => { if (xrSession?.visibilityState !== 'visible') release(true); };
renderer.xr.addEventListener('sessionstart', () => { release(true); rig.position.z = 1.5; controls.enabled = false; $('message').style.display = 'none'; document.querySelector('aside').style.display = 'none'; xrPanel.visible = true; xrSession = renderer.xr.getSession(); xrSession?.addEventListener('visibilitychange', trackingVisibility); host?.emit('xrStart', {}); });
renderer.xr.addEventListener('sessionend', () => { release(true); xrSession?.removeEventListener('visibilitychange', trackingVisibility); xrSession = null; rig.position.z = 0; camera.position.set(0, 2.8, 5.2); controls.enabled = true; controls.update(); $('message').style.display = ''; document.querySelector('aside').style.display = ''; xrPanel.visible = false; host?.emit('xrEnd', {}); });
window.addEventListener('blur', () => release(true));
window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
const clock = new THREE.Clock();
const animate=() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (active && renderer.xr.isPresenting) {
    const controller = xrControllers[Number(active.owner.replace('xr', ''))];
    if (controller?.visible) {
      const q = controller.getWorldQuaternion(new THREE.Quaternion());
      if (active.kind === 'fuse') nodes.fuse.quaternion.copy(q);
      else if (active.kind) nodes.tool.quaternion.copy(q);
      point.set(0, 0, -(active.distance ?? 0.12)).applyMatrix4(controller.matrixWorld); handPoint(point, dt);
      if (active.kind === 'screwdriver' && lastToolQuaternion) { const change = lastToolQuaternion.clone().invert().multiply(q); const angle = 2 * Math.atan2(change.y, change.w); if (Math.abs(angle) < Math.PI) turnTool(angle / (2 * Math.PI)); }
      lastToolQuaternion = q;
    } else release(true);
  }
  host?.update(dt); if (station) { renderState(station.state()); nodes.flames.children.forEach((o, i) => { o.visible = i < [2, 4, 8, 12][+$('quality').value]; o.scale.y = 0.8 + Math.sin(performance.now() * 0.009 + i) * 0.2; }); }
  if (audioListener) { const p = camera.getWorldPosition(new THREE.Vector3()); audioListener.positionX.value = p.x; audioListener.positionY.value = p.y; audioListener.positionZ.value = p.z; }
  renderer.render(scene, camera);
};renderer.setAnimationLoop(animate);
const pageLifecycle=bindPageLifecycle({releaseInput:()=>release(true),suspend:()=>renderer.setAnimationLoop(null),resume:()=>renderer.setAnimationLoop(animate),resetClock:()=>clock.getDelta(),keepActiveWhenHidden:()=>renderer.xr.isPresenting,dispose:()=>{resetToken++;window.__systems=null;host?.dispose();station=null;controls.dispose();renderer.dispose();audio?.close();}});window.__pageLifecycle=pageLifecycle;
for(const name of ['sessionstart','sessionend'])renderer.xr.addEventListener(name,()=>pageLifecycle.refresh());
reset().catch(error => { console.error(error); message(error.message); });
