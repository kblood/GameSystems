import { BAKED } from '../../extensions/grasp/baked_grasps.js';
import { chainGaps, fingerChain, placeWrist, placePalm, closeToContact, REFERENCE_HAND, CLOSURE } from '../../extensions/grasp/closure.js';
import { handGeometry, PAD_RADIUS } from '../../extensions/grasp/closure.js';
import { CATALOG } from '../../extensions/grasp/catalog.js';
import { referenceHand } from '../../extensions/grasp/record.js';
import REFERENCE from '../../extensions/grasp/reference_hand.json' with { type: 'json' };

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const modelForGolden = model => ({ base: model.base, len: model.len, axes: model.axes,
  hinge: model.hinge, restYaw: model.restYaw, twistSign: model.twistSign, radius: model.radius });
const handForGolden = hand => ({ side: hand.side, scale: hand.scale, length: hand.length, profile: hand.profile,
  fingers: Object.fromEntries(FINGERS.map(name => [name, modelForGolden(hand.fingers[name])])),
  palm: hand.palm, thenar: hand.thenar });

export function graspClosureCases() {
  const cases = [];
  for (const side of ['right', 'left']) {
    const hand = referenceHand(side);
    const poses = BAKED.poses.filter(pose => pose.side === side);
    for (const poseIndex of [0, 11]) {
      const pose = poses[poseIndex];
      for (const [index, fingerName] of FINGERS.entries()) {
        const finger = hand.fingers[fingerName];
        const row = pose.angles[index];
        cases.push({ name: `${side}:${pose.id}:${fingerName}`, finger: modelForGolden(finger), row,
          expected: fingerChain(finger, row) });
      }
    }
    for (const twist of [-30, 30]) {
      const finger = hand.fingers.Thumb;
      const row = [...poses[0].angles[0].slice(0, 4), twist];
      cases.push({ name: `${side}:synthetic-thumb-twist-${twist}`, finger: modelForGolden(finger), row,
        expected: fingerChain(finger, row) });
    }
  }
  const fallbackFinger = { base: [0.01, 0.02, 0.03], len: [0.04, 0.03, 0.02],
    axes: { F: [0, 0, 1], D: [0, 1, 0], R: [1, 0, 0] }, hinge: [0, 0, 1], restYaw: 0, twistSign: 1 };
  for (const row of [[0, 0, 35, -20], [15, -10, 20, 40, 25]])
    cases.push({ name: `hinge-axis-fallback:${row.length}`, finger: fallbackFinger, row,
      expected: fingerChain(fallbackFinger, row) });
  return cases;
}

export function graspPlaceWristCases() {
  const cases = [];
  for (const side of ['right', 'left']) {
    const hand = referenceHand(side);
    const pose = BAKED.poses.find(candidate => candidate.side === side);
    for (const scale of [0.78, 1, 1.24]) {
      const scaledHand = referenceHand(side, { scale });
      const candidate = { wrist: [...pose.wrist], quat: [...pose.quat] };
      cases.push({ name: `${side}:baked-scale-${scale}`, pose: candidate, hand: { length: scaledHand.length },
        reference: REFERENCE_HAND, expected: placeWrist(candidate, scaledHand) });
      const recorded = { ...candidate, handLength: 0.17 };
      cases.push({ name: `${side}:recorded-hand-length-${scale}`, pose: recorded, hand: { length: scaledHand.length },
        reference: REFERENCE_HAND, expected: placeWrist(recorded, scaledHand) });
    }
    const invalidRecorded = { wrist: [...pose.wrist], quat: [...pose.quat], handLength: 0 };
    cases.push({ name: `${side}:invalid-recorded-length-falls-back`, pose: invalidRecorded,
      hand: { length: hand.length * 1.15 }, reference: REFERENCE_HAND,
      expected: placeWrist(invalidRecorded, { length: hand.length * 1.15 }) });
  }
  const customHand = { length: 0.19 };
  const customPose = { wrist: [0.13, -0.27, 0.41], quat: [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)], handLength: 0.22 };
  const customReference = { length: 0.24, palm: [0.02, -0.04, 0.07] };
  cases.push({ name: 'custom-reference-rotated-recorded-pose', pose: customPose, hand: customHand,
    reference: customReference, expected: placeWrist(customPose, customHand, customReference) });
  return cases;
}

export function graspSegmentGapCases() {
  const cases = [];
  for (const side of ['right', 'left']) {
    const poses = BAKED.poses.filter(candidate => candidate.side === side);
    for (const scale of [0.82, 1.17]) {
      const hand = referenceHand(side, { scale });
      for (const poseIndex of [0, 11]) {
        const pose = poses[poseIndex];
        const placed = placeWrist(pose, hand);
        const shape = CATALOG[pose.kind].shape;
        const fingers = Object.fromEntries(FINGERS.map(name => [name, modelForGolden(hand.fingers[name])]));
        cases.push({ name: `${side}:${pose.id}:scale-${scale}`, hand: { scale: hand.scale, fingers }, shape,
          placed, rows: pose.angles, expected: chainGaps(hand, shape, placed, pose.angles) });
      }
    }
  }
  return cases;
}

export function graspProfileGeometryCases() {
  const cases = [];
  for (const side of ['left', 'right']) {
    const rest = REFERENCE.hands[side];
    const profile = structuredClone(handGeometry(rest).profile);
    profile.palmPatch = [[0.02, 0, 0.04], [-0.02, 0, 0.04], [0, 0, 0.09]];
    profile.thenarPatch = [[0.03, -0.01, 0.04], [0.02, -0.02, 0.05]];
    profile.palmWidth = 0.11;
    profile.palmThickness = 0.031;
    profile.thumbRoot = 0.008;
    const radii = Object.fromEntries(Object.entries(PAD_RADIUS).map(([name, values]) => [name, values.map(value => value * 0.8)]));
    const options = { scale: 0.93, profile, thumbTilt: 0.91, radii };
    cases.push({ name: `${side}:profile-palm-thenar-pads`, rest, options,
      expected: handGeometry(rest, options) });
    const optionalProfile = structuredClone(profile);
    delete optionalProfile.palmWidth;
    delete optionalProfile.palmThickness;
    delete optionalProfile.thumbRoot;
    delete optionalProfile.thumbTilt;
    const optionalOptions = { scale: 1.07, profile: optionalProfile };
    cases.push({ name: `${side}:profile-optional-geometry-fallbacks`, rest, options: optionalOptions,
      expected: handGeometry(rest, optionalOptions) });
    const zeroWidthProfile = structuredClone(profile);
    zeroWidthProfile.palmPatch = [];
    zeroWidthProfile.palmWidth = 0;
    const zeroWidthOptions = { scale: 1, profile: zeroWidthProfile };
    cases.push({ name: `${side}:zero-palm-width-falls-back`, rest, options: zeroWidthOptions,
      expected: handGeometry(rest, zeroWidthOptions) });
    const nullableRest = structuredClone(rest);
    nullableRest.frame.R = null;
    nullableRest.scale = null;
    nullableRest.thumbTilt = null;
    nullableRest.fingers.Middle.rest.yaw = null;
    const nullableOptions = {};
    cases.push({ name: `${side}:null-rest-frame-and-yaw-fallbacks`, rest: nullableRest, options: nullableOptions,
      expected: handGeometry(nullableRest, nullableOptions) });
  }
  return cases;
}

export function graspPlacePalmCases() {
  const cases = [];
  const offsets = [
    ['anchor-and-slide', {}],
    ['lateral-along-pitch-twist', { lateral: 0.006, along: 0.008, pitch: 12, twist: -9 }],
    ['normal-clearance', { normal: 0.004 }],
    ['left-right-offset-sign', { lateral: -0.005, along: -0.004, pitch: -8, twist: 7, normal: -0.002 }],
  ];
  for (const side of ['left', 'right']) {
    const rest = REFERENCE.hands[side];
    const poses = BAKED.poses.filter(pose => pose.side === side);
    for (const [poseIndex, pose] of [[0, poses[0]], [11, poses[11]]]) {
      const hand = referenceHand(side, { scale: poseIndex === 0 ? 1 : 0.91 });
      const shape = CATALOG[pose.kind].shape;
      for (const [name, offset] of offsets) {
        const placedPose = structuredClone(pose);
        if (name === 'normal-clearance') placedPose.handLength = 0.174;
        const options = name === 'normal-clearance'
          ? { palmGap: 0.008, palmSlide: 0.018, squeeze: 0.002 }
          : { ...CLOSURE };
        cases.push({ name: `${side}:${pose.id}:${name}`, pose: placedPose, hand, shape, options, offset,
          thumb_row: name === 'lateral-along-pitch-twist' ? pose.angles[0] : pose.open[0],
          expected: placePalm(placedPose, hand, shape, options, offset,
            name === 'lateral-along-pitch-twist' ? pose.angles[0] : pose.open[0]) });
      }
      cases.push({ name: `${side}:${pose.id}:no-shape`, pose, hand, shape: null, options: {}, offset: {}, thumb_row: null,
        expected: placePalm(pose, hand, null, {}, {}, null) });
    }
    const customProfile = structuredClone(handGeometry(rest).profile);
    customProfile.palmPatch = [[-0.018, -0.026, 0.04], [0.018, -0.026, 0.04], [0, -0.02, 0.08]];
    customProfile.thenarPatch = [[0.028, -0.019, 0.025], [0.026, -0.022, 0.04], [0.021, -0.021, 0.055]];
    const customHand = handGeometry(rest, { scale: 1.08, profile: customProfile });
    const pose = poses[0];
    const shape = CATALOG[pose.kind].shape;
    cases.push({ name: `${side}:custom-palm-thenar-patches`, pose, hand: customHand, shape, options: CLOSURE,
      offset: { pitch: 15, lateral: 0.003 }, thumb_row: pose.angles[0],
      expected: placePalm(pose, customHand, shape, CLOSURE, { pitch: 15, lateral: 0.003 }, pose.angles[0]) });
    cases.push({ name: `${side}:default-thumb-approach-row`, pose, hand: customHand, shape, options: CLOSURE,
      offset: { pitch: -6 }, default_thumb_row: true,
      expected: placePalm(pose, customHand, shape, CLOSURE, { pitch: -6 }) });
    cases.push({ name: `${side}:explicit-null-thumb-row`, pose, hand: customHand, shape, options: CLOSURE,
      offset: { pitch: 5 }, thumb_row: null,
      expected: placePalm(pose, customHand, shape, CLOSURE, { pitch: 5 }, null) });
  }
  return cases;
}

export function graspCloseFingerCases() {
  const cases = [];
  const kinds = ['bottle_beer', 'bottle_wine', 'mug', 'can'];
  for (const side of ['left', 'right']) {
    for (const kind of kinds) {
      const poses = BAKED.poses.filter(pose => pose.side === side && pose.kind === kind && pose.mode === 'wrap');
      for (const [poseIndex, scale] of [[0, 0.82], [Math.min(11, poses.length - 1), 1.18]]) {
        const pose = poses[poseIndex];
        const hand = referenceHand(side, { scale });
        const shape = CATALOG[pose.kind].shape;
        const result = closeToContact(pose, hand, shape, { wrist: pose.wrist, quat: pose.quat, options: CLOSURE });
      for (const [index, finger_name] of FINGERS.entries()) {
          const contact = result.fingers[finger_name];
          cases.push({ name: `${side}:${pose.id}:${finger_name}:scale-${scale}`, finger_name,
            finger: modelForGolden(hand.fingers[finger_name]), open_row: pose.open[index], closed_row: pose.angles[index],
            shape, wrist: pose.wrist, quat: pose.quat, scale: hand.scale, options: CLOSURE,
          expected: { row: result.angles[index], t: contact.t, touching: contact.touching,
            backedOff: contact.backedOff, stuck: contact.stuck } });
      }
      if (kind === 'bottle_beer' && poseIndex === 0) {
        const twist_pose = { ...pose, open: pose.open.map(row => [...row]), angles: pose.angles.map(row => [...row]) };
        twist_pose.open[0][4] = -12;
        twist_pose.angles[0][4] = 28;
        const thumb_index = FINGERS.indexOf('Thumb');
        const twist_result = closeToContact(twist_pose, hand, shape,
          { wrist: twist_pose.wrist, quat: twist_pose.quat, options: CLOSURE });
        const twist_contact = twist_result.fingers.Thumb;
        cases.push({ name: `${side}:${pose.id}:Thumb:twist-row`, finger_name: 'Thumb',
          finger: modelForGolden(hand.fingers.Thumb), open_row: twist_pose.open[thumb_index],
          closed_row: twist_pose.angles[thumb_index], shape, wrist: twist_pose.wrist, quat: twist_pose.quat,
          scale: hand.scale, options: CLOSURE,
          expected: { row: twist_result.angles[thumb_index], t: twist_contact.t,
            touching: twist_contact.touching, backedOff: twist_contact.backedOff, stuck: twist_contact.stuck } });
      }
      }
    }
    const beer_poses = BAKED.poses.filter(pose => pose.side === side && pose.kind === 'bottle_beer' && pose.mode === 'wrap');
    const pose = beer_poses[0];
    const hand = referenceHand(side, { scale: 1 });
    const shape = CATALOG[pose.kind].shape;
    const finger_name = 'Thumb', index = FINGERS.indexOf(finger_name);
    const options = { ...CLOSURE, squeeze: 0.0025, step: 0.08, bisect: 8, thumbOvershoot: 0.35 };
    const keep = [finger_name];
    const result = closeToContact(pose, hand, shape, { wrist: pose.wrist, quat: pose.quat, options, keep });
    const contact = result.fingers[finger_name];
    cases.push({ name: `${side}:${pose.id}:Thumb:kept-free-row`, finger_name,
      finger: modelForGolden(hand.fingers[finger_name]), open_row: pose.open[index], closed_row: pose.angles[index],
      shape, wrist: pose.wrist, quat: pose.quat, scale: hand.scale, options: { ...options, free: true },
      expected: { row: result.angles[index], t: contact.t, touching: contact.touching,
        backedOff: contact.backedOff, stuck: contact.stuck } });

    const null_overshoot_options = { ...CLOSURE, thumbOvershoot: null, overshoot: 0.8, step: 0.05 };
    const null_pose = side === 'right'
      ? beer_poses.find(candidate => candidate.id.includes('_r045_t-1')) ?? pose
      : pose;
    const null_overshoot_wrist = null_pose.wrist.map(value => value + 0.055);
    const null_overshoot_result = closeToContact(null_pose, hand, shape,
      { wrist: null_overshoot_wrist, quat: null_pose.quat, options: null_overshoot_options,
        keep: FINGERS.filter(f => f !== finger_name) });
    const null_overshoot_contact = null_overshoot_result.fingers[finger_name];
    if (side === 'right' && null_overshoot_contact.t[0] <= 1)
      throw new Error('null thumbOvershoot fallback fixture must search past t=1');
    cases.push({ name: `${side}:${null_pose.id}:Thumb:null-thumb-overshoot`, finger_name,
      finger: modelForGolden(hand.fingers[finger_name]), open_row: null_pose.open[index], closed_row: null_pose.angles[index],
      shape, wrist: null_overshoot_wrist, quat: null_pose.quat, scale: hand.scale,
      options: null_overshoot_options,
      expected: { row: null_overshoot_result.angles[index], t: null_overshoot_contact.t,
        touching: null_overshoot_contact.touching, backedOff: null_overshoot_contact.backedOff,
        stuck: null_overshoot_contact.stuck } });

    const free_pose = { ...pose, open: pose.open.map(row => [...row]), angles: pose.angles.map(row => [...row]) };
    free_pose.open[index][0] = 100;
    free_pose.angles[index][0] = 120;
    const free_options = { ...options, thumbOvershoot: null };
    const free_result = closeToContact(free_pose, hand, shape,
      { wrist: free_pose.wrist, quat: free_pose.quat, options: free_options, keep });
    const free_contact = free_result.fingers[finger_name];
    cases.push({ name: `${side}:${free_pose.id}:Thumb:free-outside-hard-range`, finger_name,
      finger: modelForGolden(hand.fingers[finger_name]), open_row: free_pose.open[index], closed_row: free_pose.angles[index],
      shape, wrist: free_pose.wrist, quat: free_pose.quat, scale: hand.scale, options: { ...free_options, free: true },
      expected: { row: free_result.angles[index], t: free_contact.t, touching: free_contact.touching,
        backedOff: free_contact.backedOff, stuck: free_contact.stuck } });
  }
  const contact_pose = BAKED.poses.find(pose => pose.side === 'right' && pose.kind === 'bottle_beer' && pose.mode === 'wrap');
  const contact_hand = referenceHand('right');
  const contact_shape = CATALOG[contact_pose.kind].shape;
  const contact_index = FINGERS.indexOf('Thumb');
  for (const [name, offset, segment] of [
    ['proximal-contact', [-0.04, -0.04, 0.02], 0],
    ['middle-contact', [-0.005, -0.04, 0.005], 1],
  ]) {
    const wrist = contact_pose.wrist.map((value, index) => value + offset[index]);
    const result = closeToContact(contact_pose, contact_hand, contact_shape,
      { wrist, quat: contact_pose.quat, options: CLOSURE, keep: FINGERS.filter(f => f !== 'Thumb') });
    const contact = result.fingers.Thumb;
    if (!contact.touching.includes(segment)) throw new Error(`${name} fixture did not touch segment ${segment}`);
    cases.push({ name: `right:${contact_pose.id}:Thumb:${name}`, finger_name: 'Thumb',
      finger: modelForGolden(contact_hand.fingers.Thumb), open_row: contact_pose.open[contact_index],
      closed_row: contact_pose.angles[contact_index], shape: contact_shape, wrist, quat: contact_pose.quat,
      scale: contact_hand.scale, options: CLOSURE,
      expected: { row: result.angles[contact_index], t: contact.t, touching: contact.touching,
        backedOff: contact.backedOff, stuck: contact.stuck } });
  }
  return cases;
}

export function graspCloseAllCases() {
  const cases = [];
  const specs = [
    { side: 'right', kind: 'bottle_beer', mode: 'wrap', keep: [] },
    { side: 'left', kind: 'bottle_wine', mode: 'wrap', keep: ['Thumb'] },
    { side: 'right', kind: 'can', mode: 'wrap', keep: [] },
    { side: 'left', kind: 'carton', mode: 'flat', keep: [] },
    { side: 'right', kind: 'bottle_beer', mode: 'wrap', keep: [], defaultScale: true,
      offset: [-0.005, -0.04, 0.005], requireThumbOpposition: true },
  ];
  for (const [index, spec] of specs.entries()) {
    const pose = BAKED.poses.find(candidate => candidate.side === spec.side
      && candidate.kind === spec.kind && candidate.mode === spec.mode);
    if (!pose) throw new Error(`missing closeAll fixture pose: ${JSON.stringify(spec)}`);
    const hand = spec.defaultScale ? referenceHand(spec.side)
      : referenceHand(spec.side, { scale: spec.scale ?? (index % 2 ? 1.18 : 0.86) });
    const shape = CATALOG[pose.kind].shape;
    const options = { ...CLOSURE, thumbSearch: false };
    const wrist = pose.wrist.map((value, axis) => value + (spec.offset?.[axis] ?? 0));
    const result = closeToContact(pose, hand, shape,
      { wrist, quat: pose.quat, options, keep: spec.keep });
    if (spec.requireThumbOpposition && (!result.grade.thumbTouching || result.grade.opposition < 125))
      throw new Error('closeAll thumb-opposition fixture must touch and oppose beyond 125 degrees');
    cases.push({ name: `${spec.side}:${pose.id}:scale-${hand.scale}:keep-${spec.keep.join('-') || 'none'}${spec.offset ? ':thumb-opposition' : ''}`,
      hand: handForGolden(hand), open_rows: pose.open, closed_rows: pose.angles, shape,
      wrist, quat: pose.quat, options, wrap: spec.mode === 'wrap', keep: spec.keep,
      expected: { angles: result.angles, fingers: result.fingers, grade: result.grade } });
  }
  return cases;
}
