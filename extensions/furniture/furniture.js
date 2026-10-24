// createFurniture(host, spec, options): one piece of furniture at runtime. Engine-free (no three.js).
//
// It is glue between FurnitureSpec data (spec.js) and the systems that already exist:
//   mechanics  every moving part is one hinge/slider constraint `<furnitureId>/<partId>` (add, grab, moveHand, drive, setLocked, setValue, step, capture/restore of its own state);
//   audio      a clunk (audio.contact by material) when a part hits a stop or snaps shut, creaks (audio/creaks.js) when asked, a rattle on a locked handle;
//   grasp      handle grips (grips.js: pole/grip poses, descriptors), the hand force of one and two hands (grasp held_drive.holdForce);
//   backpack   drawer/shelf/body contents are stash containers (createStash) on the host's inventory provider, with the ledger's rejection reasons;
//   locks      key / code / power locks guard parts through mechanics' own lock flag.
//
// host = { mechanics (required), on(event, cb) -> off, emit(event, data), audio?, inventory?, isBlocked?(info), powerOf?(lockId), onReject?(info),
//          creaks?: 'own' | 'host' | 'off' }. Without `on`, values are read from mechanics.state() each step (allocates).
// Order per frame: furniture.step(dt) (seal, latch, tap, power) and mechanics.step(dt); the order only decides a frame of latency.
// Tiers: minimal (state only: setOpen snaps, no forces, no audio), low (kinematic mechanisms: hand drag, springs, seals, locks), mid (+ audio,
// contents as slots), high (+ proxies of real items from open containers, at most 12 at once).
// Not covered (see docs/furniture_system.md): gravity on doors, collision of parts with the world other than the host's isBlocked() hook,
// moving the furniture after creation (placement is fixed), velocity in checkpoints (restored at rest).
import { createStash } from '../backpack/index.js';
import { holdForce } from '../grasp/held_drive.js';
import { createCreakTrigger } from '../audio/creaks.js';
import { jsonState } from '../host/state.js';
import { parseSpec, typeSpec, FURNITURE_DATA as D } from './spec.js';
import { partGrips, handleGrip } from './grips.js';

export const STATE_SCHEMA = D.STATE_SCHEMA;
const TH = D.THRESHOLDS, SEAL_OWNER = 'furniture:seal', TAP_OWNER = 'furniture:tap';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const NOOP = () => {};

/** furniture frame -> world (yaw about +Y, then translation) */
function toWorld(p, pos, c, s) { return [pos[0] + p[0] * c + p[2] * s, pos[1] + p[1], pos[2] - p[0] * s + p[2] * c]; }
function dirToWorld(v, c, s) { return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; }
/** Rotate r about unit axis a by angle t (Rodrigues) into out. */
function rotate(r, a, t, out) {
  const c = Math.cos(t), s = Math.sin(t), k = a[0] * r[0] + a[1] * r[1] + a[2] * r[2], cx = a[1] * r[2] - a[2] * r[1], cy = a[2] * r[0] - a[0] * r[2], cz = a[0] * r[1] - a[1] * r[0];
  out[0] = r[0] * c + cx * s + a[0] * k * (1 - c); out[1] = r[1] * c + cy * s + a[1] * k * (1 - c); out[2] = r[2] * c + cz * s + a[2] * k * (1 - c); return out;
}

export function createFurniture(host, rawSpec, options = {}) {
  if (!host?.mechanics) throw new TypeError('createFurniture needs host.mechanics');
  const mech = host.mechanics;
  for (const m of ['add', 'drive', 'release', 'grab', 'moveHand', 'setLocked', 'setValue', 'state', 'remove']) if (typeof mech[m] !== 'function') throw new TypeError(`host.mechanics needs ${m}()`);
  const spec = typeof rawSpec === 'string' ? typeSpec(rawSpec) : parseSpec(rawSpec); // a type id, a raw spec or an already normalised spec
  const fid = options.id ?? spec.id, position = options.position ?? [0, 0, 0], yaw = options.yaw ?? 0, cs = Math.cos(yaw), sn = Math.sin(yaw);
  if (typeof fid !== 'string' || !fid || fid.includes('/')) throw new TypeError('furniture id needs a nonempty string without "/"');
  if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite) || !Number.isFinite(yaw)) throw new TypeError('placement needs position [x,y,z] and a finite yaw');
  let tier = options.quality ?? host.quality ?? 'high';
  if (!D.TIER_NAMES.includes(tier)) throw new RangeError(`Unknown furniture tier: ${tier}`);
  let flags = D.TIERS[tier];
  const emitHost = host.emit ?? NOOP, listeners = new Map(), offs = [];
  let clock = 0, disposed = false;

  const fire = (type, data) => {
    data.furnitureId = fid; data.type = type;
    emitHost(`furniture:${type}`, data);
    const set = listeners.get(type); if (set) for (const cb of [...set]) { try { cb(data); } catch (e) { emitHost('furniture:error', { error: e, type }); } }
    const all = listeners.get('*'); if (all) for (const cb of [...all]) { try { cb(data); } catch { /* listener errors never break the furniture */ } }
  };
  const reject = (partId, reason, extra = {}) => {
    const info = { partId, reason, ...extra };
    try { host.onReject?.({ furnitureId: fid, ...info }); } catch { /* hook errors never break the furniture */ }
    fire('rejected', info);
    return { ok: false, reason };
  };

  // ---- parts
  const parts = [], byId = new Map(), byMid = new Map();
  for (const p of spec.parts) {
    const rec = { id: p.id, spec: p, kind: p.kind, moving: D.MOVING_KINDS.includes(p.kind), mid: `${fid}/${p.id}`, value: 0, velocity: 0, fraction: 0, open: false, locked: false,
      lockId: null, mechLocked: false, holders: new Map(), tapT: 0, tapDir: 0, sealForce: 0, lastGood: 0, moved: false, lastStop: 0, gate: false, accessAt: 0.3, stash: null, warned: false,
      min: 0, max: 1, hinge: false, pivot: null, axis: null, origin: null, handlesW: [], rattleAt: -1e9 };
    parts.push(rec); byId.set(p.id, rec);
    if (rec.moving) {
      const m = p.mechanism;
      rec.min = m.min; rec.max = m.max; rec.hinge = m.type === 'hinge'; rec.pivot = toWorld(m.pivot, position, cs, sn); rec.axis = dirToWorld(m.axis, cs, sn);
      rec.origin = toWorld(p.position, position, cs, sn);
      rec.handlesW = p.handles.map(h => ({ closed: toWorld(h.position, position, cs, sn), rel: [0, 0, 0], scratch: [0, 0, 0] }));
      for (const h of rec.handlesW) h.rel = rec.hinge ? [h.closed[0] - rec.pivot[0], h.closed[1] - rec.pivot[1], h.closed[2] - rec.pivot[2]] : [0, 0, 0];
      rec.value = rec.lastGood = m.min;
      mech.add(rec.mid, { kind: m.type, origin: rec.hinge ? rec.pivot : rec.origin, axis: rec.axis, min: m.min, max: m.max, value: m.min, inertia: m.inertia,
        resistance: m.resistance, damping: m.damping, spring: m.spring, rest: m.rest });
      byMid.set(rec.mid, rec);
    }
  }
  const moving = parts.filter(r => r.moving);
  const behindMax = new Map(); // a door's access threshold: the strictest openAt of the containers behind it
  for (const r of parts) if (r.spec.contents?.behind.length) for (const id of r.spec.contents.behind) behindMax.set(id, Math.max(behindMax.get(id) ?? 0, r.spec.contents.openAt));
  for (const [id, v] of behindMax) byId.get(id).accessAt = v;
  for (const r of parts) if (r.spec.contents && r.spec.mechanism) r.accessAt = r.spec.contents.openAt;
  const scratch = [0, 0, 0], scratch2 = [0, 0, 0];

  // ---- locks
  const locks = new Map();
  for (const l of spec.locks) {
    const rec = { id: l.id, spec: l, kind: l.kind, engaged: false, desired: l.locked, attempts: 0, lockedOutS: 0, powered: l.kind === 'power' ? (l.mode === 'secure' ? l.locked : !l.locked) : true, parts: l.parts.map(id => byId.get(id)) };
    locks.set(l.id, rec); for (const p of rec.parts) p.lockId = l.id;
  }

  // ---- contents (backpack stash per container part)
  const inventory = host.inventory ?? null, bpTier = D.BACKPACK_TIER;
  if (inventory) for (const r of parts) if (r.spec.contents) {
    const c = r.spec.contents, proxyMax = spec.tiers.high?.proxyMax ?? c.proxyMax;
    r.stash = createStash({ inventory, tier: bpTier[tier], profile: { schema: 'gamesystems.backpack-profile.v1', id: `${fid}.${r.id}`, kind: 'stash', displayName: `${spec.name} / ${r.id}`, detachable: false,
      lossPolicy: 'never', mass: { emptyKg: 0 }, tiers: { high: { physicalItemsMax: Math.min(proxyMax, c.proxyMax) } },
      pockets: c.pockets.map(k => ({ id: k.id, container: 'bag', access: 'open', categories: k.categories, maxSize: k.maxSize, capacity: k.capacity })) } });
    r.stash.close();
  }

  // ---- helpers
  const partOf = id => { const r = byId.get(id); if (!r) throw new RangeError(`Unknown part ${id}`); return r; };
  const movingOf = id => { const r = byId.get(id); return r?.moving ? r : null; };
  const closedAt = r => r.value <= r.min + (r.hinge ? TH.closedEpsRad : TH.closedEpsM);
  const handCap = (r, n, arm = r.spec.arm) => Math.min(D.HAND.forceN, holdForce(Math.max(1, n)) / Math.max(1, n)) * (r.hinge ? arm : 1);
  const armAt = (r, point) => { // lever arm of a grab point: its distance from the hinge axis (a slider: 1)
    if (!r.hinge) return 1;
    const x = point[0] - r.pivot[0], y = point[1] - r.pivot[1], z = point[2] - r.pivot[2], k = x * r.axis[0] + y * r.axis[1] + z * r.axis[2];
    return Math.max(0.05, Math.hypot(x - k * r.axis[0], y - k * r.axis[1], z - k * r.axis[2]));
  };
  const centre = (r, out) => { // current world centre of a moving part (hinge: swung about the pivot)
    if (!r.hinge) { for (let i = 0; i < 3; i++) out[i] = r.origin[i] + r.axis[i] * r.value; return out; }
    scratch2[0] = r.origin[0] - r.pivot[0]; scratch2[1] = r.origin[1] - r.pivot[1]; scratch2[2] = r.origin[2] - r.pivot[2]; rotate(scratch2, r.axis, r.value, out);
    out[0] += r.pivot[0]; out[1] += r.pivot[1]; out[2] += r.pivot[2]; return out;
  };
  const handlePos = (r, i, out) => {
    const h = r.handlesW[i]; if (!h) return null;
    if (!r.hinge) { for (let k = 0; k < 3; k++) out[k] = h.closed[k] + r.axis[k] * r.value; return out; }
    rotate(h.rel, r.axis, r.value, out); out[0] += r.pivot[0]; out[1] += r.pivot[1]; out[2] += r.pivot[2]; return out;
  };
  const applyFreeze = r => {
    const want = r.locked || !flags.physics;
    if (want !== r.mechLocked) { mech.setLocked(r.mid, want); r.mechLocked = want; }
  };
  const place = (r, value) => { // set a value even while frozen; zero velocity
    const was = r.mechLocked; if (was) { mech.setLocked(r.mid, false); r.mechLocked = false; }
    mech.setValue(r.mid, value);
    if (was) { mech.setLocked(r.mid, true); r.mechLocked = true; }
    r.value = value; r.velocity = 0; r.lastGood = value; ingest(r);
  };

  // ---- openness, contents access, events
  function updateAccess() { // a container is reachable through its own mechanism, through any door in front of it, or always
    for (const r of parts) {
      if (!r.stash) continue;
      const c = r.spec.contents;
      const ok = r.spec.mechanism ? r.gate : c.behind.length ? c.behind.some(id => byId.get(id).gate) : true;
      if (ok && !r.stash.isOpen) r.stash.open(); else if (!ok && r.stash.isOpen) r.stash.close();
    }
  }
  function ingest(r) { // a new value arrived: fraction, access gate and open/closed hysteresis with events
    r.fraction = (r.value - r.min) / (r.max - r.min);
    const gate = r.fraction >= r.accessAt || (r.gate && r.fraction >= r.accessAt * TH.contentsClose);
    const gateChanged = gate !== r.gate; r.gate = gate;
    if (!r.open && r.fraction >= TH.openFraction) { r.open = true; fire('opened', { partId: r.id }); }
    else if (r.open && r.fraction <= TH.closedFraction) { r.open = false; fire('closed', { partId: r.id, speed: r.lastStop }); r.lastStop = 0; tryEngage(r); }
    if (gateChanged) updateAccess();
  }

  // ---- locks
  function engage(l) {
    if (l.engaged) return false;
    l.engaged = true;
    for (const p of l.parts) { p.locked = true; applyFreeze(p); }
    fire('locked', { lockId: l.id, parts: l.spec.parts }); updateAccess(); return true;
  }
  function disengage(l) {
    if (!l.engaged) return false;
    l.engaged = false;
    for (const p of l.parts) { p.locked = false; applyFreeze(p); }
    fire('unlocked', { lockId: l.id, parts: l.spec.parts }); updateAccess(); return true;
  }
  const lockClosed = l => l.parts.every(p => closedAt(p));
  function tryEngage(r) { // a part just closed: engage a pending lock when all its parts are shut
    const l = r.lockId && locks.get(r.lockId); if (!l || l.engaged || !l.desired) return;
    if (lockClosed(l)) { for (const p of l.parts) if (p.value !== p.min) place(p, p.min); engage(l); }
  }
  const lockOf = id => { const l = locks.get(id); if (!l) return null; return l; };
  const lockInfo = l => ({ id: l.id, kind: l.kind, locked: l.engaged, pending: l.desired && !l.engaged, attempts: l.attempts, lockedOutS: l.lockedOutS, powered: l.powered, parts: [...l.spec.parts] });

  // ---- audio
  const audio = host.audio ?? null;
  const creakMode = host.creaks ?? options.creaks ?? (audio ? 'own' : 'off');
  const creaks = audio && creakMode === 'own' ? createCreakTrigger(audio) : null;
  const AU = D.AUDIO, wpos = [0, 0, 0];
  function clunk(r, linear, extra = {}) {
    if (!(linear >= AU.clunkMinSpeed)) return;
    fire('clunk', { partId: r.id, speed: linear, closing: r.value <= r.min + 1e-9, ...extra });
    if (!audio || !flags.audio) return;
    centre(r, wpos);
    audio.contact({ material1: r.spec.material, material2: r.spec.stopMaterial, speed: Math.min(AU.clunkMaxSpeed, linear), position: [wpos[0], wpos[1], wpos[2]], sourceId: `furn:${r.mid}` });
  }

  // ---- mechanics events
  const stopSpeedLinear = (r, speed) => (r.hinge ? speed * (r.spec.kind === 'lid' ? r.spec.size[2] : r.spec.size[0]) : speed);
  const onChanged = s => {
    const r = byMid.get(s.id); if (!r || disposed) return;
    r.value = s.value; r.velocity = s.velocity; r.moved = true;
    if (creaks && flags.audio && creakMode === 'own') creaks.handle(s, clock);
    ingest(r);
  };
  const onStop = e => {
    const r = byMid.get(e.id); if (!r || disposed || !flags.physics) return;
    const lin = stopSpeedLinear(r, e.speed);
    r.lastStop = Math.max(r.lastStop, lin);
    clunk(r, lin, { energy: e.energy });
  };
  if (host.on) { offs.push(host.on('mechanics:changed', onChanged)); offs.push(host.on('mechanics:stop', onStop)); }
  const syncFromMechanics = !host.on;

  // ---- hands
  function stiffnessOf(r, cap) { return cap / (r.hinge ? D.HAND.saturationHinge : D.HAND.saturationSlider); }
  const api = {
    id: fid, spec, placement: { position: [...position], yaw },
    get quality() { return tier; },
    get flags() { return flags; },
    parts, moving,
    get time() { return clock; },
    partIds: () => parts.map(r => r.id),
    movingIds: () => moving.map(r => r.id),
    /** Live record of a part (value, fraction, open, locked): mutated in place, safe to read every frame. */
    part: id => partOf(id),
    state(id) { const r = partOf(id); return { id, kind: r.kind, value: r.value, fraction: r.fraction, velocity: r.velocity, open: r.open, locked: r.locked, holders: r.holders.size }; },
    isOpen: id => partOf(id).open,
    isLocked: id => partOf(id).locked,
    on(type, cb) { let s = listeners.get(type); if (!s) listeners.set(type, s = new Set()); s.add(cb); return () => s.delete(cb); },
    mechanismId: id => partOf(id).mid,
    centreOf(id, out = [0, 0, 0]) { const r = partOf(id); return r.moving ? centre(r, out) : toWorld(r.spec.position, position, cs, sn); },
    handleWorld(id, i = 0, out = [0, 0, 0]) { return handlePos(partOf(id), i, out); },
    toWorld: p => toWorld(p, position, cs, sn),

    setQuality(next) {
      if (!D.TIER_NAMES.includes(next)) throw new RangeError(`Unknown furniture tier: ${next}`);
      if (next === tier) return;
      tier = next; flags = D.TIERS[tier];
      if (!flags.physics) { api.releaseAll(); for (const r of moving) { r.tapT = 0; place(r, r.value); } }
      for (const r of moving) { applyFreeze(r); if (!flags.seal && r.sealForce) { mech.drive(r.mid, SEAL_OWNER, 0); r.sealForce = 0; } }
      for (const r of parts) r.stash?.ledger.setTier(bpTier[tier]);
    },

    nearestHandle(point, maxDist = TH.reachM) {
      let best = null, bd = maxDist; const t = scratch;
      for (const r of moving) {
        if (r.handlesW.length) for (let i = 0; i < r.handlesW.length; i++) { handlePos(r, i, t); const d = Math.hypot(t[0] - point[0], t[1] - point[1], t[2] - point[2]); if (d <= bd) { bd = d; best = { partId: r.id, handleIndex: i, distance: d }; } }
        else if (r.spec.interaction === 'tap') { centre(r, t); const d = Math.hypot(t[0] - point[0], t[1] - point[1], t[2] - point[2]); if (d <= bd) { bd = d; best = { partId: r.id, handleIndex: -1, distance: d }; } }
      }
      return best;
    },
    gripFor(id, handleIndex = 0, side = 'right') { const h = partOf(id).spec.handles[handleIndex]; if (!h) throw new RangeError('no such handle'); return handleGrip(h, side); },
    gripsOf: id => partGrips(partOf(id).spec),

    /** A hand takes a part (at a world point on its handle). Locked: rejected (with a rattle). minimal tier: toggles open/closed instead. */
    grab(id, owner, point) {
      const r = movingOf(id); if (!r) return reject(id, 'UNKNOWN_PART', { action: 'grab' });
      if (!owner) throw new TypeError('grab needs an owner');
      if (r.locked) return rattle(r, 'grab');
      if (r.spec.interaction === 'none') return reject(id, 'UNKNOWN_PART', { action: 'grab' });
      if (!flags.physics) { const res = api.setOpen(id, !r.open); return { ...res, toggled: true }; }
      if (r.holders.has(owner)) mech.release(r.mid, owner);
      mech.grab(r.mid, owner, point); r.holders.set(owner, armAt(r, point)); r.warned = false; r.tapT = 0;
      fire('grabbed', { partId: id, owner, hands: r.holders.size });
      return { ok: true, reason: '', hands: r.holders.size };
    },
    /** Hand follows `point` (world). Force is capped per hand (60 N x lever arm, two hands share holdForce(2)). */
    moveHand(id, owner, point) {
      const r = movingOf(id); if (!r || !r.holders.has(owner) || !flags.physics) return false;
      if (r.locked) return false;
      const n = r.holders.size, cap = handCap(r, n, r.holders.get(owner));
      if (n < r.spec.minHands) { // too heavy for this hand count: no force, say why once
        mech.drive(r.mid, owner, 0);
        if (!r.warned) { r.warned = true; reject(id, 'TOO_FEW_HANDS', { owner, needs: r.spec.minHands }); }
        return false;
      }
      return mech.moveHand(r.mid, owner, point, stiffnessOf(r, cap), cap);
    },
    release(id, owner) { const r = movingOf(id); if (!r) return false; const had = r.holders.delete(owner); mech.release(r.mid, owner); if (had) { r.warned = false; fire('released', { partId: id, owner, hands: r.holders.size }); } return had; },
    releaseAll(owner) { for (const r of moving) for (const o of [...r.holders.keys()]) if (owner === undefined || o === owner) api.release(r.id, o); },
    holders: id => partOf(id).holders.size,

    /** Opens or closes a part without a hand: minimal snaps, other tiers push for a short time with a hand's force (heavy parts do not move). */
    setOpen(id, open) {
      const r = movingOf(id); if (!r) return reject(id, 'UNKNOWN_PART', { action: 'setOpen' });
      if (r.locked) return rattle(r, 'setOpen');
      if (open && r.spec.minHands > 1 && flags.physics) return reject(id, 'TOO_FEW_HANDS', { needs: r.spec.minHands });
      if (!flags.physics) {
        const target = open ? r.spec.mechanism.openValue : r.min;
        if (host.isBlocked && open !== r.open && api.blockedAt(r, target)) return reject(id, 'BLOCKED', { action: 'setOpen' });
        place(r, target); return { ok: true, reason: '' };
      }
      r.tapDir = open ? 1 : -1; r.tapT = D.TAP.seconds; return { ok: true, reason: '' };
    },
    toggle(id) { const r = partOf(id); return api.setOpen(id, r.tapT > 0 ? r.tapDir < 0 : r.fraction < 0.35); },

    // ---- locks
    lockIds: () => [...locks.keys()],
    lockState(id) { const l = lockOf(id); if (!l) throw new RangeError(`Unknown lock ${id}`); return lockInfo(l); },
    /** Authority call (no key): lock needs the parts shut ('NOT_CLOSED'); a power lock only follows power (use setPowered), unless force. */
    setLocked(id, locked, { force = false } = {}) {
      const l = lockOf(id); if (!l) return reject(null, 'UNKNOWN_LOCK', { lockId: id });
      if (l.kind === 'power' && !force) return reject(l.parts[0].id, 'POWERED', { lockId: id });
      return setLockState(l, !!locked, force);
    },
    /** A key is tried in a key lock: right key toggles the lock, wrong key is rejected. */
    tryKey(id, keyId) {
      const l = lockOf(id); if (!l) return reject(null, 'UNKNOWN_LOCK', { lockId: id });
      if (l.kind !== 'key') return reject(l.parts[0].id, 'NOT_KEYED', { lockId: id });
      if (keyId !== l.spec.keyId) { rattleLock(l); return reject(l.parts[0].id, 'WRONG_KEY', { lockId: id }); }
      const r = setLockState(l, !l.engaged, false); return { ...r, locked: l.engaged };
    },
    /** A code is entered in a code lock: right code unlocks; wrong codes count (maxAttempts -> lockout for lockoutS). Entering the code of an unlocked lock locks it (needs the parts shut). */
    enterCode(id, code) {
      const l = lockOf(id); if (!l) return reject(null, 'UNKNOWN_LOCK', { lockId: id });
      if (l.kind !== 'code') return reject(l.parts[0].id, 'NOT_KEYED', { lockId: id });
      if (l.lockedOutS > 0) return reject(l.parts[0].id, 'LOCKED_OUT', { lockId: id, seconds: l.lockedOutS });
      if (String(code) !== l.spec.code) {
        l.attempts++;
        rattleLock(l);
        if (l.spec.maxAttempts > 0 && l.attempts >= l.spec.maxAttempts) { l.lockedOutS = l.spec.lockoutS; l.attempts = 0; return reject(l.parts[0].id, 'LOCKED_OUT', { lockId: id, seconds: l.lockedOutS }); }
        return reject(l.parts[0].id, 'WRONG_CODE', { lockId: id, attempts: l.attempts });
      }
      l.attempts = 0;
      const r = setLockState(l, !l.engaged, false); return { ...r, locked: l.engaged };
    },
    /** Power state of a power lock (also read from host.powerOf(lockId) each step when given). secure: locked while powered; safe: locked while unpowered. */
    setPowered(id, powered) {
      const l = lockOf(id); if (!l || l.kind !== 'power') return reject(null, 'UNKNOWN_LOCK', { lockId: id });
      l.powered = !!powered; const want = l.spec.mode === 'secure' ? l.powered : !l.powered;
      return setLockState(l, want, true, true);
    },

    // ---- contents
    containerIds: () => parts.filter(r => r.stash).map(r => r.id),
    isAccessible(id) { const r = partOf(id); return !!r.stash?.isOpen; },
    store(itemId, partId, { pocketId, expectedOwner = 'world' } = {}) {
      const r = partOf(partId); if (!r.stash) return reject(partId, inventory ? 'NOT_A_CONTAINER' : 'NO_INVENTORY', { action: 'store', itemId });
      const order = pocketId ? [pocketId] : r.stash.ledger.pocketIds();
      let firstFail = null;
      for (const pid of order) {
        const res = r.stash.ledger.store(itemId, pid, { expectedOwner });
        if (res.ok) { fire('itemStored', { partId, pocketId: pid, itemId, cell: res.cell }); return { ...res, pocketId: pid }; }
        if (!firstFail || (firstFail.reason === 'FULL' && res.reason !== 'FULL') || (firstFail.reason === 'WRONG_ITEM' && res.reason !== 'FULL' && res.reason !== 'WRONG_ITEM')) firstFail = res;
      }
      return reject(partId, firstFail.reason, { action: 'store', itemId });
    },
    retrieve(partId, { itemId, pocketId, newOwner = 'world' } = {}) {
      const r = partOf(partId); if (!r.stash) return reject(partId, inventory ? 'NOT_A_CONTAINER' : 'NO_INVENTORY', { action: 'retrieve', itemId });
      const L = r.stash.ledger;
      let pid = pocketId;
      if (!pid && itemId) pid = L.locate(itemId)?.pocketId;
      if (!pid) pid = L.pocketIds().find(k => L.itemsIn(k).length) ?? L.pocketIds()[0];
      const res = L.retrieve(pid, { itemId, newOwner });
      if (!res.ok) return reject(partId, res.reason, { action: 'retrieve', itemId });
      fire('itemRemoved', { partId, pocketId: pid, itemId: res.itemId, cell: res.cell });
      return { ...res, pocketId: pid };
    },
    contents(partId) { const r = partOf(partId); return r.stash ? r.stash.ledger.contents() : {}; },
    itemCount() { let n = 0; for (const r of parts) if (r.stash) for (const k of r.stash.ledger.pocketIds()) n += r.stash.ledger.itemsIn(k).length; return n; },
    ledger: partId => partOf(partId).stash?.ledger ?? null,
    /** World position of a container cell (item base centre), following the part while it moves. */
    cellWorld(partId, pocketId, index, out = [0, 0, 0]) {
      const r = partOf(partId), c = r.spec.contents?.cells.find(x => x.pocketId === pocketId && x.index === index); if (!c) return null;
      const p = c.position;
      out[0] = position[0] + p[0] * cs + p[2] * sn; out[1] = position[1] + p[1]; out[2] = position[2] - p[0] * sn + p[2] * cs;
      if (r.moving) {
        if (r.hinge) { scratch[0] = out[0] - r.pivot[0]; scratch[1] = out[1] - r.pivot[1]; scratch[2] = out[2] - r.pivot[2]; rotate(scratch, r.axis, r.value, out); out[0] += r.pivot[0]; out[1] += r.pivot[1]; out[2] += r.pivot[2]; }
        else { out[0] += r.axis[0] * r.value; out[1] += r.axis[1] * r.value; out[2] += r.axis[2] * r.value; }
      }
      return out;
    },
    /** Items of open containers to show as real objects (tier high only; at most PROXIES.budget in all). Rows: { partId, pocketId, index, cell, itemId, position }. */
    proxies(budget = D.PROXIES.budget) {
      const rows = [];
      if (!flags.proxies) return rows;
      const open = parts.filter(r => r.stash?.isOpen).sort((a, b) => b.fraction - a.fraction);
      for (const r of open) {
        const v = r.stash.ledger.view();
        for (const it of v.items) {
          if (!it.itemId) continue;
          if (rows.length >= budget) return rows;
          const idx = Number(it.cell.split('/').pop()), c = r.spec.contents.cells.find(x => x.pocketId === it.pocketId && x.index === idx);
          rows.push({ partId: r.id, pocketId: it.pocketId, index: idx, cell: it.cell, itemId: it.itemId, position: api.cellWorld(r.id, it.pocketId, idx), local: c ? [...c.position] : null });
        }
      }
      return rows;
    },
    contentView(partId) { const r = partOf(partId); return r.stash?.isOpen ? r.stash.ledger.view() : null; },

    // ---- time
    step(dt) {
      if (!(dt >= 0) || !Number.isFinite(dt)) throw new RangeError('dt must be nonnegative and finite');
      if (disposed) return;
      clock += dt;
      for (const l of locks.values()) {
        if (l.lockedOutS > 0) l.lockedOutS = Math.max(0, l.lockedOutS - dt);
        if (l.kind === 'power' && host.powerOf) {
          const p = !!host.powerOf(l.id);
          if (p !== l.powered) { l.powered = p; setLockState(l, l.spec.mode === 'secure' ? p : !p, true, true); }
        }
        if (l.desired && !l.engaged && lockClosed(l)) { for (const p of l.parts) if (p.value !== p.min) place(p, p.min); engage(l); }
      }
      if (syncFromMechanics) for (const r of moving) { const s = mech.state(r.mid); if (s.value !== r.value) onChanged(s); }
      if (!flags.physics) return;
      for (const r of moving) {
        if (host.isBlocked && r.moved) { r.moved = false; if (r.value !== r.lastGood) { if (api.blockedAt(r, r.value)) { const bad = r.value; place(r, r.lastGood); fire('blocked', { partId: r.id, value: bad }); audioKnock(r); } else r.lastGood = r.value; } }
        // seal: a gasket holds the part shut with a constant pull below its angle (drive owner "seal", summed with the hands)
        if (r.spec.seal && flags.seal && !r.locked) {
          const f = r.value < r.spec.seal.angle && r.value > r.min ? -r.spec.seal.torque : 0;
          if (f !== r.sealForce) { mech.drive(r.mid, SEAL_OWNER, f); r.sealForce = f; }
        }
        // tap: a short push with a hand's strength
        if (r.tapT > 0 && !r.locked) {
          r.tapT -= dt;
          const cap = handCap(r, 1) * D.TAP.forceFraction;
          mech.drive(r.mid, TAP_OWNER, r.tapDir * cap);
          if (r.tapT <= 0) { mech.release(r.mid, TAP_OWNER); r.tapDir = 0; }
        }
        // latch: a self-closing/sealed part that is let go close to shut and slow clicks shut
        const m = r.spec.mechanism;
        if (m.latch > 0 && !r.holders.size && !r.locked && r.value > r.min && r.value <= m.latch && Math.abs(r.velocity) <= TH.latchSpeed && r.tapT <= 0 && (m.spring > 0 || r.spec.seal)) {
          const v = Math.abs(r.velocity); place(r, r.min); r.lastStop = Math.max(r.lastStop, AU.latchSpeed);
          clunk(r, Math.max(AU.latchSpeed, stopSpeedLinear(r, v)), { latch: true });
        }
      }
    },

    // ---- blocking hook
    blockedAt(r, value) {
      if (!host.isBlocked) return false;
      const saved = r.value; r.value = value; centre(r, wpos); r.value = saved;
      blockInfo.furnitureId = fid; blockInfo.partId = r.id; blockInfo.kind = r.kind; blockInfo.value = value; blockInfo.previous = r.lastGood;
      blockInfo.position[0] = wpos[0]; blockInfo.position[1] = wpos[1]; blockInfo.position[2] = wpos[2]; blockInfo.size = r.spec.size; blockInfo.yaw = yaw + (r.hinge ? value : 0);
      return !!host.isBlocked(blockInfo);
    },

    // ---- checkpoint (own state only; velocities restart at rest)
    capture() {
      return { schema: STATE_SCHEMA, id: fid, type: spec.id,
        parts: Object.fromEntries(moving.map(r => [r.id, { value: r.value }])),
        locks: Object.fromEntries([...locks.values()].map(l => [l.id, { engaged: l.engaged, desired: l.desired, attempts: l.attempts, lockedOutS: l.lockedOutS, powered: l.powered }])),
        containers: Object.fromEntries(parts.filter(r => r.stash).map(r => [r.id, r.stash.capture()])) };
    },
    prepareRestore(raw) {
      const d = jsonState(raw);
      if (d.schema !== STATE_SCHEMA || d.id !== fid || d.type !== spec.id) throw new Error('Furniture checkpoint belongs to another piece');
      if (!d.parts || Object.keys(d.parts).length !== moving.length) throw new Error('Furniture checkpoint topology differs (parts)');
      for (const r of moving) { const s = d.parts[r.id]; if (!s || !Number.isFinite(s.value) || s.value < r.min || s.value > r.max) throw new Error(`Invalid saved value for ${r.id}`); }
      if (!d.locks || Object.keys(d.locks).length !== locks.size) throw new Error('Furniture checkpoint topology differs (locks)');
      for (const l of locks.values()) {
        const s = d.locks[l.id];
        if (!s || typeof s.engaged !== 'boolean' || typeof s.desired !== 'boolean' || !Number.isInteger(s.attempts) || s.attempts < 0 || !Number.isFinite(s.lockedOutS) || s.lockedOutS < 0 || typeof s.powered !== 'boolean') throw new Error(`Invalid saved lock ${l.id}`);
        if (s.engaged && l.parts.some(p => d.parts[p.id].value > p.min + 1e-9)) throw new Error(`Saved lock ${l.id} is engaged on an open part`);
      }
      const withStash = parts.filter(r => r.stash);
      if (!d.containers || Object.keys(d.containers).length !== withStash.length) throw new Error('Furniture checkpoint topology differs (containers)');
      const plans = withStash.map(r => { if (!d.containers[r.id]) throw new Error(`Missing container ${r.id}`); return r.stash.prepareRestore(d.containers[r.id]); });
      return {
        commit() {
          api.releaseAll();
          for (const r of moving) { r.tapT = 0; mech.release(r.mid, TAP_OWNER); r.locked = false; applyFreeze(r); }
          for (const l of locks.values()) l.engaged = false;
          for (const r of moving) { r.open = (d.parts[r.id].value - r.min) / (r.max - r.min) >= TH.openFraction; place(r, d.parts[r.id].value); r.sealForce = 0; mech.drive(r.mid, SEAL_OWNER, 0); }
          for (const l of locks.values()) { const s = d.locks[l.id]; l.desired = s.desired; l.attempts = s.attempts; l.lockedOutS = s.lockedOutS; l.powered = s.powered; l.engaged = s.engaged; for (const p of l.parts) { p.locked = s.engaged; applyFreeze(p); } }
          for (const p of plans) p.commit();
          for (const r of moving) { r.fraction = (r.value - r.min) / (r.max - r.min); r.gate = r.fraction >= r.accessAt; r.moved = false; r.lastGood = r.value; }
          updateAccess();
        },
        notify() { for (const p of plans) p.notify(); updateAccess(); fire('restored', {}); },
      };
    },
    restore(raw) { const plan = api.prepareRestore(raw); plan.commit(); plan.notify(); },

    dispose() {
      if (disposed) return;
      api.releaseAll();
      for (const o of offs.splice(0)) o();
      for (const r of moving) { mech.release(r.mid, TAP_OWNER); mech.release(r.mid, SEAL_OWNER); mech.remove(r.mid); creaks?.forget(r.mid); }
      listeners.clear(); disposed = true;
    },
  };
  const blockInfo = { furnitureId: fid, partId: '', kind: '', value: 0, previous: 0, position: [0, 0, 0], size: null, yaw: 0 };

  function setLockState(l, locked, force, fromPower = false) {
    if (locked) {
      l.desired = true;
      if (l.engaged) return { ok: true, reason: '' };
      if (lockClosed(l)) { for (const p of l.parts) if (p.value !== p.min) place(p, p.min); engage(l); return { ok: true, reason: '' }; }
      if (fromPower) return { ok: true, reason: '', pending: true }; // a power lock engages by itself when the part shuts
      if (force) { for (const p of l.parts) { api.releaseAll(); place(p, p.min); } engage(l); return { ok: true, reason: '' }; }
      l.desired = false;
      return reject(l.parts[0].id, 'NOT_CLOSED', { lockId: l.id });
    }
    l.desired = false; disengage(l); return { ok: true, reason: '' };
  }
  function rattle(r, action) {
    if (r.lockId) rattleLock(locks.get(r.lockId));
    return reject(r.id, 'LOCKED', { action, lockId: r.lockId });
  }
  function rattleLock(l) {
    const r = l.parts[0]; if (!audio || !flags.audio || clock - r.rattleAt < AU.rattleGap) return;
    r.rattleAt = clock; centre(r, wpos);
    audio.contact({ material1: r.spec.material, material2: r.spec.material, speed: AU.rattleSpeed, position: [wpos[0], wpos[1], wpos[2]], sourceId: `furn:${r.mid}:rattle` });
  }
  function audioKnock(r) {
    if (!audio || !flags.audio) return; centre(r, wpos);
    audio.contact({ material1: r.spec.material, material2: 'wood', speed: 0.6, position: [wpos[0], wpos[1], wpos[2]], sourceId: `furn:${r.mid}:knock` });
  }

  // initial state: locks engage, tier freeze, containers closed
  for (const r of moving) { r.mechLocked = false; applyFreeze(r); r.fraction = 0; }
  for (const l of locks.values()) if (l.desired) engage(l);
  for (const r of parts) r.stash?.ledger.setTier(bpTier[tier]);
  updateAccess();
  return api;
}
