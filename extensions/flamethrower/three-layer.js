// Flamethrower three layer: the handheld mesh (a passed-in GLB object or a procedural fallback) and the nozzle. THREE is
// passed in (this folder imports no three.js).
//
// Conventions: the weapon points along local -Z (three's forward). `object` is the root the game parents to a hand /
// controller grip; `mountPoint` is where the hand holds it (the procedural mesh puts the grip at the root's origin, so
// mountPoint sits at 0,0,0); `nozzle` is an Object3D at the tip, its -Z axis the firing direction.
//
// GLB: nodes are looked up by name (case-insensitive): nozzle /nozzle|muzzle|tip|barrel_end/, mount /grip|mount|handle/,
// pilot /pilot/. Without a nozzle node the nozzle goes to the middle of the bounding box's -Z face. The GLB object is
// not cloned or disposed (it belongs to the caller); the procedural mesh is disposed by dispose().

const NOZZLE_RE = /nozzle|muzzle|tip|barrel_end/i, MOUNT_RE = /grip|mount|handle/i, PILOT_RE = /pilot/i;

function findNode(root, re) {
  let hit = null;
  root.traverse(o => { if (!hit && o !== root && re.test(o.name ?? '')) hit = o; });
  return hit;
}

/** Procedural flamethrower (about 0.75 m long). Returns { object, mountPoint, nozzle, pilot, owned: [geometries, materials] }. */
export function buildProceduralFlamethrower(THREE) {
  const owned = [];
  const mat = (color, extra = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.5, ...extra }); owned.push(m); return m; };
  const geo = g => { owned.push(g); return g; };
  const metal = mat(0x4a4d52), dark = mat(0x1d1f22, { metalness: 0.2, roughness: 0.8 }), red = mat(0x8a1c14, { metalness: 0.3 }), brass = mat(0xb08a3c, { metalness: 0.8, roughness: 0.35 });
  const pilotMat = mat(0xff9a3a, { emissive: 0xff6a10, emissiveIntensity: 2, roughness: 1, metalness: 0 });
  const root = new THREE.Group(); root.name = 'Flamethrower';
  const add = (name, geometry, material, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo(geometry), material); m.name = name; m.position.set(x, y, z); m.rotation.x = rx; root.add(m); return m; };
  add('grip', new THREE.BoxGeometry(0.035, 0.11, 0.045), dark, 0, -0.04, 0.02).rotation.x = -0.25;
  add('body', new THREE.BoxGeometry(0.06, 0.06, 0.3), metal, 0, 0.03, -0.05);
  add('tank', new THREE.CylinderGeometry(0.055, 0.055, 0.26, 16), red, 0, -0.04, -0.17, Math.PI / 2);
  add('foregrip', new THREE.BoxGeometry(0.03, 0.09, 0.04), dark, 0, -0.01, -0.3);
  add('barrel', new THREE.CylinderGeometry(0.016, 0.016, 0.42, 12), metal, 0, 0.04, -0.38, Math.PI / 2);
  add('nozzle_cone', new THREE.CylinderGeometry(0.026, 0.018, 0.05, 12), brass, 0, 0.04, -0.615, Math.PI / 2);
  const pilot = add('pilot_light', new THREE.SphereGeometry(0.008, 8, 6), pilotMat, 0, 0.012, -0.62);
  const mountPoint = new THREE.Object3D(); mountPoint.name = 'mount'; root.add(mountPoint);
  const nozzle = new THREE.Object3D(); nozzle.name = 'nozzle'; nozzle.position.set(0, 0.04, -0.645); root.add(nozzle);
  return { object: root, mountPoint, nozzle, pilot, owned };
}

/** Wraps a GLB scene/object: finds or places nozzle, mount and pilot. Returns the same shape as the procedural builder. */
export function adoptFlamethrowerModel(THREE, model) {
  if (!model?.isObject3D) throw new TypeError('model must be a three Object3D (gltf.scene)');
  const root = model;
  let nozzle = findNode(root, NOZZLE_RE), mountPoint = findNode(root, MOUNT_RE);
  const pilot = findNode(root, PILOT_RE);
  if (!nozzle) {
    root.updateMatrixWorld(true);
    const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const box = new THREE.Box3().setFromObject(root).applyMatrix4(inverse);
    nozzle = new THREE.Object3D(); nozzle.name = 'nozzle';
    if (box.isEmpty()) nozzle.position.set(0, 0, -0.5);
    else nozzle.position.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.min.z);
    root.add(nozzle);
  }
  if (!mountPoint) { mountPoint = new THREE.Object3D(); mountPoint.name = 'mount'; root.add(mountPoint); }
  return { object: root, mountPoint, nozzle, pilot, owned: [] };
}

/** Writes the nozzle's world position and -Z direction into aim.origin / aim.direction (arrays). No allocation. */
export function nozzleAim(nozzle, aim, tmpV, tmpQ) {
  nozzle.updateWorldMatrix(true, false);
  tmpV.setFromMatrixPosition(nozzle.matrixWorld);
  aim.origin[0] = tmpV.x; aim.origin[1] = tmpV.y; aim.origin[2] = tmpV.z;
  nozzle.matrixWorld.decompose(tmpV, tmpQ, tmpV); // scale is discarded
  tmpV.set(0, 0, -1).applyQuaternion(tmpQ);
  aim.direction[0] = tmpV.x; aim.direction[1] = tmpV.y; aim.direction[2] = tmpV.z;
  return aim;
}
