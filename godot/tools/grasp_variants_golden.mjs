import { BAKED, POSES, RECORDED, graspVariantSelection, parseGraspVariants, setGraspVariants } from '../../extensions/grasp/baked_grasps.js';

const selections = (recorded) => [
  { name: 'null-default', input: null },
  { name: 'empty-string', input: '' },
  { name: 'baked', input: 'baked' },
  { name: 'off-alias', input: 'off' },
  { name: 'recorded', input: 'recorded' },
  { name: 'all-alias', input: 'all' },
  { name: 'empty-list', input: [] },
  { name: 'empty-comma-list', input: ' , , ' },
  { name: 'one-id', input: recorded[0]?.id ?? 'unknown' },
  { name: 'comma-id-order', input: `${recorded.at(-1)?.id ?? 'missing'}, ${recorded[0]?.id ?? 'missing'}, unknown` },
  { name: 'array-duplicates-and-unknown', input: [recorded[0]?.id ?? 'missing', 'unknown', recorded[0]?.id ?? 'missing'] },
  { name: 'unknown-only', input: ['missing-a', 'missing-b'] },
];

export function graspVariantsCases() {
  const cases = [];
  const originalSelection = graspVariantSelection();
  try {
    for (const item of selections(RECORDED)) {
      const parsed = parseGraspVariants(item.input);
      const result = setGraspVariants(item.input);
      cases.push({ name: item.name, input: item.input, parsed,
        selection: result.selection, ids: result.ids, unknown: result.unknown,
        is_baked_array: POSES === BAKED.poses,
        poses: POSES.map(pose => ({ id: pose.id, has_default: Object.hasOwn(pose, 'default'), default: pose.default ?? null })),
      });
    }
    for (const input of [0, false, {}, [RECORDED[0]?.id ?? 'missing', 4]]) {
      cases.push({ name: `invalid:${String(input)}`, input, parsed: parseGraspVariants(input), invalid: true });
    }
  } finally {
    setGraspVariants(originalSelection);
  }
  return cases;
}
