// Two-hand cap / cork removal gesture (port of NightfallContractsGodot addons/nightfall_interaction/bottle_cap.gd's
// attached mechanism, without its physics body). One hand holds the bottle, the other grips the cap; the cap hand is
// followed in the bottle's frame (so moving the bottle is not cap motion). It opens after a loosening twist of
// TWIST_TO_LOOSEN plus LOOSENED_PULL of pull along the neck, or after STRAIGHT_PULL without twist (corks). Pulling
// sideways (MAX_RADIAL), tilting (MAX_TILT), pushing in or a tracking jump cancels; tightening only counts back.
// Positive twist is counterclockwise seen from above the mouth (rotation about the bottle's +Y), the way a cap loosens.
//
// Poses are { pos: [x, y, z], quat: [x, y, z, w] } in the bottle's frame (origin at its base, +Y up the neck, unscaled).
// cap: the cap centre in that frame. preview() gives a small twist/lift for the cap meshes while it is gripped.
import * as THREE from 'three';

export const TWIST_TO_LOOSEN = Math.PI / 3;
export const LOOSENED_PULL = 0.015;
export const STRAIGHT_PULL = 0.045;
export const MAX_RADIAL = 0.035;
export const MAX_TILT = Math.PI / 3;
export const MAX_STEP = 0.12;               // m of hand travel per sample before it counts as a tracking jump
export const MAX_STEP_ANGLE = 65 * Math.PI / 180;
export const GRIP_REACH = 0.07;             // m from the cap centre within which a squeeze grips the cap
const PREVIEW_TWIST = [-15 * Math.PI / 180, TWIST_TO_LOOSEN], PREVIEW_LIFT = 0.006;

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const finitePose = p => p && [...(p.pos ?? []), ...(p.quat ?? [])].length === 7 && [...p.pos, ...p.quat].every(Number.isFinite);

/** True when a hand (bottle-frame position) is close enough to the cap to grip it. */
export function nearCap(handPos, cap, reach = GRIP_REACH) {
  return Array.isArray(handPos) && Math.hypot(handPos[0] - cap[0], handPos[1] - cap[1], handPos[2] - cap[2]) <= reach;
}

/**
 * begin(hand) with the cap hand's first pose; update(hand, dt) each frame -> state. state.status: 'active' | 'opened' |
 * 'cancelled' (with reason: 'invalid_intention' | 'tracking_discontinuity' | 'misaligned_or_withdrawn').
 */
export function createCapGesture({ cap = [0, 0, 0] } = {}) {
  const center = new THREE.Vector3(...cap);
  const reference = new THREE.Matrix4(), referenceInv = new THREE.Matrix4(), capFrame = new THREE.Matrix4().makeTranslation(center);
  const local = new THREE.Matrix4(), intended = new THREE.Matrix4();
  const prevPos = new THREE.Vector3(), prevQuat = new THREE.Quaternion();
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);
  const st = { status: 'idle', reason: '', twist: 0, previousTwist: 0, pull: 0, radial: 0, swing: 0 };
  const cancel = reason => { st.status = 'cancelled'; st.reason = reason; return api.state(); };
  const compose = (m, pose) => m.compose(p.fromArray(pose.pos), q.fromArray(pose.quat).normalize(), ONE);

  const api = {
    begin(hand) {
      Object.assign(st, { status: 'active', reason: '', twist: 0, previousTwist: 0, pull: 0, radial: 0, swing: 0 });
      if (!finitePose(hand)) return cancel('invalid_intention');
      compose(reference, hand); referenceInv.copy(reference).invert();
      prevPos.fromArray(hand.pos); prevQuat.fromArray(hand.quat).normalize();
      return api.state();
    },
    update(hand, dt) {
      if (st.status !== 'active') return api.state();
      if (!finitePose(hand) || !Number.isFinite(dt) || dt <= 0 || dt > 0.1) return cancel('invalid_intention');
      compose(local, hand);
      const step = p.fromArray(hand.pos).distanceTo(prevPos), turn = q.fromArray(hand.quat).normalize().angleTo(prevQuat);
      if (step > MAX_STEP || turn > MAX_STEP_ANGLE) return cancel('tracking_discontinuity');
      prevPos.fromArray(hand.pos); prevQuat.fromArray(hand.quat).normalize();
      // The cap carried rigidly by the hand's motion since it gripped: an eccentric grip orbits when the cap turns, which is
      // not sideways withdrawal; the cap centre is the measure.
      intended.multiplyMatrices(local, referenceInv).multiply(capFrame).decompose(p, q, s);
      const d = p.sub(center);
      st.pull = d.y; st.radial = Math.hypot(d.x, d.z);
      if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      const twistQ = new THREE.Quaternion(0, q.y, 0, q.w);
      if (twistQ.lengthSq() > 1e-6) twistQ.normalize(); else twistQ.identity();
      const current = wrap(2 * Math.atan2(twistQ.y, twistQ.w));
      const swing = q.clone().multiply(twistQ.invert()).normalize();
      st.swing = 2 * Math.acos(Math.min(1, Math.abs(swing.w)));
      if (st.radial > MAX_RADIAL || st.pull < -0.025 || st.swing > MAX_TILT) return cancel('misaligned_or_withdrawn');
      st.twist += wrap(current - st.previousTwist); st.previousTwist = current;
      if (st.pull >= STRAIGHT_PULL || (st.twist >= TWIST_TO_LOOSEN && st.pull >= LOOSENED_PULL)) st.status = 'opened';
      return api.state();
    },
    /** Visual cap motion while gripped (rad about +Y through the cap centre, m along +Y); zero once it is not active. */
    preview() {
      if (st.status !== 'active') return { twist: 0, lift: 0 };
      return { twist: Math.min(PREVIEW_TWIST[1], Math.max(PREVIEW_TWIST[0], st.twist)), lift: Math.min(PREVIEW_LIFT, Math.max(0, st.pull)) };
    },
    state: () => ({ status: st.status, reason: st.reason, twist: st.twist, pull: st.pull, radial: st.radial, swing: st.swing }),
  };
  return api;
}
