// Golden vector definitions (inputs only). tools/gen_golden.mjs runs them through the JS core and writes the expected
// outcomes to data/backpack.golden.json; the Godot parity test replays the same inputs against GDScript.
// Frames: approach = body-local (+X right, +Z behind); pull/state hand.local = bag-local (the bag faces -Z, a pull is -Z motion).
const SH = 0.35, DT = 0.02;
const H = (local, grip = true, tracked = true) => ({ tracked, grip, local });
const IN = (L, R, extra = {}) => ({ hands: { left: L ?? H(null, false, false), right: R ?? H(null, false, false) }, ...extra });
const step = (dt, input) => ({ op: 'step', dt, input });
const rep = (n, dt, input) => Array.from({ length: n }, () => step(dt, input));
const SURFACE = { stable: true, position: [1.0, 0.8, -2.0], rotation: [0, 0, 0, 1] };
const AT = [0.0, 0.10, 0.20]; // hand on the handle (bag-local)
const R = (z, grip = true) => H([0.0, 0.10, z], grip);
/** Right hand pulls from the handle to bag-local z `zEnd` in n steps, then holds there for m steps. */
const pullRight = (zEnd, n, m, extra = {}, dt = DT) => [
  ...Array.from({ length: n }, (_, i) => step(dt, IN(null, R(0.2 + (zEnd - 0.2) * (i + 1) / n), extra))),
  ...rep(m, dt, IN(null, R(zEnd), extra)),
];
const grabRight = (dist = 0.05) => [step(DT, IN(null, R(0.2))), { op: 'grab', side: 'right', handleDistanceM: dist }];
const toHeld = (extra = {}) => [...grabRight(), ...pullRight(-0.05, 13, 8, extra, 0.04)];

// ---- approach (ported from GSBackpackApproach; sequences follow godot/addons/gs_backpack/tests/gs_backpack_tests.gd)
const obs = (side, hand, dt = DT, shoulderY = SH, tracked = true) => ({ op: 'observe', side, tracked, hand, shoulderY, dt });
const chk = (side, hand, shoulderY = SH) => ({ op: 'check', side, hand, shoulderY });
const validRight = [obs('right', [0.18, 0.40, 0.0]), obs('right', [0.18, 0.38, 0.15]), obs('right', [0.12, 0.20, 0.27]), obs('right', [0.08, 0.10, 0.36])];
const validLeft = [obs('left', [-0.18, 0.40, 0.0]), obs('left', [-0.18, 0.38, 0.15]), obs('left', [-0.12, 0.20, 0.27]), obs('left', [-0.08, 0.10, 0.36])];
export const approachVectors = [
  { name: 'right_over_shoulder_accepted', ops: [...validRight, chk('right', [0.08, 0.10, 0.36])] },
  { name: 'left_mirror_accepted', ops: [...validLeft, chk('left', [-0.08, 0.10, 0.36])] },
  { name: 'no_history_required', ops: [chk('right', [0.08, 0.10, 0.36]), chk('middle', [0, 0, 0])] },
  { name: 'unknown_side_and_non_finite_check', ops: [obs('middle', [0.18, 0.40, 0.0]), chk('middle', [0.18, 0.40, 0.0]), ...validRight, chk('right', ['NaN', 0.1, 0.3]), chk('right', [0.08, 0.10, 0.36], 'NaN')] },
  { name: 'tracking_loss_clears', ops: [obs('right', [0.2, 0.3, 0.2], DT, SH, false), obs('right', [0.2, 0.3, 0.2], DT, SH, false), chk('right', [0.2, 0.3, 0.2]), ...validRight, obs('right', [0.08, 0.1, 0.36], DT, SH, false), chk('right', [0.08, 0.10, 0.36])] },
  { name: 'hitch_dt_resets', ops: [obs('right', [0.20, 0.30, 0.20], 0.16), chk('right', [0.20, 0.30, 0.20]), obs('right', [0.18, 0.40, 0.0], 0.15), obs('right', [0.18, 0.40, 0.30], 0.15), chk('right', [0.18, 0.40, 0.30])] },
  { name: 'jump_resets', ops: [obs('right', [0.18, 0.40, 0.0]), obs('right', [0.18, 0.40, 0.5], DT, 0.0), chk('right', [0.18, 0.40, 0.5])] },
  { name: 'non_finite_inputs_clear_one_side', ops: [...validRight, obs('right', ['NaN', 0.4, 0.0]), chk('right', [0.08, 0.10, 0.36]),
    ...validRight, obs('right', [0.18, 0.40, 0.0], DT, 'NaN'), chk('right', [0.08, 0.10, 0.36]),
    ...[0.0, -0.02, 'NaN', 'Infinity'].flatMap(dt => [...validRight, obs('right', [0.18, 0.40, 0.0], dt), chk('right', [0.08, 0.10, 0.36])])] },
  { name: 'sides_are_independent', ops: [...validLeft, obs('right', [0.18, 0.40, 0.0]), obs('right', [0.18, 0.40, 0.0], -0.02), chk('left', [-0.08, 0.10, 0.36]), chk('right', [0.18, 0.40, 0.0]), { op: 'reset', side: 'left' }, chk('left', [-0.08, 0.10, 0.36])] },
  { name: 'final_check_boundary_0_30m', ops: [obs('right', [0.18, 0.40, 0.0]), obs('right', [0.18, 0.40, 0.15]), chk('right', [0.18, 0.40, 0.45]), { op: 'reset' }, obs('right', [0.18, 0.40, 0.0], 0.15), obs('right', [0.18, 0.40, 0.30], 0.15), chk('right', [0.18, 0.40, 0.30])] },
  { name: 'low_crossing_is_path_reject', ops: [obs('right', [0.18, 0.40, 0.0]), chk('right', [0.18, 0.20, 0.15])] },
  { name: 'expiry_after_lifetime', ops: [...validRight, ...Array.from({ length: 9 }, () => obs('right', [0.18, 0.40, 0.15], 0.15)), chk('right', [0.18, 0.40, 0.15])] },
  { name: 'wrong_side_too_low_not_behind_no_progress', ops: [obs('right', [0.18, 0.40, 0.0]), obs('right', [0.18, 0.40, 0.07]), chk('right', [0.18, 0.40, 0.07]), chk('right', [-0.20, 0.4, 0.2]), chk('right', [0.6, 0.4, 0.2]),
    { op: 'reset' }, obs('right', [0.18, 0.40, 0.0]), obs('right', [0.18, 0.39, 0.09]), chk('right', [0.18, 0.39, 0.09]), chk('right', [0.18, 0.0, 0.2]), chk('right', [0.18, 0.40, 0.20])] },
  { name: 'no_progress_near_entry', ops: [obs('right', [0.18, 0.40, 0.08]), obs('right', [0.18, 0.40, 0.12]), chk('right', [0.18, 0.40, 0.12]), obs('right', [0.18, 0.38, 0.20]), chk('right', [0.18, 0.38, 0.20])] },
  { name: 'diagonal_through_torso_rejected', ops: [obs('right', [0.18, 0.40, 0.0]), obs('right', [0.10, 0.30, 0.05]), obs('right', [0.05, 0.25, 0.25]), chk('right', [0.05, 0.25, 0.25])] },
];

// ---- handle pull (ported from GSBackpackHandlePull)
const pst = (hand, dt, tracked = true) => ({ op: 'step', hand, tracked, dt });
export const pullVectors = [
  { name: 'begin_validation', ops: [{ op: 'begin', hand: [0, 0, 0], side: 'middle' }, { op: 'begin', hand: ['Infinity', 0, 0], side: 'right' }, { op: 'begin', hand: [0, 0, 0], side: 'right', kind: 'click' },
    { op: 'begin', hand: [0, 0, 0], side: 'right', kind: 'interact' }, { op: 'begin', hand: [0, 0, 0], side: 'left' }] },
  { name: 'deadzone_sideways_inward', ops: [{ op: 'begin', hand: [0, 0, 0.1], side: 'right' }, pst([0.2, 0, 0.08], 0.1), pst([0.0, 0, 0.099], 0.1), pst([0, 0, 0.3], 0.1)] },
  { name: 'outward_eases_to_target', ops: [{ op: 'begin', hand: [0, 0, 0], side: 'right' }, pst([0, 0, -0.10], 0.1), pst([0, 0, -0.10], 0.1), pst([0, 0, -0.10], 0.5)] },
  { name: 'saturates_at_20cm', ops: [{ op: 'begin', hand: [0, 0, 0], side: 'right' }, pst([0, 0, -2.0], 0.1), pst([0, 0, -2.0], 1.0), pst([0, 0, -2.0], 1.0)] },
  { name: 'invalid_dt_keeps_offset', ops: [{ op: 'begin', hand: [0, 0, 0], side: 'right' }, pst([0, 0, -0.1], 0.1), pst([0, 0, -0.1], 'NaN'), pst([0, 0, -0.1], 0.0), pst([0, 0, -0.1], -1)] },
  { name: 'tracking_loss_cancels_and_settles', ops: [{ op: 'begin', hand: [0, 0, 0], side: 'right' }, pst([0, 0, -0.3], 0.1), pst([0, 0, 0], 0.1, false), ...Array.from({ length: 6 }, () => pst([0, 0, 0], 1 / 72)), ...Array.from({ length: 60 }, () => pst([0, 0, 0], 1 / 72))] },
  { name: 'non_finite_hand_cancels', ops: [{ op: 'begin', hand: [0, 0, 0], side: 'left' }, pst([0, 0, -0.15], 0.1), pst(['NaN', 0, 0], 0.1), ...Array.from({ length: 60 }, () => pst([0, 0, 0], 1 / 72))] },
  { name: 'explicit_cancel_keeps_offset_then_settles', ops: [{ op: 'begin', hand: [0, 0, 0], side: 'right', kind: 'interact' }, pst([0, 0, -0.15], 0.1), { op: 'cancel' }, ...Array.from({ length: 60 }, () => pst([0, 0, 0], 1 / 72))] },
  { name: 'dt_slicing_one_vs_many_is_equal_in_effect', ops: [{ op: 'begin', hand: [0, 0, 0], side: 'right' }, ...Array.from({ length: 10 }, () => pst([0, 0, -0.12], 0.01)), pst([0, 0, -0.12], 0.0001)] },
];

// ---- state machine
const tfx = thresholds => ({ thresholds });
export const stateVectors = [
  { name: 'full_cycle_low', tier: 'low', ops: [
    ...toHeld(), { op: 'open' }, ...rep(30, DT, IN(null, R(0.0))), { op: 'close' }, ...rep(8, DT, IN(null, R(0.0))),
    { op: 'open' }, ...rep(30, DT, IN(null, R(0.0))), { op: 'close' }, ...rep(30, DT, IN(null, R(0.0))),
    step(DT, IN(null, R(0.0, false), { surface: SURFACE })), ...rep(5, DT, IN(null, null)), { op: 'capture' },
    step(DT, IN(null, R(0.2))), { op: 'grab', side: 'right', handleDistanceM: 0.1 }, step(DT, IN(null, R(0.0, false))), ...rep(8, 0.1, IN(null, null)),
  ] },
  { name: 'draw_released_before_detach_returns_worn', tier: 'high', ops: [...grabRight(), ...pullRight(-0.02, 10, 0), step(DT, IN(null, R(-0.02, false))), ...rep(8, 0.1, IN(null, null))] },
  { name: 'draw_tracking_loss_cancels', tier: 'high', ops: [...grabRight(), ...pullRight(-0.05, 10, 0), step(DT, IN(null, H(null, true, false))), ...rep(30, DT, IN(null, null))] },
  { name: 'grab_rejections', tier: 'high', ops: [
    { op: 'grab', side: 'right', handleDistanceM: 0.05 }, step(DT, IN(null, R(0.2, false))), { op: 'grab', side: 'right', handleDistanceM: 0.05 },
    step(DT, IN(null, R(0.2))), { op: 'grab', side: 'right', handleDistanceM: 0.17 }, { op: 'grab', side: 'right' }, { op: 'grab', side: 'right', handleDistanceM: 'NaN' },
    { op: 'grab', side: 'middle', handleDistanceM: 0.05 }, { op: 'grab', side: 'right', kind: 'click', handleDistanceM: 0.05 },
    { op: 'grab', side: 'right', handleDistanceM: 0.16 }, { op: 'grab', side: 'right', handleDistanceM: 0.05 }, { op: 'open' }, { op: 'close' }, { op: 'callToHand', side: 'right' }] },
  { name: 'held_tracking_grace_regains', tier: 'low', ops: [...toHeld(), ...rep(30, DT, IN(null, H(null, true, false))), ...rep(5, DT, IN(null, R(0.0))), ...rep(10, DT, IN(null, R(0.0)))] },
  { name: 'held_tracking_loss_expires_returns_never_drops', tier: 'low', ops: [...toHeld(), ...rep(70, DT, IN(null, H(null, true, false))), ...rep(8, 0.1, IN(null, null))] },
  { name: 'don_dwell_snap_on', tier: 'low', ops: [...toHeld(), ...rep(10, DT, IN(null, R(0.0), { donDistanceM: 0.5 })), ...rep(20, DT, IN(null, R(0.0), { donDistanceM: 0.3 })),
    ...rep(30, DT, IN(null, R(0.0), { donDistanceM: 0.2 })), ...rep(5, DT, IN(null, R(0.0), { donDistanceM: 0.3 })), step(DT, IN(null, R(0.0, false), { donDistanceM: 0.3, surface: SURFACE })), ...rep(8, 0.1, IN(null, null))] },
  { name: 'don_too_short_dwell_without_surface_returns', tier: 'low', ops: [...toHeld(), ...rep(10, DT, IN(null, R(0.0), { donDistanceM: 0.2 })), ...rep(5, DT, IN(null, R(0.0), { donDistanceM: 0.5 })), ...rep(10, DT, IN(null, R(0.0), { donDistanceM: 0.2 })), step(DT, IN(null, R(0.0, false), { donDistanceM: 0.2 }))] },
  { name: 'medium_two_hands_open_and_handoff', tier: 'medium', ops: [...toHeld(), { op: 'open' }, step(DT, IN(H([-0.2, 0.1, 0.0]), R(0.0))), { op: 'open' }, ...rep(30, DT, IN(H([-0.2, 0.1, 0.0]), R(0.0))),
    step(DT, IN(H([-0.2, 0.1, 0.0]), R(0.0, false))), ...rep(3, DT, IN(H([-0.2, 0.1, 0.0]), null)), step(DT, IN(H([-0.2, 0.1, 0.0], false), null, { surface: SURFACE }))] },
  { name: 'minimal_pulls_but_never_detaches', tier: 'minimal', ops: [...toHeld(), ...rep(5, DT, IN(null, R(-0.05))), ...rep(30, DT, IN(null, R(-0.05, false)))] },
  { name: 'off_tier_is_inert', tier: 'off', ops: [...grabRight(), ...rep(5, DT, IN(null, R(0.2))), { op: 'open' }, { op: 'callToHand', side: 'right' }] },
  { name: 'recall_seated_gesture', tier: 'low', ops: [step(DT, IN(null, R(0.2))), { op: 'callToHand', side: 'right' }, { op: 'setPosture', posture: 'seated' }, { op: 'callToHand', side: 'left' }, { op: 'callToHand', side: 'right' },
    { op: 'open' }, ...rep(30, DT, IN(null, R(0.0))), step(DT, IN(null, R(0.0, false), { surface: SURFACE })), { op: 'callToHand', side: 'right' }, step(DT, IN(null, R(0.0))), { op: 'callToHand', side: 'right' }] },
  { name: 'recall_stand_posture_rejected', tier: 'high', ops: [step(DT, IN(null, R(0.2))), { op: 'setPosture', posture: 'crouch' }, { op: 'callToHand', side: 'right' }] },
  { name: 'death_restores_worn_never_loses', tier: 'high', ops: [...toHeld(), { op: 'die' }, ...toHeld(), step(DT, IN(null, R(0.0, false), { surface: SURFACE })), { op: 'die' }, ...grabRight(), { op: 'die' }] },
  { name: 'placed_auto_returns_when_far', tier: 'low', ops: [...toHeld(), step(DT, IN(null, R(0.0, false), { surface: SURFACE })), step(DT, IN(null, null, { bagDistanceM: 7.9 })), step(DT, IN(null, null, { bagDistanceM: 8.5 })), ...rep(8, 0.1, IN(null, null))] },
  { name: 'release_blocked_weapon_and_path', tier: 'low', ops: [...grabRight(), ...pullRight(-0.05, 13, 13, { weaponBusy: true }, 0.04), ...rep(5, DT, IN(null, R(-0.05), { pathClear: false })), ...rep(5, DT, IN(null, R(-0.05), { pathClear: false })), ...rep(3, DT, IN(null, R(-0.05)))] },
  { name: 'fast_pull_releases_by_speed', tier: 'low', ops: [...grabRight(), ...Array.from({ length: 12 }, (_, i) => step(0.02, IN(null, R(0.2 - 0.03 * (i + 1))))), ...rep(8, 0.02, IN(null, R(-0.2)))] },
  { name: 'invalid_ops_rejected', tier: 'low', ops: [{ op: 'open' }, { op: 'close' }, step(-1, IN(null, null)), step('NaN', IN(null, null)), ...toHeld(), { op: 'grab', side: 'left', handleDistanceM: 0.05 }, { op: 'callToHand', side: 'right' },
    step(DT, IN(null, R(0.0, false))), { op: 'grab', side: 'right', handleDistanceM: 0.05 }, { op: 'open' }, { op: 'callToHand', side: 'right' }] },
  { name: 'tier_lowered_while_held_goes_home', tier: 'high', ops: [...toHeld(), { op: 'setTier', tier: 'minimal' }, ...rep(8, 0.1, IN(null, null)), ...toHeld(), { op: 'setTier', tier: 'off' }] },
  { name: 'tier_lowered_during_draw_and_placed', tier: 'high', ops: [...grabRight(), ...pullRight(-0.02, 8, 0), { op: 'setTier', tier: 'off' }, { op: 'setTier', tier: 'high' }, ...toHeld(), step(DT, IN(null, R(0, false), { surface: SURFACE })), { op: 'setTier', tier: 'minimal' }, ...rep(8, 0.1, IN(null, null))] },
  { name: 'checkpoint_roundtrip_placed_open', tier: 'low', ops: [...toHeld(), { op: 'open' }, ...rep(30, DT, IN(null, R(0.0))), step(DT, IN(null, R(0.0, false), { surface: SURFACE })), { op: 'capture' },
    { op: 'die' }, { op: 'capture' },
    { op: 'restore', data: { schema: 'gamesystems.backpack.v1', profileId: 'field_pack', state: 'PLACED', owner: 'world', openFraction: 1, placedPose: { position: [1, 0.8, -2], rotation: [0, 0, 0, 1] } } }, { op: 'capture' },
    { op: 'restore', data: { schema: 'gamesystems.backpack.v1', profileId: 'field_pack', state: 'WORN', owner: 'worn', openFraction: 0, placedPose: null } }, { op: 'capture' }] },
  { name: 'checkpoint_invalid_restores_change_nothing', tier: 'low', ops: [...toHeld(), step(DT, IN(null, R(0.0, false), { surface: SURFACE })),
    { op: 'restore', data: { schema: 'gamesystems.backpack.v1', profileId: 'field_pack', state: 'PLACED', owner: 'world', openFraction: 0, placedPose: null } },
    { op: 'restore', data: { schema: 'gamesystems.backpack.v1', profileId: 'other', state: 'WORN', owner: 'worn', openFraction: 0, placedPose: null } },
    { op: 'restore', data: { schema: 'gamesystems.backpack.v9', profileId: 'field_pack', state: 'WORN', owner: 'worn', openFraction: 0, placedPose: null } },
    { op: 'restore', data: { schema: 'gamesystems.backpack.v1', profileId: 'field_pack', state: 'HELD_OPEN', owner: 'hand:right', openFraction: 1, placedPose: null } },
    { op: 'restore', data: { schema: 'gamesystems.backpack.v1', profileId: 'field_pack', state: 'WORN', owner: 'worn', openFraction: 2, placedPose: null } },
    { op: 'restore', data: { schema: 'gamesystems.backpack.v1', profileId: 'field_pack', state: 'PLACED', owner: 'world', openFraction: 0, placedPose: { position: [0, 0, 'NaN'], rotation: [0, 0, 0, 1] } } },
    { op: 'restore', data: { schema: 'gamesystems.backpack.v1', profileId: 'field_pack', state: 'WORN', owner: 'world', openFraction: 0, placedPose: null } }, { op: 'capture' }] },
  { name: 'threshold_override_changes_release_and_grace', tier: 'low', ...tfx({ releaseOffsetM: 0.10, releaseHoldS: 0.04, trackingGraceS: 0.1 }),
    ops: [...grabRight(), ...pullRight(-0.05, 15, 5), ...rep(8, DT, IN(null, H(null, true, false))), ...rep(8, 0.1, IN(null, null))] },
  { name: 'pocket_access_by_state', tier: 'low', ops: [step(DT, IN(null, R(0.2))), ...toHeld(), { op: 'open' }, ...rep(23, DT, IN(null, R(0.0))), ...rep(2, DT, IN(null, R(0.0))), { op: 'close' }, ...rep(2, DT, IN(null, R(0.0))), ...rep(2, DT, IN(null, R(0.0)))] },
];

// ---- profile validation (the Godot reader must accept/reject exactly the same profiles)
export function profileCases(example) {
  const mk = fn => { const p = JSON.parse(JSON.stringify(example)); fn(p); return p; };
  const cases = [
    ['example_is_valid', p => p],
    ['overrides_are_valid', p => { p.thresholds = { releaseOffsetM: 0.1, trackingGraceS: 2 }; p.tiers = { high: { physicalItemsMax: 12 }, low: { weightLag: true } }; }],
    ['left_handed_minimal_profile', p => { p.dominantHand = 'left'; delete p.donZone; delete p.recall; delete p.mass; delete p.thresholds; delete p.displayName; p.handle = { local: [0, 0, 0] }; p.pockets = [p.pockets[0]]; }],
    ['loss_policy_drop_rejected', p => { p.lossPolicy = 'on_death_drop'; }],
    ['loss_policy_missing_rejected', p => { delete p.lossPolicy; }],
    ['wrong_schema', p => { p.schema = 'gamesystems.backpack-profile.v2'; }],
    ['unknown_top_key', p => { p.extra = 1; }],
    ['empty_id', p => { p.id = ' '; }],
    ['detachable_not_boolean', p => { p.detachable = 'yes'; }],
    ['bad_dominant_hand', p => { p.dominantHand = 'both'; }],
    ['handle_missing', p => { delete p.handle; }],
    ['handle_reach_negative', p => { p.handle.reachM = -1; }],
    ['handle_local_short', p => { p.handle.local = [0, 1]; }],
    ['unknown_threshold', p => { p.thresholds = { nope: 1 }; }],
    ['negative_threshold', p => { p.thresholds = { donDwellS: -1 }; }],
    ['don_hysteresis_inverted', p => { p.thresholds = { donEnterM: 0.5, donExitM: 0.2 }; }],
    ['release_offset_above_pull_cap', p => { p.thresholds = { releaseOffsetM: 0.25 }; }],
    ['release_offset_below_deadzone', p => { p.thresholds = { releaseOffsetM: 0.03 }; }],
    ['access_fractions_inverted', p => { p.thresholds = { openAccessFraction: 0.5, closeAccessFraction: 0.9 }; }],
    ['physical_items_on_low_rejected', p => { p.tiers = { low: { physicalItems: true, physicalItemsMax: 4 } }; }],
    ['physical_items_need_max', p => { p.tiers = { high: { physicalItemsMax: 0 } }; }],
    ['unknown_tier', p => { p.tiers = { ultra: {} }; }],
    ['unknown_flag', p => { p.tiers = { low: { nope: true } }; }],
    ['flag_wrong_type', p => { p.tiers = { low: { open: 'yes' } }; }],
    ['detach_without_pull', p => { p.tiers = { low: { pull: false } }; }],
    ['open_without_detach', p => { p.tiers = { low: { detach: false } }; }],
    ['disabled_tier_with_pull', p => { p.tiers = { off: { pull: true } }; }],
    ['no_pockets', p => { p.pockets = []; }],
    ['duplicate_pocket_id', p => { p.pockets[1].id = p.pockets[0].id; }],
    ['pocket_id_with_slash', p => { p.pockets[0].id = 'a/b'; }],
    ['pocket_capacity_zero', p => { p.pockets[0].capacity = 0; }],
    ['pocket_capacity_fraction', p => { p.pockets[0].capacity = 1.5; }],
    ['pocket_size_zero_axis', p => { p.pockets[0].maxSize = [0.3, 0, 0.1]; }],
    ['pocket_categories_duplicate', p => { p.pockets[0].categories = ['tool', 'tool']; }],
    ['pocket_categories_empty', p => { p.pockets[0].categories = []; }],
    ['body_mount_with_open_access', p => { p.pockets[4].access = 'open'; }],
    ['bad_container', p => { p.pockets[0].container = 'hip'; }],
    ['bad_access', p => { p.pockets[0].access = 'sometimes'; }],
    ['pocket_unknown_key', p => { p.pockets[0].color = 'red'; }],
    ['mass_negative', p => { p.mass = { emptyKg: -1 }; }],
    ['recall_not_boolean', p => { p.recall = { seated: 1 }; }],
  ];
  return cases.map(([name, fn]) => ({ name, profile: mk(fn) }));
}
