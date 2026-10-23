// The bottle system on a host physics adapter: bodies + factory + pour + breakage wired together, stepped from the
// adapter's onStep (after every physics step, after its contact reports), so it runs exactly where the physics
// results are fresh and never while the game is paused.
//
// Order per step: poses to the three.js roots, coalesced impacts (assess, crack, pierce, shatter), liquid + mass from
// fill, pouring/drops/puddles, panes/debris. A shattered bottle calls emit('broken', { bottle }) before it is removed.
import { assertPhysicsAdapter } from '../host/index.js';
import { BottleBodies } from './bodies.js';
import { BottleFactory } from './factory.js';
import { PourSystem } from './pour.js';
import { BreakageSystem } from './breakage.js';
import { BottleAudio } from './audio.js';
import { BOTTLE_TIERS } from './quality.js';
import { createBottleStateOwner } from './state.js';

/**
 * scene: THREE.Scene; physics: host physics adapter; catalog: GameSystems catalog.json content; assetURL(path) -> url of a
 * GameSystems asset path; surfaces: room meshes that receive liquid; audio: { play(key, minGapMs) } (default: HTML audio);
 * tier: one of BOTTLE_TIERS; emit(event, data): the host bus.
 */
export function createBottleSystem({ scene, physics, catalog = { assets: [] }, assetURL = path => path, surfaces = [], audio = null,
  tier = 'high', emit = () => {}, sourceKey = 'bottles', liquidViscosity = false } = {}) {
  if(typeof sourceKey!=='string'||!sourceKey)throw new TypeError('Invalid bottle source key');
  assertPhysicsAdapter(physics);
  audio ??= new BottleAudio(assetURL);
  const bodies = new BottleBodies(physics);
  const factory = new BottleFactory(scene, bodies, audio, catalog, { assetURL, tier: BOTTLE_TIERS.includes(tier) ? tier : 'high' });
  const pour = new PourSystem(scene, factory, audio, surfaces, bodies, data => emit('liquid:deposit', {...data, sourceKey}));
  pour.setLiquidViscosity(liquidViscosity ? true : null); // opt-in; off keeps the plain discharge coefficient
  const breakage = new BreakageSystem(scene, bodies, factory, pour, audio);
  const stateOwner=createBottleStateOwner({factory,pour,bodies,physics,scene,breakage,sourceKey});
  breakage.onBroken = bottle => emit('broken', { bottle });

  function step(dt) {
    bodies.sync();
    bodies.flushImpacts();
    factory.update(dt);
    pour.step(dt);
    breakage.step(dt);
  }
  let offStep = physics.onStep(step);

  function setQuality(name) {
    factory.setQuality(BOTTLE_TIERS.includes(name) ? name : 'high');
    pour.setQuality(factory.settings);
    breakage.setQuality(factory.settings);
  }

  /** Spawn a catalog bottle or design and count its liquid in the volume ledger. extra: more adopt() options (body, color, breakInfo). */
  async function spawn(id, design = '', fill = 0.5, position = null, open = false, extra = {}) {
    const bottle = await factory.spawn(id, design, fill, position, open, extra);
    pour.register(bottle);
    return bottle;
  }
  /** Adopt a model the game built (see BottleFactory.adopt) and count its liquid. */
  function adopt(options) {
    const bottle = factory.adopt(options);
    pour.register(bottle);
    return bottle;
  }
  /** Remove every bottle, drop, puddle and piece of debris; panes are restored. */
  function reset() {
    breakage.reset();
    pour.clear();
    for (const b of [...factory.bottles]) factory.remove(b);
    emit('bottles:reset', {});
  }
  function dispose() {
    stateOwner.dispose();
    offStep?.(); offStep = null;
    reset();
    breakage.disposePanes();
    bodies.dispose();
  }

  return {
    factory, pour, breakage, bodies, audio, sourceKey,
    capture:stateOwner.capture,prepareRestore:stateOwner.prepareRestore,
    restore(raw){const plan=stateOwner.prepareRestore(raw);plan.commit();},
    get bottles() { return factory.bottles; },
    get tier() { return factory.tier; },
    get settings() { return factory.settings; },
    spawn, adopt, reset, setQuality, dispose,
    /** Viscosity-dependent hole outflow: true | false (default off). */
    setLiquidViscosity: on => pour.setLiquidViscosity(!!on), get liquidViscosity() { return pour.liquidViscosity; },
    consumePuddleVolume: (ml, options) => pour.consumePuddleVolume(ml, options),
    removePuddleVolume: (ml, options) => pour.consumePuddleVolume(ml, {...options, reason:'remove'}),
    restorePuddleLedger: state => pour.restorePuddleLedger(state),
    remove: bottle => factory.remove(bottle),
    /** Fire a shot (ray); returns the first hit or null. */
    shoot: (origin, direction) => breakage.shoot(origin, direction),
    /** Shatter a bottle now (speed m/s, optional impact { point, normal, velocity, angularVelocity, energy }). */
    shatter: (bottle, speed, impact) => breakage.breakBottle(bottle, speed, impact),
    /** Volume ledger in ml: { initialMl, inBottlesMl, inFlightMl, puddleMl, lostMl, errorMl }. */
    ledger: () => pour.ledger(),
    /** Run one bottle step by hand (the adapter's onStep normally does it). */
    step,
  };
}
