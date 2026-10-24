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
const TOP_KEYS = ['schema', 'id', 'kind', 'displayName', 'detachable', 'lossPolicy', 'dominantHand', 'handle', 'donZone', 'recall', 'mass', 'thresholds', 'tiers', 'bagMount', 'pockets'];
const POCKET_KEYS = ['id', 'container', 'access', 'categories', 'maxSize', 'capacity', 'mount'];
const MOUNT_KEYS = ['acceptOnly', 'snapMode', 'returnDelayS'];
export const PROFILE_KINDS = Object.freeze([...DATA.PROFILE_KINDS]);
export const SNAP_MODES = Object.freeze([...DATA.MOUNT.SNAP_MODES]);
// A stash (chest, locker) is a stationary container: same pockets and ledger, no carry states. Tier overrides may only touch these flags.
const STASH_TIER_KEYS = ['proxyItems', 'physicalItems', 'physicalItemsMax'];
const STASH_FORBIDDEN = ['handle', 'donZone', 'recall', 'dominantHand', 'bagMount'];

const isStr = v => typeof v === 'string' && v.trim().length > 0;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isVec3 = v => Array.isArray(v) && v.length === 3 && v.every(isNum);
const isSize = v => isVec3(v) && v.every(x => x > 0);
const fail = (path, msg) => { throw new TypeError(`BackpackProfile ${path}: ${msg}`); };
const onlyKeys = (obj, keys, path) => { for (const k of Object.keys(obj)) if (!keys.includes(k)) fail(path, `unknown key "${k}"`); };
const plain = (v, path) => { if (!v || typeof v !== 'object' || Array.isArray(v)) fail(path, 'must be an object'); return v; };

/** BackpackMount (UltimateXR-style anchor settings, ideas only): acceptOnly = item ids or tags the mount takes (absent = category filter only),
 *  snapMode none|range|dropped (how an offered item snaps), returnDelayS = seconds before a released item is sent back (0 = at once). */
function checkMount(m, path) {
  plain(m, path); onlyKeys(m, MOUNT_KEYS, path);
  if (m.acceptOnly !== undefined && (!Array.isArray(m.acceptOnly) || !m.acceptOnly.length || !m.acceptOnly.every(isStr) || new Set(m.acceptOnly).size !== m.acceptOnly.length)) fail(`${path}.acceptOnly`, 'needs unique nonempty strings');
  m.snapMode ??= DATA.MOUNT.DEFAULT_SNAP_MODE;
  if (!SNAP_MODES.includes(m.snapMode)) fail(`${path}.snapMode`, `must be one of ${SNAP_MODES.join(', ')}`);
  m.returnDelayS ??= 0;
  if (!isNum(m.returnDelayS) || m.returnDelayS < 0 || m.returnDelayS > DATA.MOUNT.MAX_RETURN_DELAY_S) fail(`${path}.returnDelayS`, `must lie in 0..${DATA.MOUNT.MAX_RETURN_DELAY_S}`);
}

/** Axes sorted descending: the canonical size used for fit checks. */
export const canonicalSize = s => [...s].sort((a, b) => a - b).reverse();
/** Item fits a cavity when every canonical axis is <= the cavity's (epsilon 1e-6, as NightfallGearInventory._fits). */
export const sizeFits = (item, cavity) => { const a = canonicalSize(item), b = canonicalSize(cavity); return a.every((v, i) => v <= b[i] + 1e-6); };

/** Thresholds of a profile: data.STATE with the profile's overrides. */
export function thresholdsOf(profile) { return { ...DATA.STATE, ...(profile.thresholds ?? {}) }; }
/** Materialisation limit of a tier: how many physical proxies the open container may show at once (0 = slot view only). */
export function materialLimit(profile, tier) {
  const f = tierFlags(profile, tier);
  return f.enabled !== false && f.physicalItems ? Math.min(f.physicalItemsMax, DATA.VIEW.MAX_PHYSICAL_PROXIES) : 0;
}
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
  p.kind ??= 'pack';
  if (!PROFILE_KINDS.includes(p.kind)) fail('kind', `must be one of ${PROFILE_KINDS.join(', ')}`);
  const stash = p.kind === 'stash';
  if (stash) {
    for (const k of STASH_FORBIDDEN) if (p[k] !== undefined) fail(k, 'a stash is stationary: it has no carry states');
    if (p.detachable !== false) fail('detachable', 'a stash is never detachable (must be false)');
  }
  if (typeof p.detachable !== 'boolean') fail('detachable', 'must be boolean');
  if (!LOSS_POLICIES.includes(p.lossPolicy)) fail('lossPolicy', `must be "never" (the pack can never be lost), got ${JSON.stringify(p.lossPolicy)}`);
  if (!stash) {
    if (!HANDS.includes(p.dominantHand)) fail('dominantHand', 'must be left or right');
    plain(p.handle, 'handle'); onlyKeys(p.handle, ['local', 'reachM'], 'handle');
    if (!isVec3(p.handle.local)) fail('handle.local', 'needs three finite numbers');
    p.handle.reachM ??= DATA.PULL.HANDLE_REACH_M;
    if (!isNum(p.handle.reachM) || p.handle.reachM <= 0) fail('handle.reachM', 'must be positive');
  }
  if (p.bagMount !== undefined) checkMount(p.bagMount, 'bagMount');
  if (p.donZone !== undefined) { plain(p.donZone, 'donZone'); onlyKeys(p.donZone, ['local'], 'donZone'); if (!isVec3(p.donZone.local)) fail('donZone.local', 'needs three finite numbers'); }
  if (!stash) {
    p.recall = plain(p.recall ?? { seated: true }, 'recall'); onlyKeys(p.recall, ['seated'], 'recall'); p.recall.seated ??= true;
    if (typeof p.recall.seated !== 'boolean') fail('recall.seated', 'must be boolean');
  }
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
      if (stash && !STASH_TIER_KEYS.includes(k)) fail(`tiers.${tier}.${k}`, 'a stash has no carry flags');
      if (typeof v !== typeof DATA.TIERS[tier][k]) fail(`tiers.${tier}.${k}`, `must be ${typeof DATA.TIERS[tier][k]}`);
    }
  }
  for (const tier of BACKPACK_TIERS) {
    const f = tierFlags(p, tier);
    if (f.physicalItems && tier !== 'high') fail(`tiers.${tier}.physicalItems`, 'physical items are only allowed on tier "high"');
    if (f.physicalItems && !(f.physicalItemsMax >= 1)) fail(`tiers.${tier}.physicalItemsMax`, 'must be >= 1 when physicalItems is on');
    if (!(f.physicalItemsMax <= DATA.VIEW.MAX_PHYSICAL_PROXIES) || !Number.isInteger(f.physicalItemsMax)) fail(`tiers.${tier}.physicalItemsMax`, `materialisation limit must be an integer <= ${DATA.VIEW.MAX_PHYSICAL_PROXIES}`);
    if (stash) continue;
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
    if (k.mount !== undefined) checkMount(k.mount, `${at}.mount`);
  });
  return p;
}
