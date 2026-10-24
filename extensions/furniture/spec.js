// FurnitureSpec: the data contract of one piece of furniture (data/furniture.schema.json, types in data/types.data.json) and its
// validator/normaliser. Pure data and arithmetic: no three.js, no engine. Everything is in metres, kilograms, radians and the
// furniture's own frame: origin on the floor in the middle of the footprint, +Y up, the front (where the user stands) at +Z.
//
// A spec lists PARTS (body, door, drawer, lid, slide_door, shelf). A moving part has a MECHANISM (hinge or slider: limits, resistance,
// spring/self-closing, seal), 1..2 HANDLES, an interaction method and an optional CONTENTS block (pockets that become a backpack stash).
// LOCKS (key, code, power) guard moving parts. Parts may be written as `{ "use": "drawer", ...overrides }` (reusable building blocks in
// types.data.json "blocks"). parseSpec() returns a normalised deep copy with everything the runtime needs already computed
// (mechanism origin/axis in furniture frame, handle positions, lever arms, inertia, cell positions); it throws TypeError('FurnitureSpec <path>: ...').
import DATA from './data/furniture.data.json' with { type: 'json' };
import TYPES from './data/types.data.json' with { type: 'json' };
import SOUND from '../audio/sound_materials.json' with { type: 'json' };

export const FURNITURE_DATA = DATA;
export const SPEC_SCHEMA = DATA.SPEC_SCHEMA;
export const FURNITURE_TIERS = Object.freeze([...DATA.TIER_NAMES]);
export const SOUND_MATERIALS = Object.freeze(Object.keys(SOUND.materials));
export const BLOCKS = TYPES.blocks;
export const TYPE_IDS = Object.freeze(TYPES.types.map(t => t.id));

const TOP_KEYS = ['schema', 'id', 'name', 'category', 'size', 'mass', 'material', 'color', 'parts', 'locks', 'tiers', 'tags', 'doc'];
const PART_KEYS = ['id', 'use', 'kind', 'size', 'position', 'material', 'color', 'mass', 'style', 'wall', 'mechanism', 'handle', 'handles', 'interaction',
  'minHands', 'contents', 'seal', 'stopMaterial', 'doc', 'arm'];
const MECH_KEYS = ['type', 'hinge', 'pivot', 'axis', 'slide', 'min', 'max', 'openValue', 'resistance', 'damping', 'inertia', 'spring', 'rest', 'selfClosing', 'latch'];
const HANDLE_KEYS = ['style', 'at', 'orientation', 'length', 'radius', 'standoff', 'twoHand', 'position'];
const CONTENT_KEYS = ['pockets', 'openAt', 'behind', 'proxyMax', 'cells'];
const POCKET_KEYS = ['id', 'capacity', 'maxSize', 'categories'];
const LOCK_KEYS = ['id', 'kind', 'parts', 'keyId', 'code', 'mode', 'locked', 'maxAttempts', 'lockoutS'];

const isStr = v => typeof v === 'string' && v.trim().length > 0;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isVec3 = v => Array.isArray(v) && v.length === 3 && v.every(isNum);
const isSize = v => isVec3(v) && v.every(x => x > 0);
const fail = (path, msg) => { throw new TypeError(`FurnitureSpec ${path}: ${msg}`); };
const plain = (v, path) => { if (!v || typeof v !== 'object' || Array.isArray(v)) fail(path, 'must be an object'); return v; };
const onlyKeys = (o, keys, path) => { for (const k of Object.keys(o)) if (!keys.includes(k)) fail(path, `unknown key "${k}"`); };
const clone = v => JSON.parse(JSON.stringify(v));
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Deep merge for building blocks: objects merge, arrays and scalars are replaced by the override. */
export function mergeBlock(base, over) {
  const out = clone(base);
  for (const [k, v] of Object.entries(over ?? {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) ? mergeBlock(out[k], v) : clone(v);
  }
  return out;
}
/** `{ use: 'drawer', id, position, ... }` -> the block with the overrides applied (unknown block throws). */
export function expandBlock(part, path = 'part') {
  if (part.use === undefined) return part;
  const block = BLOCKS[part.use];
  if (!block) fail(`${path}.use`, `unknown building block "${part.use}" (known: ${Object.keys(BLOCKS).join(', ')})`);
  const { use, ...rest } = part;
  return mergeBlock(block, rest);
}

/** Hinge geometry from a side name: pivot (furniture frame) and axis so that a positive angle swings the free edge toward +Z (door) / lifts the front (lid). */
export function hingeFrom(side, c, size) {
  const [w, h, d] = size;
  if (side === 'left') return { pivot: [c[0] - w / 2, c[1], c[2]], axis: [0, -1, 0] };
  if (side === 'right') return { pivot: [c[0] + w / 2, c[1], c[2]], axis: [0, 1, 0] };
  if (side === 'back_top') return { pivot: [c[0], c[1] - h / 2, c[2] - d / 2], axis: [-1, 0, 0] };
  throw new RangeError(`Unknown hinge side ${side}`);
}
const SLIDE_AXIS = { front: [0, 0, 1], left: [-1, 0, 0], right: [1, 0, 0] };

/** Panels (centre + size, furniture frame) of a body part, by style. Used by the three builder and by tests. */
export function bodyPanels(part) {
  const [w, h, d] = part.size, t = part.wall ?? DATA.DEFAULTS.wall, panels = [];
  const P = (name, at, size) => panels.push({ name, at: add(part.position, at), size });
  switch (part.style) {
    case 'solid': P('solid', [0, 0, 0], [w, h, d]); break;
    case 'carcass':
      P('left', [-(w - t) / 2, 0, 0], [t, h, d]); P('right', [(w - t) / 2, 0, 0], [t, h, d]);
      P('top', [0, (h - t) / 2, 0], [w - 2 * t, t, d]); P('bottom', [0, -(h - t) / 2, 0], [w - 2 * t, t, d]);
      P('back', [0, 0, -(d - t / 2) / 2 + t / 4], [w - 2 * t, h - 2 * t, t / 2]); break;
    case 'tray':
      P('left', [-(w - t) / 2, 0, 0], [t, h, d]); P('right', [(w - t) / 2, 0, 0], [t, h, d]);
      P('front', [0, 0, (d - t) / 2], [w - 2 * t, h, t]); P('back', [0, 0, -(d - t) / 2], [w - 2 * t, h, t]);
      P('bottom', [0, -(h - t) / 2, 0], [w - 2 * t, t, d - 2 * t]); break;
    case 'frame': { // door frame: two jambs and a head, open front and bottom
      P('jambL', [-(w - t) / 2, 0, 0], [t, h, d]); P('jambR', [(w - t) / 2, 0, 0], [t, h, d]); P('head', [0, (h - t) / 2, 0], [w - 2 * t, t, d]); break;
    }
    case 'table': { // top slab with four legs
      const top = Math.min(0.04, h * 0.1), leg = 0.05;
      P('top', [0, (h - top) / 2, 0], [w, top, d]);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) P(`leg${sx}${sz}`, [sx * (w / 2 - leg / 2 - 0.02), -top / 2, sz * (d / 2 - leg / 2 - 0.02)], [leg, h - top, leg]);
      break;
    }
    default: throw new RangeError(`Unknown body style ${part.style}`);
  }
  return panels;
}

function normaliseHandle(raw, part, path) {
  plain(raw, path); onlyKeys(raw, HANDLE_KEYS, path);
  const [w, h, d] = part.size, off = DATA.DEFAULTS.handleOffset;
  const h2 = { style: raw.style ?? 'bar' };
  if (!DATA.HANDLE_STYLES.includes(h2.style)) fail(`${path}.style`, `must be one of ${DATA.HANDLE_STYLES.join(', ')}`);
  let at = raw.at;
  if (at === undefined) {
    const dir = part.mechanism.hinge === 'right' || part.mechanism.slide === 'right' ? -1 : 1;
    if (part.kind === 'door') at = [dir * (w / 2 - 0.07), 0, d / 2 + off];
    else if (part.kind === 'slide_door') at = [dir * (w / 2 - 0.06), 0, d / 2 + off];
    else if (part.kind === 'lid') at = [0, 0, d / 2 - 0.02];
    else at = [0, h > 0.3 ? h / 4 : 0, d / 2 + off]; // drawer
  }
  if (!isVec3(at)) fail(`${path}.at`, 'needs three finite numbers');
  h2.at = [...at];
  h2.orientation = raw.orientation ?? (part.kind === 'drawer' || part.kind === 'lid' ? 'horizontal' : 'vertical');
  if (!['horizontal', 'vertical'].includes(h2.orientation)) fail(`${path}.orientation`, 'must be horizontal or vertical');
  h2.length = raw.length ?? (h2.style === 'bar' ? Math.min(0.22, (h2.orientation === 'horizontal' ? w : h) * 0.55) : h2.style === 'lever' ? 0.13 : h2.style === 'wheel' ? 0.26 : 0.04);
  h2.radius = raw.radius ?? (h2.style === 'knob' ? 0.022 : 0.011);
  h2.standoff = raw.standoff ?? 0.03;
  for (const k of ['length', 'radius', 'standoff']) if (!isNum(h2[k]) || h2[k] <= 0) fail(`${path}.${k}`, 'must be positive');
  h2.twoHand = !!raw.twoHand;
  h2.position = add(part.position, h2.at); // closed pose, furniture frame
  return h2;
}

function normaliseMechanism(raw, part, top, path) {
  plain(raw, path); onlyKeys(raw, MECH_KEYS, path);
  const D = DATA.DEFAULTS, m = { type: raw.type };
  if (!DATA.MECHANISM_TYPES.includes(m.type)) fail(`${path}.type`, `must be one of ${DATA.MECHANISM_TYPES.join(', ')}`);
  const hinge = m.type === 'hinge', defaults = D[m.type];
  if (hinge) {
    if (raw.pivot !== undefined || raw.axis !== undefined) {
      if (!isVec3(raw.pivot) || !isVec3(raw.axis) || Math.hypot(...raw.axis) < 1e-6) fail(path, 'explicit hinge needs pivot and a nonzero axis (three finite numbers each)');
      const n = Math.hypot(...raw.axis); m.pivot = [...raw.pivot]; m.axis = raw.axis.map(v => v / n); if (raw.hinge !== undefined) m.hinge = raw.hinge;
    } else {
      if (!DATA.HINGE_SIDES.includes(raw.hinge)) fail(`${path}.hinge`, `must be one of ${DATA.HINGE_SIDES.join(', ')} (or give pivot and axis)`);
      Object.assign(m, hingeFrom(raw.hinge, part.position, part.size)); m.hinge = raw.hinge;
    }
  } else {
    if (raw.axis !== undefined) { if (!isVec3(raw.axis) || Math.hypot(...raw.axis) < 1e-6) fail(`${path}.axis`, 'needs a nonzero vector'); const n = Math.hypot(...raw.axis); m.axis = raw.axis.map(v => v / n); if (raw.slide !== undefined) m.slide = raw.slide; }
    else { if (!SLIDE_AXIS[raw.slide]) fail(`${path}.slide`, `must be one of ${DATA.SLIDE_DIRECTIONS.join(', ')} (or give axis)`); m.axis = [...SLIDE_AXIS[raw.slide]]; m.slide = raw.slide; }
    m.pivot = [...part.position];
  }
  m.min = raw.min ?? 0; m.max = raw.max;
  if (!isNum(m.min) || !isNum(m.max) || m.max <= m.min) fail(path, 'needs min < max (finite numbers)');
  if (hinge && (m.max > Math.PI || m.min < -Math.PI)) fail(path, 'hinge limits must lie within -pi..pi radians');
  m.openValue = raw.openValue ?? m.min + (m.max - m.min) * D.openFraction;
  if (!isNum(m.openValue) || m.openValue <= m.min || m.openValue > m.max) fail(`${path}.openValue`, 'must lie in (min, max]');
  m.resistance = raw.resistance ?? defaults.resistance;
  m.damping = raw.damping ?? defaults.damping;
  // Inertia: a swinging slab about its edge (m w^2 / 3, w = pivot to the far edge) or the moving mass of a drawer.
  const reach = hinge ? (part.kind === 'lid' ? part.size[2] : part.size[0]) : 1;
  m.inertia = raw.inertia ?? Math.max(defaults.inertiaMin, hinge ? part.mass * reach * reach / 3 : part.mass);
  const sc = raw.selfClosing === true ? {} : raw.selfClosing && typeof raw.selfClosing === 'object' ? raw.selfClosing : null;
  m.spring = raw.spring ?? (sc ? (sc.spring ?? defaults.selfClosingSpring) : 0);
  m.rest = raw.rest ?? m.min;
  m.selfClosing = !!sc || m.spring > 0;
  m.latch = raw.latch ?? sc?.latch ?? 0;
  for (const k of ['resistance', 'damping', 'inertia', 'spring', 'latch']) if (!isNum(m[k]) || m[k] < 0) fail(`${path}.${k}`, 'must be nonnegative');
  if (!(m.inertia > 0)) fail(`${path}.inertia`, 'must be positive');
  if (!isNum(m.rest) || m.rest < m.min || m.rest > m.max) fail(`${path}.rest`, 'must lie in [min, max]');
  // A spring that cannot beat the static resistance would leave the door hanging open at some angle: the latch must cover that angle.
  if (m.spring > 0 && m.rest === m.min && m.resistance > 0) {
    const hang = m.resistance / m.spring;
    if (m.latch < hang) fail(`${path}.latch`, `the self-closing spring (${m.spring}) cannot overcome resistance ${m.resistance} below ${hang.toFixed(3)}: latch must be at least that`);
  }
  return m;
}

function normaliseContents(raw, part, path) {
  plain(raw, path); onlyKeys(raw, CONTENT_KEYS, path);
  if (!['body', 'shelf', 'drawer'].includes(part.kind)) fail(path, 'only body, shelf and drawer parts can hold contents');
  if (!Array.isArray(raw.pockets) || !raw.pockets.length) fail(`${path}.pockets`, 'needs at least one pocket');
  const seen = new Set();
  const pockets = raw.pockets.map((k, i) => {
    const at = `${path}.pockets[${i}]`; plain(k, at); onlyKeys(k, POCKET_KEYS, at);
    if (!isStr(k.id) || k.id.includes('/')) fail(`${at}.id`, 'needs a nonempty string without "/"');
    if (seen.has(k.id)) fail(`${at}.id`, `duplicate pocket id ${k.id}`);
    seen.add(k.id);
    if (!Number.isInteger(k.capacity) || k.capacity < 1) fail(`${at}.capacity`, 'must be an integer >= 1');
    if (!isSize(k.maxSize)) fail(`${at}.maxSize`, 'needs three positive finite numbers');
    const categories = k.categories ?? DATA.DEFAULT_CATEGORIES;
    if (!Array.isArray(categories) || !categories.length || !categories.every(isStr) || new Set(categories).size !== categories.length) fail(`${at}.categories`, 'needs unique nonempty strings');
    return { id: k.id, capacity: k.capacity, maxSize: [...k.maxSize], categories: [...categories] };
  });
  const c = { pockets, openAt: raw.openAt ?? 0.3, behind: [...(raw.behind ?? [])], proxyMax: raw.proxyMax ?? DATA.PROXIES.default };
  if (!(c.openAt > 0 && c.openAt <= 1)) fail(`${path}.openAt`, 'must lie in (0, 1]');
  if (!Number.isInteger(c.proxyMax) || c.proxyMax < 1 || c.proxyMax > DATA.PROXIES.budget) fail(`${path}.proxyMax`, `must be an integer in 1..${DATA.PROXIES.budget}`);
  if (!Array.isArray(c.behind) || !c.behind.every(isStr)) fail(`${path}.behind`, 'needs an array of part ids');
  if (c.behind.length && part.mechanism) fail(`${path}.behind`, 'a part with its own mechanism is reached through that mechanism, not through "behind"');
  c.cells = cellLayout(part, pockets);
  return c;
}

/** Positions of the container cells (item BASE centre, furniture frame, part closed): a grid over the cavity of the part. */
export function cellLayout(part, pockets) {
  const [w, h, d] = part.size, t = part.wall ?? DATA.DEFAULTS.wall, n = pockets.reduce((s, k) => s + k.capacity, 0);
  let iw, idp, floorY;
  if (part.kind === 'shelf') { iw = w - 0.04; idp = d - 0.04; floorY = part.position[1] + h / 2; }
  else if (part.kind === 'drawer') { iw = w - 2 * t - 0.02; idp = d - 2 * t - 0.03; floorY = part.position[1] - h / 2 + t; }
  else { iw = w - 2 * t - 0.02; idp = d - 2 * t - 0.02; floorY = part.position[1] - h / 2 + t; }
  iw = Math.max(0.05, iw); idp = Math.max(0.05, idp);
  const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt(n * iw / idp)))), rows = Math.ceil(n / cols);
  const cells = []; let i = 0;
  for (const k of pockets) for (let j = 0; j < k.capacity; j++, i++) {
    const col = i % cols, row = Math.floor(i / cols);
    cells.push({ pocketId: k.id, index: j, position: [part.position[0] - iw / 2 + (col + 0.5) * iw / cols, floorY, part.position[2] - idp / 2 + (row + 0.5) * idp / rows] });
  }
  return cells;
}

/** Validates (TypeError with the path of the first problem) and returns a normalised deep copy of a FurnitureSpec. */
export function parseSpec(raw) {
  const s = clone(plain(raw, 'spec'));
  onlyKeys(s, TOP_KEYS, 'spec');
  if (s.schema !== SPEC_SCHEMA) fail('schema', `must be ${SPEC_SCHEMA}`);
  if (!isStr(s.id)) fail('id', 'needs a nonempty string');
  s.name ??= s.id; s.category ??= 'storage';
  if (!isStr(s.name) || !isStr(s.category)) fail('name', 'name and category need strings');
  if (!isSize(s.size)) fail('size', 'needs three positive finite numbers (metres, W x H x D)');
  if (!isNum(s.mass) || s.mass <= 0) fail('mass', 'must be positive (kg)');
  s.material ??= 'wood';
  if (!SOUND_MATERIALS.includes(s.material)) fail('material', `must be a sound material of audio/sound_materials.json (${SOUND_MATERIALS.join(', ')})`);
  s.color ??= '#a67c52';
  if (!/^#[0-9a-fA-F]{6}$/.test(s.color)) fail('color', 'must be #rrggbb');
  s.tags = s.tags ?? []; if (!Array.isArray(s.tags) || !s.tags.every(isStr)) fail('tags', 'needs strings');
  s.tiers = plain(s.tiers ?? {}, 'tiers');
  for (const [tier, o] of Object.entries(s.tiers)) {
    if (!FURNITURE_TIERS.includes(tier)) fail(`tiers.${tier}`, 'unknown tier');
    plain(o, `tiers.${tier}`); onlyKeys(o, ['proxyMax'], `tiers.${tier}`);
    if (o.proxyMax !== undefined && (!Number.isInteger(o.proxyMax) || o.proxyMax < 1 || o.proxyMax > DATA.PROXIES.budget)) fail(`tiers.${tier}.proxyMax`, `must be an integer in 1..${DATA.PROXIES.budget}`);
  }
  if (!Array.isArray(s.parts) || !s.parts.length) fail('parts', 'needs at least one part');
  const ids = new Set(); let bodies = 0;
  s.parts = s.parts.map((raw0, i) => {
    const at = `parts[${i}]`, p = expandBlock(plain(raw0, at), at);
    onlyKeys(p, PART_KEYS, at);
    if (!isStr(p.id) || p.id.includes('/')) fail(`${at}.id`, 'needs a nonempty string without "/"');
    if (ids.has(p.id)) fail(`${at}.id`, `duplicate part id ${p.id}`);
    ids.add(p.id);
    if (!DATA.PART_KINDS.includes(p.kind)) fail(`${at}.kind`, `must be one of ${DATA.PART_KINDS.join(', ')}`);
    if (!isSize(p.size)) fail(`${at}.size`, 'needs three positive finite numbers');
    if (!isVec3(p.position)) fail(`${at}.position`, 'needs three finite numbers (centre, closed, furniture frame)');
    p.material ??= s.material; p.color ??= s.color;
    if (!SOUND_MATERIALS.includes(p.material)) fail(`${at}.material`, `must be one of ${SOUND_MATERIALS.join(', ')}`);
    if (!/^#[0-9a-fA-F]{6}$/.test(p.color)) fail(`${at}.color`, 'must be #rrggbb');
    p.stopMaterial ??= s.material;
    if (!SOUND_MATERIALS.includes(p.stopMaterial)) fail(`${at}.stopMaterial`, 'must be a sound material');
    p.mass ??= Math.max(0.5, p.size[0] * p.size[1] * p.size[2] * DATA.DEFAULTS.densityKgM3);
    if (!isNum(p.mass) || p.mass <= 0) fail(`${at}.mass`, 'must be positive');
    if (p.kind === 'body') {
      bodies++; p.style ??= 'carcass'; p.wall ??= DATA.DEFAULTS.wall;
      if (!DATA.BODY_STYLES.includes(p.style)) fail(`${at}.style`, `must be one of ${DATA.BODY_STYLES.join(', ')}`);
      if (!isNum(p.wall) || p.wall <= 0 || p.wall * 2 >= Math.min(...p.size)) fail(`${at}.wall`, 'must be positive and thinner than half the smallest dimension');
    } else if (p.style !== undefined) fail(`${at}.style`, 'only a body has a style');
    p.wall ??= DATA.DEFAULTS.wall;
    const moving = DATA.MOVING_KINDS.includes(p.kind);
    if (moving) {
      if (p.mechanism === undefined) fail(`${at}.mechanism`, `a ${p.kind} needs a mechanism`);
      p.mechanism = normaliseMechanism(p.mechanism, p, s, `${at}.mechanism`);
      const wantHinge = p.kind === 'door' || p.kind === 'lid';
      if (wantHinge !== (p.mechanism.type === 'hinge')) fail(`${at}.mechanism.type`, `a ${p.kind} uses a ${wantHinge ? 'hinge' : 'slider'}`);
    } else if (p.mechanism !== undefined) fail(`${at}.mechanism`, `a ${p.kind} does not move`);
    const handles = p.handles ?? (p.handle ? [p.handle] : []);
    if (!Array.isArray(handles) || handles.length > 2) fail(`${at}.handles`, 'at most two handles');
    if (handles.length && !moving) fail(`${at}.handle`, 'only moving parts have handles');
    p.handles = handles.map((h, j) => normaliseHandle(h, p, `${at}.handle${handles.length > 1 ? `s[${j}]` : ''}`)); delete p.handle;
    p.interaction ??= moving ? 'grab' : 'none';
    if (!DATA.INTERACTIONS.includes(p.interaction)) fail(`${at}.interaction`, `must be one of ${DATA.INTERACTIONS.join(', ')}`);
    if (p.interaction === 'grab' && moving && !p.handles.length) p.interaction = 'tap'; // nothing to hold: a push/tap part
    p.minHands ??= 1;
    if (![1, 2].includes(p.minHands)) fail(`${at}.minHands`, 'must be 1 or 2');
    if (p.seal !== undefined) {
      plain(p.seal, `${at}.seal`); onlyKeys(p.seal, ['torque', 'angle'], `${at}.seal`);
      if (!moving) fail(`${at}.seal`, 'only moving parts seal');
      p.seal = { torque: p.seal.torque ?? 2, angle: p.seal.angle ?? (p.mechanism.type === 'hinge' ? 0.15 : 0.02) };
      if (!(p.seal.torque > 0) || !(p.seal.angle > 0) || p.seal.angle >= p.mechanism.max) fail(`${at}.seal`, 'torque and angle must be positive, angle below the travel');
      if (p.seal.torque <= p.mechanism.resistance) fail(`${at}.seal.torque`, 'must exceed the mechanism resistance or the seal cannot close the door');
    }
    // Lever arm of the (first) handle: the distance a hand pulls at, perpendicular to the hinge axis (a slider: 1).
    p.arm = 1;
    if (moving && p.mechanism.type === 'hinge') {
      const ref = p.handles[0]?.position ?? add(p.position, [p.kind === 'lid' ? 0 : p.size[0] * 0.4 * (p.mechanism.hinge === 'right' ? -1 : 1), 0, p.kind === 'lid' ? p.size[2] / 2 : 0]);
      const r = [ref[0] - p.mechanism.pivot[0], ref[1] - p.mechanism.pivot[1], ref[2] - p.mechanism.pivot[2]], a = p.mechanism.axis, along = r[0] * a[0] + r[1] * a[1] + r[2] * a[2];
      p.arm = Math.max(0.05, Math.hypot(r[0] - along * a[0], r[1] - along * a[1], r[2] - along * a[2]));
    }
    if (moving) { // physical plausibility: one hand opens it (minHands 1) or only two hands can (minHands 2)
      const F = DATA.HAND.forceN, m = p.mechanism, own = F * p.arm, need = m.resistance + Math.max(p.seal?.torque ?? 0, m.spring * (m.max - m.min));
      if (p.minHands === 1 && own <= need * 1.05) fail(`${at}.minHands`, `one hand (${own.toFixed(1)}) cannot overcome ${need.toFixed(1)}: lower the resistance or set minHands 2`);
      if (p.minHands === 2 && (own > need * 0.98 || 2 * own <= need * 1.05)) fail(`${at}.minHands`, `minHands 2 needs one hand (${own.toFixed(1)}) below and two hands (${(2 * own).toFixed(1)}) above ${need.toFixed(1)}`);
    }
    if (p.contents !== undefined) p.contents = normaliseContents(p.contents, p, `${at}.contents`);
    return p;
  });
  if (bodies > 1) fail('parts', 'at most one body (korpus)');
  for (const p of s.parts) if (p.contents) for (const id of p.contents.behind) {
    const q = s.parts.find(x => x.id === id);
    if (!q || !['door', 'lid', 'slide_door'].includes(q.kind)) fail(`parts.${p.id}.contents.behind`, `${id} must be a door, lid or slide_door part`);
  }
  s.locks = s.locks ?? []; if (!Array.isArray(s.locks)) fail('locks', 'must be an array');
  const lockIds = new Set(), guarded = new Set();
  s.locks = s.locks.map((raw0, i) => {
    const at = `locks[${i}]`, l = clone(plain(raw0, at)); onlyKeys(l, LOCK_KEYS, at);
    if (!isStr(l.id)) fail(`${at}.id`, 'needs a nonempty string (the lock id)');
    if (lockIds.has(l.id)) fail(`${at}.id`, `duplicate lock id ${l.id}`);
    lockIds.add(l.id);
    if (!DATA.LOCK_KINDS.includes(l.kind)) fail(`${at}.kind`, `must be one of ${DATA.LOCK_KINDS.join(', ')}`);
    if (!Array.isArray(l.parts) || !l.parts.length) fail(`${at}.parts`, 'needs the ids of the parts it guards');
    for (const id of l.parts) {
      const p = s.parts.find(x => x.id === id);
      if (!p || !DATA.MOVING_KINDS.includes(p.kind)) fail(`${at}.parts`, `${id} must be a moving part`);
      if (guarded.has(id)) fail(`${at}.parts`, `${id} is already guarded by another lock`);
      guarded.add(id);
    }
    if (l.kind === 'key') { if (!isStr(l.keyId)) fail(`${at}.keyId`, 'a key lock needs keyId (the id of the key that fits)'); }
    else if (l.keyId !== undefined) fail(`${at}.keyId`, 'only a key lock has keyId');
    if (l.kind === 'code') {
      if (typeof l.code !== 'string' || !new RegExp(`^\\d{${DATA.CODE.minDigits},${DATA.CODE.maxDigits}}$`).test(l.code)) fail(`${at}.code`, `a code lock needs a string of ${DATA.CODE.minDigits}-${DATA.CODE.maxDigits} digits`);
    } else if (l.code !== undefined) fail(`${at}.code`, 'only a code lock has code');
    if (l.kind === 'power') { l.mode ??= 'secure'; if (!['secure', 'safe'].includes(l.mode)) fail(`${at}.mode`, 'must be secure (locked while powered) or safe (locked while unpowered)'); }
    else if (l.mode !== undefined) fail(`${at}.mode`, 'only a power lock has mode');
    l.locked ??= true; if (typeof l.locked !== 'boolean') fail(`${at}.locked`, 'must be boolean');
    l.maxAttempts ??= 0; l.lockoutS ??= 0;
    if (!Number.isInteger(l.maxAttempts) || l.maxAttempts < 0 || !isNum(l.lockoutS) || l.lockoutS < 0) fail(at, 'maxAttempts must be an integer >= 0 and lockoutS >= 0');
    if (l.maxAttempts > 0 && l.kind !== 'code') fail(`${at}.maxAttempts`, 'only a code lock counts attempts');
    return l;
  });
  return s;
}

const cache = new Map();
/** A built-in type, normalised. Returns a fresh deep copy every call. */
export function typeSpec(id) {
  if (!cache.has(id)) {
    const raw = TYPES.types.find(t => t.id === id);
    if (!raw) throw new RangeError(`Unknown furniture type "${id}" (known: ${TYPE_IDS.join(', ')})`);
    cache.set(id, parseSpec({ schema: SPEC_SCHEMA, ...raw }));
  }
  return clone(cache.get(id));
}
/** Every built-in type, normalised. */
export const allTypes = () => TYPE_IDS.map(typeSpec);
/** Shortcut for tests/tools: the same type with overrides (top-level keys replaced; `parts` merged by id). */
export function variantOf(id, over = {}) {
  const base = TYPES.types.find(t => t.id === id);
  if (!base) throw new RangeError(`Unknown furniture type "${id}"`);
  const { parts, ...rest } = over, merged = { schema: SPEC_SCHEMA, ...clone(base), ...clone(rest) };
  if (parts) merged.parts = merged.parts.map(p => (parts[p.id] ? mergeBlock(expandBlock(p), parts[p.id]) : p));
  return parseSpec(merged);
}

/** Moving parts of a normalised spec. */
export const movingParts = spec => spec.parts.filter(p => DATA.MOVING_KINDS.includes(p.kind));
