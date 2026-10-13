import { BAKED } from '../../extensions/grasp/baked_grasps.js';
import { fingerChain } from '../../extensions/grasp/closure.js';
import { referenceHand } from '../../extensions/grasp/record.js';

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const modelForGolden = model => ({ base: model.base, len: model.len, axes: model.axes,
  hinge: model.hinge, restYaw: model.restYaw, twistSign: model.twistSign });

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
