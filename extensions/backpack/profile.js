// BackpackProfile: the data contract of a backpack (data/profile.schema.json, example data/profile.example.json) and its
// validator. Pure data, no engine. The Godot reader (gs_backpack_profile.gd) validates the same rules.
// Conventions: body-local frame of GSBackpackApproach (+X right, +Z behind, metres); size triples are compared after
// sorting the axes (a rotated item still fits), like NightfallGearInventory._fits.
import DATA from './data/backpack.data.json' with { type: 'json' };

export const BACKPACK_DATA = DATA;
export const PROFILE_SCHEMA = 'gamesystems.backpack-profile.v1';
export const BACKPACK_TIERS = Object.freeze([...DATA.TIER_NAMES]);
export const BACKPACK_STATES = Object.freeze([...DATA.STATES]);
export const LOSS_POLICIES = Object.freeze(['never']);
const ACCESS = ['always', 'worn', 'open'], CONTAINERS = ['bag', 'body'], HANDS = ['left', 'right'];
const TOP_KEYS = ['schema', 'id', 'displayName', 'detachable', 'lossPolicy', 'dominantHand', 'handle', 'donZone', 'recall', 'mass', 'thresholds', 'tiers', 'pockets'];
const POCKET_KEYS = ['id', 'container', 'access', 'categories', 'maxSize', 'capacity'];

const isStr = v => typeof v === 'string' && v.trim().length > 0;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isVec3 = v => Array.isArray(v) && v.length === 3 && v.every(isNum);
const isSize = v => isVec3(v) && v.every(x => x > 0);
const fail = (path, msg) => { throw new TypeError(`BackpackProfile ${path}: ${msg}`); };
const onlyKeys = (obj, keys, path) => { for (const k of Object.keys(obj)) if (!keys.includes(k)) fail(path, `unknown key "${k}"`); };
const plain = (v, path) => { if (!v || typeof v !== 'object' || Array.isArray(v)) fail(path, 'must be an object'); return v; };

/** Axes sorted descending: the canonical size used for fit checks. */
export const canonicalSize = s => [...s].sort((a, b) => a - b).reverse();
/** Item fits a cavity when every canonical axis is <= the cavity's (epsilon 1e-6, as NightfallGearInventory._fits). */
export const sizeFits = (item, cavity) => { const a = canonicalSize(item), b = canonicalSize(cavity); return a.every((v, i) => v <= b[i] + 1e-6); };

/** Thresholds of a profile: data.STATE with the profile's overrides. */
export function thresholdsOf(profile) { return { ...DATA.STATE, ...(profile.thresholds ?? {}) }; }
/** Tier flags of a profile: data.TIERS[tier] with the profile's overrides (validated, so physicalItems only on high). */
export function tierFlags(profile, tier) {
  if (!BACKPACK_TIERS.includes(tier)) throw new RangeError(`Unknown backpack tier: ${tier}`);
  return { ...DATA.TIERS[tier], ...(profile.tiers?.[tier] ?? {}) };
}

/** Validates (throws TypeError with the path of the first problem) and returns a normalised deep copy. */
export function parseProfile(raw) {
  const p = JSON.parse(JSON.stringify(plain(raw, 'profile')));
  onlyKeys(p, TOP_KEYS, 'profile');
  if (p.schema !== PROFILE_SCHEMA) fail('schema', `must be ${PROFILE_SCHEMA}`);
  if (!isStr(p.id)) fail('id', 'needs a nonempty string');
  if (typeof p.detachable !== 'boolean') fail('detachable', 'must be boolean');
  if (!LOSS_POLICIES.includes(p.lossPolicy)) fail('lossPolicy', `must be "never" (the pack can never be lost), got ${JSON.stringify(p.lossPolicy)}`);
  if (!HANDS.includes(p.dominantHand)) fail('dominantHand', 'must be left or right');
  plain(p.handle, 'handle'); onlyKeys(p.handle, ['local', 'reachM'], 'handle');
  if (!isVec3(p.handle.local)) fail('handle.local', 'needs three finite numbers');
  p.handle.reachM ??= DATA.PULL.HANDLE_REACH_M;
  if (!isNum(p.handle.reachM) || p.handle.reachM <= 0) fail('handle.reachM', 'must be positive');
  if (p.donZone !== undefined) { plain(p.donZone, 'donZone'); onlyKeys(p.donZone, ['local'], 'donZone'); if (!isVec3(p.donZone.local)) fail('donZone.local', 'needs three finite numbers'); }
  p.recall = plain(p.recall ?? { seated: true }, 'recall'); onlyKeys(p.recall, ['seated'], 'recall'); p.recall.seated ??= true;
  if (typeof p.recall.seated !== 'boolean') fail('recall.seated', 'must be boolean');
  p.mass = plain(p.mass ?? { emptyKg: 0 }, 'mass'); onlyKeys(p.mass, ['emptyKg'], 'mass'); p.mass.emptyKg ??= 0;
  if (!isNum(p.mass.emptyKg) || p.mass.emptyKg < 0) fail('mass.emptyKg', 'must be nonnegative');
  p.thresholds = plain(p.thresholds ?? {}, 'thresholds');
  for (const [k, v] of Object.entries(p.thresholds)) {
    if (!(k in DATA.STATE)) fail(`thresholds.${k}`, 'unknown threshold');
    if (!isNum(v) || v < 0) fail(`thresholds.${k}`, 'must be a nonnegative number');
  }
  const th = thresholdsOf(p);
  if (!(th.openAccessFraction > 0 && th.openAccessFraction <= 1) || !(th.closeAccessFraction >= 0 && th.closeAccessFraction <= th.openAccessFraction)) fail('thresholds', 'open/closeAccessFraction must satisfy 0 <= close <= open <= 1');
  if (!(th.donEnterM <= th.donExitM)) fail('thresholds', 'donEnterM must not exceed donExitM (hysteresis)');
  if (!(th.releaseOffsetM > DATA.PULL.PULL_DEADZONE_M && th.releaseOffsetM <= DATA.PULL.MAX_PULL_M)) fail('thresholds.releaseOffsetM', 'must lie between the pull deadzone and the pull cap');
  if (!(th.returnDurationS > 0 && th.openDurationS > 0 && th.maxStepS > 0)) fail('thresholds', 'returnDurationS, openDurationS and maxStepS must be positive');
  p.tiers = plain(p.tiers ?? {}, 'tiers');
  for (const [tier, flags] of Object.entries(p.tiers)) {
    if (!BACKPACK_TIERS.includes(tier)) fail(`tiers.${tier}`, 'unknown tier');
    plain(flags, `tiers.${tier}`);
    for (const [k, v] of Object.entries(flags)) {
      if (!(k in DATA.TIERS[tier])) fail(`tiers.${tier}.${k}`, 'unknown flag');
      if (typeof v !== typeof DATA.TIERS[tier][k]) fail(`tiers.${tier}.${k}`, `must be ${typeof DATA.TIERS[tier][k]}`);
    }
  }
  for (const tier of BACKPACK_TIERS) {
    const f = tierFlags(p, tier);
    if (f.physicalItems && tier !== 'high') fail(`tiers.${tier}.physicalItems`, 'physical items are only allowed on tier "high"');
    if (f.physicalItems && !(f.physicalItemsMax >= 1)) fail(`tiers.${tier}.physicalItemsMax`, 'must be >= 1 when physicalItems is on');
    if (!f.enabled && (f.pull || f.detach || f.open)) fail(`tiers.${tier}`, 'a disabled tier cannot enable pull/detach/open');
    if (f.detach && !f.pull) fail(`tiers.${tier}`, 'detach needs pull (the guided pull comes first)');
    if (f.open && !f.detach) fail(`tiers.${tier}`, 'open needs detach');
  }
  if (!Array.isArray(p.pockets) || !p.pockets.length) fail('pockets', 'needs at least one pocket');
  const seen = new Set();
  p.pockets.forEach((k, i) => {
    const at = `pockets[${i}]`; plain(k, at); onlyKeys(k, POCKET_KEYS, at);
    if (!isStr(k.id) || k.id.includes('/')) fail(`${at}.id`, 'needs a nonempty string without "/"');
    if (seen.has(k.id)) fail(`${at}.id`, `duplicate pocket id ${k.id}`);
    seen.add(k.id);
    if (!CONTAINERS.includes(k.container)) fail(`${at}.container`, 'must be bag or body');
    if (!ACCESS.includes(k.access)) fail(`${at}.access`, 'must be always, worn or open');
    if (k.container === 'body' && k.access !== 'always') fail(`${at}.access`, 'body mounts stay on the body and are always accessible');
    if (!Array.isArray(k.categories) || !k.categories.length || !k.categories.every(isStr) || new Set(k.categories).size !== k.categories.length) fail(`${at}.categories`, 'needs unique nonempty strings');
    if (!isSize(k.maxSize)) fail(`${at}.maxSize`, 'needs three positive finite numbers');
    if (!Number.isInteger(k.capacity) || k.capacity < 1) fail(`${at}.capacity`, 'must be an integer >= 1');
  });
  return p;
}
