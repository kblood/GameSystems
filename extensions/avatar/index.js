// GameSystems avatar extension: public API; fork of the CharacterCreatorXR character plugin (MIT, Copyright (c) 2026
// Kasper Olesen) via the Contracts character plugin. Poses ANY character that implements the character contract
// (humanoid contract.js, checked with assertCharacter; e.g. character-cc's ccCharacters()) from WebXR tracking:
//   vrik.js + twobone/bodyvolume/locomotion/cliploco/clips   full-body VR IK from head + hands, walking legs
//   calibrate.js            height / arm calibration          rigdata.js   IK rest data from rest joint heads
//   body_height.js          stick crouch, seated mode + automatic seated choice (host applies originOffset to its rig)
//   fingers.js, fingerInput.js, filters.js, finger_profiles.json   finger mapping (XR hands, controllers), One Euro
//   tracking.js, session.js  XR tracking record, session start   npc-animation.js   procedural NPC animation
//   handposes.js, hand_poses.json, recorded_hand.json   hand poses + hand animations (one frame format; controller
//                           fingers from data poses, grab / release / pour / gesture clips, recording pipeline)
// Depends on: humanoid (public API) and one character provider passed in (never imported). Source of truth:
// GameSystems/extensions/avatar; games get synced copies of the top-level files (never edit them).
//
// Quality tiers (AVATAR_QUALITY): 'full' (full body: walking clips, idle sway, sit/jump, cloth/hair physics, eye life),
// 'arms' (hands and arms: same arm/hand/finger IK, cheap step-only legs, no secondary physics or eye life), 'off'
// (hidden, not solved). Switch at any time with entity.setQuality(tier).
// Skeleton check at load (humanoid checkSkeleton): a hand without fingers runs as a stiff "mitten" (synthetic finger
// rest data, poses ignored) and warns; knuckles far from the expected geometry warn (entity.skeleton.warnings).
// Hand-pose tiers (HAND_POSE_QUALITY, handposes.js): 'low' (the old synthetic finger curves), 'mid' (data poses and
// clips), 'high' (+ touch-sensor gestures, cubic clip interpolation; default). Global setHandPoseQuality(tier) or per
// player entity.setHandPoseQuality(tier).
import * as THREE from 'three';
import { checkSkeleton, completeHands, poseToWorld, fkPositions, LAYERS, assertCharacter } from '../humanoid/index.js';
import { createVRIK } from './vrik.js';
import { createHeightEstimator, solveHeight } from './calibrate.js';
import { createFingerInput } from './fingerInput.js';
import { mixTwist } from './fingers.js';
import { createHandAnimator, handClip, sampleClip, clipDuration, stateFromRows, rowsFromState, handPoseQuality, HAND_POSE_QUALITY } from './handposes.js';
import { createXRTracking, gripFromHand } from './tracking.js';
import { createNPCAnimator, localAimPoint } from './npc-animation.js';
import { createLifetime, frameDelta } from './lifecycle.js';
import { prepareRig, THUMB_AXIS, FINGERS } from './rigdata.js';
import { qRotate } from './qx.js';
import { measureHandProfile, rigHandProfile, applyHandProfile } from './handprofile.js';
import { handSkinPoints } from './handskin.js';

export { handFromGrip, gripFromHand, GRIP_WRIST_OFFSET } from './tracking.js';
export { fingerStateFromCurls, fingerStateFromJoints, syntheticJoints, limitFingerState, blendFingerStates, mixTwist, LIMITS, XR_JOINTS, XR_CHAINS } from './fingers.js';
export { prepareRig, handFrame, chainAngles, fingerAxes, thumbTwist, twistSign, THUMB_AXIS, TWIST_PLANE, FINGERS, SEGMENTS } from './rigdata.js';
export { createVRIK, VRIK_DEFAULTS } from './vrik.js';
export { solveHeight, solveArmScale, createHeightEstimator } from './calibrate.js';
export { createBodyHeight, browserStorage, SEATED_BELOW, MIN_EYE_HEIGHT, CROUCH_DEADZONE, SEATED_OFFSET_MAX } from './body_height.js';
export { createNPCAnimator, localAimPoint } from './npc-animation.js';
export { createCrawlGait, CRAWL_DEFAULTS } from './crawl.js';
export { controllerFingerState, relaxedFingerState, RELAXED_CURLS } from './fingerInput.js';
export {
  HAND_FORMAT, HAND_POSE_QUALITY, setHandPoseQuality, handPoseQuality, LIMITS_DEG, IDENTITY_WRIST, toRows, rowsToArray, limitRows,
  mixRows, stateFromRows, rowsFromState, isClip, buildLibrary, HAND_LIBRARY, setHandLibrary, setHandVariants, handVariants, parseHandVariants, variantName,
  handPose, handClip, poseNames, clipNames,
  poseState, clipDuration, sampleClip, resolveClip, grabFingerState, pourFingerState, createHandAnimator, controllerRows, RECORD_DEFAULTS,
  reduceKeyframes, processRecording, mirrorClip,
} from './handposes.js';
export { LAYERS };
export { HAND_PROFILE_FORMAT, HAND_BONES, DEFAULT_PROPORTIONS, PAD_CONTACT, handLocal, rigHandProfile, measureHandProfile, applyHandProfile, isHandProfile } from './handprofile.js';
export { handSkinPoints } from './handskin.js';

const GESTURE_FADE = 0.15;   // s, gesture in / out
/**
 * Per hand finger effects on top of the tracked fingers (mid/high hand-pose tiers): a gesture clip (playGesture) and the
 * release animation when a host's virtual-grasp override (record.fingers[side]) ends. The override itself always wins.
 */
function createHandFx() {
  const anim = createHandAnimator();
  let last = null, release = null, weight = 0, gesture = null, held = null;
  return {
    play(id, opts) { if (!handClip(id)) throw new RangeError(`no hand clip ${id}`); held = null; gesture = anim.play(id, opts); return gesture; },
    stop() { gesture = null; anim.stop(); },
    get gesture() { return gesture ?? (weight > 0 ? anim.playing : null); },
    apply(live, override, dt, tier) {
      if (override) { last = override; release = null; return override; }
      let state = live;
      if (gesture || weight > 0) {
        weight = Math.max(0, Math.min(1, weight + (gesture ? dt : -dt) / GESTURE_FADE));
        const frame = anim.update(dt) ?? held;   // a finished one-shot holds its last frame while it fades out
        held = frame;
        if (!anim.playing) gesture = null;
        if (!frame || (!gesture && weight <= 0)) { anim.stop(); gesture = null; weight = 0; held = null; }
        else {
          const g = stateFromRows(frame.rows, { src: 'gesture' });
          state = weight >= 1 ? g : blend(live, g, weight * weight * (3 - 2 * weight));
        }
      }
      if (last && tier !== 'low') { release = { time: 0, from: rowsFromState(last) }; }
      last = null;
      if (release) {
        const clip = handClip('release');
        release.time += dt;
        if (!clip || release.time >= clipDuration(clip)) release = null;
        else state = stateFromRows(sampleClip(clip, release.time, { from: release.from, to: rowsFromState(state), loop: false, quality: tier }).rows, { src: 'release' });
      }
      return state;
    },
    reset() { anim.stop(); last = null; release = null; weight = 0; gesture = null; held = null; },
  };
}
function blend(a, b, t) {
  const out = {};
  for (const f of FINGERS) {
    const x = a?.[f], y = b?.[f];
    if (!x || !y) { out[f] = y || x || null; continue; }
    const m = (p, q) => p + (q - p) * t;
    out[f] = { yaw: null, dyaw: m(x.dyaw ?? 0, y.dyaw ?? 0), pitch: m(x.pitch, y.pitch), bend1: m(x.bend1, y.bend1), bend2: m(x.bend2, y.bend2),
      curl: m(x.curl ?? 0, y.curl ?? 0), src: t < 0.5 ? x.src : y.src };
    const tw = mixTwist(x, y, t);
    if (tw !== undefined) out[f].twist = tw;
    if (x.yaw != null) out[f].yaw = x.yaw + ((y.dyaw ?? 0) - (x.dyaw ?? 0)) * t;   // tracked hand (absolute yaw): spread toward the gesture's offset
  }
  return out;
}

export const AVATAR_QUALITY = Object.freeze(['off', 'arms', 'full']);
/** Solver options per tier ('arms': step-only legs, no idle sway / sitting / jumping). */
const TIER_IK = { full: {}, arms: { clips: false, idleSway: 0, sit: 'off', jump: false } };
const normalizeTier = tier => (AVATAR_QUALITY.includes(tier) ? tier : tier === 'low' ? 'arms' : tier === 'high' ? 'full' : 'full');

const FALLBACK_TABLE = {
  profiles: [], fallback: {
    index: { button: 0, field: 'value', touchCurl: 0.3 }, grip: { button: 1, field: 'value' },
    thumbTouch: [3, 4, 5, 6], thumbCurl: 0.85, thumbRestCurl: 0.55,
  },
};
const isVec3 = value => value?.length >= 3 && [value[0], value[1], value[2]].every(Number.isFinite);
const isQuat = value => value?.length >= 4 && [value[0], value[1], value[2], value[3]].every(Number.isFinite);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * IK rest data of a character: rig = prepareRig(rest heads with mitten hands completed), plus rig.skeleton (the check
 * report) and rig.hands[side].mitten. Throws when required body joints are missing.
 * Hand profiles (handprofile.js): rig.hands[side].measured = measured once here from the character's rest-pose skin
 * (handskin.js; rig-only proportional defaults without skin), rig.hands[side].profile = measured + overrides
 * (options.handProfile: one override or a list applied in order; the character's own `handProfile` goes first).
 * options.skin: false skips the skin read (rig-only profile).
 */
export function measureCharacter(character, { handProfile = null, skin = true } = {}) {
  const heads = character.restHeads(), skeleton = checkSkeleton(heads);
  if (!skeleton.ok) throw new Error(`character skeleton unusable: ${skeleton.warnings[0]}`);
  const rig = prepareRig(completeHands(heads, skeleton).heads, { eyeOffset: character.eyeOffset?.() ?? null });
  rig.skeleton = skeleton;
  const overrides = [character.handProfile, handProfile].flat().filter(Boolean);
  for (const side of ['left', 'right']) {
    const h = rig.hands[side];
    h.mitten = skeleton.hands[side].mitten;
    const base = { side, frame: h.frame, wrist: rig.H[`${side}Hand`], fingers: h.fingers, thumbTilt: THUMB_AXIS.tilt };
    let points = null;
    if (skin && !h.mitten) { try { points = handSkinPoints(character, side); } catch (error) { console.warn(`[avatar] ${side} hand skin not measured: ${error.message}`); } }
    h.measured = points ? measureHandProfile(base, points) : rigHandProfile(base);
    h.profile = overrides.reduce(applyHandProfile, h.measured);
  }
  return rig;
}

/**
 * Rest hand of a rig for grasping (GameSystems grasp closure.handGeometry() input): { side, frame: {F, D, R}, wrist,
 * fingers: { Thumb..Little: { pts, len, rest } }, scale, handLength (world m, wrist -> middle fingertip along the bones),
 * thumbTilt (this avatar's thumb axis tilt, rad), mitten, profile (the hand profile, handprofile.js) }. Character frame,
 * rig metres except handLength. Grasping reads only `profile` (+ scale) when it is there.
 */
export function restHand(rig, side, scale = 1) {
  const h = rig?.hands?.[side], wrist = rig?.H?.[`${side}Hand`];
  if (!h || !wrist) return null;
  const m = h.fingers.Middle, handLength = (dist(m.pts[0], wrist) + m.len[0] + m.len[1] + m.len[2]) * scale;
  const fingers = Object.fromEntries(FINGERS.map(f => [f, { pts: h.fingers[f].pts, len: h.fingers[f].len, rest: h.fingers[f].rest }]));
  const profile = h.profile ?? null;
  return { side, frame: h.frame, wrist, fingers, scale, handLength: profile ? profile.length * scale : handLength, thumbTilt: profile?.thumbTilt ?? THUMB_AXIS.tilt, mitten: !!h.mitten, profile };
}

/**
 * scene owns returned entity roots; renderer is used only to read XR reference-space tracking.
 * character: a character provider { id, create({ kind, options, signal, physicsScene }) -> character contract }.
 * quality: avatar tier for new players ('full' | 'arms' | 'off'; 'high'/'low' map to 'full'/'arms').
 */
export function createCharacterPlugin({ scene, renderer, character: provider, quality = 'full', handProfile = null } = {}) {
  if (!scene?.add || !scene?.remove) throw new TypeError('createCharacterPlugin requires a three.js scene');
  if (!renderer?.xr?.getReferenceSpace) throw new TypeError('createCharacterPlugin requires a WebXR-capable renderer');
  if (typeof provider?.create !== 'function') throw new TypeError('createCharacterPlugin requires a character provider ({ create })');
  const lifetime = createLifetime(), entities = new Set();
  const tracker = createXRTracking(renderer);
  let session = null, referenceSpace = null, npcSequence = 0;
  const profilesP = fetch(new URL('./finger_profiles.json', import.meta.url), { signal: lifetime.signal })
    .then(response => response.ok ? response.json() : FALLBACK_TABLE).catch(() => FALLBACK_TABLE);
  lifetime.onDispose(() => { for (const entity of [...entities]) entity.dispose(); entities.clear(); tracker.reset(); });
  async function create(kind, options = {}) {
    lifetime.assertAlive();
    const child = createLifetime(), root = new THREE.Group();
    root.name = kind === 'player' ? 'CharacterPlayer' : 'CharacterNPC';
    const removeParentCleanup = lifetime.onDispose(() => child.dispose());
    let avatar = null, rig = null, unsubscribe = () => {}, offRest = () => {};
    const rigListeners = new Set();
    child.onDispose(() => { unsubscribe(); offRest(); rigListeners.clear(); avatar?.dispose?.(); root.removeFromParent(); entities.delete(entity); removeParentCleanup(); });
    let scale = Number.isFinite(options.scale) && options.scale > 0 ? options.scale : 1;
    // Hand profile overrides: provider/plugin option, player option, then the runtime setter (setHandProfile).
    const profileOverrides = [handProfile, options.handProfile].filter(Boolean);
    const runtimeProfile = { left: null, right: null };
    let handProfileVersion = 0;
    const measure = () => measureCharacter(avatar);
    const reprofile = () => {
      if (!rig) return;
      for (const side of ['left', 'right']) {
        const h = rig.hands[side];
        h.profile = [avatar?.handProfile, ...profileOverrides, runtimeProfile[side]].flat().filter(Boolean).reduce(applyHandProfile, h.measured);
      }
      handProfileVersion++;
    };
    const entity = {
      root,
      get rig() { return rig; }, get body() { return avatar?.body ?? avatar?.meshes?.[0] ?? null; },
      get humanoid() { return avatar?.humanoid ?? null; }, get avatar() { return avatar; }, get character() { return avatar; },
      get skeleton() { return rig?.skeleton ?? null; },
      get scale() { return scale; }, get disposed() { return child.disposed; },
      /** Immediately calls with the current rig, then after every re-measurement; returns an idempotent unsubscribe. */
      onRig(callback) {
        if (child.disposed) return () => {};
        rigListeners.add(callback);
        try { callback(rig); } catch (error) { rigListeners.delete(callback); throw error; }
        return () => rigListeners.delete(callback);
      },
      /** Rest hand for grasping (see restHand()), at the entity's current scale. */
      restHand: side => restHand(rig, side, scale),
      /** The hand profile in effect for a side (handprofile.js; measured + overrides), or null before the rig exists. */
      handProfile: side => rig?.hands?.[side]?.profile ?? null,
      /** The measured profile (no overrides). */
      measuredHandProfile: side => rig?.hands?.[side]?.measured ?? null,
      /**
       * Runtime adjustment: override (see applyHandProfile: fields, `size`, `girth`; flat or { left, right }) on top of the
       * measured profile and the provider/player overrides, for one side or both; null clears. Bumps handProfileVersion,
       * so hosts rebuild their grasp hand (closure.handGeometry) and the next grab closes on the new profile.
       */
      setHandProfile(override, side = null) {
        for (const s of side ? [side] : ['left', 'right']) runtimeProfile[s] = override ?? null;
        reprofile();
        return { left: entity.handProfile('left'), right: entity.handProfile('right') };
      },
      /** Increments whenever a hand profile changes (setHandProfile, rest change): a cache key for grasp hands. */
      get handProfileVersion() { return handProfileVersion; },
      dispose: () => child.dispose(), ready: null,
    };
    try {
      avatar = await provider.create({ kind, options, signal: child.signal, physicsScene: scene });
      assertCharacter(avatar, { label: `character provider ${provider.id ?? '(no id)'}` });
      child.assertAlive(); lifetime.assertAlive();   // disposed meanwhile: the catch below disposes the character once
      rig = measure(); reprofile();
      for (const warning of rig.skeleton.warnings) console.warn(`[avatar] ${warning}`);
      offRest = avatar.onRestChange?.(() => {
        rig = measure(); reprofile();
        for (const callback of [...rigListeners]) callback(rig);
      }) ?? (() => {});
      root.add(avatar.root);
      const bodyShape = () => avatar.bodyShape ?? { male: 1, bust: 0 };
      if (kind === 'player') {
        const table = await profilesP;
        child.assertAlive();
        let tier = normalizeTier(options.avatarQuality ?? quality);
        const solverOptions = () => ({ body: bodyShape(), ...TIER_IK[tier === 'off' ? 'arms' : tier], ...options.ik });
        let solver = createVRIK(rig, solverOptions());
        let handTier = HAND_POSE_QUALITY.includes(options.handPoseQuality) ? options.handPoseQuality : null;   // null = global
        const newFingers = () => createFingerInput(table, { quality: handTier });
        let fingers = newFingers(), estimator = createHeightEstimator();
        const handFx = { left: createHandFx(), right: createHandFx() };
        let auto = options.autoCalibrate !== false && options.scale == null, autoDone = false;
        let trackingPosition = null;
        const elbowFed = { left: false, right: false };
        const floorY = Number.isFinite(options.floorY) ? options.floorY : 0;
        unsubscribe = entity.onRig(next => { solver.setRig(next); solver.reset(); });
        function calibrate(eyeHeight, explicit = true) {
          if (child.disposed) return { ok: false };
          const result = solveHeight([{ h: 0, eye: rig.eyeHeight }], eyeHeight, { mode: 'scale' });
          if (!result.ok) return result;
          scale = result.scale; root.scale.setScalar(scale); solver.reset(); avatar.resetSecondary?.();
          if (explicit) auto = false;
          return result;
        }
        Object.assign(entity, {
          calibrate: eyeHeight => calibrate(eyeHeight),
          setFirstPerson: on => avatar.setFirstPerson?.(on),
          get quality() { return tier; },
          /** 'full' | 'arms' | 'off' (see AVATAR_QUALITY). Switching rebuilds the solver; 'off' hides the avatar. */
          setQuality(next) {
            next = normalizeTier(next);
            if (child.disposed || next === tier) return tier;
            const wasOff = tier === 'off';
            tier = next; root.visible = tier !== 'off';
            if (tier !== 'off') { solver = createVRIK(rig, solverOptions()); if (wasOff) { fingers = newFingers(); trackingPosition = null; } avatar.resetSecondary?.(); }
            return tier;
          },
          /** Hand-pose tier of this player ('low' | 'mid' | 'high'; null = the global setHandPoseQuality). */
          get handPoseQuality() { return handTier ?? handPoseQuality(); },
          setHandPoseQuality(next) { handTier = HAND_POSE_QUALITY.includes(next) ? next : null; fingers.setQuality(handTier); return handTier ?? handPoseQuality(); },
          /** Play a hand clip (wave, beckon, a pose id, a recorded gesture) on one hand's fingers: { loop, speed }. */
          playGesture(side, id, opts = {}) { return handFx[side === 'left' ? 'left' : 'right'].play(id, opts); },
          stopGesture(side) { for (const s of side ? [side] : ['left', 'right']) handFx[s]?.stop(); },
          gesture: side => handFx[side]?.gesture ?? null,
          resetTracking() {
            if (child.disposed) return;
            solver = createVRIK(rig, solverOptions()); fingers = newFingers(); estimator.reset(); trackingPosition = null;
            handFx.left.reset(); handFx.right.reset();
            autoDone = false; tracker.reset(); avatar.resetSecondary?.();
          },
          updateTracking(record, dt) {
            if (child.disposed) return null;
            dt = frameDelta(dt);
            if (tier === 'off') return null;
            const full = tier === 'full';
            if (!record || record.headLost || !isVec3(record.head?.pos) || !isQuat(record.head?.quat)) { avatar.tick?.(dt, false); return null; }
            if (auto && !autoDone) {
              const forward = qRotate(record.head.quat, [0, 0, -1]), up = qRotate(record.head.quat, [0, 1, 0]), right = qRotate(record.head.quat, [1, 0, 0]);
              estimator.push(record.head.pos[1] - floorY, Math.asin(Math.max(-1, Math.min(1, -forward[1]))), dt, { roll: Math.atan2(right[1], up[1]) });
              const estimate = estimator.result();
              if (estimate?.confidence >= 0.75) { calibrate(estimate.eye, false); autoDone = true; }
            }
            // Recenter/teleport should not produce a run/jump from the discontinuity.
            if (trackingPosition && Math.hypot(...record.head.pos.map((v, i) => v - trackingPosition[i])) > 1.5) solver.reset();
            trackingPosition = [...record.head.pos];
            const fingerResult = fingers.update(record.snaps || [], dt, rig);
            // Hosts can override one virtual grasp (e.g. a held pistol) without disabling the other hand's tracking.
            // Gestures and the release animation (handFx, mid/high tiers) sit between the tracked fingers and the override.
            const handNow = handTier ?? handPoseQuality();
            const fingerStates = {};
            for (const side of ['left', 'right']) fingerStates[side] = handFx[side].apply(fingerResult[side].state, record.fingers?.[side] ?? null, dt, handNow);
            // Solver floor is zero. A known elevated floor is removed from ALL targets.
            const shift = pose => pose?.pos ? { ...pose, pos: [pose.pos[0], pose.pos[1] - floorY, pose.pos[2]] } : pose;
            const hands = { left: shift(record.hands?.left), right: shift(record.hands?.right) };
            // Optional elbow hints (record.elbowHints[side] = { vector, weight }, e.g. grasp weight_lag's elbow): without them (and
            // after the last one ended) this does nothing, the solve is exactly as before.
            if (record.elbowHints || elbowFed.left || elbowFed.right) {
              for (const sd of ['left', 'right']) {
                const h = record.elbowHints?.[sd];
                if (h && isVec3(h.vector)) { solver.setElbowHint(sd, h.vector, h.weight ?? 1); elbowFed[sd] = true; }
                else if (elbowFed[sd]) { solver.setElbowHint(sd, null, 0); elbowFed[sd] = false; }
              }
            }
            const result = solver.solve({ head: shift(record.head), hands, fingers: fingerStates, scale }, dt);
            if (!result) return null;
            avatar.applyPose(result.pose);
            root.position.fromArray(result.rig.position); root.position.y += floorY;
            root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), result.rig.yaw);
            root.scale.setScalar(scale); avatar.root.position.fromArray(result.pose.root);
            avatar.root.quaternion.identity(); avatar.root.scale.setScalar(1);
            // 'arms': no eye life, cloth or hair collision; the matrices still update.
            if (full) avatar.tick?.(dt); else avatar.root.updateMatrixWorld(true);
            return result;
          },
        });
        root.visible = tier !== 'off';
        avatar.setFirstPerson?.(options.firstPerson !== false);
      } else {
        const animator = createNPCAnimator(rig, { seed: options.seed ?? options.id ?? `npc-${npcSequence++}`, body: bodyShape() });
        let lastAnimation = null;
        unsubscribe = entity.onRig(next => animator.setRig(next));
        let yaw = Number.isFinite(options.yaw) ? options.yaw : 0;
        let position = isVec3(options.position) ? [...options.position] : [0, 0, 0];
        let lastInput = { position, yaw, state: 'idle', moving: false, speed: 0 };
        Object.assign(entity, {
          weaponGrip: null,
          // Native XR GRIP -Z forward, not a raw hand frame or a weapon-root offset.
          getWeaponPose() {
            if (child.disposed || !lastAnimation) return { pos: [0, 0, 0], quat: [0, 0, 0, 1], valid: false };
            root.updateMatrixWorld(true);
            const bone = avatar.humanoid?.bones?.rightHand;
            const pos = bone?.getWorldPosition(new THREE.Vector3()) ?? avatar.root.localToWorld(new THREE.Vector3().fromArray(lastAnimation.grip.position).sub(new THREE.Vector3().fromArray(lastAnimation.pose.root)));
            const handQuat = avatar.root.getWorldQuaternion(new THREE.Quaternion())
              .multiply(new THREE.Quaternion().fromArray(lastAnimation.grip.quaternion));
            const wrist = { pos: pos.toArray(), quat: handQuat.toArray() };
            const grip = gripFromHand('right', wrist.pos, wrist.quat);
            return { ...grip, valid: true, frame: 'native-grip', wrist };
          },
          updateNPC(input = {}, dt) {
            if (child.disposed) return null;
            dt = frameDelta(dt); lastInput = { ...lastInput, ...input, recoil: input.recoil ?? 0 };
            if (Number.isFinite(input.scale) && input.scale > 0) scale = input.scale;
            if (isVec3(lastInput.position)) position = [...lastInput.position];
            if (Number.isFinite(lastInput.yaw)) yaw = lastInput.yaw;
            root.position.fromArray(position); root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw); root.scale.setScalar(scale);
            const animation = animator.update({ ...lastInput, position, yaw, scale, aimPoint: localAimPoint(lastInput.aimPoint, position, yaw, scale) }, dt);
            lastAnimation = animation;
            avatar.applyPose(animation.pose);
            avatar.root.position.fromArray(animation.offset).add(new THREE.Vector3().fromArray(animation.pose.root));
            avatar.root.quaternion.setFromEuler(new THREE.Euler(...animation.tilt)); avatar.root.scale.setScalar(1);
            entity.weaponGrip = animation.grip;
            root.updateMatrixWorld(true);
            let gaze = null;
            const attention = isVec3(lastInput.attentionPoint) ? lastInput.attentionPoint : lastInput.aimPoint;
            if (isVec3(attention)) {
              // EyeLife expects angular HEAD-relative direction, not actor-local/world coordinates.
              const headQ = new THREE.Quaternion().fromArray(poseToWorld(animation.pose.joints).head);
              const head = fkPositions(rig.H, animation.pose).head;
              const eye = new THREE.Vector3().fromArray(head).sub(new THREE.Vector3().fromArray(animation.pose.root))
                .add(new THREE.Vector3().fromArray(rig.eyeOffset).applyQuaternion(headQ));
              const direction = avatar.root.worldToLocal(new THREE.Vector3().fromArray(attention)).sub(eye).applyQuaternion(headQ.invert());
              gaze = { yaw: Math.atan2(direction.x, direction.z), pitch: Math.atan2(direction.y, Math.hypot(direction.x, direction.z)) };
            }
            avatar.tick?.(dt, true, { gaze, frozen: animation.death === 1 }); return animation;
          },
        });
        avatar.setFirstPerson?.(false); // Every NPC face/hair mesh has MAIN + HEAD, never HEAD-only.
        entity.updateNPC({}, 0);
      }
      child.assertAlive();
      scene.add(root); entities.add(entity);
      entity.ready = Promise.resolve(entity);
      return entity;
    } catch (error) { child.dispose(); throw error; }
  }
  return {
    createPlayer: options => create('player', options),
    createNPC: options => create('npc', options),
    readTracking(frame, dt) {
      if (lifetime.disposed || !frame) return null;
      const ref = renderer.xr.getReferenceSpace();
      if (frame.session !== session || ref !== referenceSpace) { tracker.reset(); session = frame.session; referenceSpace = ref; }
      return tracker.read(frame, frameDelta(dt)); // LOCAL reference-space; never game/world transformed here.
    },
    dispose: () => lifetime.dispose(),
  };
}
