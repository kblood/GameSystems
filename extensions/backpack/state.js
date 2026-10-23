// BackpackState: the pure state machine of a detachable backpack. Rules, transitions, who owns the bag, tracking loss,
// "never lost", checkpoint. No scene, no physics, no rendering: the host feeds hand input and surface/zone distances
// (adapters.js) and applies the outcome. The Godot twin is godot/addons/gs_backpack/gs_backpack_state.gd (same rules,
// proven against the same golden vectors).
//
//   WORN --grab handle--> DRAWING --release (offset >= 0.18 m for 0.15 s, or fast)--> HELD_CLOSED <--open/close--> HELD_OPEN
//    ^  ^                   |  (grip let go / tracking lost: back to WORN)               |  (grip let go)
//    |  |                   v                                                            v
//    |  +------------- RETURNING <-- no surface / back zone dwell / too far / tracking lost beyond grace --+--> PLACED
//    +--- returned (returnDurationS) ---+                                                   PLACED --grab--> HELD_*
//   WORN/PLACED --callToHand (seated gesture, optional)--> HELD_CLOSED
//
// Owner of the BAG (never of the items: the inventory ledger keeps those, bag state never changes item ownership):
//   WORN, DRAWING: 'worn'   HELD_*: 'hand:left'|'hand:right'   PLACED: 'world'   RETURNING: 'in_transit'
// The pack can never be lost (profile.lossPolicy is always 'never'): there is no LOST state, tracking loss while held
// freezes the bag for trackingGraceS and then sends it RETURNING, a release in mid air or without a stable surface goes
// RETURNING (never a drop), RETURNING always finishes in returnDurationS, death puts the bag WORN again.
import { parseProfile, thresholdsOf, tierFlags, BACKPACK_TIERS } from './profile.js';
import { createPull } from './pull.js';
import { jsonState } from '../host/state.js';

export const STATE_SCHEMA = 'gamesystems.backpack.v1';
export const TRANSITIONS = Object.freeze({
  WORN: ['DRAWING', 'HELD_CLOSED'],
  DRAWING: ['WORN', 'HELD_CLOSED'],
  HELD_CLOSED: ['HELD_OPEN', 'PLACED', 'RETURNING'],
  HELD_OPEN: ['HELD_CLOSED', 'PLACED', 'RETURNING'],
  PLACED: ['HELD_CLOSED', 'HELD_OPEN', 'RETURNING'],
  RETURNING: ['WORN'],
});
/** Legal state transitions (death/tier-off use a forced reset to WORN that is outside this table). */
export const canTransition = (from, to) => (TRANSITIONS[from] ?? []).includes(to);
export const isHeld = state => state === 'HELD_CLOSED' || state === 'HELD_OPEN';
export const OWNER_OF = Object.freeze({ WORN: 'worn', DRAWING: 'worn', PLACED: 'world', RETURNING: 'in_transit' });
const EPS = 1e-9;
const POSTURES = ['standing', 'crouch', 'seated'];
const opposite = side => (side === 'left' ? 'right' : 'left');
const fin = Array.isArray;
const finite3 = v => fin(v) && v.length === 3 && v.every(Number.isFinite);
const finite4 = v => fin(v) && v.length === 4 && v.every(Number.isFinite) && Math.hypot(...v) > 1e-9;
const clamp01 = v => Math.max(0, Math.min(1, v));

function normalHand(h) {
  const local = h && finite3(h.local) ? [...h.local] : null;
  return { tracked: !!(h && h.tracked === true && local), grip: !!(h && h.grip === true), local };
}
const validPose = p => !!p && finite3(p.position) && finite4(p.rotation);

export function createBackpackState({ profile, tier = 'high', emit = () => {} } = {}) {
  const prof = parseProfile(profile);
  const th = thresholdsOf(prof);
  const pull = createPull();
  let flags = tierFlags(prof, tier), tierName = tier;
  const s = {
    state: 'WORN', holder: '', secondary: false, drawSide: '', openFraction: 0, openTarget: 0, accessOpen: false,
    holdS: 0, prevOutward: null, blocked: '', graceS: 0, graceOn: false, donOn: false, donS: 0, returnS: 0,
    placedPose: null, posture: 'standing', hands: { left: normalHand(), right: normalHand() },
  };
  let events = [];
  const note = (type, data = {}) => { const e = { type, ...data }; events.push(e); emit(`backpack:${type}`, e); };
  const done = (ok, reason = '') => { const r = { ok, reason, events }; events = []; return r; };

  function go(to, reason) {
    const from = s.state;
    if (!canTransition(from, to)) throw new Error(`Illegal backpack transition ${from} -> ${to}`);
    s.state = to; note('state', { from, to, reason });
  }
  function forceWorn(reason) {
    const from = s.state;
    pull.clear();
    Object.assign(s, { state: 'WORN', holder: '', secondary: false, drawSide: '', openFraction: 0, openTarget: 0, accessOpen: false, holdS: 0, prevOutward: null,
      blocked: '', graceS: 0, graceOn: false, donOn: false, donS: 0, returnS: 0, placedPose: null });
    if (from !== 'WORN') note('state', { from, to: 'WORN', reason });
  }
  function toReturning(reason) {
    go('RETURNING', reason);
    Object.assign(s, { holder: '', secondary: false, openTarget: 0, graceS: 0, graceOn: false, donOn: false, donS: 0, returnS: 0, placedPose: null });
  }
  function toHeld(side, reason) {
    const to = s.accessOpen ? 'HELD_OPEN' : 'HELD_CLOSED';
    go(to, reason);
    Object.assign(s, { holder: side, secondary: false, graceS: 0, graceOn: false, donOn: false, donS: 0, placedPose: null });
  }
  function owner() {
    return isHeld(s.state) ? `hand:${s.holder}` : OWNER_OF[s.state];
  }
  function cancelDraw(reason) {
    pull.cancel(); s.drawSide = ''; s.holdS = 0; s.prevOutward = null; s.blocked = '';
    go('WORN', reason);
  }
  function advanceOpen(dt) {
    const step = dt / th.openDurationS;
    if (s.openFraction < s.openTarget) s.openFraction = Math.min(s.openTarget, s.openFraction + step);
    else if (s.openFraction > s.openTarget) s.openFraction = Math.max(s.openTarget, s.openFraction - step);
    if (!s.accessOpen && s.openTarget === 1 && s.openFraction + EPS >= th.openAccessFraction) s.accessOpen = true;
    else if (s.accessOpen && s.openFraction < th.closeAccessFraction - EPS) s.accessOpen = false;
    if (s.state === 'HELD_CLOSED' && s.accessOpen) go('HELD_OPEN', 'opened');
    else if (s.state === 'HELD_OPEN' && !s.accessOpen) go('HELD_CLOSED', 'closed');
  }
  const canDetach = () => flags.enabled && flags.detach && prof.detachable;

  const api = {
    profile: prof, thresholds: th,
    get tier() { return tierName; }, get flags() { return { ...flags }; },
    get state() { return s.state; }, get owner() { return owner(); }, get holder() { return s.holder; },
    get openFraction() { return s.openFraction; }, get pull() { return pull; },
    snapshot() {
      return { state: s.state, owner: owner(), holder: s.holder, secondary: s.secondary, openFraction: s.openFraction, accessOpen: s.accessOpen,
        pullOffset: pull.offset, returnProgress: s.state === 'RETURNING' ? clamp01(s.returnS / th.returnDurationS) : 0, placed: s.placedPose !== null, posture: s.posture };
    },
    /** True when items of this pocket may be stored/retrieved now (bag state decides; body mounts always). */
    canAccess(pocketId) {
      const pocket = prof.pockets.find(k => k.id === pocketId);
      if (!pocket || !flags.enabled) return false;
      if (pocket.access === 'always') return true;
      if (pocket.access === 'worn') return s.state === 'WORN' || (s.accessOpen && (isHeld(s.state) || s.state === 'PLACED'));
      return s.accessOpen && (isHeld(s.state) || s.state === 'PLACED');
    },
    setPosture(p) { if (!POSTURES.includes(p)) throw new RangeError(`Unknown posture: ${p}`); s.posture = p; },
    /** Change tier at runtime. A tier that cannot hold a detached bag sends it home (RETURNING); off puts it WORN. Never loses it. */
    setTier(name) {
      if (!BACKPACK_TIERS.includes(name)) throw new RangeError(`Unknown backpack tier: ${name}`);
      tierName = name; flags = tierFlags(prof, name);
      if (!flags.enabled) forceWorn('tier_off');
      else if (!flags.pull && s.state === 'DRAWING') cancelDraw('tier_lowered');
      else if (!canDetach() && (isHeld(s.state) || s.state === 'PLACED')) toReturning('tier_lowered');
      return done(true);
    },

    /** Grab the handle (WORN: starts the guided pull -> DRAWING; PLACED: lift it -> HELD_*). handleDistanceM: hand to handle, adapter-measured. */
    grab(side, { kind = 'grip', handleDistanceM } = {}) {
      if (side !== 'left' && side !== 'right') return done(false, 'invalid_hand');
      if (kind !== 'grip' && kind !== 'interact') return done(false, 'invalid_kind');
      if (!flags.enabled || !flags.pull) return done(false, 'tier_off');
      if (s.state === 'RETURNING') return done(false, 'returning');
      if (s.state !== 'WORN' && s.state !== 'PLACED') return done(false, 'busy');
      const hand = s.hands[side];
      if (!hand.tracked) return done(false, 'not_tracked');
      if (!hand.grip) return done(false, 'not_gripping');
      if (!Number.isFinite(handleDistanceM) || handleDistanceM > prof.handle.reachM + EPS) return done(false, 'out_of_reach');
      if (s.state === 'WORN') {
        if (!pull.begin(hand.local, side, kind)) return done(false, 'busy');
        s.drawSide = side; s.holdS = 0; s.prevOutward = null; s.blocked = '';
        go('DRAWING', 'grab');
      } else {
        if (!canDetach()) return done(false, 'tier_no_detach');
        toHeld(side, 'grab_placed');
      }
      return done(true);
    },
    open() {
      if (!isHeld(s.state) && s.state !== 'PLACED') return done(false, 'invalid_state');
      if (!flags.open) return done(false, 'tier_no_open');
      if (isHeld(s.state) && flags.twoHand && !s.secondary) return done(false, 'needs_two_hands');
      s.openTarget = 1; return done(true);
    },
    close() {
      if (!isHeld(s.state) && s.state !== 'PLACED') return done(false, 'invalid_state');
      s.openTarget = 0; return done(true);
    },
    /** Optional accessibility gesture: a seated player calls the bag to the hand (from WORN or PLACED). */
    callToHand(side) {
      if (side !== 'left' && side !== 'right') return done(false, 'invalid_hand');
      if (!flags.enabled || !canDetach()) return done(false, 'tier_no_detach');
      if (!prof.recall.seated) return done(false, 'recall_disabled');
      if (s.state !== 'WORN' && s.state !== 'PLACED') return done(false, s.state === 'RETURNING' ? 'returning' : 'busy');
      if (s.posture !== 'seated') return done(false, 'not_seated');
      const hand = s.hands[side];
      if (!hand.tracked) return done(false, 'not_tracked');
      if (!hand.grip) return done(false, 'not_gripping');
      if (s.state === 'WORN') s.accessOpen = false;
      toHeld(side, 'call_to_hand');
      return done(true);
    },
    /** Player died or was reset: the bag is on the body again (loss policy never). Items are untouched. */
    die() { forceWorn('death_restore'); return done(true); },

    /** Advance by dt (clamped to maxStepS). input: { hands:{left,right:{tracked,grip,local}}, posture, pathClear, weaponBusy, surface:{stable,position,rotation}, donDistanceM, bagDistanceM } */
    step(dt, input = {}) {
      if (!Number.isFinite(dt) || dt < 0) return done(false, 'invalid_dt');
      dt = Math.min(dt, th.maxStepS);
      s.hands = { left: normalHand(input.hands?.left), right: normalHand(input.hands?.right) };
      if (POSTURES.includes(input.posture)) s.posture = input.posture;
      if (!flags.enabled) return done(true);
      switch (s.state) {
        case 'WORN': pull.step([0, 0, 0], false, dt); break;
        case 'DRAWING': {
          const hand = s.hands[s.drawSide];
          if (!hand.tracked) { cancelDraw('tracking_lost'); pull.step([0, 0, 0], false, dt); break; }
          if (!hand.grip) { cancelDraw('grip_released'); pull.step([0, 0, 0], false, dt); break; }
          const offset = pull.step(hand.local, true, dt);
          const outward = pull.start[2] - hand.local[2];
          const speed = s.prevOutward === null || dt <= 0 ? 0 : (outward - s.prevOutward) / dt;
          s.prevOutward = outward;
          const ready = offset + EPS >= th.releaseOffsetM;
          s.holdS = ready ? s.holdS + dt : 0;
          if (!ready) { s.blocked = ''; break; }
          if (!(s.holdS + EPS >= th.releaseHoldS || speed >= th.releaseSpeedMps)) break;
          const block = !canDetach() ? 'tier_no_detach' : input.pathClear === false ? 'path_blocked' : input.weaponBusy === true ? 'weapon_busy' : '';
          if (block) { if (block !== s.blocked) note('release_blocked', { reason: block }); s.blocked = block; break; }
          const side = s.drawSide;
          pull.clear(); s.drawSide = ''; s.holdS = 0; s.prevOutward = null; s.blocked = '';
          toHeld(side, 'released');
          note('detached', { side });
          break;
        }
        case 'HELD_CLOSED': case 'HELD_OPEN': case 'PLACED': case 'RETURNING': break;
        default: throw new Error(`Unknown backpack state ${s.state}`);
      }
      if (isHeld(s.state)) {
        const hand = s.hands[s.holder], other = s.hands[opposite(s.holder)];
        s.secondary = flags.twoHand && other.tracked && other.grip;
        if (!hand.tracked) {
          if (!s.graceOn) { s.graceOn = true; note('tracking_grace', { side: s.holder }); }
          s.graceS += dt;
          if (s.graceS + EPS >= th.trackingGraceS) toReturning('tracking_lost');
        } else {
          if (s.graceOn) note('tracking_regained', { side: s.holder });
          s.graceS = 0; s.graceOn = false;
          const d = input.donDistanceM;
          if (Number.isFinite(d)) { s.donOn = s.donOn ? d <= th.donExitM : d <= th.donEnterM; s.donS = s.donOn ? s.donS + dt : 0; }
          else { s.donOn = false; s.donS = 0; }
          if (!hand.grip) {
            if (flags.twoHand && other.tracked && other.grip) { s.holder = opposite(s.holder); s.secondary = false; note('handoff', { side: s.holder }); }
            else if (s.donOn && s.donS + EPS >= th.donDwellS) toReturning('don');
            else if (input.surface && input.surface.stable === true && validPose(input.surface)) {
              const pose = { position: [...input.surface.position], rotation: [...input.surface.rotation] };
              go('PLACED', 'placed'); Object.assign(s, { holder: '', secondary: false, graceS: 0, graceOn: false, donOn: false, donS: 0, placedPose: pose });
            } else toReturning('no_surface');
          }
        }
      } else if (s.state === 'PLACED') {
        if (Number.isFinite(input.bagDistanceM) && input.bagDistanceM > th.autoReturnDistanceM) toReturning('too_far');
      }
      if (isHeld(s.state) || s.state === 'PLACED' || s.state === 'RETURNING') advanceOpen(dt);
      if (s.state === 'RETURNING') {
        s.returnS += dt;
        if (s.returnS + EPS >= th.returnDurationS) { forceWorn('returned'); }
      }
      return done(true);
    },

    // Checkpoint (JSON-safe). Only stable states persist: PLACED with its world pose, everything else restores as WORN
    // (default after a restart is WORN; the bag is never in someone's hand or in transit across a checkpoint).
    capture() {
      const placed = s.state === 'PLACED' && s.placedPose;
      return { schema: STATE_SCHEMA, profileId: prof.id, state: placed ? 'PLACED' : 'WORN', owner: placed ? 'world' : 'worn',
        openFraction: placed ? s.openFraction : 0, placedPose: placed ? { position: [...s.placedPose.position], rotation: [...s.placedPose.rotation] } : null };
    },
    prepareRestore(raw) {
      const d = jsonState(raw);
      if (d.schema !== STATE_SCHEMA) throw new Error('Backpack checkpoint schema differs');
      if (d.profileId !== prof.id) throw new Error('Backpack checkpoint belongs to another profile');
      if (!['WORN', 'PLACED'].includes(d.state)) throw new Error('Backpack checkpoint state must be WORN or PLACED');
      if (typeof d.openFraction !== 'number' || d.openFraction < 0 || d.openFraction > 1) throw new Error('Backpack checkpoint openFraction out of range');
      if (d.state === 'WORN' && (d.owner !== 'worn' || d.placedPose !== null || d.openFraction !== 0)) throw new Error('Backpack checkpoint WORN is inconsistent');
      if (d.state === 'PLACED' && (d.owner !== 'world' || !validPose(d.placedPose))) throw new Error('Backpack checkpoint PLACED needs a valid world pose');
      return {
        state: d.state,
        commit() {
          forceWorn('restore');
          if (d.state === 'PLACED' && canDetach()) {
            s.state = 'PLACED'; s.placedPose = { position: [...d.placedPose.position], rotation: [...d.placedPose.rotation] };
            s.openFraction = d.openFraction; s.openTarget = d.openFraction >= th.openAccessFraction ? 1 : 0; s.accessOpen = d.openFraction >= th.openAccessFraction;
          }
          events = [];
        },
        notify() { note('restored', { state: s.state }); events = []; },
      };
    },
    restore(raw) { const plan = api.prepareRestore(raw); plan.commit(); plan.notify(); },
    reset() { forceWorn('reset'); events = []; },
  };
  return api;
}
