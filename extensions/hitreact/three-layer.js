// GameSystems hitreact extension: the thin three.js layer. THREE is passed in (the extension never imports three, like
// extensions/ai three-adapters.js). It converts world hits into the character frame, runs the pure reaction
// (reaction.js), applies the result to the character's bones (character.applyPose, humanoid contract) and moves the
// character root by the pelvis offset; with the opt-in ragdoll it runs the physics segments (ragdoll-driver.js) while the
// body is downed or inert and blends back to the animated pose while recovering.
//
//   const reactor = createHitReactor(THREE, { character, config, physics, lost })
//   reactor.hit({ region, point, direction, impulse })   world space (THREE.Vector3 or arrays); returns the reaction result
//   const r = reactor.update(dt, animatedPose)            after the animator: applies the pose, returns
//                                                          { state, events: [{ from, to }], ragdoll, blend }
//   reactor.kill()  dead -> 'inert';  reactor.reset();  reactor.takeRecenter() -> world [dx, 0, dz] | null;  dispose()
//
// character: the humanoid contract (root, restHeads(), applyPose(); onRestChange optional). The character frame is
// character.root (its local space is where restHeads and canonical poses live). physics: a physics adapter; the ragdoll
// runs only when config.ragdoll.enabled is true AND the adapter has the ragdoll capability (ragdoll-driver.js).
// lost(regionId) -> true for a severed region (gore): its segment is not built.
import { fkPositions, qMul, qConj } from '../humanoid/index.js';
import { resolveHitReactConfig } from './config.js';
import { createHitReaction } from './reaction.js';
import { applyReaction, blendPoses } from './pose.js';
import { restSegments, segmentFrames, jointFrames, poseFromSegments, segmentForRegion, createDownedMonitor } from './ragdoll.js';
import { createRagdollDriver, supportsRagdoll } from './ragdoll-driver.js';

const arr = p => (Array.isArray(p) ? p : p && Number.isFinite(p.x) ? [p.x, p.y, p.z] : null);

export function createHitReactor(THREE, { character, config = {}, physics = null, lost = null } = {}) {
  if (!character?.root || typeof character.applyPose !== 'function' || typeof character.restHeads !== 'function') throw new TypeError('createHitReactor: character must follow the humanoid contract (root, restHeads, applyPose)');
  const cfg = resolveHitReactConfig(...[].concat(config));
  const ragdollOn = cfg.ragdoll.enabled && supportsRagdoll(physics);
  const reaction = createHitReaction(cfg, { externalRecovery: ragdollOn });
  const driver = ragdollOn ? createRagdollDriver(physics, cfg.ragdoll) : null;
  const monitor = createDownedMonitor(cfg.ragdoll);
  let H = character.restHeads(), rest = restSegments(H);
  const offRest = character.onRestChange?.(() => { H = character.restHeads(); rest = restSegments(H); });

  const M = new THREE.Matrix4(), inv = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3(), v = new THREE.Vector3();
  let scale = 1, qa = [0, 0, 0, 1];
  const frame = () => {
    character.root.updateWorldMatrix(true, false);
    M.copy(character.root.matrixWorld); M.decompose(pos, quat, scl); inv.copy(M).invert();
    scale = (scl.x + scl.y + scl.z) / 3; qa = [quat.x, quat.y, quat.z, quat.w];
  };
  const toLocal = p => v.fromArray(p).applyMatrix4(inv).toArray();
  const toWorld = p => v.fromArray(p).applyMatrix4(M).toArray();
  const dirToLocal = d => v.fromArray(d).applyQuaternion(quat.clone().invert()).toArray();

  let lastPose = null, lastState = reaction.state, pendingKnock = null, snapshot = null, blend = 0, recenter = null;
  const local0 = pose => ({ ...pose, root: [0, 0, 0] });

  function activate(pose, muscles) {
    const base = local0(pose ?? lastPose ?? { joints: {} });
    const localFrames = segmentFrames(H, base, rest), worldFrames = {};
    for (const [k, f] of Object.entries(localFrames)) worldFrames[k] = { center: toWorld(f.center), quaternion: qMul(qa, f.quaternion) };
    const skip = new Set(Object.values(rest).filter(r => lost?.(r.region)).map(r => r.key));
    driver.activate({ frames: worldFrames, joints: jointFrames(H, base, localFrames, rest, scale), rest, scale, skip, muscles });
    if (pendingKnock && cfg.ragdoll.knockdownImpulse > 0) {
      const d = pendingKnock.direction, k = cfg.ragdoll.knockdownImpulse;
      driver.applyImpulse('upperChest', [d[0] * k, d[1] * k, d[2] * k], null);
    }
    pendingKnock = null; monitor.reset();
  }
  function readLocal() {
    const out = {};
    for (const [k, f] of Object.entries(driver.read())) out[k] = { center: toLocal(f.center), quaternion: qMul(qConj(qa), f.quaternion) };
    return out;
  }

  const api = {
    reaction, driver, get config() { return cfg; }, get state() { return reaction.state; }, get ragdollEnabled() { return ragdollOn; },
    get ragdollActive() { return !!driver?.active; },

    /** A hit in world space. impulse N·s (the ai hit hook's value). */
    hit({ region = 'chest', point = null, direction = null, impulse = 0 } = {}) {
      frame();
      const p = arr(point), d = arr(direction);
      const heads = lastPose ? fkPositions(H, local0(lastPose)) : H;
      const result = reaction.hit({ region, point: p ? toLocal(p) : null, direction: d ? dirToLocal(d) : null, impulse, heads });
      if (d) {
        const l = Math.hypot(...d) || 1, dir = [d[0] / l, d[1] / l, d[2] / l];
        pendingKnock = { direction: dir };
        if (driver?.active) {
          const shot = cfg.ragdoll.shotImpulse > 0 ? cfg.ragdoll.shotImpulse : impulse;
          driver.applyImpulse(segmentForRegion(region), [dir[0] * shot, dir[1] * shot, dir[2] * shot], p);
        }
      }
      return result;
    },
    kill() { reaction.kill(); },
    /** World [dx, 0, dz] the host may add to the body's position when recovering from a ragdoll fall (once), or null. */
    takeRecenter() {
      const r = recenter; recenter = null;
      if (r && snapshot) { snapshot.root = [snapshot.root[0] - r.local[0], snapshot.root[1], snapshot.root[2] - r.local[2]]; }
      return r ? r.world : null;
    },

    /** After the animator: the reacted (or ragdoll, or blended) pose goes onto the bones. */
    update(dt, pose) {
      dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
      frame();
      const animated = local0(pose ?? lastPose ?? { joints: {} });
      lastPose = pose ?? lastPose;
      const f = reaction.update(dt);
      let out, ragdoll = false;
      if (driver) {
        const state = reaction.state;
        if ((state === 'downed' || state === 'inert') && !driver.active) activate(animated, state === 'downed' ? cfg.ragdoll.muscleScale : 0);
        if (state === 'inert' && driver.active) driver.setMuscles(0);
        if (driver.active) {
          if (state === 'downed') {
            const targets = segmentFrames(H, animated, rest), world = {};
            for (const [k, t] of Object.entries(targets)) world[k] = qMul(qa, t.quaternion);
            driver.setTargets(world);
            if (monitor.update(dt, driver.maxSpeed())) reaction.recover();
          }
          const ragPose = poseFromSegments(H, readLocal(), animated, rest);
          if (reaction.state === 'recovering') {
            // stop simulating; blend from where the body lies back to the animated pose
            snapshot = ragPose; blend = 1; driver.deactivate();
            if (cfg.ragdoll.recenter) {
              const local = [snapshot.root[0], 0, snapshot.root[2]];
              const w = v.fromArray(local).applyQuaternion(quat).multiplyScalar(scale).toArray();
              recenter = { local, world: [w[0], 0, w[2]] };
            }
          } else { out = ragPose; ragdoll = true; }
        }
      }
      if (!out) {
        const reacted = applyReaction(animated, H, driver ? { ...f, collapse: 0 } : f, cfg);
        if (snapshot) {
          blend = Math.max(0, blend - dt / cfg.downed.recoverSeconds);
          const s = blend * blend * (3 - 2 * blend);
          out = blendPoses(reacted, snapshot, s);
          if (blend <= 0) { snapshot = null; recenter = null; }
        } else out = reacted;
      }
      character.applyPose(out);
      const off = out.root ?? [0, 0, 0];
      if (off[0] || off[1] || off[2]) character.root.position.add(v.fromArray(off).applyQuaternion(character.root.quaternion));
      character.root.updateMatrixWorld?.(true);
      const events = [];
      if (reaction.state !== lastState) { events.push({ from: lastState, to: reaction.state }); lastState = reaction.state; }
      return { state: reaction.state, events, ragdoll, blend: snapshot ? blend : 0, pose: out, active: f.active };
    },
    reset() { reaction.reset(); driver?.deactivate(); monitor.reset(); snapshot = null; blend = 0; recenter = null; pendingKnock = null; lastState = reaction.state; },
    dispose() { driver?.deactivate(); offRest?.(); },
  };
  return api;
}
