// GameSystems gore extension: the customization config. Pure (no three.js). One object per zombie type or globally,
// merged global -> type -> per character (resolveGoreConfig); validateGoreConfig() names every problem. Full reference:
// docs/gore_system.md.
//
//   goreLevel        'off' | 'low' | 'high'. off: nothing comes off, no blood, no insides (zombies still die and fall);
//                    low: limbs and head come off, stump caps, little blood, no insides or organs, short-lived gibs;
//                    high: everything below.
//   totalHealth      dies when the summed damage reaches this (any region)
//   regions          { <region id>: { health, severable, severAt, damageScale, variant } } (regions.js ids)
//                      health       hit points of the region; a hit takes damage × damageScale
//                      severable    false: the region is wounded but never comes off (its seam stays closed)
//                      severAt      comes off when its health falls to severAt × health (0 = when used up; 0.5 = at half)
//                      variant      baked seam variant: 'clean' | 'jagged' (the bake's names; unknown -> the first one)
//   blood            { color, amount (0..2, scales particles and splats), spurtSeconds (a stump keeps bleeding) }
//   insides          { bones, organs, flesh } layers visible through wounds and in chunks (booleans)
//   gibs             { lifetime (s), max (alive at once, oldest go first), physics (false: gibs fall with simple gravity) }
//   decals           { max (floor/wall splats alive at once), wounds (bullet wounds per zombie), floor, walls }
//   particles        { max } blood spray particles alive at once (all zombies share one pool)
//   mobility         how a damaged zombie moves (damage.js mobility(); the host maps it to a gait and a speed):
//                      limpBelow     a leg region (upper leg, lower leg, foot) under this share of its health limps
//                      limpSpeed     speed factor when limping (a foot gone or a hurt leg)
//                      crawlSpeed    speed factor when crawling on both arms (a leg gone at the knee or above)
//                      oneArmCrawlSpeed   ... crawling on one arm
//                      legsOnlyCrawlSpeed ... no usable arm: shoving with the remaining leg(s); no arms and no legs: 0
//   performance      { freezeMorphs (bake the slider morphs into the vertices at spawn: much cheaper on Quest, sliders can
//                    no longer change afterwards), meshHitTest (hits tested against the skinned triangles; false: the
//                    physics proxies only) }
import { REGIONS, REGION_IDS } from './regions.js';

export const GORE_LEVELS = Object.freeze(['off', 'low', 'high']);
export const SEAM_VARIANTS = Object.freeze(['clean', 'jagged']);

const regionDefaults = r => {
  const base = { health: 40, severable: true, severAt: 0, damageScale: 1, variant: 'jagged' };
  if (r.kind === 'root') return { ...base, health: 120, severable: false };
  if (r.id === 'chest') return { ...base, health: 140, damageScale: 0.8, variant: 'jagged' };
  if (r.id === 'neck') return { ...base, health: 35, damageScale: 1.5, variant: 'clean' };
  if (r.id === 'head') return { ...base, health: 45, damageScale: 2 };
  if (r.id === 'jaw') return { ...base, health: 20, damageScale: 1.5 };
  if (r.id === 'cranium') return { ...base, health: 30, damageScale: 2 };
  if (/UpperArm|UpperLeg/.test(r.id)) return { ...base, health: r.id.includes('Leg') ? 60 : 45 };
  if (/Hand|Foot/.test(r.id)) return { ...base, health: 20 };
  if (r.kind === 'patch') return { ...base, health: 35, damageScale: 0.9 };
  return base;
};

export const DEFAULT_GORE_CONFIG = Object.freeze({
  goreLevel: 'high',
  totalHealth: 260,
  regions: Object.fromEntries(REGIONS.map(r => [r.id, regionDefaults(r)])),
  blood: { color: '#6b0a0a', amount: 1, spurtSeconds: 1.6 },
  insides: { bones: true, organs: true, flesh: true },
  gibs: { lifetime: 14, max: 24, physics: true },
  decals: { max: 64, wounds: 10, floor: true, walls: true },
  particles: { max: 600 },
  mobility: { limpBelow: 0.5, limpSpeed: 0.6, crawlSpeed: 0.32, oneArmCrawlSpeed: 0.2, legsOnlyCrawlSpeed: 0.12 },
  performance: { freezeMorphs: true, meshHitTest: true },
});

/** What each gore level switches off on top of the config (applied by effectiveConfig). */
export const LEVEL_LIMITS = Object.freeze({
  off: { sever: false, blood: 0, insides: false, gibs: 0, decals: 0, wounds: 0 },
  low: { sever: true, blood: 0.35, insides: false, gibs: 8, decals: 16, wounds: 3, lifetime: 6 },
  high: { sever: true, blood: 1, insides: true, gibs: Infinity, decals: Infinity, wounds: Infinity },
});

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  if (!isObj(over)) return over === undefined ? base : over;
  const out = isObj(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base?.[k]) ? merge(base[k], v) : v;
  return out;
}
const clone = v => JSON.parse(JSON.stringify(v));

/**
 * Merges config layers onto the defaults, later layers winning (global, zombie type, per character, ...). A layer may
 * set regions: { '*': {...} } to change every region at once (applied before that layer's named regions).
 * Throws a TypeError naming every problem (validateGoreConfig).
 */
export function resolveGoreConfig(...layers) {
  let cfg = clone(DEFAULT_GORE_CONFIG);
  for (const layer of layers.filter(Boolean)) {
    if (!isObj(layer)) throw new TypeError('gore config layers must be objects');
    const { regions, ...rest } = layer;
    cfg = merge(cfg, rest);
    if (isObj(regions)) {
      if (isObj(regions['*'])) for (const id of REGION_IDS) cfg.regions[id] = merge(cfg.regions[id], regions['*']);
      for (const [id, r] of Object.entries(regions)) if (id !== '*') cfg.regions[id] = merge(cfg.regions[id] ?? {}, r);
    } else if (regions !== undefined) cfg.regions = regions;
  }
  const { ok, errors } = validateGoreConfig(cfg);
  if (!ok) throw new TypeError(`invalid gore config: ${errors.join('; ')}`);
  return cfg;
}

const num = (v, lo = -Infinity, hi = Infinity) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const bool = v => typeof v === 'boolean';
const COLOR = /^#[0-9a-fA-F]{6}$/;

/** Checks a full (resolved) config. Returns { ok, errors: [string] }. */
export function validateGoreConfig(cfg) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  if (!isObj(cfg)) return { ok: false, errors: ['config must be an object'] };
  need(GORE_LEVELS.includes(cfg.goreLevel), `goreLevel must be one of ${GORE_LEVELS.join(', ')}`);
  need(num(cfg.totalHealth, 1), 'totalHealth must be a number >= 1');
  if (!isObj(cfg.regions)) errors.push('regions must be an object');
  else {
    for (const id of Object.keys(cfg.regions)) need(REGION_IDS.includes(id), `regions.${id} is not a region (${REGION_IDS.join(', ')})`);
    for (const id of REGION_IDS) {
      const r = cfg.regions[id];
      if (!isObj(r)) { errors.push(`regions.${id} must be an object`); continue; }
      need(num(r.health, 1), `regions.${id}.health must be a number >= 1`);
      need(bool(r.severable), `regions.${id}.severable must be a boolean`);
      need(num(r.severAt, 0, 0.99), `regions.${id}.severAt must be in 0..0.99`);
      need(num(r.damageScale, 0, 100), `regions.${id}.damageScale must be in 0..100`);
      need(typeof r.variant === 'string' && r.variant.length > 0, `regions.${id}.variant must be a seam variant name (${SEAM_VARIANTS.join(', ')})`);
    }
    need(!cfg.regions.pelvis?.severable, 'regions.pelvis.severable must be false (the root region stays on)');
  }
  const section = (name, checks) => {
    const s = cfg[name];
    if (!isObj(s)) { errors.push(`${name} must be an object`); return; }
    for (const [key, ok, msg] of checks) need(ok(s[key]), `${name}.${key} ${msg}`);
  };
  section('blood', [['color', v => typeof v === 'string' && COLOR.test(v), 'must be a #rrggbb colour'], ['amount', v => num(v, 0, 2), 'must be in 0..2'],
    ['spurtSeconds', v => num(v, 0, 30), 'must be in 0..30 s']]);
  section('insides', [['bones', bool, 'must be a boolean'], ['organs', bool, 'must be a boolean'], ['flesh', bool, 'must be a boolean']]);
  section('gibs', [['lifetime', v => num(v, 0.1, 600), 'must be in 0.1..600 s'], ['max', v => Number.isInteger(v) && v >= 0 && v <= 256, 'must be an integer in 0..256'],
    ['physics', bool, 'must be a boolean']]);
  section('decals', [['max', v => Number.isInteger(v) && v >= 0 && v <= 1024, 'must be an integer in 0..1024'],
    ['wounds', v => Number.isInteger(v) && v >= 0 && v <= 64, 'must be an integer in 0..64'], ['floor', bool, 'must be a boolean'], ['walls', bool, 'must be a boolean']]);
  section('particles', [['max', v => Number.isInteger(v) && v >= 0 && v <= 8192, 'must be an integer in 0..8192']]);
  section('mobility', [['limpBelow', v => num(v, 0, 1), 'must be in 0..1'], ['limpSpeed', v => num(v, 0, 2), 'must be in 0..2'],
    ['crawlSpeed', v => num(v, 0, 2), 'must be in 0..2'], ['oneArmCrawlSpeed', v => num(v, 0, 2), 'must be in 0..2'],
    ['legsOnlyCrawlSpeed', v => num(v, 0, 2), 'must be in 0..2']]);
  section('performance', [['freezeMorphs', bool, 'must be a boolean'], ['meshHitTest', bool, 'must be a boolean']]);
  return { ok: errors.length === 0, errors };
}

/**
 * The config as the runtime uses it: the gore level's limits applied (LEVEL_LIMITS). Returns a new object with
 * sever (bool), bloodScale, insides layers, gib/decal/wound caps and lifetime folded in.
 */
export function effectiveConfig(cfg) {
  const lim = LEVEL_LIMITS[cfg.goreLevel] ?? LEVEL_LIMITS.high;
  const out = clone(cfg);
  out.sever = lim.sever;
  out.blood.amount = cfg.blood.amount * lim.blood;
  out.insides = lim.insides ? { ...cfg.insides } : { bones: false, organs: false, flesh: false };
  out.gibs.max = Math.min(cfg.gibs.max, lim.gibs);
  out.gibs.lifetime = Math.min(cfg.gibs.lifetime, lim.lifetime ?? Infinity);
  out.decals.max = Math.min(cfg.decals.max, lim.decals);
  out.decals.wounds = Math.min(cfg.decals.wounds, lim.wounds);
  if (!lim.sever) for (const r of Object.values(out.regions)) r.severable = false;
  return out;
}
