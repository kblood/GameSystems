// Grasp lab page (test tooling only): the VRIK avatar driven by a synthetic tracking record, no game, no XR session.
// A held item is a lathe/cylinder shape in a fixed world frame; the hand is placed in ITEM space, fingers are plugin
// finger rows ([dyaw, pitch, bend1, bend2] degrees). measure() = CPU-skinned hand vertices vs the item's signed
// distance (same metrics as the games' hand-contact smoke tests, ../../contact.js) + joint/anatomy readouts. Driven from
// node by puppeteer (lab_page.mjs). The avatar is the Contracts character plugin (CharacterCreator male), or with
// ?character=vrm the GameSystems avatar extension posing the character-vrm test model (extensions plan step 6).
import * as THREE from 'three';
import * as contractsPlugin from 'character-plugin';
import { signedDistance } from '../../catalog.js';
import { contactMetrics } from '../../contact.js';

const D2R = Math.PI / 180, FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(960, 720); renderer.setClearColor(0x2a323a); document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6)); const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(1, 3, 2); scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshStandardMaterial({ color: 0x3a4650 })); floor.rotation.x = -Math.PI / 2; scene.add(floor);
const useVRM = new URLSearchParams(location.search).get('character') === 'vrm';
// ?faces=1 (lab_page FACES=1): the hand skin is sampled on its triangles too (centroid + edge midpoints of every triangle
// whose corners are all hand vertices, grouped by the corners' majority), not only at vertices: a low-poly hand (the VRM
// test model: 46 palm vertices, ~6 per finger segment) touches with faces whose vertices stay millimetres away.
const sampleFaces = new URLSearchParams(location.search).get('faces') === '1';
let characters, player;
if (useVRM) {
  const [{ createCharacterPlugin }, { vrmCharacters }] = await Promise.all([import('/extensions/avatar/index.js'), import('/extensions/character-vrm/index.js')]);
  characters = createCharacterPlugin({ scene, renderer, character: vrmCharacters({ assetsURL: '/extensions/character-vrm/assets/', quality: 'low' }) });
  player = await characters.createPlayer({});
  await player.ready; player.calibrate(1.62);   // as the demo's auto-calibration does for a 1.62 m eye height (CC: built in)
} else {
  characters = contractsPlugin.createCharacterPlugin({ scene, renderer, quality: { player: { skinUpgrade: true, shadows: false }, npc: { skinUpgrade: false, shadows: false, cloth: false, hairCollision: false } } });
  player = await characters.createPlayer({ outfit: ['shirt', 'jeans', 'shoes'], hair: 'short02', sex: 'male', body: { height: 0 } });
}
await player.ready; player.setFirstPerson(true);

const head = { pos: [0, 1.62, 0], quat: [0, 0, 0, 1] };
const rec = { t: 0, head, hands: { left: { valid: false }, right: { valid: false } }, snaps: [], eyes: null, fingers: {} };
const item = { shape: null, pos: [0, 1.15, -0.34], quat: [0, 0, 0, 1], mesh: null, world: new THREE.Matrix4(), inv: new THREE.Matrix4() };

const rowsToState = rows => Object.fromEntries(FINGERS.map(f => [f, { yaw: null, dyaw: rows[f][0] * D2R, pitch: rows[f][1] * D2R, bend1: rows[f][2] * D2R, bend2: rows[f][3] * D2R, curl: 1, src: 'lab' }]));

// ---- item ----
function profileGeometry(s) {
  if (s.type === 'lathe') return new THREE.LatheGeometry([[0, 0], ...s.profile, [s.profile.at(-1)[0], 0]].map(([y, r]) => new THREE.Vector2(r, y)), 32);
  if (s.type === 'cylinder') return new THREE.CylinderGeometry(s.radius, s.radius, s.half * 2, 32);
  return new THREE.BoxGeometry(...s.size);
}
function setItem(shape, { pos = [0, 1.15, -0.34], yaw = 0, ghost = true } = {}) {
  if (item.mesh) { scene.remove(item.mesh); item.mesh.traverse(o => o.geometry?.dispose()); }
  item.shape = shape; item.pos = pos; item.quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).toArray();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a5a20, transparent: ghost, opacity: ghost ? 0.55 : 1, roughness: 0.3 });
  if (shape.type === 'parts') { item.mesh = new THREE.Group(); for (const part of shape.parts) { const m = new THREE.Mesh(profileGeometry(part), mat); m.position.fromArray(part.at || [0, 0, 0]); item.mesh.add(m); } }
  else item.mesh = new THREE.Mesh(profileGeometry(shape), mat);
  item.mesh.position.fromArray(pos); item.mesh.quaternion.fromArray(item.quat); scene.add(item.mesh);
  item.world.compose(new THREE.Vector3(...pos), new THREE.Quaternion(...item.quat), new THREE.Vector3(1, 1, 1)); item.inv.copy(item.world).invert();
}

// ---- hand ----
let vertexSets = null;
function buildVertexSets() {
  const bones = player.humanoid.bones, out = { left: [], right: [] };
  for (const side of ['left', 'right']) {
    const byObject = new Map();
    for (const [key, bone] of Object.entries(bones)) if (key.startsWith(side) && (key === `${side}Hand` || /(Thumb|Index|Middle|Ring|Little)/.test(key))) byObject.set(bone, key.slice(side.length));
    scene.updateMatrixWorld(true);
    player.root.traverse(o => {
      if (!o.isSkinnedMesh) return;
      for (let p = o; p; p = p.parent) if (!p.visible) return;
      const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight, n = o.geometry.attributes.position.count, groups = o.skeleton.bones.map(b => byObject.get(b));
      const idx = [], grp = [];
      for (let i = 0; i < n; i++) {
        let best = -1, w = 0;
        for (let k = 0; k < 4; k++) { const wk = sw.getComponent(i, k); if (wk > w) { w = wk; best = si.getComponent(i, k); } }
        const g = groups[best]; if (g) { idx.push(i); grp.push(g); }
      }
      const tris = [];
      if (sampleFaces && idx.length) {
        const at = new Map(idx.map((v, k) => [v, k])), index = o.geometry.index;
        const count = index ? index.count : n;
        for (let t = 0; t + 2 < count; t += 3) {
          const c = [0, 1, 2].map(j => at.get(index ? index.getX(t + j) : t + j));
          if (c.some(k => k === undefined)) continue;
          const g = grp[c[0]] === grp[c[1]] || grp[c[0]] === grp[c[2]] ? grp[c[0]] : grp[c[1]] === grp[c[2]] ? grp[c[1]] : grp[c[0]];
          tris.push(c[0], c[1], c[2], g);
        }
      }
      if (idx.length) out[side].push({ mesh: o, idx, grp, tris });
    });
  }
  vertexSets = out;
}
const tmp = new THREE.Vector3();
function handPoints(side) {
  if (!vertexSets) buildVertexSets();
  scene.updateMatrixWorld(true);
  const pts = [];
  for (const { mesh, idx, grp, tris } of vertexSets[side]) {
    mesh.skeleton.update();
    const m = new THREE.Matrix4().multiplyMatrices(item.inv, mesh.matrixWorld);
    const P = [];
    for (let k = 0; k < idx.length; k++) { mesh.getVertexPosition(idx[k], tmp); tmp.applyMatrix4(m); P.push([tmp.x, tmp.y, tmp.z]); pts.push({ p: P[k], group: grp[k] }); }
    for (let t = 0; t < tris.length; t += 4) {
      const a = P[tris[t]], b = P[tris[t + 1]], c = P[tris[t + 2]], group = tris[t + 3];
      pts.push({ p: [0, 1, 2].map(j => (a[j] + b[j] + c[j]) / 3), group });
      for (const [u, v] of [[a, b], [b, c], [c, a]]) pts.push({ p: [0, 1, 2].map(j => (u[j] + v[j]) / 2), group });
    }
  }
  return pts;
}

/** Drive the avatar: wrist pose in ITEM space + finger rows; settle the arm for `iterations` solver ticks. */
function pose(side, wrist, rows, iterations = 10) {
  const w = { pos: new THREE.Vector3(...wrist.pos).applyMatrix4(item.world).toArray(), quat: new THREE.Quaternion(...item.quat).multiply(new THREE.Quaternion(...wrist.quat)).toArray() };
  rec.hands[side] = { pos: w.pos, quat: w.quat, valid: true, kind: 'controller' };
  rec.fingers = { ...rec.fingers, [side]: rowsToState(rows) };
  for (let i = 0; i < iterations; i++) { rec.t += 1 / 72; player.updateTracking(rec, 1 / 72); }
  return w;
}
function clearHand(side) { delete rec.fingers[side]; rec.hands[side] = { valid: false }; }
const boneWorld = name => player.humanoid.bones[name].getWorldPosition(new THREE.Vector3());
/** Wrist anatomy: angle between the forearm axis and the hand axis, and the commanded-vs-actual wrist error. */
function wristInfo(side, w) {
  const hand = boneWorld(`${side}Hand`), lower = boneWorld(`${side}LowerArm`), mid = boneWorld(`${side}MiddleProximal`);
  const fore = hand.clone().sub(lower).normalize(), axis = mid.clone().sub(hand).normalize();
  return { wristErrorMm: hand.distanceTo(new THREE.Vector3(...w.pos)) * 1000, deviationDeg: fore.angleTo(axis) / D2R };
}
function measure(side, wrist, rows, { iterations = 10 } = {}) {
  const w = pose(side, wrist, rows, iterations), pts = handPoints(side);
  const shape = item.shape, axis = { origin: [0, 0, 0], dir: [0, 1, 0] };
  const m = contactMetrics(pts, p => signedDistance(shape, p), axis);
  const per = Object.fromEntries([...FINGERS, 'Hand'].map(f => [f, { pen: 0, gap: Infinity }])), groups = {};
  for (const { p, group } of pts) {
    const f = group === 'Hand' ? 'Hand' : FINGERS.find(x => group.startsWith(x)), d = signedDistance(shape, p) * 1000, o = per[f];
    o.pen = Math.max(o.pen, -d); if (group === 'Hand' || group.endsWith('Distal')) o.gap = Math.min(o.gap, d);
    groups[group] = Math.min(groups[group] ?? Infinity, d);
  }
  return { ...m, per, groups, ...wristInfo(side, w) };
}
function shot(eye, look, { w = 960, h = 720, fov = 40 } = {}) {
  const cam = new THREE.PerspectiveCamera(fov, w / h, 0.01, 30); cam.position.fromArray(eye); cam.lookAt(new THREE.Vector3(...look));
  renderer.setSize(w, h, false); renderer.render(scene, cam); return renderer.domElement.toDataURL('image/png');
}
/** Camera positions around the item, relative to a wrist pose in item space (hand frame: +Z fingers, +Y dorsal). */
function views(side, wrist, center) {
  const q = new THREE.Quaternion(...item.quat).multiply(new THREE.Quaternion(...wrist.quat));
  const ax = v => new THREE.Vector3(...v).applyQuaternion(q), c = new THREE.Vector3(...center).applyMatrix4(item.world);
  const palm = ax([0, -1, 0]), F = ax([0, 0, 1]), R = ax([1, 0, 0]).multiplyScalar(side === 'left' ? -1 : 1);
  return {
    fingertips: c.clone().addScaledVector(palm, 0.26).addScaledVector(F, 0.05).toArray(),
    thumbside: c.clone().addScaledVector(R, 0.26).addScaledVector(palm, 0.08).toArray(),
    dorsal: c.clone().addScaledVector(ax([0, 1, 0]), 0.26).addScaledVector(F, -0.04).toArray(),
    oblique: c.clone().addScaledVector(palm, 0.2).addScaledVector(F, 0.1).add(new THREE.Vector3(0, 0.12, 0)).toArray(),
    above: c.clone().add(new THREE.Vector3(0, 0.3, 0.0001)).toArray(),
    center: c.toArray(),
  };
}
/** The character's rest hand as close-to-contact needs it (closure.js handGeometry input, incl. the hand profile) + its world scale. */
function restHand(side) {
  const rig = player.rig, h = rig.hands[side], r = player.restHand?.(side);
  return { scale: player.scale, rest: { side, frame: { F: h.frame.F, D: h.frame.D, R: h.frame.R }, wrist: rig.H[`${side}Hand`], scale: player.scale,
    fingers: Object.fromEntries(FINGERS.map(f => [f, { pts: h.fingers[f].pts, len: h.fingers[f].len, rest: { yaw: h.fingers[f].rest.yaw } }])),
    ...(r?.profile && { profile: r.profile, thumbTilt: r.thumbTilt, handLength: r.handLength }) } };
}
/** Runtime hand-profile adjustment on the avatar (entity.setHandProfile): override (fields, size, girth) or null. */
function setHandProfile(override, side = null) { return player.setHandProfile?.(override, side) ?? null; }
/** Skin vertices of the posed hand in its commanded hand frame (m; +Z fingers, +Y back of the hand), grouped. */
function handLocalPoints(side) {
  const cmd = rec.hands[side], m = new THREE.Matrix4().compose(new THREE.Vector3(...cmd.pos), new THREE.Quaternion(...cmd.quat), new THREE.Vector3(1, 1, 1)).invert();
  const toWorld = item.world;
  return handPoints(side).map(({ p, group }) => ({ p: new THREE.Vector3(...p).applyMatrix4(toWorld).applyMatrix4(m).toArray(), group }));
}
window.__lab = { THREE, player, setItem, pose, clearHand, measure, shot, views, handPoints, restHand, setHandProfile, handLocalPoints, wristInfo, signedDistance, item, rec, scene, renderer };
window.__ready = true;
