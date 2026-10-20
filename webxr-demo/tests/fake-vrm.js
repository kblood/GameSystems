// A fake three-vrm VRM for node tests (no model, no three-vrm), shared by character-vrm and character-contract tests.
import * as THREE from 'three';

// ---- fake VRM: a humanoid of THREE.Bones with VRM 1.0 names, built facing -Z like a VRM 0.x export ----
export function fakeHeads() {
  const H = { hips: [0, 0.95, 0], spine: [0, 1.05, 0], chest: [0, 1.18, 0], upperChest: [0, 1.3, 0], neck: [0, 1.45, 0], head: [0, 1.55, 0] };
  for (const [s, x] of [['left', 1], ['right', -1]]) {
    Object.assign(H, { [`${s}Shoulder`]: [0.03 * x, 1.4, 0], [`${s}UpperArm`]: [0.17 * x, 1.4, 0], [`${s}LowerArm`]: [0.45 * x, 1.4, 0], [`${s}Hand`]: [0.7 * x, 1.4, 0],
      [`${s}UpperLeg`]: [0.09 * x, 0.92, 0], [`${s}LowerLeg`]: [0.09 * x, 0.5, 0], [`${s}Foot`]: [0.09 * x, 0.08, 0], [`${s}Toes`]: [0.09 * x, 0.02, 0.12] });
    const knuckle = { Index: 0.025, Middle: 0.005, Ring: -0.015, Little: -0.033 };
    for (const [f, z] of Object.entries(knuckle)) ['Proximal', 'Intermediate', 'Distal'].forEach((g, k) => { H[`${s}${f}${g}`] = [(0.79 + 0.04 * k) * x, 1.4, z]; });
    ['Metacarpal', 'Proximal', 'Distal'].forEach((g, k) => { H[`${s}Thumb${g}`] = [(0.72 + 0.03 * k) * x, 1.39, 0.03 + 0.02 * k]; });
  }
  return H;
}
export function fakeVRM({ metaVersion = '0', fingers = true, eyes = false } = {}) {
  const heads = fakeHeads(), bones = {}, scene = new THREE.Group();
  const vrm0 = metaVersion === '0', toFile = p => (vrm0 ? [-p[0], p[1], -p[2]] : p); // a VRM 0.x file faces -Z
  const parentOf = { spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'upperChest', head: 'neck' };
  for (const s of ['left', 'right']) {
    Object.assign(parentOf, { [`${s}Shoulder`]: 'upperChest', [`${s}UpperArm`]: `${s}Shoulder`, [`${s}LowerArm`]: `${s}UpperArm`, [`${s}Hand`]: `${s}LowerArm`,
      [`${s}UpperLeg`]: 'hips', [`${s}LowerLeg`]: `${s}UpperLeg`, [`${s}Foot`]: `${s}LowerLeg`, [`${s}Toes`]: `${s}Foot` });
    for (const f of ['Index', 'Middle', 'Ring', 'Little']) Object.assign(parentOf, { [`${s}${f}Proximal`]: `${s}Hand`, [`${s}${f}Intermediate`]: `${s}${f}Proximal`, [`${s}${f}Distal`]: `${s}${f}Intermediate` });
    Object.assign(parentOf, { [`${s}ThumbMetacarpal`]: `${s}Hand`, [`${s}ThumbProximal`]: `${s}ThumbMetacarpal`, [`${s}ThumbDistal`]: `${s}ThumbProximal` });
  }
  for (const j of Object.keys(heads)) {
    if (!fingers && /(Thumb|Index|Middle|Ring|Little)/.test(j)) continue;
    const b = new THREE.Bone(); b.name = `bone_${j}`; bones[j] = b;
  }
  for (const [j, b] of Object.entries(bones)) {
    const p = parentOf[j], w = toFile(heads[j]), pw = p ? toFile(heads[p]) : [0, 0, 0];
    b.position.set(w[0] - pw[0], w[1] - pw[1], w[2] - pw[2]);
    (p ? bones[p] : scene).add(b);
  }
  if (eyes) for (const [name, x] of [['leftEye', -0.03], ['rightEye', 0.03]]) {
    const eye = new THREE.Bone(); eye.name = name; eye.position.set(x, 0.02, 0.05); bones[name] = eye; bones.head.add(eye);
  }
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  scene.add(mesh); scene.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(Object.values(bones)));
  let springResets = 0;
  return {
    bones, scene, meta: { metaVersion },
    humanoid: { autoUpdateHumanBones: true, getRawBoneNode: name => bones[name] ?? null },
    springBoneManager: { reset: () => springResets++, update() {} },
    get springResets() { return springResets; },
  };
}
