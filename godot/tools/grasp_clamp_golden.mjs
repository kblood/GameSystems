import baked from '../../extensions/grasp/baked_grasps.data.json' with { type: 'json' };
import validator from '../../extensions/grasp/data/validator.data.json' with { type: 'json' };
import { clampRows } from '../../extensions/grasp/grasp_validator.js';

export function graspClampCases() {
  const rows = [];
  const digits = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
  for (const pose of baked.poses) {
    const input = Object.fromEntries(digits.map((finger, index) => [finger, pose.angles[index]]));
    rows.push({ name: `baked:${pose.id}`, input, expected: clampRows(input) });
  }
  rows.push(
    { name: 'missing-rows', input: {}, expected: clampRows({}) },
    { name: 'partial-and-null', input: { Thumb: [null, 999, -999, 90, null], Index: [null, -999, 999, -999, 17] }, expected: clampRows({ Thumb: [null, 999, -999, 90, null], Index: [null, -999, 999, -999, 17] }) },
    { name: 'all-upper-lower-bounds', input: Object.fromEntries(Object.entries(validator.HARD).map(([finger, joints]) => [finger, Object.keys(joints).map(() => 1e6)])), expected: clampRows(Object.fromEntries(Object.entries(validator.HARD).map(([finger, joints]) => [finger, Object.keys(joints).map(() => 1e6)]))) },
    { name: 'all-lower-bounds', input: Object.fromEntries(Object.entries(validator.HARD).map(([finger, joints]) => [finger, Object.keys(joints).map(() => -1e6)])), expected: clampRows(Object.fromEntries(Object.entries(validator.HARD).map(([finger, joints]) => [finger, Object.keys(joints).map(() => -1e6)]))) },
  );
  return rows;
}
