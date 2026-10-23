// The VRIK avatar (GameSystems extensions avatar + character-cc, the CharacterCreator character) in the bottle demo, with
// baked hand grasps on bottles. An extension (GameSystems/extensions/host): main.js loads it with a dynamic import, so the
// demo runs without it. It reacts to the core's events (grab, release, broken, disconnect, xrStart, xrEnd) and exposes
// holdPose/trackedWrist/graspOf for the interaction. avatar, humanoid and grasp come from ./vendor/extensions (synced from
// GameSystems by npm run sync); the CharacterCreator character through ./contracts.js (its generated CharacterCreator
// files come from the Contracts game). Tracking is read from the three.js scene (camera + controller grips) so the same
// record works in XR and on desktop, where the arms are synthesised.
// Quality tiers: off (hidden, not solved), low (avatar 'arms': hands and arms, no secondary motion; character 'low'
// preset), high (avatar 'full': full body, walking clips; skin upgrade). The avatar tier switches live; the character's
// rendering preset is chosen when it loads (low unless loaded at high).
import * as THREE from 'three';
import { ccCharacters } from './character-select.js'; // ./contracts.js (CharacterCreator) or ?character=vrm (character-vrm)
import { createCharacterPlugin, handFromGrip, grabFingerState, pourFingerState, poseState, setHandPoseQuality, handPoseQuality, HAND_POSE_QUALITY, setHandVariants } from './vendor/extensions/avatar/index.js';
import { defaultPose, graspPose, handGeometry, runtimeRows, CATALOG, setGraspVariants, setProceduralGrasps, createWeightLag, parseWeightLag } from './vendor/extensions/grasp/index.js';
import { DEMO_AVATAR } from './avatar-config.js';

/** Demo tier -> avatar extension tier (AVATAR_QUALITY). */
export const AVATAR_TIER = Object.freeze({ off: 'off', low: 'arms', high: 'full' });
const REFERENCE = { bottle_beer: { radius: 0.0325, height: 0.2615 }, bottle_wine: { radius: 0.0375, height: 0.35 } };
const GRIP_SECONDS = 0.16, CLOSE_SECONDS = 0.14;
const v = new THREE.Vector3(), q = new THREE.Quaternion(), m = new THREE.Matrix4();

const arr = x => x.toArray();
const lerpArr = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);

/** Which baked kind a demo bottle resembles. */
export function graspKind(bottle) { return bottle.height > 0.3 ? 'bottle_wine' : 'bottle_beer'; }

const adapted = new WeakMap(); // bottle -> { left, right, shape }: the default grasp adapted to this bottle (stable per bottle)
/** This bottle's glass silhouette: the catalogue profile of its kind scaled to its radius and height (item space). */
export function bottleShape(bottle) {
  const kind = graspKind(bottle), ref = REFERENCE[kind], kr = (bottle.radius ?? ref.radius) / ref.radius, ky = (bottle.height ?? ref.height) / ref.height;
  return { type: 'lathe', profile: CATALOG[kind].shape.profile.map(([y, r]) => [y * ky, r * kr]) };
}
/**
 * Pose of the baked default body grasp, adapted to this bottle's radius/height (item space, base-centre origin).
 * With the avatar's hand (closure.handGeometry) and grasp quality 'mid'/'high' the wrist is placed for the hand's length
 * and the fingers are closed to contact with this bottle's silhouette (extensions plan step 3), once per bottle and hand.
 */
export function graspFor(bottle, side, hand = null) {
  const kind = graspKind(bottle), pose = defaultPose(kind, side, 'body') || defaultPose(kind, side);
  if (!pose) return null;
  let cached = adapted.get(bottle);
  if (!cached || cached.radius !== bottle.radius || cached.height !== bottle.height) adapted.set(bottle, cached = { radius: bottle.radius, height: bottle.height });
  if (!cached[side]) {
    const ref = REFERENCE[kind], wrist = [...pose.wrist];
    const radial = Math.hypot(wrist[0], wrist[2]) || 1, dr = (bottle.radius ?? ref.radius) - ref.radius;
    wrist[0] += wrist[0] / radial * dr; wrist[2] += wrist[2] / radial * dr;
    wrist[1] = Math.min(wrist[1], Math.max(0.05, bottle.height * 0.55));
    cached[side] = { ...pose, wrist };
  }
  const shown = hand ? graspPose(cached[side], hand, { shape: cached.shape ??= bottleShape(bottle) }) : cached[side];
  return { pose: shown, wrist: shown.wrist, quat: shown.quat };
}

/**
 * Holds bookkeeping driven by the core's events. holds: owner -> { bottle, side, grasp, k, close }.
 * Exported for tests; player only needs resetTracking().
 */
export function bindAvatarEvents(ctx, { holds, player, handOf = () => null }) {
  ctx.on('grab', ({ owner, bottle, side }) => {
    const grasp = side && graspFor(bottle, side, handOf(side));
    if (grasp) holds.set(owner, { bottle, side, grasp, k: 0, close: 0 });
  });
  ctx.on('release', ({ owner }) => holds.delete(owner));
  // A bottle shot to pieces in the hand: the hand lets go even if the core's release never arrives (grab_findings 1.1).
  ctx.on('broken', ({ bottle }) => { for (const [owner, h] of holds) if (h.bottle === bottle) holds.delete(owner); });
  ctx.on('disconnect', ({ owner }) => holds.delete(owner));
  // Re-run auto calibration for the new viewpoint (desktop eye vs. real head height), never the explicit calibrate()
  // which would switch auto calibration off for good (grab_findings 1.9).
  ctx.on('xrStart', () => player.resetTracking());
  ctx.on('xrEnd', () => player.resetTracking());
}

/** Extension factory: main.js loads it with host.load(() => import('./avatar.js')). */
export default function avatarExtension() {
  let avatar = null, hidden = false;
  return {
    id: 'avatar',
    quality: ['off', 'low', 'high'],
    async init(ctx) {
      avatar = await createAvatar(ctx);
      bindAvatarEvents(ctx, avatar);
      hidden = ctx.quality === 'off';
      const api = {
        get active() { return !hidden; },
        player: avatar.player, characters: avatar.characters, holds: avatar.holds,
        holdPose: (...args) => avatar.holdPose(...args),
        trackedWrist: owner => avatar.trackedWrist(owner),
        /** The baked grasp an owner's hand uses on its bottle, or null. */
        graspOf: owner => avatar.holds.get(owner)?.grasp ?? null,
        /** Visual weight (grasp/weight_lag.js): the shown hand sinks/lags a little with a heavy bottle. ?weightlag=on|off; default off, on with ?testpanel. */
        get weightLag() { return avatar.weightLag; },
        setWeightLag: on => avatar.setWeightLag(on),
        /** Show the raw (unlagged) hand while the weight lag is on: the studio-style 'raw joints' view of the weight lag. */
        get showRawHand() { return avatar.showRawHand; },
        setShowRawHand: on => avatar.setShowRawHand(on),
        /** Hand-pose tier ('low' = the old curves and linear grab, 'mid', 'high'); also ?handposes=low|mid|high. */
        get handPoseQuality() { return handPoseQuality(); },
        setHandPoseQuality,
      };
      return api;
    },
    update(dt) { avatar.update(dt); },
    setQuality(tier) {
      hidden = tier === 'off';
      avatar.player.setQuality(AVATAR_TIER[tier] ?? 'full'); // 'off' hides it; leaving 'off' restarts the solver
    },
    dispose() { avatar?.dispose(); avatar = null; },
  };
}

// Bottle tilt from upright (rad) -> pour progress 0..1 for the hand's pour clip.
const POUR_FROM = 35 * Math.PI / 180, POUR_TO = 115 * Math.PI / 180;
export const pourProgress = tilt => { const x = Math.max(0, Math.min(1, (tilt - POUR_FROM) / (POUR_TO - POUR_FROM))); return x * x * (3 - 2 * x); };

async function createAvatar({ scene, renderer, camera, game, quality, assetURL }) {
  const interaction = game.interaction;
  const hp = typeof location === 'object' ? new URLSearchParams(location.search).get('handposes') : null;
  if (HAND_POSE_QUALITY.includes(hp)) setHandPoseQuality(hp);
  // Grasp Studio recordings are variants (the bake / hand library stays unless picked): ?graspvariant=recorded|<id>[,<id>],
  // ?handvariant=recorded|<name>@rec-<stamp>[,...] (grasp setGraspVariants, avatar setHandVariants).
  const search = typeof location === 'object' ? new URLSearchParams(location.search) : null;
  // Procedural grasps (mug handle and top, carton sides, pole, barrel) are opt-in: ?proceduralgrasps=on (default off = the bake as it was).
  if (search?.has('proceduralgrasps')) setProceduralGrasps(search.get('proceduralgrasps'));
  if (search?.has('graspvariant')) setGraspVariants(search.get('graspvariant'));
  if (search?.has('handvariant')) setHandVariants(search.get('handvariant'));
  const playerQuality = quality === 'high' ? { skinUpgrade: true, shadows: false } // the plugin's 'low' preset, for the player only:
    : { cloth: false, skinUpgrade: false, hairUpgrade: false, shadows: false, hairCollision: false };
  const character = ccCharacters({ assetsURL: assetURL('avatar-assets/'),
    quality: { player: playerQuality, npc: { skinUpgrade: false, shadows: false, cloth: false, hairCollision: false } } });
  const characters = createCharacterPlugin({ scene, renderer, character, quality: AVATAR_TIER[quality] ?? 'full' });
  let player;
  try {
    player = await characters.createPlayer({ ...DEMO_AVATAR });
    await player.ready;
  } catch (error) { characters.dispose?.(); throw error; }
  player.setFirstPerson(true);
  if (!player.root.parent) scene.add(player.root);
  // XR body height (interaction.body): once the first calibration has chosen standing or seated, the avatar is fitted to
  // the standing reference eye. A seated player's rig is lifted by the same amount, so the avatar stands with arms long
  // enough to reach the controllers (an avatar fitted to the seated eye height is too small for its hands to hold).
  const offBody = interaction?.body?.onChange(({ reason, referenceEye }) => {
    if (reason === 'calibrated' && interaction.renderer.xr.isPresenting) player.calibrate(referenceEye);
  });
  const holds = new Map(); // owner -> { bottle, side, grasp, k, close, lag }
  let t = 0;
  // Visual weight: off by default, on with ?testpanel, ?weightlag=on|off decides. The demo's bottle follows the controller
  // kinematically, so the lag runs a virtual body through the real held-drive law (simulate) and only the SHOWN hand moves.
  let lagOn = parseWeightLag(search?.get('weightlag')) ?? !!search?.has('testpanel'), showRaw = false;
  const lagTier = quality === 'high' ? 'high' : 'low';
  const massOf = bottle => (CATALOG[graspKind(bottle)]?.mass ?? 0.5) + (Number.isFinite(bottle.fillMl) ? bottle.fillMl * 0.001 : 0);
  // The avatar's own hand for close-to-contact grasps (the avatar's public rest hand, player.restHand(side): this
  // character's finger geometry, calibrated scale and thumb tilt), rebuilt when the rig, the scale or the hand profile (player.setHandProfile) changes.
  let handCache = null;
  function handOf(side) {
    if (!player.rig) return null;
    if (handCache?.rig !== player.rig || handCache.scale !== player.scale || handCache.version !== player.handProfileVersion) handCache = { rig: player.rig, scale: player.scale, version: player.handProfileVersion };
    if (!(side in handCache)) { const rest = player.restHand(side); handCache[side] = rest && !rest.mitten ? handGeometry(rest) : null; }
    return handCache[side];
  }

  const worldPose = obj => { obj.updateWorldMatrix(true, false); return { pos: arr(obj.getWorldPosition(v)), quat: arr(obj.getWorldQuaternion(q)) }; };
  const snap = (side, trigger, grip, src) => ({ handedness: side, profiles: src?.profiles?.length ? [...src.profiles] : ['desktop-simulated'], hasHand: false, joints: null,
    gamepad: { mapping: 'xr-standard', buttons: [{ value: trigger }, { value: grip }], axes: [0, 0, 0, 0] } });

  function trackedHands() {
    const hands = { left: { valid: false }, right: { valid: false } }, snaps = [];
    if (renderer.xr.isPresenting) {
      const sources = renderer.xr.getSession()?.inputSources || [];
      for (const c of interaction.xrControllers) {
        const side = c.handedness; if (!side || !c.grip.visible) continue;
        const src = [...sources].find(s => s.handedness === side && s.gamepad);
        const g = worldPose(c.grip);
        hands[side] = { ...handFromGrip(side, g.pos, g.quat), valid: true, kind: 'controller' };
        snaps.push({ handedness: side, profiles: src ? [...src.profiles] : [], hasHand: false, joints: null,
          gamepad: { mapping: 'xr-standard', buttons: Array.from(src?.gamepad?.buttons || [], b => ({ value: b.value, touched: b.touched, pressed: b.pressed })), axes: [0, 0, 0, 0] } });
      }
    } else {
      camera.updateWorldMatrix(true, false);
      const head = worldPose(camera);
      const place = (side, off, trigger, grip) => {
        v.set(...off).applyQuaternion(camera.getWorldQuaternion(q)).add(camera.getWorldPosition(new THREE.Vector3()));
        hands[side] = { ...handFromGrip(side, arr(v), head.quat), valid: true, kind: 'desktop' };
        snaps.push(snap(side, trigger, grip));
      };
      place('right', holds.has('desktop') ? [0.1, -0.16, -0.42] : [0.2, -0.28, -0.32], 0, holds.has('desktop') ? 1 : 0.45); place('left', [-0.24, -0.5, -0.17], 0, 0.15);
    }
    return { hands, snaps };
  }

  function bottleItem(bottle) {
    bottle.root.updateWorldMatrix(true, false);
    return { pos: new THREE.Vector3().setFromMatrixPosition(bottle.root.matrixWorld), quat: bottle.root.getWorldQuaternion(new THREE.Quaternion()) };
  }

  let tracked = null;
  const gunPoses = new Map(), gunPose = id => gunPoses.get(id) ?? gunPoses.set(id, poseState(id, { src: 'virtual' })).get(id);
  return {
    characters, player, holds, handOf,
    get weightLag() { return lagOn; }, setWeightLag(on) { lagOn = !!on; if (!lagOn) for (const h of holds.values()) { h.lag?.reset(); h.shown = null; } },
    get showRawHand() { return showRaw; }, setShowRawHand(on) { showRaw = !!on; },
    /**
     * Bottle pose for this frame: eases from the pose the demo computed (controller ray) onto the baked grasp relation
     * (wrist-in-hand), so the bottle ends up sitting in the visible hand instead of floating at the controller.
     */
    holdPose(owner, base, dt, wrist) {
      const h = holds.get(owner); if (!h) return base;
      h.k = Math.min(1, h.k + dt / GRIP_SECONDS);
      if (h.k >= 1) h.close = Math.min(1, h.close + dt / CLOSE_SECONDS); else h.close = 0;
      // Desktop: the demo's own camera-driven bottle pose stays authoritative (tilt/pour); the hand is posed onto the bottle instead.
      if (!wrist || owner === 'desktop') return base;
      const qi = new THREE.Quaternion(...h.grasp.quat).invert();
      const itemQ = new THREE.Quaternion(...wrist.quat).multiply(qi);
      const itemP = new THREE.Vector3(...h.grasp.wrist).applyQuaternion(itemQ).negate().add(new THREE.Vector3(...wrist.pos));
      const e = h.k * h.k * (3 - 2 * h.k);
      return { position: base.position.clone().lerp(itemP, e), quaternion: base.quaternion.clone().slerp(itemQ, e) };
    },
    /** Tracked wrist (world) for an owner this frame; set by update(). owner: 0/1 (XR controller index) or 'desktop'. */
    trackedWrist(owner) {
      const side = holds.get(owner)?.side ?? (owner === 'desktop' ? 'right' : interaction.xrControllers[owner]?.handedness);
      return tracked?.[side] || null;
    },
    update(dt) {
      t += dt;
      camera.updateWorldMatrix(true, false);
      const head = worldPose(camera), { hands, snaps } = trackedHands();
      tracked = { ...hands };
      const fingers = {};
      for (const [owner, h] of holds) {
        // Backstop for grab_findings 1.1: a bottle removed from the scene (shot, reset) never keeps the hand.
        if (!h.bottle.root.parent) { holds.delete(owner); continue; }
        const hand = hands[h.side]; if (!hand?.valid) continue;
        const item = bottleItem(h.bottle);
        const target = { pos: arr(new THREE.Vector3(...h.grasp.wrist).applyQuaternion(item.quat).add(item.pos)), quat: arr(item.quat.clone().multiply(new THREE.Quaternion(...h.grasp.quat))) };
        const e = h.k * h.k * (3 - 2 * h.k);
        hands[h.side] = { ...hand, pos: lerpArr(hand.pos, target.pos, e), quat: arr(new THREE.Quaternion(...hand.quat).slerp(new THREE.Quaternion(...target.quat), e)) };
        h.lag ??= createWeightLag({ enabled: true, tier: lagTier });
        if (lagOn && !showRaw) {
          const r = h.lag.update({ dt, mass: massOf(h.bottle), target: arr(item.pos), simulate: true });
          if (r.active) hands[h.side] = { ...hands[h.side], pos: hands[h.side].pos.map((x, i) => x + r.offset[i]) };
          h.shown = r;
        } else { h.lag.reset(); h.shown = null; }
        // Open approach -> grip closed to contact on this hand (or the clamped bake at grasp quality 'low'), memoised;
        // the hand-pose grab clip shapes the closing (linear at hand-pose tier 'low'), the pour clip the tilted grip.
        const rows = runtimeRows(h.grasp.pose);
        if (h.close < 1) fingers[h.side] = grabFingerState(rows, h.close);
        else {
          const up = new THREE.Vector3(0, 1, 0).applyQuaternion(item.quat);
          fingers[h.side] = pourFingerState(rows, pourProgress(Math.acos(Math.max(-1, Math.min(1, up.y)))));
        }
      }
      // The pistol hand (pistol.js): the named Godot poses, 'pistol' (index along the guard) and 'trigger' just after a
      // shot. On desktop the hand goes to the pistol's grip (it converges on the crosshair, so it is not the fixed offset).
      const gun = interaction.pistol, gunSide = gun?.owner == null ? null : gun.owner === 'desktop' ? 'right' : interaction.xrControllers[gun.owner]?.handedness;
      if (gunSide && !fingers[gunSide]) {
        fingers[gunSide] = gunPose(gun.firing ? 'trigger' : 'pistol');
        if (gun.owner === 'desktop') { const g = gun.gripPose(); hands.right = { ...handFromGrip('right', g.pos, g.quat), valid: true, kind: 'desktop' }; }
      }
      player.updateTracking({ t, head, hands, snaps, eyes: null, fingers }, dt);
    },
    dispose() { offBody?.(); player.dispose(); characters.dispose?.(); },
  };
}
