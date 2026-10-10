// The bottles' only door to physics: bottle and shard bodies on a host physics adapter (ctx.physics, see
// ../host/physics.js), pose sync to the three.js roots, and impact coalescing. No physics engine is imported here.
//
// A bottle body is a cylinder whose origin is the centre of the model's base (the root's origin); a shard body sits at
// its piece's centre (so it spins about it) and the mesh follows with that offset. Contact reports that arrive after a
// physics step are reduced to the strongest one per bottle and handed to its onImpact after sync(), so callbacks see
// up-to-date poses and may remove bodies.
import * as THREE from 'three';

export const BOTTLE_GROUP = 4, SHARD_GROUP = 2, SHARD_MASK = 1 | 4;
/** Approach speed (m/s) below which a contact is not an impact (the cannon adapter reports from the same speed). */
export const IMPACT_MIN_SPEED = 0.45;

const _offset = new THREE.Vector3(), _q = new THREE.Quaternion();
const fromArray = (v, a) => a ? v.set(a[0], a[1], a[2]) : v;

export class BottleBodies {
  constructor(physics) {
    this.physics = physics;
    this.records = new Map(); // handle -> { root, handle, center, onImpact }
    this.pending = new Map(); // record -> impact snapshot (strongest since the last flush)
    this._pose = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
    this._velocity = { linear: [0, 0, 0], angular: [0, 0, 0] };
    this._offContact = physics.onContact(c => this._contact(c));
  }

  /**
   * Dynamic bottle body at the root's pose. onImpact(speed, impact) gets the coalesced impacts (see _contact).
   * shape / options (optional, from adopt({ body })): the game's own collision shape for this bottle and extra addBody
   * options merged over the defaults (userData is merged too, so surface stays unless the game sets one). The body
   * origin is always the root's origin (centre of the base).
   */
  bottle(root, { radius, height, mass = 0.5, surface = 'bottle', onImpact = null, shape = null, options = null }) {
    const handle = this.physics.addBody(shape ?? { type: 'cylinder', radius, height, segments: 10, offset: [0, height / 2, 0] }, mass,
      { position: root.position, quaternion: root.quaternion },
      { linearDamping: 0.12, angularDamping: 0.18, sleepTimeLimit: 0.6, group: BOTTLE_GROUP, ...options,
        userData: { surface, ...options?.userData } });
    this.records.set(handle, { root, handle, center: null, onImpact });
    return handle;
  }

  /** Debris box: size (Vector3, m), centre of the piece in root space, initial velocity / angular velocity. */
  shard(root, { size, mass, velocity, angularVelocity, center = new THREE.Vector3() }) {
    const offset = center.clone().applyQuaternion(root.quaternion);
    const handle = this.physics.addBody({ type: 'box', size: [Math.max(0.006, size.x), Math.max(0.006, size.y), Math.max(0.006, size.z)] },
      Math.max(0.0002, mass), { position: root.position.clone().add(offset), quaternion: root.quaternion },
      { userData: { surface: 'glass' }, linearDamping: 0.15, angularDamping: 0.25, sleepTimeLimit: 0.5, group: SHARD_GROUP, mask: SHARD_MASK,
        velocity, spin: angularVelocity, contacts: false });
    this.records.set(handle, { root, handle, center: center.clone(), onImpact: null });
    return handle;
  }

  has(handle) { return this.records.has(handle); }

  remove(handle) {
    const record = this.records.get(handle); if (!record) return;
    this.records.delete(handle);
    this.pending.delete(record);
    this.physics.remove(handle);
  }

  setMass(handle, mass) { if (this.records.has(handle)) this.physics.setMass(handle, mass); }
  isHeld(handle) { return this.records.has(handle) && this.physics.isHeld(handle); }

  /** World linear and angular velocity as new Vector3s (zero for unknown handles). */
  velocity(handle) {
    const out = { linear: new THREE.Vector3(), angular: new THREE.Vector3() };
    if (!this.records.has(handle)) return out;
    const v = this.physics.velocity(handle, this._velocity);
    out.linear.fromArray(v.linear); out.angular.fromArray(v.angular);
    return out;
  }

  /** Copy every body pose to its root (shards keep their piece centre on the body). */
  sync() {
    const pose = this._pose;
    for (const r of this.records.values()) {
      this.physics.pose(r.handle, pose);
      r.root.quaternion.fromArray(pose.quaternion);
      if (r.center) {
        _offset.copy(r.center).applyQuaternion(r.root.quaternion);
        r.root.position.set(pose.position[0] - _offset.x, pose.position[1] - _offset.y, pose.position[2] - _offset.z);
      } else r.root.position.fromArray(pose.position);
    }
  }

  /** Hand the strongest impact of each bottle since the last flush to its onImpact; skips bodies removed meanwhile. */
  flushImpacts() {
    if (!this.pending.size) return;
    const batch = [...this.pending];
    this.pending.clear();
    for (const [record, impact] of batch) if (this.records.get(record.handle) === record) record.onImpact(impact.speed, impact);
  }

  /** Plain snapshot: { speed, localPoint, localNormal, point, normal, velocity, angularVelocity, surface, strikerMass }. */
  _contact(c) {
    const record = this.records.get(c.a);
    if (!record?.onImpact || !(c.speed > IMPACT_MIN_SPEED) || c.speed <= (this.pending.get(record)?.speed ?? 0)) return;
    let { localPoint, localNormal, velocity, spin } = c;
    if (!localPoint || !localNormal || !velocity || !spin) { // optional report fields: derive from the body now
      const pose = this.physics.pose(c.a, { position: [0, 0, 0], quaternion: [0, 0, 0, 1] });
      _q.fromArray(pose.quaternion).invert();
      localPoint ??= fromArray(new THREE.Vector3(), c.point).sub(fromArray(_offset, pose.position)).applyQuaternion(_q).toArray();
      localNormal ??= fromArray(new THREE.Vector3(), c.normal).applyQuaternion(_q).toArray();
      if (!velocity || !spin) { const v = this.physics.velocity(c.a, { linear: [0, 0, 0], angular: [0, 0, 0] }); velocity ??= v.linear; spin ??= v.angular; }
    }
    this.pending.set(record, { speed: c.speed, localPoint: [...localPoint], localNormal: [...localNormal], point: [...c.point], normal: [...c.normal],
      velocity: [...velocity], angularVelocity: [...spin], surface: c.surface ?? 'concrete', strikerMass: c.otherMass ?? Infinity });
  }

  /** Remove every body and stop listening. */
  dispose() {
    this._offContact?.(); this._offContact = null;
    for (const handle of [...this.records.keys()]) this.remove(handle);
  }
}
