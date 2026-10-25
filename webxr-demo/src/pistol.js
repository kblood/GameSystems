// A simple pistol with a laser sight for the bottle demo. It rides in a holster on the right hip (following the head's
// yaw); a hand draws it, letting go at the hip holsters it, letting go anywhere else drops it to the floor and it is back
// in the holster after RETURN_SECONDS (it can be picked up again before that). In XR it sits in the
// controller's grip space, pitched so its handle lies in the controller handle (GUN_PITCH_DEG; local -Z is the muzzle). On desktop it is
// held at the right of the view and converges on the crosshair. The laser runs from the module under the barrel to
// whatever the ray meets (room, bottles, panes); a shot flashes, kicks and bangs (synthesised, there is no gunshot ogg).
// Room hits leave a bullet hole; bottles and panes are broken by the demo's own breakage.shoot.
import * as THREE from 'three';

/** Desktop grip offset in camera space (m); the avatar's right hand is put there while the pistol is held. */
export const DESKTOP_OFFSET = Object.freeze([0.14, -0.17, -0.36]);
export const REACH = 0.14;         // m from the grip point within which a squeeze takes the pistol
export const HOLSTER_REACH = 0.2;  // m: drawing from (or letting go into) the hip holster, which is out of sight
export const RETURN_SECONDS = 20;  // a dropped pistol is back in the holster after this long
export const HOLSTER_OFFSET = Object.freeze([0.22, 0, 0.02]); // m from the eyes in the body's yaw frame (right, -, back)
export const HIP_DROP = 0.62;      // m below the eyes
export const HOLSTER_FOLLOW = 4;   // 1/s: how fast the holster turns after the head
export const LASER_RANGE = 30;
/**
 * Held in XR, the pistol is pitched about GUN_PIVOT so its handle lies in the Touch controller's handle and its trigger
 * sits on the controller trigger. Why: WebXR gripSpace has the controller handle along grip Z (-Z toward the thumb), as the
 * xr-input-profiles oculus-touch-v2/v3, meta-quest-touch-plus/pro GLBs draw it (handle elevation +1.2..+4.3 deg above -Z,
 * mean +1.7; trigger pad at y -0.031, z -0.025), while this pistol's handle runs along its +Y. With the gun frame equal to
 * gripSpace the handle sat ~83 deg off the controller handle and the trigger ~5 cm from the controller trigger. The handle
 * here (outline below, top edge to bottom edge) is at +84.6 deg elevation, so the exact rotation about grip X is
 * 1.7 - 84.6 = -82.9 deg, rounded to -82 (the per-profile spread is +-3.5 deg, hence one constant). GUN_PIVOT is the point
 * in grip space solving: trigger centre (y .024, z -.034) lands on the mean controller trigger pad, handle centre on the
 * controller handle axis (residual 0.3 mm). The muzzle (-Z) follows: the barrel then points ~35 deg below the Quest aim ray
 * (the Chromium/IWER grip is the aim ray turned 45 deg about X). Override: ?gunpitch=<deg> (0 = the old pose).
 * Desktop and the holster pose are unchanged. Same derivation as NightfallContracts weapons/interaction.js (GUN_PITCH_DEG -80
 * for its Kestrel model, whose handle is raked slightly differently).
 */
export const GUN_PITCH_DEG = -82;
export const GUN_PIVOT = Object.freeze([0, 0.0015, 0.0019]);
/** Parse a ?gunpitch value: finite degrees within +-180, else null (use the default). */
export function parseGunPitch(value) {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= 180 ? n : null;
}
/** The pistol's local pose in the XR grip frame for a pitch: { position: [x,y,z], quaternion: [x,y,z,w] }. 0 = identity. */
export function heldGunLocal(pitchDeg = GUN_PITCH_DEG, pivot = GUN_PIVOT) {
  if (!pitchDeg) return { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
  const t = pitchDeg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t), [, py, pz] = pivot;
  return { position: [0, py - (py * c - pz * s), pz - (py * s + pz * c)], quaternion: [Math.sin(t / 2), 0, 0, Math.cos(t / 2)] };
}
const MAX_HOLES = 40, FLASH_SECONDS = 0.06, TRIGGER_POSE_SECONDS = 0.15, UP = new THREE.Vector3(0, 1, 0);
// Holstered: muzzle down with a slight rearward cant, so the handle sits up and back where the hand finds it.
const HOLSTERED = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 - 0.3, 0, 0));

function buildModel() {
  const root = new THREE.Group(); root.name = 'pistol';
  const recoil = new THREE.Group(); root.add(recoil);
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b2d30, metalness: 0.7, roughness: 0.38 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151617, metalness: 0.3, roughness: 0.7 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x3a2b22, metalness: 0.05, roughness: 0.85 });
  const box = (size, material, position) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...size), material); m.position.fromArray(position);
    m.castShadow = true; recoil.add(m); return m;
  };
  box([0.03, 0.03, 0.2], metal, [0, 0.074, -0.094]);   // slide
  box([0.026, 0.024, 0.16], dark, [0, 0.046, -0.07]);  // frame
  const shape = new THREE.Shape(); // handle profile in (z, y), as Nightfall's curved grip
  [[-0.023, 0.034], [-0.018, -0.01], [-0.009, -0.08], [0.004, -0.092], [0.034, -0.086], [0.033, -0.054], [0.026, 0.034]]
    .forEach(([z, y], i) => i ? shape.lineTo(z, y) : shape.moveTo(z, y));
  const handle = new THREE.ExtrudeGeometry(shape, { depth: 0.028, bevelEnabled: false });
  handle.rotateY(-Math.PI / 2); handle.translate(0.014, 0, 0);
  const handleMesh = new THREE.Mesh(handle, grip); handleMesh.castShadow = true; recoil.add(handleMesh);
  box([0.006, 0.004, 0.05], dark, [0, 0.008, -0.045]);  // trigger guard
  box([0.005, 0.02, 0.006], metal, [0, 0.024, -0.034]); // trigger
  box([0.022, 0.02, 0.05], dark, [0, 0.022, -0.125]);   // laser module
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.004, 12), new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false }));
  lens.position.set(0, 0.022, -0.1505); lens.rotation.y = Math.PI; recoil.add(lens);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.074, -0.196); recoil.add(muzzle);
  const laser = new THREE.Object3D(); laser.position.set(0, 0.022, -0.151); recoil.add(laser);
  const flash = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.07, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.035),
    new THREE.MeshBasicMaterial({ color: 0xffc46a, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
  flash.visible = false; muzzle.add(flash); // no muzzle light: one more light recompiles and slows every lit shader
  root.traverse(o => { if (o.isMesh && o !== flash) o.userData.pistol = true; });
  return { root, recoil, muzzle, laser, flash };
}

/** Bang: a filtered noise crack over a falling low thump. Lazily creates its AudioContext (a trigger press unlocks it). */
function createBang() {
  let ctx = null, noise = null;
  return () => {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext; if (!AC) return;
    try {
      ctx ??= new AC(); if (ctx.state === 'suspended') ctx.resume();
      if (!noise) {
        noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.3), ctx.sampleRate);
        const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.045));
      }
      const t = ctx.currentTime, out = ctx.createGain(); out.gain.value = 0.55; out.connect(ctx.destination);
      const crack = ctx.createBufferSource(); crack.buffer = noise;
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.setValueAtTime(5200, t); filter.frequency.exponentialRampToValueAtTime(700, t + 0.25);
      crack.connect(filter).connect(out); crack.start(t);
      const thump = ctx.createOscillator(), g = ctx.createGain();
      thump.frequency.setValueAtTime(140, t); thump.frequency.exponentialRampToValueAtTime(45, t + 0.18);
      g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      thump.connect(g).connect(out); thump.start(t); thump.stop(t + 0.22);
    } catch { /* audio is optional */ }
  };
}

/**
 * The holster frame on the right hip from the head (world): the head's yaw, smoothed so a glance does not swing it, and
 * HIP_DROP below the eyes. Returns a function (dt) -> { position, quaternion } (reused objects).
 */
export function createHolsterFrame(head) {
  const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), eye = new THREE.Vector3(), forward = new THREE.Vector3();
  let yaw = null;
  return dt => {
    head.updateWorldMatrix(true, false);
    head.getWorldPosition(eye); head.getWorldDirection(forward);
    const target = Math.hypot(forward.x, forward.z) > 1e-3 ? Math.atan2(-forward.x, -forward.z) : yaw ?? 0;
    if (yaw === null || !(dt > 0)) yaw = target;
    else yaw += Math.atan2(Math.sin(target - yaw), Math.cos(target - yaw)) * Math.min(1, dt * HOLSTER_FOLLOW);
    quaternion.setFromAxisAngle(UP, yaw);
    position.set(...HOLSTER_OFFSET).applyQuaternion(quaternion).add(eye);
    position.y = Math.max(eye.y - HIP_DROP, eye.y * 0.45);
    return { position, quaternion };
  };
}

function buildHolster() {
  const group = new THREE.Group(); group.name = 'pistol-holster';
  const inner = new THREE.Group(); inner.quaternion.copy(HOLSTERED); group.add(inner);
  const leather = new THREE.MeshStandardMaterial({ color: 0x4a2f1c, roughness: 0.8 });
  const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.06, 0.19), leather); sleeve.position.set(0, 0.062, -0.105); // around slide + frame
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.035), leather); strap.position.set(0, 0.095, -0.03);
  inner.add(sleeve, strap);
  group.traverse(o => { if (o.isMesh) { o.userData.pistol = true; o.castShadow = true; } });
  return group;
}

/**
 * scene; head: the camera (the holster rides on the right hip under it); targets(): meshes the laser and bullet holes can
 * land on (room, bottles, panes); surfaces(): what a dropped pistol lands on. onReturn(): called when a dropped pistol
 * goes back into the holster by itself. state: 'holstered' | 'held' | 'falling' | 'dropped'; owner: XR controller index
 * or 'desktop' while held.
 */
export function createPistol({ scene, head, targets = () => [], surfaces = targets, sound = createBang(), onReturn = () => {}, returnSeconds = RETURN_SECONDS, gunPitchDeg = GUN_PITCH_DEG }) {
  const model = buildModel(), { root, recoil, muzzle, laser, flash } = model;
  const raycaster = new THREE.Raycaster();
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.5),
    new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false }));
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0065, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3a24, toneMapped: false }));
  beam.name = 'pistol-laser'; dot.name = 'pistol-laser-dot'; beam.visible = dot.visible = false; beam.frustumCulled = false;
  const holeGeometry = new THREE.CircleGeometry(0.007, 10), holeMaterial = new THREE.MeshBasicMaterial({ color: 0x111111, polygonOffset: true, polygonOffsetFactor: -2 });
  const holes = new THREE.Group(); holes.name = 'bullet-holes';
  const holster = buildHolster(), holsterFrame = createHolsterFrame(head);
  scene.add(beam, dot, holes, holster);
  let flashFor = 0, kick = 0, triggerFor = 0, state = 'holstered', lostFor = 0;
  const velocity = new THREE.Vector3(), spin = new THREE.Quaternion();
  const v = new THREE.Vector3(), q = new THREE.Quaternion();

  function followHolster(dt) {
    const { position, quaternion } = holsterFrame(dt);
    holster.position.copy(position); holster.quaternion.copy(quaternion); holster.updateMatrixWorld(true);
    if (state !== 'holstered') return;
    if (root.parent !== scene) scene.add(root);
    root.position.copy(position); root.quaternion.copy(quaternion).multiply(HOLSTERED); root.updateMatrixWorld(true);
  }

  function quiet() { beam.visible = dot.visible = false; flash.visible = false; kick = 0; recoil.rotation.x = 0; recoil.position.z = 0; }

  /** Falling under gravity until the swept segment meets a surface; it then lies on its side there. */
  function fall(dt) {
    const from = root.position.clone();
    velocity.y -= 9.81 * dt;
    const step = velocity.clone().multiplyScalar(dt), length = step.length();
    if (length > 1e-6) {
      raycaster.set(from, step.clone().divideScalar(length)); raycaster.far = length + 0.02;
      const hit = raycaster.intersectObjects(surfaces(), false).find(h => !h.object.userData.pistol && !h.object.userData.bottle);
      if (hit) {
        const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : UP.clone();
        const yaw = new THREE.Euler().setFromQuaternion(root.quaternion, 'YXZ').y;
        root.position.copy(hit.point).addScaledVector(normal, 0.016);
        root.quaternion.setFromUnitVectors(UP, normal).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, Math.PI / 2, 'YXZ')));
        state = 'dropped'; velocity.set(0, 0, 0); return;
      }
    }
    root.position.add(step);
    root.quaternion.premultiply(spin).normalize(); // a slow tumble so it does not fall like a rigid bracket
    if (root.position.y < -5) { state = 'dropped'; lostFor = returnSeconds; } // fell out of the room: straight back
  }

  /** First room/bottle/pane hit along a ray (world), or null. */
  function cast(origin, direction, far = LASER_RANGE) {
    raycaster.set(origin, direction); raycaster.far = far;
    return raycaster.intersectObjects(targets(), false).find(h => h.object.visible && !h.object.userData.pistol && !h.object.name.startsWith('Liquid')) || null;
  }

  const api = {
    root, muzzle, holster, owner: null, shots: 0,
    get state() { return state; },
    get holes() { return holes.children.length; },
    /** Seconds until a dropped pistol is back in the holster (0 unless it is lying or falling). */
    get returnIn() { return state === 'falling' || state === 'dropped' ? Math.max(0, returnSeconds - lostFor) : 0; },
    /** World pose of the grip frame (the fist): { pos, quat } arrays. */
    gripPose() {
      root.updateWorldMatrix(true, false);
      return { pos: root.getWorldPosition(v).toArray(), quat: root.getWorldQuaternion(q).toArray() };
    },
    /** The grip point in world space (for reach checks). */
    gripPoint(out = new THREE.Vector3()) { root.updateWorldMatrix(true, false); return root.getWorldPosition(out); },
    /** The holster's grip point (world); a held pistol let go within HOLSTER_REACH of it is holstered. */
    holsterPoint(out = new THREE.Vector3()) { holster.updateWorldMatrix(true, false); return holster.getWorldPosition(out); },
    /** How close a squeeze must be to take it: the holster (out of sight) is a little more forgiving than the floor. */
    get reach() { return state === 'holstered' ? HOLSTER_REACH : REACH; },
    /** True for the trigger finger pose shortly after a shot. */
    get firing() { return triggerFor > 0; },
    /** Takes the pistol: parent is the XR grip (owner = index) or the camera ('desktop'). */
    take(owner, parent) {
      api.owner = owner; state = 'held'; lostFor = 0; velocity.set(0, 0, 0); parent.add(root);
      if (owner === 'desktop') { root.position.fromArray(DESKTOP_OFFSET); root.quaternion.identity(); return; }
      const local = heldGunLocal(gunPitchDeg); root.position.fromArray(local.position); root.quaternion.fromArray(local.quaternion);
    },
    /** Into the holster (let go at the hip, desktop Q, a reset, the session ending). */
    holster() { api.owner = null; state = 'holstered'; lostFor = 0; quiet(); scene.add(root); followHolster(0); },
    /** Let go away from the holster: it falls from where it is with the hand's `throwVelocity` and returns after returnSeconds. */
    drop(throwVelocity = new THREE.Vector3()) {
      root.updateWorldMatrix(true, false);
      const p = root.getWorldPosition(new THREE.Vector3()), r = root.getWorldQuaternion(new THREE.Quaternion());
      api.owner = null; state = 'falling'; lostFor = 0; quiet();
      scene.add(root); root.position.copy(p); root.quaternion.copy(r);
      velocity.copy(throwVelocity).clampLength(0, 8);
      spin.setFromAxisAngle(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), 0.08);
    },
    /** The muzzle ray in world space. */
    ray() {
      root.updateWorldMatrix(true, true);
      return { origin: muzzle.getWorldPosition(new THREE.Vector3()), direction: new THREE.Vector3(0, 0, -1).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())).normalize() };
    },
    cast,
    /**
     * Visual + sound of a shot; `hitBreakable` says whether breakage already handled the hit. A miss that meets the room
     * leaves a hole. Returns the room hit (or null).
     */
    fire(origin, direction, hitBreakable) {
      api.shots++; flashFor = FLASH_SECONDS; kick = 1; triggerFor = TRIGGER_POSE_SECONDS;
      flash.visible = true; flash.rotation.z = Math.random() * Math.PI;
      sound();
      if (hitBreakable) return null;
      const hit = cast(origin, direction, 100);
      if (!hit || hit.object.userData.bottle || hit.object.userData.pane || !hit.face) return hit;
      const hole = new THREE.Mesh(holeGeometry, holeMaterial);
      const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      hole.position.copy(hit.point).addScaledVector(normal, 0.0015); hole.lookAt(v.copy(hit.point).add(normal));
      holes.add(hole); while (holes.children.length > MAX_HOLES) holes.remove(holes.children[0]);
      return hit;
    },
    /** Per frame: the holster, a dropped pistol's fall and return, recoil and flash, desktop convergence on `aim`, the laser. */
    update(dt, { aim = null } = {}) {
      followHolster(dt);
      if (state === 'falling' || state === 'dropped') {
        if (state === 'falling') fall(dt);
        lostFor += dt;
        if (lostFor >= returnSeconds) { api.holster(); onReturn(); }
        return;
      }
      flashFor = Math.max(0, flashFor - dt); triggerFor = Math.max(0, triggerFor - dt);
      flash.visible = flashFor > 0;
      kick = Math.max(0, kick - dt * 9); recoil.rotation.x = 0.22 * kick * kick; recoil.position.z = 0.012 * kick;
      if (state !== 'held') { beam.visible = dot.visible = false; return; }
      if (aim && api.owner === 'desktop') {
        root.position.fromArray(DESKTOP_OFFSET); root.updateWorldMatrix(true, false);
        root.lookAt(aim); root.rotateY(Math.PI); // Object3D.lookAt points +Z for non-cameras: the muzzle is -Z
      }
      root.updateWorldMatrix(true, true);
      const origin = laser.getWorldPosition(new THREE.Vector3()), direction = api.ray().direction;
      const hit = cast(origin, direction);
      const length = hit ? hit.distance : LASER_RANGE;
      beam.position.copy(origin); beam.quaternion.copy(root.getWorldQuaternion(q)); beam.scale.set(1, 1, length); beam.visible = true;
      dot.visible = !!hit; if (hit) dot.position.copy(hit.point).addScaledVector(direction, -0.002);
    },
    reset() { holes.clear(); api.holster(); },
    dispose() { quiet(); scene.remove(root, beam, dot, holes, holster); },
  };
  api.holster();
  return api;
}
