// Identity metadata is observed from public mergePoses, not reconstructed policy.
import { mergePoses, recordedPoses } from '../../extensions/grasp/record.js';
import baked from '../../extensions/grasp/baked_grasps.data.json' with { type: 'json' };
import recordings from '../../extensions/grasp/recorded_grasps.json' with { type: 'json' };
import { deepStrictEqual } from 'node:assert';

export function graspMergeCases() {
  const cases = [];
  const p = (id, isDefault = false, kind = 'cup', side = 'left', grasp = 'body') =>
    ({ id, kind, side, grasp, default: isDefault, metadata: { label: id, numbers: [1, 2] } });
  const add = (name, base, recorded, canonical = false) => {
    const before = structuredClone({ base, recorded });
    const result = mergePoses(base, recorded);
    const inputs = [...base.map((pose, index) => ({ pose, source: 'baked', index })),
      ...recorded.map((pose, index) => ({ pose, source: 'recorded', index }))];
    const expected = result.map(pose => {
      // The sole possible copied field is default. Compare with each input after
      // restoring that field; do not infer origin from an ID that may be duplicated.
      const input = inputs.find(row => row.pose === pose) ?? inputs.find(row =>
        Object.keys(pose).every(key => key === 'default' || pose[key] === row.pose[key]) &&
        Object.keys(row.pose).length === Object.keys(pose).length);
      if (!input) throw new Error(`Cannot identify output source in ${name}`);
      return { source: input.source, index: input.index, same_pose: pose === input.pose,
        has_default: Object.hasOwn(pose, 'default'), default_value: pose.default ?? null,
        nested_identity: Object.entries(input.pose).filter(([, value]) => value && typeof value === 'object')
          .map(([key, value]) => ({ key, same: pose[key] === value })) };
    });
    deepStrictEqual({ base, recorded }, before, `mergePoses mutated ${name}`);
    cases.push({ name, library: canonical ? 'canonical' : 'synthetic',
      ...(canonical ? { recorded_indices: recorded.map(pose => recordings.poses.indexOf(pose)) } : { baked: base, recorded }),
      same_array: result === base, expected });
  };
  add('empty_both', [], []);
  add('empty_recordings_identity', [p('a', true), p('b')], []);
  add('only_recordings', [], [p('r')]);
  add('append_order', [p('a'), p('b')], [p('z'), p('c')]);
  add('recorded_default_takes_baked_default', [p('a', true), p('b', false)], [p('r', true)]);
  add('clear_all_baked_defaults_same_key', [p('a', true), p('b', true)], [p('r', true)]);
  add('other_keys_keep_defaults', [p('a', true), p('b', true, 'cup', 'right'), p('c', true, 'cup', 'left', 'handle')], [p('r', true)]);
  add('first_recorded_default_only', [p('a', true)], [p('r1', true), p('r2', true), p('r3', true)]);
  add('nondefault_before_default', [], [p('r1'), p('r2', true), p('r3', true)]);
  add('baked_duplicate_ids_retained', [p('same', true), p('same')], [p('same', true), p('r')]);
  add('recorded_duplicate_first_wins', [], [p('r'), p('r', true), p('later', true)]);
  add('duplicate_default_still_clears_bake', [p('r', true)], [p('r', true)]);
  add('skipped_default_does_not_claim_recorded_default', [p('r')], [p('r', true), p('later', true)]);
  add('duplicate_ids_across_keys', [p('a', true)], [p('r', false, 'other'), p('r', true), p('later', true)]);
  const missing = p('missing'); delete missing.default;
  add('missing_default_preserved', [missing], [p('r')]);
  add('different_kind_defaults', [p('a', true)], [p('r1', true, 'other'), p('r2', true)]);
  add('default_marker_blocks_later_id', [], [p('r', true), p('default:cup/left/body')]);
  add('id_blocks_later_default_marker', [], [p('default:cup/left/body'), p('r', true)]);
  add('slash_key_alias', [p('a', true, 'cup/left', 'body', 'handle')], [p('r', true, 'cup', 'left', 'body/handle')]);
  add('empty_string_keys', [p('', true, '', '', '')], [p('r', true, '', '', '')]);
  add('canonical_bake_recordings', baked.poses, recordedPoses(recordings), true);
  return cases;
}
