// Furniture lab (G1): a room with every furniture type from extensions/furniture. Desktop: drag handles with the mouse (Shift = second hand),
// VR: grab with the controller (trigger or grip), ray at bottles and keys. Docs: docs/furniture_system.md.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { createHost } from './vendor/extensions/host/index.js';
import mechanicsExtension from './vendor/extensions/mechanics/index.js';
import { createMemoryInventory } from './vendor/extensions/backpack/index.js';
import { furnitureExtension, typeSpec, TYPE_IDS } from './vendor/extensions/furniture/index.js';
import { buildFurnitureMesh } from './vendor/extensions/furniture/mesh.js';
import { bindPageLifecycle } from './page-lifecycle.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x1d2428);
const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.xr.enabled = true; document.body.prepend(renderer.domElement);
document.body.append(VRButton.createButton(renderer));
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 60); camera.position.set(0.5, 1.7, 4.2);
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 1, -1.5); controls.update();
scene.add(new THREE.HemisphereLight(0xe4effa, 0x4b4a45, 2.6)); const sun = new THREE.DirectionalLight(0xffe9c8, 2.4); sun.position.set(2, 5, 3); scene.add(sun);

// ---- room
const box = (size, at, color) => { const m = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color, roughness: 0.85 })); m.position.set(...at); scene.add(m); return m; };
box([9, 0.1, 7], [0, -0.05, 0], 0x59616a); box([9, 3, 0.12], [0, 1.5, -3.5], 0x39474f); box([0.12, 3, 7], [-4.5, 1.5, 0], 0x39474f); box([0.12, 3, 7], [4.5, 1.5, 0], 0x39474f);

// ---- host: mechanics + furniture (+ optional audio) and a memory inventory that stands in for the game's item ledger
const host = createHost({ THREE, scene, renderer, camera, quality: 3 });
const mechanics = await host.load(mechanicsExtension); if (!mechanics) throw new Error('mechanics extension failed');
const inventory = createMemoryInventory();
let audio = null;
if (params.has('audio')) {
  try { const mod = await import('./vendor/extensions/audio/index.js'); audio = await host.load(mod.default, {}); if (audio) mod.installUnlock?.(audio); } catch (error) { console.error('audio', error); }
}
const powerOn = { value: false };
const set = await host.load(furnitureExtension({ inventory, powerOf: () => powerOn.value, onReject: r => log(`afvist: ${r.reason}${r.partId ? ` (${r.partId})` : ''}`) }));
if (!set) throw new Error('furniture extension failed');

const powerDoor = typeSpec('door'); powerDoor.id = 'power_door'; powerDoor.locks = [{ id: 'pwr', kind: 'power', mode: 'secure', parts: ['door'], locked: false }];
// type, id, position, yaw (back wall z=-3.5 faces +Z; yaw turns the front towards the room)
const LAYOUT = [
  ['cabinet', 'cabinet', [-3.4, 0, -3.2], 0], ['kitchen_cabinet', 'kitchen', [-2.5, 0, -3.2], 0], ['dresser', 'dresser', [-1.5, 0, -3.2], 0], ['wardrobe', 'wardrobe', [-0.2, 0, -3.15], 0],
  ['desk', 'desk', [1.3, 0, -3.1], 0], ['fridge', 'fridge', [2.55, 0, -3.15], 0], ['safe', 'safe', [3.4, 0, -3.2], 0], ['locker', 'locker', [4.05, 0, -3.2], 0],
  ['chest', 'chest', [3.6, 0, -0.5], -Math.PI / 2], ['drawer', 'bedside', [3.7, 0, 1.0], -Math.PI / 2], [powerDoor, 'power_door', [-3.8, 0, 0.5], Math.PI / 2], ['sliding_door', 'sliding', [-3.9, 0, 2.4], Math.PI / 2],
];
const pieces = new Map(), meshByFurniture = new Map(), pickables = [];
let drawCalls = 0;
for (const [type, id, position, yaw] of LAYOUT) {
  const f = set.add(type, { id, position, yaw }), m = buildFurnitureMesh(type, { position, yaw });
  scene.add(m.group); pieces.set(id, f); meshByFurniture.set(id, m); drawCalls += m.stats.drawCalls;
  for (const mesh of m.meshes) { mesh.userData.furnitureId = id; pickables.push(mesh); }
  for (const t of ['opened', 'closed', 'locked', 'unlocked', 'itemStored', 'itemRemoved', 'blocked']) f.on(t, e => log(`${id}: ${t}${e.partId ? ` ${e.partId}` : ''}${e.itemId ? ` ${e.itemId}` : ''}`));
}

// ---- bottles in drawers (one InstancedMesh = one draw call, at most 12 proxies at the high tier)
const bottleGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.26, 10).rotateZ(Math.PI / 2);
const bottles = new THREE.InstancedMesh(bottleGeo, new THREE.MeshStandardMaterial({ color: 0x3f7d4f, roughness: 0.2, metalness: 0.1 }), 12); bottles.count = 0; bottles.frustumCulled = false; scene.add(bottles);
const held = new THREE.Mesh(bottleGeo, bottles.material); held.visible = false; scene.add(held);
let heldItem = null, proxyRows = [];
let bottleSeq = 0;
function stash(furnitureId, partId, n) {
  const f = pieces.get(furnitureId); f.setOpen(partId, true); run(1.2);
  for (let i = 0; i < n; i++) { const id = `flaske_${++bottleSeq}`; inventory.registerItem(id, 'bottle', [0.26, 0.065, 0.065], 'world'); f.store(id, partId); }
  f.setOpen(partId, false); run(1.5);
}
function run(seconds, hz = 72) { for (let i = 0; i < seconds * hz; i++) { set.step(1 / hz); mechanics.step(1 / hz); } }
function seed() { stash('dresser', 'drawer1', 3); stash('desk', 'drawer2', 2); stash('kitchen', 'drawer', 2); stash('bedside', 'drawer', 1); }
seed();

// ---- keys and the code pad (in-world, so they work in VR as well)
const keyMeshes = [['key_locker', 0x6fbf73, 0.95], ['key_chest', 0xd8b65d, 1.1], ['key_wrong', 0x8a8f94, 1.25]].map(([id, color, x]) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.012, 0.03), new THREE.MeshStandardMaterial({ color })); m.position.set(x, 0.762, -2.95); m.userData.keyId = id; scene.add(m); pickables.push(m); return m;
});
const padCanvas = document.createElement('canvas'); padCanvas.width = 240; padCanvas.height = 320;
const padTexture = new THREE.CanvasTexture(padCanvas), padMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.4), new THREE.MeshBasicMaterial({ map: padTexture }));
padMesh.position.set(3.0, 1.15, -2.2); scene.add(padMesh); box([0.06, 1.0, 0.06], [3.0, 0.5, -2.24], 0x39474f); padMesh.userData.pad = true; pickables.push(padMesh);
let entry = '';
const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'];
function drawPad(note = '') {
  const c = padCanvas.getContext('2d'); c.fillStyle = '#10181c'; c.fillRect(0, 0, 240, 320);
  c.fillStyle = '#8fd0a0'; c.font = '34px monospace'; c.textAlign = 'center'; c.fillText(entry.padEnd(4, '_') || '____', 120, 40);
  c.font = '14px monospace'; c.fillStyle = '#d6c79d'; c.fillText(note, 120, 62);
  c.font = '30px sans-serif';
  PAD.forEach((k, i) => { const x = 20 + (i % 3) * 72, y = 80 + Math.floor(i / 3) * 58; c.fillStyle = '#344955'; c.fillRect(x, y, 64, 50); c.fillStyle = '#edf4f2'; c.fillText(k, x + 32, y + 36); });
  padTexture.needsUpdate = true;
}
function padPress(uv) {
  const x = uv.x * 240, y = (1 - uv.y) * 320, col = Math.floor((x - 20) / 72), row = Math.floor((y - 80) / 58);
  if (col < 0 || col > 2 || row < 0 || row > 3) return;
  const k = PAD[row * 3 + col];
  if (k === 'C') entry = ''; else if (k === 'OK') { submitCode(entry); entry = ''; } else if (entry.length < 8) entry += k;
  drawPad();
}
drawPad();
function submitCode(code) { const r = pieces.get('safe').enterCode('combo', code); drawPad(r.ok ? (r.locked ? 'LÅST' : 'ÅBEN') : r.reason); log(`kode ${code}: ${r.ok ? (r.locked ? 'låst' : 'låst op') : r.reason}`); return r; }
const KEY_LOCKS = [['locker', 'lock'], ['chest', 'lock']];
function useKey(keyId, from) {
  let best = null, bestD = 3;
  for (const [fid, lid] of KEY_LOCKS) { const d = new THREE.Vector3(...pieces.get(fid).centreOf(fid === 'chest' ? 'lid' : 'door')).distanceTo(from); if (d < bestD) { best = [fid, lid]; bestD = d; } }
  if (!best) { log(`nøgle ${keyId}: intet lås inden for rækkevidde`); return; }
  const r = pieces.get(best[0]).tryKey(best[1], keyId); log(`nøgle ${keyId} på ${best[0]}: ${r.ok ? (r.locked ? 'låst' : 'låst op') : r.reason}`);
}

// ---- grabbing
const ray = new THREE.Raycaster(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
const grabs = new Map(); // owner -> { furniture, partId, plane?, controller? }
function holdersOf(partId, f) { return [...grabs].filter(([, g]) => g.furniture === f && g.partId === partId); }
function raycast(r, extra = []) { return r.intersectObjects([...pickables, bottles, ...extra], false)[0] ?? null; }
function takeBottle(row, hand) {
  const f = pieces.get(row.furnitureId), r = f.retrieve(row.partId, { itemId: row.itemId, newOwner: 'hand' }); if (!r.ok) return;
  heldItem = { itemId: row.itemId, hand }; held.visible = true;
}
function putBottle(at) {
  if (!heldItem) return false;
  let best = null, bestD = 0.45;
  for (const f of pieces.values()) for (const id of f.containerIds()) if (f.isAccessible(id)) { const d = tmp2.set(...f.centreOf(id)).distanceTo(at); if (d < bestD) { best = [f, id]; bestD = d; } }
  if (best) { const r = best[0].store(heldItem.itemId, best[1], { expectedOwner: 'hand' }); if (!r.ok) return false; }
  else { inventory.transfer?.(heldItem.itemId, 'hand', 'world'); log('flaske sat på gulvet'); const m = new THREE.Mesh(bottleGeo, bottles.material); m.position.set(at.x, 0.035, at.z); scene.add(m); }
  heldItem = null; held.visible = false; return true;
}
function startGrab(owner, r, handPoint, controller = null, shift = false) {
  const hit = raycast(r); if (!hit) return false;
  if (hit.object === bottles) { if (heldItem) return true; takeBottle(proxyRows[hit.instanceId], owner); return true; }
  if (hit.object.userData.keyId) { useKey(hit.object.userData.keyId, tmp.copy(r.ray.origin)); return true; }
  if (hit.object.userData.pad) { padPress(hit.uv); return true; }
  const fid = hit.object.userData.furnitureId, partId = hit.object.userData.partId; if (!fid) return false;
  const f = pieces.get(fid);
  if (!partId) { if (heldItem) putBottle(hit.point); return true; }
  if (heldItem) { putBottle(hit.point); return true; }
  const pt = handPoint ?? hit.point.toArray();
  const near = f.nearestHandle(pt, 0.5); const point = near && near.partId === partId ? f.handleWorld(partId, near.handleIndex) : pt;
  const res = f.grab(partId, owner, point); if (!res.ok) { log(`${fid}/${partId}: ${res.reason}`); return true; }
  const plane = controller ? null : new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(tmp).negate(), new THREE.Vector3(...point));
  grabs.set(owner, { furniture: f, partId, plane, controller });
  if (shift) { const o2 = `${owner}+`; if (f.grab(partId, o2, f.handleWorld(partId, 0)).ok) grabs.set(o2, { furniture: f, partId, plane, controller, follow: owner }); }
  controls.enabled = false; return true;
}
function endGrab(owner) {
  for (const [o, g] of [...grabs]) if (o === owner || g.follow === owner) { g.furniture.release(g.partId, o); grabs.delete(o); }
  if (!grabs.size) controls.enabled = !renderer.xr.isPresenting;
}
const pointer = new THREE.Vector2(), el = renderer.domElement;
const setRay = e => { const b = el.getBoundingClientRect(); pointer.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1); ray.setFromCamera(pointer, camera); return ray; };
el.addEventListener('pointerdown', e => { if (renderer.xr.isPresenting || e.button !== 0) return; if (startGrab('mouse', setRay(e), null, null, e.shiftKey)) el.setPointerCapture(e.pointerId); });
el.addEventListener('pointermove', e => {
  if (renderer.xr.isPresenting) return; setRay(e);
  for (const [owner, g] of grabs) { const target = ray.ray.intersectPlane(g.plane, tmp); if (target) g.furniture.moveHand(g.partId, owner, target.toArray()); }
  if (heldItem) { const t = ray.ray.at(1.2, tmp); held.position.copy(t); }
});
el.addEventListener('pointerup', () => endGrab('mouse'));
el.addEventListener('pointercancel', () => endGrab('mouse'));
const xrOwners = [];
for (let i = 0; i < 2; i++) {
  const controller = renderer.xr.getController(i), owner = `xr:${i}`; rig.add(controller); xrOwners.push([owner, controller]);
  controller.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -3)]), new THREE.LineBasicMaterial({ color: 0xf1ba79 })));
  const start = () => { controller.updateMatrixWorld(true); ray.ray.origin.setFromMatrixPosition(controller.matrixWorld); ray.ray.direction.set(0, 0, -1).applyQuaternion(controller.getWorldQuaternion(tmpQ)); startGrab(owner, ray, controller.getWorldPosition(new THREE.Vector3()).toArray(), controller); };
  for (const n of ['selectstart', 'squeezestart']) controller.addEventListener(n, start);
  for (const n of ['selectend', 'squeezeend', 'disconnected']) controller.addEventListener(n, () => endGrab(owner));
}
renderer.xr.addEventListener('sessionstart', () => { rig.position.set(0, 0, 1.6); controls.enabled = false; document.querySelector('aside').style.display = 'none'; });
renderer.xr.addEventListener('sessionend', () => { rig.position.set(0, 0, 0); controls.enabled = true; document.querySelector('aside').style.display = ''; });

// ---- panel
function slam(f, partId, torque) { const mid = `${f.id}/${partId}`; mechanics.drive(mid, 'slam', torque); setTimeout(() => mechanics.release(mid, 'slam'), 250); }
$('slam').onclick = () => { const f = pieces.get('fridge'); if (f.state('door').value < 0.3) f.setOpen('door', true); setTimeout(() => slam(f, 'door', -25), 700); };
$('slam2').onclick = () => { const f = pieces.get('cabinet'); f.setOpen('doorL', true); setTimeout(() => slam(f, 'doorL', -18), 700); };
$('key-locker').onclick = () => { const r = pieces.get('locker').tryKey('lock', 'key_locker'); log(`nøgle locker: ${r.ok ? (r.locked ? 'låst' : 'låst op') : r.reason}`); };
$('key-chest').onclick = () => { const r = pieces.get('chest').tryKey('lock', 'key_chest'); log(`nøgle kiste: ${r.ok ? (r.locked ? 'låst' : 'låst op') : r.reason}`); };
$('key-wrong').onclick = () => { const r = pieces.get('locker').tryKey('lock', 'key_wrong'); log(`forkert nøgle: ${r.reason || 'ok'}`); };
$('power').onclick = () => { powerOn.value = !powerOn.value; log(`dørlås strøm: ${powerOn.value ? 'til (låst)' : 'fra'}`); };
$('enter').onclick = () => { submitCode($('code').value); $('code').value = ''; };
$('quality').onchange = () => host.setQuality(+$('quality').value);
let saved = null;
$('save').onclick = () => { saved = JSON.parse(JSON.stringify(set.capture())); log('gemt'); };
$('restore').onclick = () => { if (!saved) return; try { set.restore(saved); log('indlæst'); } catch (e) { log(`kunne ikke indlæse: ${e.message}`); } };
$('reset').onclick = () => location.reload();

const logLines = [];
function log(line) { logLines.push(line); if (logLines.length > 9) logLines.shift(); $('log').textContent = logLines.join('\n'); }
function statusText() {
  const lock = (fid, part) => pieces.get(fid).isLocked(part) ? 'låst' : 'åben-lås';
  const frac = (fid, part) => `${Math.round(pieces.get(fid).state(part).fraction * 100)}%`;
  const items = [...pieces.values()].reduce((n, f) => n + f.itemCount(), 0) + (heldItem ? 1 : 0);
  return `Tegnekald: ${drawCalls + 3} · flasker: ${items} (${proxyRows.length} synlige)\nPengeskab: ${lock('safe', 'door')} · ${frac('safe', 'door')}\nSkab: ${lock('locker', 'door')} · kiste: ${lock('chest', 'lid')}\nDørlås: ${lock('power_door', 'door')}\nKøleskab: ${frac('fridge', 'door')} · skuffe 1: ${frac('dresser', 'drawer1')}`;
}

// ---- frame loop (no allocations: rows come from furniture.proxies(), matrices are reused)
const timer = new THREE.Clock(), dummy = new THREE.Object3D(); let statusT = 0;
const animate = () => {
  const dt = Math.min(timer.getDelta(), 0.05);
  for (const [owner, g] of grabs) if (g.controller) g.furniture.moveHand(g.partId, owner, g.controller.getWorldPosition(tmp).toArray());
  for (const [o, g] of grabs) if (g.follow) { const lead = grabs.get(g.follow); if (lead?.controller) g.furniture.moveHand(g.partId, o, lead.controller.getWorldPosition(tmp).toArray()); }
  host.update(dt);
  for (const [id, f] of pieces) meshByFurniture.get(id).update(f);
  // bottles in open drawers/shelves (tier high); rows are rebuilt only for the pieces that have open containers
  proxyRows.length = 0; let n = 0;
  for (const [id, f] of pieces) { if (n >= 12) break; for (const row of f.proxies(12 - n)) { row.furnitureId = id; proxyRows.push(row); dummy.position.set(row.position[0], row.position[1] + 0.033, row.position[2]); dummy.updateMatrix(); bottles.setMatrixAt(n++, dummy.matrix); } }
  bottles.count = n; bottles.instanceMatrix.needsUpdate = true;
  if (heldItem && renderer.xr.isPresenting) { const c = xrOwners.find(([o]) => o === heldItem.hand)?.[1] ?? xrOwners[0][1]; held.position.copy(c.getWorldPosition(tmp)); }
  if ((statusT += dt) > 0.2) { statusT = 0; $('status').textContent = statusText(); }
  renderer.render(scene, camera);
};
renderer.setAnimationLoop(animate);
window.__furniture = { host, set, pieces, mechanics, inventory, scene, renderer, camera, types: TYPE_IDS, run, submitCode, stats: () => ({ drawCalls, pieces: pieces.size, proxies: proxyRows.length }), state: () => set.capture() };
window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
window.__pageLifecycle = bindPageLifecycle({ suspend: () => renderer.setAnimationLoop(null), resume: () => renderer.setAnimationLoop(animate), resetClock: () => timer.getDelta(),
  dispose: () => { host.dispose(); controls.dispose(); scene.traverse(o => { o.geometry?.dispose?.(); }); renderer.dispose(); } });
