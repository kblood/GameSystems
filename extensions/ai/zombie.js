// GameSystems ai extension: the zombie brain. Pure (no three.js). One brain per agent:
//   world.addAgent(createZombieBrain({ aggression: 0.8 }), body)
//
// Behaviour:
// - roam: idle and wander near home until something is noticed.
// - investigate: a heard stimulus (gunshot, impact, footstep) or a half-noticed glimpse; walks to the (inexact) spot.
// - chase: contact from sight (short range, narrow cone), touch range (senseRadius) or a hit; follows the navmesh
//   around boxes and walls. Close to the player the horde coordinator hands out surround slots, so zombies spread
//   around the player (never into the escape lane) instead of stacking; without a free slot a zombie waits farther out.
// - attack (VR): a slot reached and an attack token taken -> windup (intent.telegraph 0..1, the host shows it) -> a
//   short lunge -> grab a hand, bite at the head, or from the floor grab an ankle / bite the legs. Damage is an 'attack'
//   event; the player body and camera are never moved. Shoving the zombie with a fast hand, or shooting it, during the
//   windup cancels the attack. At most horde.maxAttackers zombies wind up or attack at once.
// - gore: the host hands over mobility (setMobility, mobilityFromGore): walk / limp / crawl speeds and which limbs work.
//   A crawler attacks low; a zombie without arms cannot grab but still bites; headless or dead is dead.
// - physical state (world.setPhysicalState): destabilized / downed / recovering / inert pause movement and attacks
//   (an attack in progress is cancelled); 'standing' resumes. The IK / active-ragdoll layer owns the body meanwhile.
import { createUtility } from './utility.js';
import { updateAwareness, INVESTIGATE_AT } from './perception.js';
import { moveTo, pushToward, stand, faceToward, faceVelocity } from './steering.js';
import { point, flatDistance } from './math.js';

export const ZOMBIE_DEFAULTS = Object.freeze({
  aggression: 0.6,            // 0..1: how readily it chases, attacks again and keeps after a lost target
  hearingRange: 1,            // multiplier on every stimulus radius
  sightRange: 7,              // m, standing (short sight; zombies mostly hear)
  viewHalfAngle: 55,          // deg
  alertViewHalfAngle: 80,
  senseRadius: 1.4,           // m: notices the player this close without seeing (touch, smell)
  detectionRate: 2.4,
  memory: 9,                  // s
  eyeHeight: 1.55, crawlEyeHeight: 0.35, crawlSightScale: 0.6,
  speed: Object.freeze({ wander: 0.22, investigate: 0.4, chase: 0.55 }),   // m/s at walk, before gore's speed factor
  speedMultiplier: 1,
  investigateFor: 40,         // s: walking to a heard spot keeps it in mind this long
  wanderRadius: 2.5,          // m around home
  wanderPause: Object.freeze([1.2, 3.5]),
  personalSpace: 0.5,         // m from the tracked head (VR)
  handSpace: 0.3,
  maxAttackers: 2,            // horde: zombies attacking at once (written into the world's horde coordinator)
  hordeSpacing: 0.65,         // m between surround slots
  attack: Object.freeze({
    range: 0.85,              // m (flat) from the head where a standing zombie stops to attack
    crawlRange: 1.05,         // m: a crawler's body stops farther out; its head and arms are ahead of it
    windup: 0.75,             // s telegraph before the lunge
    lunge: 0.3,               // s
    lungeSpeed: 1.4,          // m/s (personal space still holds)
    reach: 0.5,               // m added to range when deciding whether the lunge connects
    cooldown: 1.6,            // s after an attack (shortened by aggression)
    damage: Object.freeze({ grab: 6, bite: 15, ankle: 5, legBite: 8 }),
  }),
  shove: Object.freeze({ speed: 1.4, radius: 0.5 }),   // a tracked hand this fast this close cancels a windup
  flinch: Object.freeze({ head: 0.6, chest: 0.4, arm: 0.25, leg: 0.45 }),   // s: hit during an attack -> attack cancelled
});

const merge = (base, over) => {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge(base[k], v) : v;
  return out;
};

/** Body region (gore region ids or guard zones) -> head | chest | arm | leg. */
export function regionClass(region = '') {
  const r = String(region);
  if (/head|cranium|jaw|neck/i.test(r)) return 'head';
  if (/arm|hand/i.test(r)) return 'arm';
  if (/leg|foot/i.test(r)) return 'leg';
  return 'chest';
}

/**
 * Gore hand-off: reads a gore zombie (extensions/gore: mobility(), speedFactor(), limbs(), limpSide(), lost(id), dead)
 * into the brain's mobility record. Duck-typed: ai never imports gore.
 */
export function mobilityFromGore(zombie, out = {}) {
  out.mode = zombie.mobility?.() ?? 'walk';
  out.speedFactor = zombie.speedFactor?.() ?? 1;
  out.limbs = zombie.limbs?.() ?? { leftArm: true, rightArm: true, leftLeg: true, rightLeg: true };
  out.limpSide = zombie.limpSide?.() ?? null;
  out.headless = !!zombie.lost?.('head');
  out.dead = !!zombie.dead || out.headless;
  return out;
}

/**
 * Which attack a zombie makes: { kind, target }. kind: grab (a hand) | bite (the head) | ankle (grab low) | legBite.
 * target: leftHand | rightHand | head | legs. A crawler always goes low; no arms means no grab.
 */
export function chooseAttack(mobility, player, position, reach = 1.4) {
  const arms = mobility.limbs?.leftArm || mobility.limbs?.rightArm;
  if (mobility.mode === 'crawl' || mobility.mode === 'none') return arms ? { kind: 'ankle', target: 'legs' } : { kind: 'legBite', target: 'legs' };
  if (arms) {
    let best = null, bestD = reach;
    for (const hand of player.hands) {
      if (!hand.tracked) continue;
      const d = flatDistance(position, hand);
      if (d < bestD && d < flatDistance(position, player.head) + 0.15) { bestD = d; best = hand.side === 'left' ? 'leftHand' : 'rightHand'; }
    }
    if (best) return { kind: 'grab', target: best };
  }
  return { kind: 'bite', target: 'head' };
}

export function createZombieBrain(config = {}) {
  const cfg = merge(ZOMBIE_DEFAULTS, config);
  const roam = createUtility([
    { id: 'chase', score: c => c.contact ? 1 : 0 },
    { id: 'investigate', score: c => c.memory > 0 ? 0.7 + 0.2 * cfg.aggression : 0 },
    { id: 'roam', score: () => 0.2 },
  ], { hysteresis: 0.05 });
  const home = point(), goal = point(), targetPoint = point();
  let state = 'roam', attackKind = null, attackTarget = null, investigating = 0, timer = 0, recoverFor = 0, roamTimer = 0, roaming = false, cooldown = 0;
  const mob = { mode: 'walk', speedFactor: 1, limbs: { leftArm: true, rightArm: true, leftLeg: true, rightLeg: true }, limpSide: null, dead: false, headless: false };

  const brain = {
    kind: 'zombie', config: cfg, usesHorde: true, mobility: mob,
    perception: { sightRange: cfg.sightRange, viewHalfAngle: cfg.viewHalfAngle, alertViewHalfAngle: cfg.alertViewHalfAngle, senseRadius: cfg.senseRadius,
      detectionRate: cfg.detectionRate, hearing: cfg.hearingRange, memory: cfg.memory, hearingMemory: cfg.memory, eyeHeight: cfg.eyeHeight,
      nearRange: 3, samples: 2, alertDecay: 20 },
    move: { personalSpace: cfg.personalSpace, handSpace: cfg.handSpace, separation: cfg.hordeSpacing },
    raysPerUpdate: 2,
    get state() { return state; },
    init(agent, ctx) {
      copyPoint(home, agent.position);
      agent.personalSpace = cfg.personalSpace; agent.intent.state = state;
      if (ctx.horde) { ctx.horde.config.maxAttackers = cfg.maxAttackers; ctx.horde.config.spacing = cfg.hordeSpacing; }
      roamTimer = agent.rng.range(...cfg.wanderPause);
    },
    reset(agent) { state = 'roam'; attackKind = attackTarget = null; timer = cooldown = recoverFor = investigating = 0; roaming = false; copyPoint(home, agent.position); agent.intent.state = state; },
    setMobility(agent, m) { Object.assign(mob, m); },
    eyeHeight: () => mob.mode === 'crawl' || mob.mode === 'none' ? cfg.crawlEyeHeight : cfg.eyeHeight,
    engaged: () => state === 'chase' || state === 'surround' || isAttacking(),
    wantsSlot: agent => !agent.dead && agent.perception.contact && (state === 'chase' || state === 'surround' || isAttacking()) && agent.ctx.player.active
      && flatDistance(agent.position, agent.ctx.player.head) < 3.5,

    think(agent, ctx) {
      const p = agent.perception, intent = agent.intent, player = ctx.player, dt = ctx.dt, sense = agent.sense;
      intent.telegraph = 0; intent.attack = null; intent.hasLook = false; intent.crouch = false;
      intent.gait = mob.mode === 'crawl' || mob.mode === 'none' ? 'crawl' : mob.mode === 'limp' ? 'limp' : 'walk';
      if (mob.dead || mob.headless) return die(agent, ctx);
      if (agent.dead) { setState(agent, ctx, 'dead'); stand(agent); return; }
      cooldown = Math.max(0, cooldown - dt);
      // crawlers see less far
      sense.sightRange = cfg.sightRange * (intent.gait === 'crawl' ? cfg.crawlSightScale : 1);
      const visible = (p.seen && p.seenAge <= ctx.perceptionHold) || p.sensed;
      updateAwareness(p, sense, dt, visible, player.head);
      if (visible && (p.suspicion >= 1 || p.sensed)) { if (!p.contact) ctx.emit('spotted', { agent, at: copyPoint(point(), player.head) }); p.contact = true; p.alert = true; }
      if (p.contact && !visible && p.unseenTime > 2 + 4 * cfg.aggression) p.contact = false;   // lost it: search the last spot
      if (p.memory <= 0) p.contact = false;

      if (agent.physical !== 'standing') {
        // the IK / ragdoll layer owns the body: no movement, no attacks, an attack in progress is lost
        if (isAttacking()) cancelAttack(agent, ctx, 'physical');
        intent.paused = true; stand(agent); return;
      }
      intent.paused = false;
      const speedScale = cfg.speedMultiplier * (mob.speedFactor ?? 1);

      if (isAttacking()) return attack(agent, ctx, visible, speedScale);
      if (!p.contact && p.suspicion >= INVESTIGATE_AT && p.memory <= 0) p.memory = 2;
      const goalId = roam.choose({ contact: p.contact, memory: p.memory }, state === 'surround' ? 'chase' : state);
      if (goalId === 'chase') return chase(agent, ctx, visible, speedScale);
      if (goalId === 'investigate') {
        if (state !== 'investigate' || p.heardAge <= dt + 1e-9) investigating = 0;   // a new sound restarts the walk
        setState(agent, ctx, 'investigate');
        investigating += dt;
        const r = moveTo(agent, ctx, p.lastKnown, cfg.speed.investigate * speedScale, 0.4);
        faceVelocity(agent);
        // a slow zombie does not forget a sound while it is still walking there (up to investigateFor)
        if (r === 'moving' && investigating < cfg.investigateFor) p.memory = Math.max(p.memory, 0.5);
        if (r !== 'moving') { p.memory = Math.min(p.memory, 1.5); faceToward(agent, p.lastKnown); copyPoint(home, agent.position); }
        return;
      }
      setState(agent, ctx, 'roam');
      roamTimer -= dt;
      if (roaming) {
        const r = moveTo(agent, ctx, goal, cfg.speed.wander * speedScale, 0.25);
        faceVelocity(agent);
        if (r !== 'moving' || roamTimer < -8) { roaming = false; roamTimer = agent.rng.range(...cfg.wanderPause); }
      } else {
        stand(agent);
        if (roamTimer <= 0) {
          const a = agent.rng.angle(), d = agent.rng.range(0.5, cfg.wanderRadius);
          goal.x = home.x + Math.sin(a) * d; goal.y = home.y; goal.z = home.z + Math.cos(a) * d;
          if (ctx.nav.closest(goal, goal)) { roaming = true; roamTimer = 0; }
          else roamTimer = 1;
        }
      }
    },

    /** A hit (world.hit): cancels a windup / lunge for the region's flinch time and makes the zombie aware. */
    onHit(agent, hit, ctx) {
      if (agent.dead) return {};
      const p = agent.perception, cls = regionClass(hit.region);
      p.alert = true; p.contact = true; p.memory = cfg.memory; p.quietTime = 0;
      if (ctx.player.active) copyPoint(p.lastKnown, ctx.player.head);
      else if (hit.point && hit.direction) { p.lastKnown.x = hit.point.x - hit.direction.x * 3; p.lastKnown.z = hit.point.z - hit.direction.z * 3; }
      const flinch = cfg.flinch[cls] ?? 0.3;
      if (isAttacking() && (hit.damage ?? 1) > 0) { cancelAttack(agent, ctx, 'hit'); recoverFor = flinch; }
      return { regionClass: cls, stagger: flinch };
    },
  };

  function isAttacking() { return state === 'windup' || state === 'lunge' || state === 'recover'; }
  function setState(agent, ctx, next) {
    if (next === state) return;
    const from = state; state = next; agent.intent.state = next;
    ctx.emit('state', { agent, from, to: next });
  }
  function die(agent, ctx) {
    if (!agent.dead) { agent.dead = true; ctx.horde?.releaseAttack(agent); ctx.emit('death', { agent }); }
    setState(agent, ctx, 'dead'); stand(agent);
  }
  function cancelAttack(agent, ctx, reason) {
    ctx.horde?.releaseAttack(agent);
    if (state === 'windup' || state === 'lunge') ctx.emit('attackCancelled', { agent, reason, kind: attackKind });
    setState(agent, ctx, 'recover'); timer = 0; recoverFor = 0.5; cooldown = Math.max(cooldown, 0.8);
  }
  function targetOf(player, name, out) {
    if (name === 'legs') { out.x = player.head.x; out.y = player.floorY + 0.12; out.z = player.head.z; return out; }
    if (name === 'leftHand' || name === 'rightHand') {
      const hand = player.hands[name === 'leftHand' ? 0 : 1];
      if (hand.tracked) return copyPoint(out, hand);
    }
    return copyPoint(out, player.head);
  }
  function standoff() { return mob.mode === 'crawl' || mob.mode === 'none' ? cfg.attack.crawlRange : cfg.attack.range; }

  function chase(agent, ctx, visible, speedScale) {
    const player = ctx.player, p = agent.perception, intent = agent.intent;
    const live = visible || p.unseenTime < 0.6;   // follows the real player for a moment after losing sight
    const target = live && player.active ? player.head : p.lastKnown;
    const range = standoff(), d = flatDistance(agent.position, target);
    const speed = cfg.speed.chase * speedScale;
    if (agent.slot && live && ctx.horde && d < 3.5) {
      ctx.horde.slotPosition(agent, target, range, goal);
      // on the slot itself (after a lunge the zombie walks back out to it, so neighbours never stack)
      const atSlot = flatDistance(agent.position, goal) < 0.12;
      intent.hasLook = true; copyPoint(intent.look, target);
      if (atSlot && agent.slot.valid) {
        stand(agent); faceToward(agent, target);
        const canAttack = player.tracking && cooldown <= 0 && (mob.speedFactor > 0 || d <= range + 0.1);
        if (canAttack && ctx.horde.requestAttack(agent)) return beginWindup(agent, ctx);
        setState(agent, ctx, 'surround');
        return;
      }
      setState(agent, ctx, agent.slot.valid ? 'chase' : 'surround');
      const r = moveTo(agent, ctx, goal, speed, 0.05);
      if (r === 'moving') faceVelocity(agent); else faceToward(agent, target);
      return;
    }
    setState(agent, ctx, 'chase');
    if (!live && d < 0.6) { p.contact = false; stand(agent); return; }   // reached the last known spot: nothing here
    const r = moveTo(agent, ctx, target, speed, live ? range : 0.3);
    if (r === 'moving') faceVelocity(agent); else faceToward(agent, target);
    if (live) { intent.hasLook = true; copyPoint(intent.look, target); }
    // no horde coordinator: attack straight from the chase
    if (!ctx.horde && live && d <= range + 0.12 && player.tracking && cooldown <= 0) beginWindup(agent, ctx);
  }

  function beginWindup(agent, ctx) {
    const choice = chooseAttack(mob, ctx.player, agent.position, standoff() + cfg.attack.reach + 0.4);
    attackKind = choice.kind; attackTarget = choice.target; timer = 0;
    setState(agent, ctx, 'windup');
    targetOf(ctx.player, attackTarget, targetPoint);
    agent.intent.attack = attackKind; agent.intent.target = attackTarget;
    ctx.emit('telegraph', { agent, kind: attackKind, target: attackTarget, windup: cfg.attack.windup, at: copyPoint(point(), targetPoint) });
    agent.intent.actions.push({ type: 'windup', kind: attackKind, target: attackTarget });
    stand(agent);
  }

  function attack(agent, ctx, visible, speedScale) {
    const intent = agent.intent, player = ctx.player, a = cfg.attack, dt = ctx.dt;
    timer += dt;
    if (state === 'recover') {
      // step back out to the slot on the ring (a lunge ends inside it), facing the player
      if (agent.slot?.valid && player.active && ctx.horde) {
        ctx.horde.slotPosition(agent, player.head, standoff(), goal);
        if (moveTo(agent, ctx, goal, cfg.speed.chase * speedScale * 0.7, 0.05) !== 'moving') stand(agent);
      } else stand(agent);
      faceToward(agent, player.head);
      if (timer >= recoverFor) setState(agent, ctx, agent.perception.contact ? 'chase' : 'roam');
      return;
    }
    if (!player.active || !player.tracking) return cancelAttack(agent, ctx, 'tracking');
    targetOf(player, attackTarget, targetPoint);
    intent.attack = attackKind; intent.target = attackTarget;
    intent.hasLook = true; copyPoint(intent.look, targetPoint);
    faceToward(agent, targetPoint);
    if (shoved(agent, ctx)) return;
    if (state === 'windup') {
      intent.telegraph = Math.min(1, timer / a.windup);
      stand(agent);
      if (timer >= a.windup) { setState(agent, ctx, 'lunge'); timer = 0; agent.intent.actions.push({ type: 'lunge', kind: attackKind, target: attackTarget }); }
      return;
    }
    // lunge: a short burst toward the target; personal space still stops the body short of the head
    intent.telegraph = 1;
    pushToward(agent, ctx, targetPoint, a.lungeSpeed * Math.max(0.35, speedScale));
    if (timer < a.lunge) return;
    const reach = standoff() + a.reach, d = flatDistance(agent.position, targetPoint);
    if (d <= reach) {
      const damage = a.damage[attackKind] ?? 0;
      const event = { agent, kind: attackKind, target: attackTarget, damage, at: copyPoint(point(), targetPoint) };
      intent.actions.push({ type: 'attack', kind: attackKind, target: attackTarget, damage });
      ctx.emit('attack', event);
    } else ctx.emit('attackMissed', { agent, kind: attackKind, target: attackTarget, distance: d });
    ctx.horde?.releaseAttack(agent);
    cooldown = a.cooldown * (1.3 - 0.6 * cfg.aggression);
    setState(agent, ctx, 'recover'); timer = 0; recoverFor = 0.6; stand(agent);
  }

  /** A fast tracked hand into the zombie's head/chest during an attack pushes it off (no camera or body motion). */
  function shoved(agent, ctx) {
    const low = mob.mode === 'crawl' || mob.mode === 'none';
    for (const hand of ctx.player.hands) {
      if (!hand.tracked || hand.speed < cfg.shove.speed) continue;
      const dy = hand.y - (agent.position.y + (low ? 0.35 : 1.3));
      if (Math.hypot(hand.x - agent.position.x, hand.z - agent.position.z, dy * 0.6) > cfg.shove.radius + (low ? 0.3 : 0.15)) continue;
      ctx.emit('shoved', { agent, hand: hand.side, velocity: { x: hand.vx, y: 0, z: hand.vz } });
      cancelAttack(agent, ctx, 'shoved');
      recoverFor = 0.9;   // a little longer than a plain cancel
      return true;
    }
    return false;
  }
  return brain;
}

function copyPoint(out, p) { out.x = p.x; out.y = p.y; out.z = p.z; return out; }
