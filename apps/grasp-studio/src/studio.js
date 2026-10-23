// Grasp Studio model (pure, no three.js / WebXR): one item, the recording side, live feedback, auto-capture, review.
// main.js feeds it the tracked joints of both hands every frame (world space, name -> [x,y,z]) and draws what it reports;
// tests drive it with synthetic joints (grasp record.js poseJoints).
//
// Per frame, for the recording hand:
//   capture   record.js captureFromJoints: wrist + hand frame in item space, finger rows on the REFERENCE hand, hand length
//   gaps      the user's own hand as a bone model (restFromJoints -> closure.handGeometry) through closure.chainGaps:
//             per finger, per segment the skin gap to the item (m) -> fingertip state 'touch' | 'inside' | 'free'
//   avatar    the capture closed to contact (closure.closeToContact) on the avatar's hand (the twin's own hand when
//             the avatar extension is loaded, else the reference hand), re-closed every CLOSURE_EVERY[tier] frames
//   auto      capture.js createAutoCapture: countdown while still on the item, frames averaged
// A finished countdown becomes `review`: the averaged capture as a recorded pose (record.js recordedPose), its validator
// verdict + score on the reference hand (scoreGrasp), and its mirror for the other hand (mirrorPose) when autoMirror is on.
//
// Modes (extensions plan step 7): 'grasp' (above), 'animation' (capture.js createAnimationCapture: still -> record ->
// still again; item space when the hand starts on the item, else hand space relative to the first frame) and 'gesture'
// (a hand pose anywhere: the auto-capture countdown without the on-item test). Both hand modes run the avatar's
// recording pipeline (handposes.js processRecording: One Euro -> keyframe reduction -> grasp validateRows/clampRows per
// keyframe) and review the clip (+ its mirror); accept() returns the clips for the /api/hand endpoint.
import {
  CATALOG, XR_CHAINS, captureFromJoints, restFromJoints, rowsFromJoints, handGeometry, chainGaps, closeToContact,
  referenceHand, recordedPose, mirrorPose, scoreGrasp, poseJoints, poseById, defaultPose, DEFAULT_OPEN,
  twoHandSpec, secondaryPoses, handsClearance, createWeightLag, setProceduralGrasps, parseProceduralGrasps,
} from './vendor/extensions/grasp/index.js';
import { validateRows, clampRows } from './vendor/extensions/grasp/index.js';
import { processRecording, mirrorClip, toRows, HAND_FORMAT } from './vendor/extensions/avatar/handposes.js';
import { createAutoCapture, createAnimationCapture, trackingConfidence, STILL, ANIM } from './capture.js';

export const KIND = 'bottle_beer';
/**
 * The studio shows the procedural grasps (mug handle and top, carton sides, pole, barrel) by default so they can be tested and
 * recorded on; in games they are opt-in (?proceduralgrasps=on). ?proceduralgrasps=off in the studio shows the bake alone (then pole
 * and barrel have no grasp). `search`: a URLSearchParams (or anything with get). Returns whether they are on.
 */
export const applyProceduralGrasps = search => setProceduralGrasps(parseProceduralGrasps(search?.get?.('proceduralgrasps')) ?? true);
/** Grasps the studio offers per kind. The two-hand kinds (grasp two_hand.data.json) can also record a SECONDARY grip (setRole). */
export const GRASPS = Object.freeze({ bottle_beer: ['body', 'neck'], mug: ['handle', 'top'], carton: ['side', 'face'], pole: ['grip'], barrel: ['side'] });
/** Kinds the panel cycles through. */
export const KINDS = Object.freeze(Object.keys(GRASPS));
/** 'primary' | 'secondary': which hand's grip a recording is (secondary: a pose saved with role 'secondary', still a rec-<stamp> variant). */
export const ROLES = Object.freeze(['primary', 'secondary']);
/** Fingertip feedback (mm): touching within touchMm of the surface, penetrating deeper than penetrationMm, "on the item" within onItemMm. */
export const FEEDBACK = Object.freeze({ touchMm: 4, penetrationMm: 3, onItemMm: 25 });
/** Frames between re-closing the avatar hand per tier ('low' saves ~2/3 of the closure cost on the Quest CPU). */
export const CLOSURE_EVERY = Object.freeze({ low: 3, high: 1 });
/** Studio modes: grasp poses on the item, hand animations, gesture poses. */
export const MODES = Object.freeze(['grasp', 'animation', 'gesture']);
/** Gesture / animation names the panel cycles through (any id works through setClipName). */
export const GESTURE_NAMES = Object.freeze({ gesture: ['point', 'thumbs_up', 'fist', 'pinch', 'relaxed', 'open'], animation: ['wave', 'beckon', 'grab', 'release', 'pour'] });
const qMulS = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
/** Variant id of a hand recording: `<name>@rec-<YYYYMMDDTHHMMSS>` (UTC; the store adds a suffix if it is taken). */
export const variantId = (name, at = new Date().toISOString()) => `${name}@rec-${at.replace(/[-:]/g, '').replace(/\.\d+Z?$|Z$/, '')}`;
const other = side => (side === 'left' ? 'right' : 'left');

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
function rotate(q, v) {
  const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}
const conj = q => [-q[0], -q[1], -q[2], q[3]];

/** Fingertip state from a tip gap (m). */
export function tipState(gap, feedback = FEEDBACK) {
  if (gap < -feedback.penetrationMm / 1000) return 'inside';
  if (gap <= feedback.touchMm / 1000) return 'touch';
  return 'free';
}

export function createStudio({ kind = KIND, side = 'right', grasp = GRASPS[kind][0], autoMirror = true, tier = 'high', still = STILL, avatarHand = null,
  mode = 'grasp', clipName = null, anim = ANIM } = {}) {
  let shape = CATALOG[kind].shape;
  const settings = { kind, side, grasp, role: 'primary', weightLag: true, autoMirror, tier, mode: MODES.includes(mode) ? mode : 'grasp', clipName: clipName || (mode === 'animation' ? 'wave' : 'point') };
  // Visual weight of the item in the recording hand (grasp/weight_lag.js): a virtual body follows the hand through the held-drive
  // law; the shown avatar hand sinks/lags a little. Display only; the saved grip is always the raw hand.
  const lag = createWeightLag({ enabled: true, tier: tier === 'high' ? 'high' : 'low' });
  let lastT = null, partnerCache = null;
  const auto = createAutoCapture(still), animCap = createAnimationCapture({ ...anim, ...still }), poseCap = createAutoCapture(still);
  const history = { left: [], right: [] };
  let item = { pos: [0, 1, -0.4], quat: [0, 0, 0, 1] }, frame = 0, live = null, review = null, closed = null, lastSaved = [];
  let handOf = avatarHand; // side -> closure.handGeometry() of the avatar, or null

  const displayHand = s => handOf?.(s) || referenceHand(s);
  const toItem = p => rotate(conj(item.quat), sub(p, item.pos));
  const tipsOf = joints => FINGERS.map(f => joints[XR_CHAINS[f][3]]);

  function reset() { auto.reset(); animCap.reset(); poseCap.reset(); review = null; closed = null; live = null; lag.reset(); lastT = null; }

  // The OTHER hand on the item (two-hand kinds, grasp mode): the opposite side's default pose of the other group, closed to
  // contact on its hand, so both hands are seen on the item. Recording the primary grip: the other hand shows a secondary grip
  // far enough from it; recording the secondary grip: the other hand shows the primary grip.
  function partnerClosed() {
    const spec = twoHandSpec(kind);
    if (!spec || settings.mode !== 'grasp') return null;
    const s = settings.side, o = other(s), key = `${kind}/${s}/${settings.role}`, hand = displayHand(o);
    if (partnerCache?.key === key && partnerCache.hand === hand) return partnerCache.value;
    const primary = defaultPose(kind, settings.role === 'primary' ? s : o, spec.primary);
    const pose = settings.role === 'primary' ? (secondaryPoses(kind, o, primary, spec)[0] ?? defaultPose(kind, o, spec.secondary)) : primary;
    const value = pose ? { pose, closed: { ...closeToContact(pose, hand, shape), hand, side: o } } : null;
    partnerCache = { key, hand, value };
    return value;
  }
  /** Skin gap (mm, negative = the hands overlap) between the recording and the partner hand on the item, or null. */
  function clearanceMm(pose) {
    const partner = partnerClosed();
    if (!partner) return null;
    const hand = displayHand(pose.side);
    return Math.round(handsClearance(partner.closed.hand, partner.closed, hand, closeToContact(pose, hand, shape)) * 10000) / 10;
  }

  // hand modes: frames { t, wrist: { pos, quat } (item space), rows (reference hand), onItem } -> a reviewed clip
  function makeClipReview(frames, { kind: k, onItemStart = false }) {
    const space = k === 'pose' ? 'hand' : onItemStart ? 'item' : 'hand';
    let samples = frames;
    if (space === 'hand') {
      // relative to the first frame's hand (a gesture's wrist motion from where the hand started)
      const f0 = frames[0], qi = conj(f0.wrist.quat);
      samples = frames.map(f => ({ ...f, wrist: k === 'pose' ? { pos: [0, 0, 0], quat: [0, 0, 0, 1] }
        : { pos: rotate(qi, sub(f.wrist.pos, f0.wrist.pos)), quat: qMulS(qi, f.wrist.quat) } }));
    }
    // A recording is a variant of its name (handposes.js buildLibrary): its own id `<name>@rec-<stamp>`, never the bare
    // library id, so saving one never replaces the library clip or an earlier recording.
    const at = new Date().toISOString();
    const { clip, report } = processRecording(samples, { id: variantId(settings.clipName, at), kind: k, space, side: settings.side, clampRows, validateRows,
      meta: { format: HAND_FORMAT, studio: 'grasp-studio', ...(space === 'item' ? { item: kind } : {}), date: at.slice(0, 10), at } });
    clip.variantOf = settings.clipName;
    const mirror = settings.autoMirror ? mirrorClip(clip) : null;
    return { mode: settings.mode, clip, report, mirror, frames: frames.length };
  }

  function makeReview(avg) {
    const pose = recordedPose(avg, { kind, grasp: settings.grasp, frames: avg.frames, ...(settings.role === 'secondary' && { role: 'secondary' }) });
    const score = scoreGrasp(pose);
    pose.recorded.score = score.score;
    let mirror = null, mirrorScore = null;
    if (settings.autoMirror) {
      mirror = mirrorPose(pose);
      mirrorScore = scoreGrasp(mirror);
      mirror.recorded = { ...pose.recorded, score: mirrorScore.score, mirrored: true };
    }
    return { pose, score, mirror, mirrorScore, spread: avg.spread, frames: avg.frames, role: settings.role, clearanceMm: clearanceMm(pose) };
  }

  return {
    settings, shape,
    get item() { return item; },
    get live() { return live; },
    get review() { return review; },
    get lastSaved() { return lastSaved; },
    /** The other hand on the item (two-hand kinds): { pose, closed } or null. */
    get partner() { return partnerClosed(); },
    get shape() { return shape; },
    get status() { return live?.auto ?? { state: (settings.mode === 'animation' ? animCap : settings.mode === 'gesture' ? poseCap : auto).state, progress: 0, remaining: still.hold }; },
    setAvatarHand(fn) { handOf = fn; closed = null; partnerCache = null; },
    setItem(pos, quat = [0, 0, 0, 1]) { item = { pos: [...pos], quat: [...quat] }; reset(); },
    setSide(s) { if (s !== 'left' && s !== 'right') throw new RangeError(`side ${s}?`); settings.side = s; reset(); },
    setGrasp(g) { if (!GRASPS[kind].includes(g)) throw new RangeError(`grasp ${g}?`); settings.grasp = g; reset(); },
    /** Another item kind (GRASPS): the first grasp group, the primary role. */
    setKind(k) {
      if (!GRASPS[k]) throw new RangeError(`kind ${k}?`);
      kind = k; settings.kind = k; shape = CATALOG[k].shape; settings.grasp = GRASPS[k][0]; settings.role = 'primary'; partnerCache = null; reset();
    },
    /** 'primary' | 'secondary' (two-hand kinds only): a secondary recording is saved with role 'secondary' in the group of the secondary hand. */
    setRole(r) {
      if (!ROLES.includes(r)) throw new RangeError(`role ${r}?`);
      const spec = twoHandSpec(kind);
      if (r === 'secondary' && !spec) throw new RangeError(`${kind} has no secondary grip`);
      settings.role = r; if (spec) settings.grasp = spec[r]; partnerCache = null; reset();
    },
    setWeightLag(on) { settings.weightLag = !!on; if (!on) lag.reset(); },
    setAutoMirror(on) { settings.autoMirror = !!on; },
    setTier(t) { settings.tier = t in CLOSURE_EVERY ? t : 'high'; lag.setTier(settings.tier); },
    /** 'grasp' | 'animation' | 'gesture' (see the header); resets the capture. */
    setMode(m) {
      if (!MODES.includes(m)) throw new RangeError(`mode ${m}?`);
      settings.mode = m;
      if (m !== 'grasp' && !GESTURE_NAMES[m].includes(settings.clipName)) settings.clipName = GESTURE_NAMES[m][0];
      reset();
    },
    /** Name the next hand clip is a variant of (e.g. 'point'; saved as point@rec-<stamp>, the library clip is kept). */
    setClipName(n) { if (typeof n !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(n)) throw new RangeError(`clip name ${n}?`); settings.clipName = n; },
    reset,

    /**
     * One frame. hands: { left|right: { joints: name -> [x,y,z] (world), emulated? } | null }. Returns `live`:
     * { side, confidence: {left, right}, valid, capture, gaps, tips: {f: state}, onItem, closed, auto }.
     */
    update(t, hands) {
      frame++;
      const confidence = {};
      for (const s of ['left', 'right']) {
        const h = hands?.[s], tips = h?.joints ? tipsOf(h.joints) : null;
        history[s].push({ tips: tips?.every(Boolean) ? tips : null, emulated: !!h?.emulated });
        if (history[s].length > 8) history[s].shift();
        confidence[s] = trackingConfidence(history[s]);
      }
      const s = settings.side, joints = hands?.[s]?.joints || null;
      const capture = joints && captureFromJoints(s, joints, item, referenceHand(s));
      let gaps = null, tips = null, onItem = false;
      if (capture) {
        const userHand = handGeometry(restFromJoints(s, joints)), rows = rowsFromJoints(s, joints, userHand);
        gaps = chainGaps(userHand, shape, { wrist: capture.wrist, quat: capture.quat }, rows);
        tips = Object.fromEntries(FINGERS.map(f => [f, tipState(gaps[f].segments[2])]));
        onItem = Math.min(...FINGERS.map(f => gaps[f].min)) < FEEDBACK.onItemMm / 1000;
        if (settings.mode === 'grasp' && !review && (!closed || frame % (CLOSURE_EVERY[settings.tier] || 1) === 0)) {
          const pose = { kind, grasp: settings.grasp, mode: CATALOG[kind].grip, side: s, wrist: capture.wrist, quat: capture.quat,
            angles: capture.angles, open: DEFAULT_OPEN, handLength: capture.handLength };
          const hand = displayHand(s);
          closed = { ...closeToContact(pose, hand, shape), hand, side: s };
        }
      } else if (!review) closed = null;
      if (settings.mode !== 'grasp') {
        const frame = capture ? { wrist: { pos: capture.wrist, quat: capture.quat }, rows: toRows(capture.angles), onItem } : null;
        const sample = { t, valid: !!capture, confidence: confidence[s], capture, frame, onItem: true,
          wrist: capture?.wrist, quat: capture?.quat, tips: joints ? tipsOf(joints).map(toItem) : null };
        let status;
        if (settings.mode === 'animation') {
          status = animCap.update(sample);
          if (status.recorded) review = makeClipReview(status.recorded.frames, { kind: 'animation', onItemStart: !!status.recorded.frames[0].onItem });
        } else {
          status = poseCap.update(sample);
          if (status.captured) review = makeClipReview([{ t: 0, wrist: { pos: [0, 0, 0], quat: [0, 0, 0, 1] }, rows: toRows(status.captured.angles) }], { kind: 'pose' });
        }
        live = { side: s, confidence, valid: !!capture, capture, gaps, tips, onItem, closed: null, auto: status, mode: settings.mode };
        return live;
      }
      const status = auto.update({ t, valid: !!capture, confidence: confidence[s], onItem, capture,
        wrist: capture?.wrist, quat: capture?.quat, tips: joints ? tipsOf(joints).map(toItem) : null });
      if (status.captured) {
        review = makeReview(status.captured);
        const hand = displayHand(s);
        closed = { ...closeToContact(review.pose, hand, shape), hand, side: s, frozen: true };
      }
      // Visual weight: the recording hand's item-space wrist drives a virtual body of the item's mass (two hands share it
      // while a partner hand is shown); the offset is for DISPLAY (the avatar ghost hand), the capture stays raw.
      let weight = null;
      const dtw = lastT == null ? 0 : Math.max(0, Math.min(0.1, t - lastT));
      lastT = t;
      if (settings.weightLag && capture && onItem && !review) {
        const r = lag.update({ dt: dtw, mass: CATALOG[kind].mass ?? 0.5, hands: settings.role === 'secondary' ? 2 : 1, target: capture.wrist, simulate: true });
        if (r.active) weight = { offset: r.offset, elbow: r.elbow, effort: r.effort };
      } else lag.reset();
      live = { side: s, confidence, valid: !!capture, capture, gaps, tips, onItem, closed, auto: status, weightLag: weight, partner: partnerClosed() };
      return live;
    },

    /** Accept the review: the poses to save ([pose, mirror?]), marked default when asked. */
    accept({ markDefault = false } = {}) {
      if (!review) return [];
      if (review.clip) {   // hand modes: the clips for /api/hand
        const list = [review.clip, ...(review.mirror ? [review.mirror] : [])];
        (review.mode === 'animation' ? animCap : poseCap).accept(); review = null; lastSaved = list;
        return list;
      }
      const list = [review.pose, ...(review.mirror ? [review.mirror] : [])].map(p => ({ ...p, default: !!markDefault }));
      auto.accept(); review = null; closed = null; lastSaved = list;
      return list;
    },
    discard() { if (review) { (review.clip ? (review.mode === 'animation' ? animCap : poseCap) : auto).discard(); review = null; closed = null; } },
  };
}

/**
 * Synthetic tracked joints for desktop preview and smoke tests: the reference hand holding `pose` (a baked pose by
 * default) on the item, approaching from `approach` metres out along the hand's back over the first second, then still
 * (with `noiseMm` of seeded jitter). The other hand rests 0.3 m to the side, open. Returns { left, right } like XR input.
 */
export function syntheticHands(t, item, { side = 'right', kind = KIND, poseId = null, approach = 0.12, noiseMm = 0.2, seed = 1 } = {}) {
  const pose = (poseId && poseById(poseId)) || defaultPose(kind, side, 'body');
  const hand = referenceHand(side), k = Math.min(1, t);
  const lift = rotate(pose.quat, [0, approach * (1 - k * k * (3 - 2 * k)), 0]);
  const rows = pose.angles.map((row, f) => row.map((v, j) => (DEFAULT_OPEN[f][j] ?? 0) + (v - (DEFAULT_OPEN[f][j] ?? 0)) * k));
  let joints = poseJoints({ ...pose, wrist: pose.wrist.map((v, i) => v + lift[i]) }, hand, item, rows);
  let n = seed * 9301 + Math.floor(t * 90) * 49297;
  const rand = () => { n = (n * 9301 + 49297) % 233280; return n / 233280 - 0.5; };
  joints = Object.fromEntries(Object.entries(joints).map(([name, p]) => [name, p.map(v => v + rand() * noiseMm / 1000)]));
  const o = other(side), rest = referenceHand(o);
  const away = { ...pose, side: o, wrist: [pose.wrist[0], pose.wrist[1], pose.wrist[2] + (o === 'left' ? -0.3 : 0.3)] };
  return { [side]: { joints }, [o]: { joints: poseJoints(away, rest, item, DEFAULT_OPEN) } };
}
