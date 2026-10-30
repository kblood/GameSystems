// Quality tiers and hard budgets of fire-fx. Pure.
//
// Every pool is allocated once, at createFireFX, at the size of the budget (default: the 'high' tier, never above
// FIRE_FX_LIMITS). A tier only lowers what is live/drawn inside that allocation; setQuality never allocates more.
//
//   particles       live ember/spark/puff instances (one InstancedMesh)
//   lights          shared PointLights (the brightest visible flames get them; the rest fake their glow in the shader)
//   flames          flames drawn per frame (the registry holds up to budget.flames; extra visible flames are not drawn)
//   scorches        scorch decals alive (oldest are replaced)
//   octaves         fbm octaves in the flame shader
//   embersPerFlame  embers per second from a flame of size 1 m and intensity 1
//   sparkScale      share of a spark() request that is emitted
export const FIRE_FX_QUALITY = Object.freeze(['low', 'medium', 'high']);
/** Host tier names (extensions/host SYSTEM_TIERS) mapped onto fire-fx tiers. */
export const FIRE_FX_ALIASES = Object.freeze({ minimal: 'low', mid: 'medium' });

export const FIRE_FX_TIERS = Object.freeze({
  low: Object.freeze({ particles: 400, lights: 1, flames: 24, scorches: 16, octaves: 2, embersPerFlame: 6, sparkScale: 0.35 }),
  medium: Object.freeze({ particles: 1000, lights: 2, flames: 48, scorches: 32, octaves: 3, embersPerFlame: 12, sparkScale: 0.6 }),
  high: Object.freeze({ particles: 2000, lights: 4, flames: 96, scorches: 64, octaves: 4, embersPerFlame: 20, sparkScale: 1 }),
});

/** Absolute caps: a budget asking for more is clamped to these. */
export const FIRE_FX_LIMITS = Object.freeze({ particles: 2000, lights: 4, flames: 128, scorches: 128, sparksPerCall: 64 });

/** Canonical tier name ('low' | 'medium' | 'high'); accepts the host aliases. Throws RangeError on anything else. */
export function resolveQuality(tier) {
  const t = FIRE_FX_ALIASES[tier] ?? tier;
  if (!FIRE_FX_QUALITY.includes(t)) throw new RangeError(`Unknown fire-fx quality: ${tier} (${FIRE_FX_QUALITY.join(', ')})`);
  return t;
}

/** The allocation sizes: { particles, lights, flames, scorches }, each min(budget value ?? high tier, FIRE_FX_LIMITS). */
export function resolveBudget(budget = {}) {
  if (budget === null || typeof budget !== 'object') throw new TypeError('budget must be an object');
  const out = {};
  for (const key of ['particles', 'lights', 'flames', 'scorches']) {
    const v = budget[key] ?? FIRE_FX_TIERS.high[key];
    if (!Number.isInteger(v) || v < 0) throw new RangeError(`budget.${key} must be an integer >= 0`);
    out[key] = Math.min(v, FIRE_FX_LIMITS[key]);
  }
  for (const key of Object.keys(budget)) if (!(key in out)) throw new RangeError(`budget.${key} is not a fire-fx budget (particles, lights, flames, scorches)`);
  return Object.freeze(out);
}

/** What a tier may use inside a resolved budget: counts are min(tier, budget); octaves etc. come from the tier. */
export function tierLimits(tier, budget) {
  const t = FIRE_FX_TIERS[resolveQuality(tier)];
  return {
    quality: resolveQuality(tier),
    particles: Math.min(t.particles, budget.particles), lights: Math.min(t.lights, budget.lights),
    flames: Math.min(t.flames, budget.flames), scorches: Math.min(t.scorches, budget.scorches),
    octaves: t.octaves, embersPerFlame: t.embersPerFlame, sparkScale: t.sparkScale,
  };
}
