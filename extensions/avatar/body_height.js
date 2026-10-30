// GameSystems avatar extension. Virtual body height: analog stick crouch, seated mode and its automatic detection. Pure.
// Port of NightfallContractsGodot addons/nightfall_characters/body_height.gd (PLAN.md package C1); the automatic seated
// choice is new here (Godot never auto-detects seated).
//
// Model: effective eye = tracked eye + originOffset(), originOffset() = seatedOffset - virtualCrouch. The host adds
// originOffset() to its XR rig height every frame (negative lowers the view) and feeds the avatar the raised/lowered
// head and hands, so a seated user gets a standing avatar with full arm reach.
// - Analog crouch on the right stick Y (Boneworks hold-height): the stick claims itself when |y| > CROUCH_DEADZONE and
//   |y| > CROUCH_AXIS_DOMINANCE * |x|; the height stays where it was left. It re-arms only after |y| < CROUCH_DEADZONE
//   (after invalid input or a recentre), so a held stick never crouches by surprise. The eye never goes below
//   MIN_EYE_HEIGHT, also when the user physically crouches under a virtual crouch. While the stick is claimed the host
//   must not snap-turn (claimsStick).
// - Seated: seatedOffset = reference eye - seated eye, capped at SEATED_OFFSET_MAX and slewed at HEIGHT_SLEW.
// - Automatic posture (first calibration of a session): the plateau of level-gaze, still-head samples (the avatar's
//   createHeightEstimator) decides. Below seatedBelow the user is seated: the measured eye becomes the seated eye and the
//   reference stays the stored standing eye (or defaultEye). Otherwise the measured eye is the standing reference.
//   A seated user who then stands up (tracked eye above the seated eye + STAND_UP_RISE for STAND_UP_SECONDS) is switched
//   back to standing and re-measured. A forced posture ('standing' | 'seated') skips the automatic choice.
// Storage: { get(key) -> string | null, set(key, value) } (e.g. localStorage); failures are ignored.
import { createHeightEstimator } from './calibrate.js';

export const CROUCH_DEADZONE = 0.35;
export const CROUCH_AXIS_DOMINANCE = 1.5;
export const CROUCH_RATE = 1.2;          // m/s at full deflection
export const MIN_EYE_HEIGHT = 0.55;
export const SEATED_OFFSET_MAX = 0.80;
export const HEIGHT_SLEW = 1.5;          // m/s
export const DEFAULT_EYE_HEIGHT = 1.62;
export const REFERENCE_EYE_MIN = 1.20;
export const REFERENCE_EYE_MAX = 2.10;
export const SEATED_BELOW = 1.30;        // m: a first-calibration eye below this is taken as seated
export const STAND_UP_RISE = 0.30;
export const STAND_UP_SECONDS = 1.5;
export const POSTURES = ['standing', 'seated'];
const STORE_KEY = 'gamesystems.bodyHeight';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const moveToward = (v, target, step) => (Math.abs(target - v) <= step ? target : v + Math.sign(target - v) * step);
const finiteDt = dt => (Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0);

/**
 * options: { defaultEye, seatedBelow, posture ('standing' | 'seated' | null = automatic), storage, estimator options }.
 * Returns the body-height state; see the module comment for the frame order (update, observe, originOffset).
 */
export function createBodyHeight({ defaultEye = DEFAULT_EYE_HEIGHT, seatedBelow = SEATED_BELOW, posture: forced = null,
  storage = null, estimator: estimatorOptions } = {}) {
  const stored = load(storage);
  const st = {
    posture: forced === 'seated' ? 'seated' : 'standing', decided: false,
    standingEye: stored.standingEye ?? clamp(defaultEye, REFERENCE_EYE_MIN, REFERENCE_EYE_MAX),
    seatedEye: NaN, trackedEye: NaN, seatedOffset: 0, virtualCrouch: 0,
    armed: false, claimed: false, hint: '', standTime: 0, version: 0,
  };
  const estimator = createHeightEstimator(estimatorOptions);
  const listeners = new Set();
  const changed = reason => { st.version++; for (const cb of [...listeners]) cb({ reason, posture: st.posture, referenceEye: st.standingEye, seatedEye: st.seatedEye }); };

  function decide(eye) {
    st.decided = true;
    if (forced === 'standing' || (forced !== 'seated' && eye >= seatedBelow)) {
      st.posture = 'standing'; st.standingEye = clamp(eye, REFERENCE_EYE_MIN, REFERENCE_EYE_MAX); st.seatedEye = NaN;
      save(storage, { standingEye: st.standingEye });
    } else {
      st.posture = 'seated'; st.seatedEye = eye;
    }
    changed('calibrated');
  }

  const api = {
    get posture() { return st.posture; },
    /** True once the first calibration chose a posture (the avatar can then be fitted to referenceEye). */
    get decided() { return st.decided; },
    get referenceEye() { return st.standingEye; },
    get seatedEye() { return st.seatedEye; },
    get trackedEye() { return st.trackedEye; },
    get virtualCrouch() { return st.virtualCrouch; },
    get seatedOffset() { return st.seatedOffset; },
    /** Bumped on every posture/reference change. */
    get version() { return st.version; },
    /** 'Low ceiling' when a rise was blocked by the headroom probe. */
    get hint() { return st.hint; },
    /** Host probe (rise m) -> how far the head can rise before contact; null = unlimited. */
    headroom: null,
    /** cb({ reason, posture, referenceEye, seatedEye }) on every posture/reference change. Returns an unsubscribe. */
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },

    /** Host tracking/focus/time break: discard evidence, not applied body state. */
    interruptObservation() { estimator.reset(); st.standTime = 0; },

    /** Right stick each XR frame, before the turn code: stick = { x, y } (gamepad axes; y < 0 = pushed up). */
    update(stick, dt) {
      st.claimed = false;
      const x = Math.abs(stick?.x), y = Math.abs(stick?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(dt)) { st.armed = false; return false; }
      if (y < CROUCH_DEADZONE) st.armed = true;
      if (!st.armed || y <= CROUCH_DEADZONE || y <= CROUCH_AXIS_DOMINANCE * x) return false;
      st.claimed = true;
      // Quadratic past the deadzone, faded to zero at the dominance line so rolling the thumb toward a turn eases the
      // crouch out instead of stepping it off. Stick down (y > 0) crouches.
      const dominance = clamp(1 - CROUCH_AXIS_DOMINANCE * x / y, 0, 1);
      const shaped = -Math.sign(stick.y) * ((Math.min(y, 1) - CROUCH_DEADZONE) / (1 - CROUCH_DEADZONE)) ** 2 * dominance;
      let target = clamp(st.virtualCrouch - shaped * CROUCH_RATE * finiteDt(dt), 0, api.maxCrouch());
      if (target < st.virtualCrouch) {
        const rise = st.virtualCrouch - target;
        const allowed = typeof api.headroom === 'function' ? clamp(Number(api.headroom(rise)) || 0, 0, rise) : rise;
        if (allowed < rise - 1e-4) { st.hint = 'Low ceiling'; target = st.virtualCrouch - allowed; } else st.hint = '';
      } else if (target > st.virtualCrouch) st.hint = '';
      st.virtualCrouch = target;
      return true;
    },
    get claimsStick() { return st.claimed; },

    /** Deepest virtual crouch that keeps the effective eye at MIN_EYE_HEIGHT (0 until the head was observed). */
    maxCrouch() { return Number.isFinite(st.trackedEye) ? Math.max(0, st.trackedEye + st.seatedOffset - MIN_EYE_HEIGHT) : 0; },

    /**
     * Each frame with the tracked (rig-local, floor = 0) eye height, before originOffset() is applied.
     * gaze = { pitch, roll } (rad) feeds the automatic calibration; without it no automatic choice is made.
     */
    observe(eye, dt, gaze = null) {
      if (!Number.isFinite(eye) || !Number.isFinite(dt) || dt <= 0 || dt > 0.1) {
        api.interruptObservation(); return;
      }
      st.trackedEye = eye;
      if (!st.decided) {
        if (gaze && Number.isFinite(gaze.pitch) && Number.isFinite(gaze.roll ?? 0)) {
          estimator.push(eye, gaze.pitch, dt, { roll: gaze.roll ?? 0 });
          const estimate = estimator.result();
          if (estimate?.confidence >= 0.75) decide(estimate.eye);
        } else estimator.reset();
      }
      if (st.posture === 'seated' && st.decided && forced !== 'seated' && Number.isFinite(st.seatedEye)) {
        st.standTime = eye > st.seatedEye + STAND_UP_RISE ? st.standTime + dt : 0;
        if (st.standTime >= STAND_UP_SECONDS) { st.standTime = 0; api.recalibrate('standing'); changed('stood-up'); }
      }
      const target = st.posture === 'seated' && Number.isFinite(st.seatedEye) ? clamp(st.standingEye - st.seatedEye, 0, SEATED_OFFSET_MAX) : 0;
      st.seatedOffset = moveToward(st.seatedOffset, target, HEIGHT_SLEW * dt);
      // A physical crouch under a virtual one: rise (slewed) so the eye stays >= MIN_EYE_HEIGHT.
      const limit = api.maxCrouch();
      if (st.virtualCrouch > limit) st.virtualCrouch = Math.max(limit, st.virtualCrouch - HEIGHT_SLEW * dt);
    },

    originOffset() { return st.seatedOffset - st.virtualCrouch; },
    effectiveEye() { return Number.isFinite(st.trackedEye) ? st.trackedEye + api.originOffset() : NaN; },

    /** Select 'standing', 'seated' or 'auto'; remeasure without discarding applied height. */
    setPosture(next) {
      if (next !== 'auto' && !POSTURES.includes(next)) return st.posture;
      forced = next === 'auto' ? null : next; api.recalibrate(forced);
      return st.posture;
    },
    /** Measure again (automatic choice, or the given posture). Keeps the stored standing eye as the seated reference. */
    recalibrate(posture = null) {
      if (posture === 'standing' || posture === 'seated') st.posture = posture;
      st.decided = false; st.standTime = 0; estimator.reset();
      if (st.posture === 'standing') st.seatedEye = NaN;
    },
    /** The runtime moved the tracking space: the stick must pass through its deadzone before crouching again. */
    onRecentered() { st.armed = false; st.claimed = false; api.interruptObservation(); },
    /** New XR session: crouch cleared, posture measured again (a forced posture stays). */
    reset() { st.virtualCrouch = 0; st.seatedOffset = 0; st.trackedEye = NaN; st.hint = ''; api.onRecentered(); api.recalibrate(forced); },
    telemetry() {
      return { posture: st.posture, decided: st.decided, virtualCrouch: +st.virtualCrouch.toFixed(3), seatedOffset: +st.seatedOffset.toFixed(3),
        originOffset: +api.originOffset().toFixed(3), referenceEye: st.standingEye, seatedEye: Number.isFinite(st.seatedEye) ? st.seatedEye : null,
        trackedEye: Number.isFinite(st.trackedEye) ? +st.trackedEye.toFixed(3) : null, claimsStick: st.claimed, hint: st.hint };
    },
  };
  return api;
}

function load(storage) {
  try {
    const data = JSON.parse(storage?.get(STORE_KEY) ?? 'null');
    const eye = Number(data?.standingEye);
    return Number.isFinite(eye) ? { standingEye: clamp(eye, REFERENCE_EYE_MIN, REFERENCE_EYE_MAX) } : {};
  } catch { return {}; }
}
function save(storage, data) {
  try { storage?.set(STORE_KEY, JSON.stringify(data)); } catch { /* private mode / quota: the session still works */ }
}

/** localStorage as a body-height storage, or null where it is unavailable. */
export function browserStorage() {
  try {
    const ls = globalThis.localStorage; if (!ls) return null;
    return { get: key => ls.getItem(key), set: (key, value) => ls.setItem(key, value) };
  } catch { return null; }
}
