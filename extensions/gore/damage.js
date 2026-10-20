// GameSystems gore extension: per-region health, severing and death. Pure (no three.js); the runtime (character.js)
// turns its events into hidden regions, gibs and blood.
//
//   const model = createDamageModel(effectiveConfig(resolveGoreConfig(...)))
//   model.hit('leftUpperArm', 30) -> [{ type: 'damage', region, amount, health }, { type: 'sever', region, lost: [...] },
//                                     { type: 'death', cause: 'head' | 'vital' | 'total', region }]
// A region comes off when its health falls to severAt × health and it is severable (chained: the whole subtree goes with
// it, e.g. an upper arm takes the forearm and the hand). Losing a vital region (chest, neck, head, cranium) or using up the
// head's health kills, and so does total damage >= totalHealth. A dead zombie can still be shot apart (no second death).
// Hits on a lost region are ignored. mobility() says how a zombie with missing parts moves on, limbs() which limbs
// still work and speedFactor() how fast (cfg.mobility; defaults below). The host maps these onto its animation, e.g. the
// avatar NPC animator's gait input ('walk' | 'limp' | 'crawl', limpSide, limbs); gore itself never animates.
import { REGIONS, REGION, REGION_IDS, subtree } from './regions.js';

/** Default speed factors (cfg.mobility overrides): crawl = both arms pulling. */
export const MOBILITY = Object.freeze({ walk: 1, limp: 0.6, crawl: 0.32, oneArmCrawl: 0.2, legsOnlyCrawl: 0.12, none: 0 });
const MOBILITY_DEFAULTS = { limpBelow: 0.5, limpSpeed: MOBILITY.limp, crawlSpeed: MOBILITY.crawl, oneArmCrawlSpeed: MOBILITY.oneArmCrawl, legsOnlyCrawlSpeed: MOBILITY.legsOnlyCrawl };
const LEG = ['UpperLeg', 'LowerLeg', 'Foot'];

export function createDamageModel(cfg) {
  const state = {};
  let taken = 0, dead = false, cause = null;
  function reset() {
    for (const r of REGIONS) state[r.id] = { health: cfg.regions[r.id].health, max: cfg.regions[r.id].health, lost: false, severed: false };
    taken = 0; dead = false; cause = null;
  }
  reset();

  function limbs() {
    const ok = (...ids) => ids.every(id => !state[id].lost);
    return { leftArm: ok('leftUpperArm', 'leftLowerArm'), rightArm: ok('rightUpperArm', 'rightLowerArm'),
      leftLeg: ok('leftUpperLeg', 'leftLowerLeg'), rightLeg: ok('rightUpperLeg', 'rightLowerLeg') };
  }
  function limpSide() {
    const below = cfg.mobility?.limpBelow ?? MOBILITY_DEFAULTS.limpBelow;
    let side = null, worst = Infinity;
    for (const s of ['left', 'right']) {
      if (state[`${s}UpperLeg`].lost || state[`${s}LowerLeg`].lost) continue;
      const share = state[`${s}Foot`].lost ? -1 : Math.min(...LEG.map(p => state[s + p].health / state[s + p].max));
      if (share < below && share < worst) { worst = share; side = s; }
    }
    return side;
  }

  function die(why, region, events) {
    if (dead) return;
    dead = true; cause = why;
    events.push({ type: 'death', cause: why, region });
  }

  /** Takes a region (and its subtree) off. Returns the sever event or null when already lost / not allowed. */
  function sever(id, events = [], { force = false } = {}) {
    const s = state[id], r = REGION[id];
    if (!s || s.lost || !r.parent) return null;
    if (!force && !(cfg.sever !== false && cfg.regions[id].severable)) return null;
    const lost = subtree(id).filter(x => !state[x].lost);
    for (const x of lost) { state[x].lost = true; state[x].health = Math.min(state[x].health, 0); }
    s.severed = true;
    const event = { type: 'sever', region: id, lost };
    events.push(event);
    if (lost.some(x => REGION[x].vital)) die('vital', id, events);
    return event;
  }

  return {
    get dead() { return dead; }, get cause() { return cause; }, get damage() { return taken; },
    /** { health, max, lost, severed } of a region (live object; do not mutate). */
    region: id => state[id],
    lost: id => !!state[id]?.lost,
    /** Region ids that are gone (in REGIONS order). */
    lostRegions: () => REGION_IDS.filter(id => state[id].lost),
    /** Applies `amount` damage (scaled by the region's damageScale). Returns the events in order. */
    hit(id, amount, { force = false } = {}) {
      const events = [], s = state[id];
      if (!s) throw new RangeError(`unknown region ${id}`);
      if (s.lost || !(amount > 0)) return events;
      const dmg = amount * cfg.regions[id].damageScale;
      s.health -= dmg; taken += dmg;
      events.push({ type: 'damage', region: id, amount: dmg, health: s.health });
      const rc = cfg.regions[id];
      if (s.health <= rc.severAt * s.max) sever(id, events, { force });
      if (!state[id].lost && s.health <= 0 && (id === 'head' || id === 'cranium')) die('head', id, events);
      if (taken >= cfg.totalHealth) die('total', id, events);
      return events;
    },
    /** Takes a region off regardless of health (scripts, tests). force: also when it is not severable. */
    sever(id, { force = false } = {}) { const events = []; sever(id, events, { force }); return events; },
    /** Kills without taking anything off. */
    kill(why = 'script') { const events = []; die(why, null, events); return events; },
    /**
     * 'walk' | 'limp' (a foot gone, or a leg region below mobility.limpBelow of its health) | 'crawl' (a leg gone at the
     * knee or above) | 'none' (dead).
     */
    mobility() {
      if (dead) return 'none';
      if (!limbs().leftLeg || !limbs().rightLeg) return 'crawl';
      return limpSide() ? 'limp' : 'walk';
    },
    /** Which limbs still work: an arm needs its upper and lower arm, a leg its upper and lower leg. */
    limbs,
    /** The hurt leg ('left' | 'right') when limping (a lost foot first, then the lower health share), else null. */
    limpSide,
    /** Speed factor for the current mobility (cfg.mobility): crawling depends on the arms left; helpless = 0. */
    speedFactor() {
      const m = { ...MOBILITY_DEFAULTS, ...(cfg.mobility ?? {}) }, mode = this.mobility();
      if (mode === 'walk') return 1;
      if (mode === 'limp') return m.limpSpeed;
      if (mode === 'none') return 0;
      const l = limbs(), arms = +l.leftArm + +l.rightArm, legs = +l.leftLeg + +l.rightLeg;
      return arms === 2 ? m.crawlSpeed : arms === 1 ? m.oneArmCrawlSpeed : legs ? m.legsOnlyCrawlSpeed : 0;
    },
    /** At least one hand left to grab with. */
    canAttack: () => !dead && ['left', 'right'].some(s => !state[`${s}Hand`].lost),
    reset,
    /** Plain snapshot (for UI / saves). */
    snapshot: () => ({ dead, cause, damage: taken, regions: Object.fromEntries(REGION_IDS.map(id => [id, { ...state[id] }])) }),
  };
}
