import { BAKED } from '../../extensions/grasp/baked_grasps.js';
import { chainGaps, fingerChain, placeWrist, REFERENCE_HAND } from '../../extensions/grasp/closure.js';
import { handGeometry, PAD_RADIUS } from '../../extensions/grasp/closure.js';
import { CATALOG } from '../../extensions/grasp/catalog.js';
import { referenceHand } from '../../extensions/grasp/record.js';
import REFERENCE from '../../extensions/grasp/reference_hand.json' with { type: 'json' };

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const modelForGolden = model => ({ base: model.base, len: model.len, axes: model.axes,
  hinge: model.hinge, restYaw: model.restYaw, twistSign: model.twistSign, radius: model.radius });

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
