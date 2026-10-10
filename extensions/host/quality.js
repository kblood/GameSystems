// Quality tiers. The game has one global level (0 = minimal … maxLevel = highest, the demo uses 0–3); every extension
// declares its own ordered tier names, e.g. ['off', 'low', 'high']. A level maps onto the tiers by rounding up, so the
// lowest game level picks the first tier (usually 'off'), the highest picks the last, and every level above the
// lowest leaves an 'off'-first extension switched on. Tiers can also be pinned per extension.

export const DEFAULT_TIERS = Object.freeze(['off', 'on']);

/** Tier name for a global level. */
export function tierFor(tiers = DEFAULT_TIERS, level = 0, maxLevel = 3) {
  if (!tiers.length) return null;
  if (!(maxLevel > 0)) return tiers[tiers.length - 1];
  const t = Math.min(1, Math.max(0, Number(level) / maxLevel || 0));
  return tiers[Math.min(tiers.length - 1, Math.ceil(t * (tiers.length - 1) - 1e-9))];
}

/** Accepts a tier name or an index into tiers; returns the tier name, or null when it is not one of the tiers. */
export function normalizeTier(tiers = DEFAULT_TIERS, tier) {
  if (Number.isInteger(tier)) return tiers[tier] ?? null;
  return tiers.includes(tier) ? tier : null;
}

/** 'off' is the only tier the host treats specially: the extension's update() is not called. */
export const isOff = tier => tier === 'off';
