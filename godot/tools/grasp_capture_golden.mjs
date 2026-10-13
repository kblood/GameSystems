import { handBasis, handLengthFromJoints, quatFromBasis, poseJoints, referenceHand, rowsFromJoints, captureFromJoints } from '../../extensions/grasp/record.js';
import { BAKED } from '../../extensions/grasp/baked_grasps.js';
import { rotate } from '../../extensions/grasp/math.js';

const makeJoints = () => ({
  wrist: [0, 0, 0],
  'index-finger-phalanx-proximal': [1, 0, 0],
  'middle-finger-phalanx-proximal': [0, 0, 1],
  'pinky-finger-phalanx-proximal': [-1, 0, 0],
  'middle-finger-phalanx-intermediate': [0, 0, 1.02],
  'middle-finger-phalanx-distal': [0, 0, 1.04],
  'middle-finger-tip': [0, 0, 1.06],
});

const captureHand = hand => ({ fingers: Object.fromEntries(Object.entries(hand.fingers).map(([finger, model]) =>
  [finger, { axes: model.axes, hinge: model.hinge, restYaw: model.restYaw, twistSign: model.twistSign }])) });

const cases = [
  { name: 'right-orthogonal', side: 'right', joints: makeJoints() },
  { name: 'left-orthogonal', side: 'left', joints: makeJoints() },
  { name: 'missing-index-knuckle', side: 'right', joints: { wrist: [0, 0, 0] } },
  { name: 'null-middle-joint', side: 'right', joints: { ...makeJoints(), 'middle-finger-tip': null } },
  { name: 'nonfinite-basis-joint', side: 'right', joints: { ...makeJoints(), wrist: [0, null, 0] } },
  { name: 'degenerate-forward-axis', side: 'right', joints: { ...makeJoints(), 'middle-finger-phalanx-proximal': [0, 0, 0] } },
  { name: 'large-finite-coordinates', side: 'right', joints: { ...makeJoints(), wrist: [0, 0, 0], 'index-finger-phalanx-proximal': [1e200, 0, 0], 'middle-finger-phalanx-proximal': [0, 0, 1e200], 'pinky-finger-phalanx-proximal': [-1e200, 0, 0] } },
];

const q = [0.3, -0.4, 0.2, Math.sqrt(0.71)];
const basis = quaternion => ({
  X: rotate(quaternion, [1, 0, 0]), Y: rotate(quaternion, [0, 1, 0]), Z: rotate(quaternion, [0, 0, 1]),
});
const arbitrary = basis(q);
const quatCases = [
  { name: 'identity', ...basis([0, 0, 0, 1]) },
  { name: 'x-dominant-half-turn', X: [1, 0, 0], Y: [0, -1, 0], Z: [0, 0, -1] },
  { name: 'y-dominant-half-turn', X: [-1, 0, 0], Y: [0, 1, 0], Z: [0, 0, -1] },
  { name: 'z-dominant-half-turn', X: [-1, 0, 0], Y: [0, -1, 0], Z: [0, 0, 1] },
  { name: 'arbitrary-rotation', ...arbitrary },
];

export function graspCaptureCases() {
  const rowCases = [];
  const captureCases = [];
  for (const side of ['right', 'left']) {
    const hand = referenceHand(side);
    const poses = BAKED.poses.filter(pose => pose.side === side);
    for (const index of [0, 3, 9, 18, 27]) {
      const pose = poses[index];
      const joints = poseJoints(pose, hand);
      rowCases.push({ name: `${side}:${pose.id}`, side, joints,
        hand: captureHand(hand), expected_rows: rowsFromJoints(side, joints, hand) });
    }
    const missing = poseJoints(poses[0], hand);
    delete missing['ring-finger-phalanx-intermediate'];
    rowCases.push({ name: `${side}:missing-finger-joint`, side, joints: missing,
      hand: captureHand(hand), expected_rows: null });

    const twistRows = poses[0].angles.map(row => [...row]);
    twistRows[0] = [...twistRows[0].slice(0, 4), 30];
    const twistJoints = poseJoints(poses[0], hand, undefined, twistRows);
    rowCases.push({ name: `${side}:thumb-twist-inverse`, side, joints: twistJoints,
      hand: captureHand(hand), expected_rows: rowsFromJoints(side, twistJoints, hand) });

    for (const [index, item] of [
      { pos: [1.2, 0.7, -2.5], quat: [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)] },
      { pos: [-0.35, 1.8, 0.9], quat: [Math.sin(0.17), -0.2, 0.1, Math.sqrt(1 - 0.17 ** 2 - 0.2 ** 2 - 0.1 ** 2)] },
    ].entries()) {
      const pose = poses[[0, 11][index]];
      const joints = poseJoints(pose, hand, item);
      captureCases.push({ name: `${side}:item-space-${index}`, side, joints, item,
        hand: captureHand(hand), expected_capture: captureFromJoints(side, joints, item, hand) });
    }
    const invalidJoints = poseJoints(poses[0], hand);
    delete invalidJoints['middle-finger-tip'];
    const identityItem = { pos: [0, 0, 0], quat: [0, 0, 0, 1] };
    captureCases.push({ name: `${side}:missing-middle-tip`, side, joints: invalidJoints, item: identityItem,
      hand: captureHand(hand), expected_capture: captureFromJoints(side, invalidJoints, identityItem, hand) });
  }
  return {
    cases: cases.map(row => ({ ...row, expected_basis: handBasis(row.side, row.joints), expected_length: handLengthFromJoints(row.joints) })),
    row_cases: rowCases,
    capture_cases: captureCases,
    quaternion_cases: quatCases.map(row => ({ name: row.name, X: row.X, Y: row.Y, Z: row.Z,
      expected: quatFromBasis(row.X, row.Y, row.Z) })),
    length_cases: [
      { name: 'missing-tip', joints: Object.fromEntries(Object.entries(makeJoints()).filter(([key]) => key !== 'middle-finger-tip')) },
      { name: 'nonfinite-segment', joints: { ...makeJoints(), 'middle-finger-phalanx-distal': [0, 0, null] } },
      { name: 'zero-length-chain', joints: Object.fromEntries(['wrist', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip'].map(key => [key, [0, 0, 0]])) },
      { name: 'large-finite-segments', joints: Object.fromEntries(['wrist', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip'].map((key, index) => [key, [index * 1e200, 0, 0]])) },
      { name: 'small-finite-segments', joints: Object.fromEntries(['wrist', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip'].map((key, index) => [key, [index * 1e-200, 0, 0]])) },
    ].map(row => ({ ...row, expected_length: handLengthFromJoints(row.joints) })),
  };
}
