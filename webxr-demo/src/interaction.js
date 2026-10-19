import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { createBodyHeight, browserStorage } from './vendor/extensions/avatar/body_height.js';
import { createCapGesture, nearCap } from './vendor/extensions/bottles/cap_gesture.js';
import { HOLSTER_REACH } from './pistol.js';

const Y = new THREE.Vector3(0, 1, 0);
/** Desktop eye height (m). The avatar auto-calibrates its size from it, so it should be a plausible standing eye. */
export const DESKTOP_EYE = 1.6;
/** An XR hold is dropped when its controller/hand has had no pose for this long (tracking lost without 'disconnected'). */
export const LOST_RELEASE_SECONDS = 0.25;

/**
 * Bottle pose tilted about the hand's grip point instead of the bottle centre (grab_findings 1.6): the wrist stays put
 * and the bottle turns in it. base0/q0: untilted pose (base-centre origin), wrist: grasp wrist in bottle space.
 */
export function tiltAboutGrip(base0, q0, wrist, axis, angle) {
  const grip = new THREE.Vector3(...wrist).applyQuaternion(q0).add(base0);
  const quaternion = new THREE.Quaternion().setFromAxisAngle(axis, angle).multiply(q0);
  return { position: grip.sub(new THREE.Vector3(...wrist).applyQuaternion(quaternion)), quaternion };
}

export class Interaction {
  constructor({ renderer, scene, camera, rig, factory, physics, breakage, actions, hud, host = null, pistol = null }) {
    Object.assign(this, { renderer, scene, camera, rig, factory, physics, breakage, actions, hud, host, pistol });
    this.keys = new Set();
    this.raycaster = new THREE.Raycaster();
    this.held = new Map();
    this.tilt = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.paused = false;
    this.uiTargets = [];
    this.xrControllers = [];
    this.snapReady = true;
    this.avatarModels = false; // whether the generic controller models are hidden for the avatar's hands
    this.caps = new Map(); // owner -> { bottle, gesture, meshes } while that hand grips a cap (bottles cap_gesture.js)
    // XR body height (avatar body_height.js): right stick Y crouches (Boneworks hold-height), a seated first calibration
    // lifts the rig to the standing reference so a seated player's avatar keeps its full reach. ?posture=standing|seated
    // skips the automatic choice.
    const posture = typeof location === 'object' ? new URLSearchParams(location.search).get('posture') : null;
    this.body = createBodyHeight({ storage: browserStorage(), posture: ['standing', 'seated'].includes(posture) ? posture : null });
    this.bodyOffset = 0; // the part of rig.position.y that is body height (removed again when the session ends)
    this.body.onChange(({ reason, posture }) => {
      if (reason === 'calibrated' && posture === 'seated') this.hud?.('Siddende: kroppen vises stående');
      else if (reason === 'stood-up') this.hud?.('Stående: måler højden igen');
    });
    this._makeXRUI();
    this._bindDesktop();
    this._bindXR();
  }

  _bindDesktop() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('click', () => {
      if (this.renderer.xr.isPresenting) return;
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
      else this.shoot('desktop');
    });
    canvas.addEventListener('contextmenu', e => { e.preventDefault(); if (!this.renderer.xr.isPresenting) this.throw('desktop'); });
    window.addEventListener('mousemove', e => {
      if (document.pointerLockElement !== canvas || this.renderer.xr.isPresenting) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0022, -1.45, 1.45);
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    });
    canvas.addEventListener('wheel', e => { if (this.held.has('desktop')) { this.tilt += Math.sign(e.deltaY) * 0.1; e.preventDefault(); } }, { passive: false });
    window.addEventListener('keydown', e => {
      if (e.repeat || e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement) return;
      this.keys.add(e.code);
      if (e.code === 'KeyG') this.toggleGrab('desktop');
      if (e.code === 'KeyU') this.toggleCap('desktop');
      if (e.code === 'KeyQ') this.togglePistol('desktop');
      if (e.code === 'KeyE') this.throw('desktop');
      if (e.code === 'KeyR') this.actions.reset();
      if (e.code === 'KeyP') this.actions.pause();
      if (/^Digit[1-4]$/.test(e.code)) this.actions.quality(Number(e.code.slice(-1)) - 1);
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) this.keys.clear(); });
  }

  _bindXR() {
    const controllerFactory = new XRControllerModelFactory();
    const handFactory = new XRHandModelFactory();
    for (let i = 0; i < 2; i++) {
      const pointer = this.renderer.xr.getController(i);
      const grip = this.renderer.xr.getControllerGrip(i);
      const model = controllerFactory.createControllerModel(grip);
      grip.add(model);
      this.rig.add(pointer, grip);
      const hand = this.renderer.xr.getHand(i);
      hand.add(handFactory.createHandModel(hand, 'mesh'));
      this.rig.add(hand);
      const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1.2)]), new THREE.LineBasicMaterial({ color: 0xffd091, transparent: true, opacity: 0.7 }));
      pointer.add(ray);
      const entry = { pointer, grip, hand, ray, model, index: i, handedness: null, isHand: false, lostFor: 0 };
      this.xrControllers.push(entry);
      pointer.addEventListener('connected', event => this._onConnected(i, event.data));
      pointer.addEventListener('disconnected', () => this._onDisconnected(i));
      pointer.addEventListener('squeezestart', () => this.toggleGrab(i));
      pointer.addEventListener('squeezeend', () => this.release(i));
      pointer.addEventListener('selectstart', event => {
        const input = event.data;
        if (input?.hand) this.toggleGrab(i);
        else this.shoot(i);
      });
    }
    this.renderer.xr.addEventListener('sessionstart', () => { this.body.reset(); this._applyBodyOffset(0); });
    this.renderer.xr.addEventListener('sessionend', () => { this.releaseAll(); this._applyBodyOffset(0); this.restoreDesktop(); });
  }

  /** Moves the rig so its height above the walked-on floor carries the body-height offset (seated lift, stick crouch). */
  _applyBodyOffset(offset) {
    this.rig.position.y += offset - this.bodyOffset;
    this.bodyOffset = offset;
  }

  /** Feeds the tracked head (rig-local eye height and gaze) to the body height, then applies its offset. */
  _updateBody(dt) {
    const head = this.camera;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(head.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(head.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(head.quaternion);
    this.body.observe(head.position.y, dt, { pitch: Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1)), roll: Math.atan2(right.y, up.y) });
    this._applyBodyOffset(this.body.originOffset());
  }

  _emit(event, data) { this.host?.emit(event, data); }

  /** The avatar extension's api while it is loaded and not switched off by quality, else null. */
  get avatar() {
    const a = this.host?.get('avatar');
    return a?.active ? a : null;
  }

  /** source: the XRInputSource. Extensions hear when an input switches between controller and tracked hand. */
  _onConnected(i, source) {
    const entry = this.xrControllers[i];
    entry.handedness = source?.handedness || null; entry.lostFor = 0; entry.source = source || null;
    const isHand = !!source?.hand;
    if (isHand !== entry.isHand) { entry.isHand = isHand; this._emit('handTrackingChanged', { owner: i, handedness: entry.handedness, hand: isHand }); }
  }

  /**
   * Controller gone (or switched to hand tracking): drop what it held where it is, then forget its handedness.
   * Pinch holds never get a squeezeend, so without this the bottle would hang kinematic in the air (grab_findings 1.2).
   */
  _onDisconnected(i) {
    const entry = this.xrControllers[i];
    this.release(i, 0, true);
    this._emit('disconnect', { owner: i, handedness: entry.handedness });
    entry.handedness = null; entry.lostFor = 0;
  }

  /** XR holds whose controller/hand has had no pose for LOST_RELEASE_SECONDS are dropped in place. */
  _checkTracking(dt) {
    for (const owner of new Set([...this.held.keys(), ...this.caps.keys(), ...(this.pistol?.owner != null ? [this.pistol.owner] : [])])) {
      if (owner === 'desktop') continue;
      const c = this.xrControllers[owner]; if (!c) continue;
      c.lostFor = c.pointer.visible ? 0 : c.lostFor + dt;
      if (c.lostFor > LOST_RELEASE_SECONDS) this.release(owner, 0, true);
    }
  }

  /** After XR: fold snap turns into the desktop yaw and put the camera back at the desktop eye (grab_findings 1.9). */
  restoreDesktop() {
    this.yaw += this.rig.rotation.y; this.rig.rotation.y = 0;
    this.camera.position.set(0, DESKTOP_EYE, 0);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  _label(text, width = 0.34) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#263b40'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#a8bdba'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, 504, 120);
    ctx.fillStyle = '#fff1d5'; ctx.font = 'bold 54px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 64);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide, transparent: true }));
    return m;
  }

  _makeXRUI() {
    const panel = new THREE.Group(); panel.position.set(0, 1.85, 0.95);
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.13, 0.3), new THREE.MeshBasicMaterial({ color: 0x162529, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    panel.add(bg);
    const controls = [['Nulstil', () => this.actions.reset(), -0.36], ['Kvalitet', () => this.actions.quality((this.factory.quality + 1) % 4), 0.18]];
    for (const [label, action, x] of controls) {
      const mesh = this._label(label, 0.42); mesh.position.set(x, 0, 0.01); mesh.userData.action = action; panel.add(mesh); this.uiTargets.push(mesh);
    }
    this.scene.add(panel);
  }

  _ray(owner) {
    if (owner === 'desktop') {
      const origin = this.camera.getWorldPosition(new THREE.Vector3());
      const direction = this.camera.getWorldDirection(new THREE.Vector3());
      return { origin, direction };
    }
    const c = this.xrControllers[owner]?.pointer;
    if (!c) return null;
    return { origin: c.getWorldPosition(new THREE.Vector3()), direction: new THREE.Vector3(0, 0, -1).applyQuaternion(c.getWorldQuaternion(new THREE.Quaternion())) };
  }

  pick(owner, maxDistance = 3) {
    const ray = this._ray(owner); if (!ray) return null;
    this.raycaster.set(ray.origin, ray.direction); this.raycaster.far = maxDistance;
    const objects = [...this.uiTargets];
    for (const b of this.factory.bottles) b.root.traverse(o => { if (o.isMesh && !o.name.startsWith('Liquid')) objects.push(o); });
    if (this.pistol && this.pistol.owner == null) this.pistol.root.traverse(o => { if (o.userData.pistol) objects.push(o); });
    return this.raycaster.intersectObjects(objects, false)[0] || null;
  }

  toggleGrab(owner) {
    if (this.held.has(owner)) { this.release(owner); return; }
    if (this.pistol?.owner === owner) { this._letGoPistol(owner); return; } // desktop G toggles
    if (owner !== 'desktop' && this._gripCap(owner)) return;
    if (owner !== 'desktop' && this._pistolInReach(owner)) { this._takePistol(owner); return; }
    const hit = this.pick(owner);
    if (hit?.object.userData.action) { hit.object.userData.action(); return; }
    if (hit?.object.userData.pistol) { this._takePistol(owner); return; }
    const b = hit?.object.userData.bottle;
    if (!b || b.broken || [...this.held.values()].some(x => x.bottle === b)) return;
    const hold = { bottle: b, last: b.root.position.clone(), velocity: new THREE.Vector3() };
    this.held.set(owner, hold);
    this._emit('grab', { owner, bottle: b, side: owner === 'desktop' ? 'right' : this.xrControllers[owner]?.handedness || null });
    if (owner === 'desktop') this.tilt = 0;
    this.hud(`Holder ${b.design || b.id}`);
  }

  /** Forget a hold without touching physics; every hand (avatar) lets go through the 'release' event. */
  _dropHold(owner) {
    const h = this.held.get(owner); if (!h) return null;
    this.held.delete(owner);
    this._emit('release', { owner, bottle: h.bottle });
    return h;
  }

  /** still: drop in place with zero velocity (disconnect, lost tracking) instead of the hand's motion. */
  release(owner, throwSpeed = 0, still = false) {
    this._endCap(owner);
    if (this.pistol?.owner === owner) this._letGoPistol(owner, still);
    const h = this._dropHold(owner); if (!h) return;
    const ray = this._ray(owner);
    const velocity = still ? new THREE.Vector3() : h.velocity.clone().clampLength(0, 4);
    if (throwSpeed && ray) velocity.copy(ray.direction).multiplyScalar(throwSpeed).addScaledVector(Y, 1);
    this.physics.release(h.bottle.entry, velocity);
  }

  /** A bottle broke or was removed: whoever held it lets go (no physics, the body is gone). grab_findings 1.1. */
  dropBottle(bottle) {
    for (const [owner, h] of [...this.held]) if (h.bottle === bottle) this._dropHold(owner);
    for (const [owner, c] of [...this.caps]) if (c.bottle === bottle) this._endCap(owner);
  }

  // Caps in XR (Godot bottle_cap.gd): one hand holds the bottle, the free hand squeezes at the cap and twists + pulls it
  // off (a cork: pulls straight). Squeezing at the mouth of an open bottle puts the cap back.
  /** The bottle's unscaled frame (base origin, +Y up the neck) as a matrix. */
  _bottleFrame(b, out = new THREE.Matrix4()) {
    b.root.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    b.root.matrixWorld.decompose(p, q, new THREE.Vector3());
    return out.compose(p, q, new THREE.Vector3(1, 1, 1));
  }

  /** Cap meshes and the cap centre in the bottle frame, or null for a bottle without a removable cap. */
  _capOf(b) {
    if (b.capInfo !== undefined) return b.capInfo;
    const meshes = [];
    b.root.traverse(o => { if (o.isMesh && o.name.startsWith('Cap')) meshes.push(o); });
    if (!meshes.length || b.setOpen === undefined) return (b.capInfo = null);
    const box = new THREE.Box3();
    for (const m of meshes) box.expandByObject(m);
    const center = box.getCenter(new THREE.Vector3()).applyMatrix4(this._bottleFrame(b).invert());
    return (b.capInfo = { meshes, center: center.toArray() });
  }

  /** The XR owner's grip pose in the bottle's frame. */
  _handInBottle(owner, b) {
    const grip = this.xrControllers[owner]?.grip; if (!grip) return null;
    grip.updateWorldMatrix(true, false);
    const m = this._bottleFrame(b).invert().multiply(grip.matrixWorld);
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    m.decompose(p, q, new THREE.Vector3());
    return { pos: p.toArray(), quat: q.toArray() };
  }

  _gripCap(owner) {
    for (const [other, h] of this.held) {
      const b = h.bottle, cap = other !== owner && !b.broken ? this._capOf(b) : null;
      const hand = cap && this._handInBottle(owner, b);
      if (!hand || !nearCap(hand.pos, cap.center)) continue;
      if (b.open) { b.setOpen(false); this.hud(b.open ? 'Kan ikke lukkes' : 'Lukket'); this._pulse(owner, 0.4, 40); return true; }
      const gesture = createCapGesture({ cap: cap.center });
      if (gesture.begin(hand).status !== 'active') return false;
      const meshes = cap.meshes.map(o => ({ o, position: o.position.clone(), quaternion: o.quaternion.clone() }));
      this.caps.set(owner, { bottle: b, gesture, meshes, support: other });
      this.hud('Drej og træk proppen af');
      this._pulse(owner, 0.25, 30);
      return true;
    }
    return false;
  }

  _endCap(owner) {
    const c = this.caps.get(owner); if (!c) return;
    this.caps.delete(owner);
    for (const { o, position, quaternion } of c.meshes) { o.position.copy(position); o.quaternion.copy(quaternion); }
  }

  _updateCaps(dt) {
    for (const [owner, c] of [...this.caps]) {
      const b = c.bottle;
      if (b.broken || this.held.get(c.support)?.bottle !== b) { this._endCap(owner); continue; } // support hand let go
      const state = c.gesture.update(this._handInBottle(owner, b), dt);
      if (state.status === 'opened') {
        this._endCap(owner); b.setOpen(true); this.hud('Åben'); this._pulse(owner, 0.8, 60); continue;
      }
      if (state.status === 'cancelled') { this._endCap(owner); if (state.reason === 'misaligned_or_withdrawn') this.hud('Proppen slap'); continue; }
      // Small visual twist/lift about the neck axis while gripped.
      const { twist, lift } = c.gesture.preview(), center = new THREE.Vector3(...this._capOf(b).center);
      const motion = new THREE.Matrix4().makeTranslation(center.x, center.y + lift, center.z)
        .multiply(new THREE.Matrix4().makeRotationY(twist)).multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
      const frame = this._bottleFrame(b), toWorld = frame.clone().multiply(motion).multiply(frame.clone().invert());
      for (const { o, position, quaternion } of c.meshes) {
        o.position.copy(position); o.quaternion.copy(quaternion); o.updateWorldMatrix(true, false);
        const world = toWorld.clone().multiply(o.matrixWorld), local = o.parent.matrixWorld.clone().invert().multiply(world);
        local.decompose(o.position, o.quaternion, new THREE.Vector3());
      }
    }
  }

  _pulse(owner, strength, ms) {
    try { this.xrControllers[owner]?.source?.gamepad?.hapticActuators?.[0]?.pulse?.(strength, ms)?.catch?.(() => {}); } catch { /* optional */ }
  }

  // The pistol (pistol.js) rides in a holster on the right hip. A squeeze at the holster (or at a dropped pistol, or
  // pointing at it) takes it; letting go at the hip holsters it, anywhere else drops it and it comes back by itself.
  _pistolInReach(owner) {
    const grip = this.xrControllers[owner]?.grip; if (!this.pistol || this.pistol.owner != null || !grip) return false;
    return grip.getWorldPosition(new THREE.Vector3()).distanceTo(this.pistol.gripPoint()) <= this.pistol.reach;
  }

  _takePistol(owner) {
    if (!this.pistol || this.pistol.owner != null) return;
    this.pistol.take(owner, owner === 'desktop' ? this.camera : this.xrControllers[owner].grip);
    this.pistolTrack = null;
    this._emit('pistol', { owner, held: true, side: owner === 'desktop' ? 'right' : this.xrControllers[owner]?.handedness || null });
    this.hud('Pistol: aftrækker skyder');
    this._pulse(owner, 0.3, 30);
  }

  /** Into the holster (desktop, reset, pause, session end) or, for an XR hand away from the hip, a drop. */
  _letGoPistol(owner, still = false) {
    if (owner == null || this.pistol?.owner !== owner) return;
    const grip = owner === 'desktop' ? null : this.xrControllers[owner]?.grip;
    const atHip = !grip || grip.getWorldPosition(new THREE.Vector3()).distanceTo(this.pistol.holsterPoint()) <= HOLSTER_REACH;
    if (atHip) { this.pistol.holster(); this._emit('pistol', { owner, held: false, state: 'holstered' }); return; }
    this.pistol.drop(still || !this.pistolTrack ? new THREE.Vector3() : this.pistolTrack.velocity.clone());
    this.pistolTrack = null;
    this._emit('pistol', { owner, held: false, state: 'dropped' });
    this.hud('Pistolen er tabt: tilbage i hylsteret om 20 s');
  }

  _holsterPistol() {
    const owner = this.pistol?.owner; if (owner == null) return;
    this.pistol.holster();
    this._emit('pistol', { owner, held: false, state: 'holstered' });
  }

  /** Desktop Q: draw from the holster (or pick a dropped one up), or holster it. */
  togglePistol(owner) {
    if (!this.pistol) return;
    if (this.pistol.owner === owner) this._holsterPistol();
    else if (this.pistol.owner == null && !this.held.has(owner)) this._takePistol(owner);
  }

  /** XR hand velocity while the pistol is held, for a throw when it is dropped. */
  _trackPistolHand(dt) {
    const owner = this.pistol?.owner, grip = owner == null || owner === 'desktop' ? null : this.xrControllers[owner]?.grip;
    if (!grip || !(dt > 0)) return;
    const p = grip.getWorldPosition(new THREE.Vector3());
    if (!this.pistolTrack) this.pistolTrack = { last: p, velocity: new THREE.Vector3() };
    else { this.pistolTrack.velocity.copy(p).sub(this.pistolTrack.last).divideScalar(Math.max(dt, 1 / 120)); this.pistolTrack.last.copy(p); }
  }

  releaseAll() { this._holsterPistol(); for (const owner of [...this.caps.keys()]) this._endCap(owner); for (const owner of [...this.held.keys()]) this.release(owner); }

  throw(owner) {
    if (this.held.has(owner)) this.release(owner, 10);
    else this.shoot(owner);
  }

  toggleCap(owner) {
    const b = this.held.get(owner)?.bottle || this.pick(owner)?.object.userData.bottle;
    if (b) { b.setOpen(!b.open); this.hud(b.open ? 'Åben' : 'Lukket'); }
  }

  shoot(owner) {
    if (this.pistol?.owner === owner) { this._shootPistol(owner); return; }
    const hit = this.pick(owner, 3);
    if (hit?.object.userData.action) { hit.object.userData.action(); return; }
    const ray = this._ray(owner); if (!ray) return;
    const impact = this.breakage.shoot(ray.origin, ray.direction);
    if (impact) this.hud(impact.object.userData.pane ? 'Rude knust' : 'Træffer');
    this._emit('shot', { owner, origin: ray.origin.clone(), direction: ray.direction.clone(), hit: !!impact });
  }

  /** XR: along the barrel. Desktop: along the view (the pistol converges on the crosshair). */
  _shootPistol(owner) {
    const ray = owner === 'desktop' ? this._ray(owner) : this.pistol.ray();
    const impact = this.breakage.shoot(ray.origin, ray.direction);
    this.pistol.fire(ray.origin, ray.direction, !!impact);
    if (impact) this.hud(impact.object.userData.pane ? 'Rude knust' : 'Træffer');
    this._pulse(owner, 0.9, 45);
    this._emit('shot', { owner, origin: ray.origin.clone(), direction: ray.direction.clone(), hit: !!impact, pistol: true });
  }

  step(dt) {
    const avatar = this.avatar;
    if (this.avatarModels !== !!avatar) { // the avatar draws controller hands; generic models come back when it is off/gone
      this.avatarModels = !!avatar;
      for (const c of this.xrControllers) c.model.visible = !avatar; // tracked hands keep their own mesh
    }
    if (this.pistol) {
      // The pistol hand: no pointer ray and no controller model (the pistol is in the hand); desktop aims at the crosshair.
      for (const c of this.xrControllers) { const gun = this.pistol.owner === c.index; c.ray.visible = !gun; c.model.visible = !avatar && !gun; }
      let aim = null;
      if (this.pistol.owner === 'desktop') {
        const ray = this._ray('desktop'), hit = this.pistol.cast(ray.origin, ray.direction);
        aim = hit ? hit.point : ray.origin.clone().addScaledVector(ray.direction, 20);
      }
      this._trackPistolHand(dt);
      this.pistol.update(dt, { aim });
    }
    if (!this.renderer.xr.isPresenting) this._desktopMove(dt);
    else { this._xrMove(dt); this._updateBody(dt); this._checkTracking(dt); this._updateCaps(dt); }
    for (const [owner, h] of [...this.held]) {
      if (!this.factory.bottles.has(h.bottle)) { this._dropHold(owner); continue; }
      const ray = this._ray(owner); if (!ray) continue;
      const b = h.bottle;
      let target;
      if (owner === 'desktop') {
        const q0 = this.camera.getWorldQuaternion(new THREE.Quaternion());
        // With the avatar the bottle is held where the right arm can reach it (a little closer and to the right).
        const centre = avatar
          ? ray.origin.clone().addScaledVector(ray.direction, 0.46).add(new THREE.Vector3(0.1, 0, 0).applyQuaternion(q0)).add(new THREE.Vector3(0, -0.1, 0))
          : ray.origin.clone().addScaledVector(ray.direction, 0.68).add(new THREE.Vector3(0, -0.1, 0));
        const grasp = avatar?.graspOf(owner);
        // With a hand on the bottle, tilting turns it about the grip so the wrist rotates instead of orbiting.
        if (grasp) target = tiltAboutGrip(centre.sub(new THREE.Vector3(0, b.height * 0.5, 0).applyQuaternion(q0)), q0, grasp.wrist, ray.direction, this.tilt);
        else {
          const q = q0.premultiply(new THREE.Quaternion().setFromAxisAngle(ray.direction, this.tilt));
          target = { position: centre.sub(new THREE.Vector3(0, b.height * 0.5, 0).applyQuaternion(q)), quaternion: q };
        }
      } else {
        const q = this.xrControllers[owner].pointer.getWorldQuaternion(new THREE.Quaternion());
        const centre = ray.origin.clone().addScaledVector(ray.direction, 0.08);
        target = { position: centre.sub(new THREE.Vector3(0, b.height * 0.5, 0).applyQuaternion(q)), quaternion: q };
      }
      // With the avatar the bottle settles into the visible hand's baked grasp instead of floating at the controller.
      if (avatar) target = avatar.holdPose(owner, target, dt, avatar.trackedWrist(owner));
      const base = target.position;
      h.velocity.copy(base).sub(h.last).divideScalar(Math.max(dt, 1 / 120));
      h.last.copy(base);
      this.physics.hold(b.entry, { position: base, quaternion: target.quaternion });
    }
  }

  _desktopMove(dt) {
    if (document.pointerLockElement !== this.renderer.domElement) return;
    const v = new THREE.Vector3();
    if (this.keys.has('KeyW')) v.z -= 1; if (this.keys.has('KeyS')) v.z += 1;
    if (this.keys.has('KeyA')) v.x -= 1; if (this.keys.has('KeyD')) v.x += 1;
    if (this.keys.has('Space')) v.y += 1; if (this.keys.has('KeyC')) v.y -= 1;
    v.normalize().multiplyScalar(dt * (this.keys.has('ShiftLeft') ? 4 : 1.8));
    v.applyAxisAngle(Y, this.yaw);
    this.rig.position.add(v);
    this.rig.position.y = Math.max(-0.7, Math.min(2, this.rig.position.y));
    if (this.keys.has('KeyZ')) this.tilt += dt * 1.5;
    if (this.keys.has('KeyX')) this.tilt -= dt * 1.5;
  }

  _xrMove(dt) {
    const session = this.renderer.xr.getSession(); if (!session) return;
    for (const source of session.inputSources) {
      const axes = source.gamepad?.axes;
      if (!axes || axes.length < 2) continue;
      const x = axes.length >= 4 ? axes[2] : axes[0];
      const y = axes.length >= 4 ? axes[3] : axes[1];
      if (source.handedness === 'left') {
        const fwd = this.camera.getWorldDirection(new THREE.Vector3()); fwd.y = 0; fwd.normalize();
        const right = new THREE.Vector3().crossVectors(fwd, Y).normalize();
        if (Math.abs(x) > 0.2) this.rig.position.addScaledVector(right, x * dt * 1.5);
        if (Math.abs(y) > 0.2) this.rig.position.addScaledVector(fwd, -y * dt * 1.5);
      } else if (source.handedness === 'right') {
        // Stick Y is the crouch; a turn needs X to dominate, so a diagonal crouch never snaps.
        if (this.body.update({ x, y }, dt)) continue;
        if (Math.abs(x) < 0.3) this.snapReady = true;
        if (this.snapReady && Math.abs(x) > 0.75 && Math.abs(x) > Math.abs(y)) {
          this.rig.rotation.y -= Math.sign(x) * Math.PI / 6;
          this.snapReady = false;
        }
      }
    }
  }
}
