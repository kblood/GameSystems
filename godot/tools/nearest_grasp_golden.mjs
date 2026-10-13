// Probe the public JS selector, never a second implementation of its score.
import { BAKED, nearestPose, setGraspVariants, graspVariantSelection, ANGLE_WEIGHT, HYSTERESIS } from '../../extensions/grasp/baked_grasps.js';

export function nearestGraspCases() {
  const cases = [], identity = [0, 0, 0, 1];
  const query = (pos = [0, 0, 0], quat = identity) => ({ pos, quat });
  const pose = (id, wrist, quat = identity, grasp = 'body', side = 'left') =>
    ({ id, kind: '__nearest_golden', side, grasp, wrist, quat });
  const add = (name, candidates, local, options = {}, allowed = null, baked = false) => {
    setGraspVariants(baked ? 'baked' : 'recorded', candidates);
    const kind = baked ? candidates[0].kind : '__nearest_golden';
    const side = baked ? candidates[0].side : 'left';
    const filter_calls = [];
    const filter = allowed === null ? null : p => { filter_calls.push(p.id); return allowed.includes(p.id); };
    const result = nearestPose(kind, side, local, { ...options, filter });
    cases.push({ name, library: baked ? 'baked' : 'synthetic', ...(baked ? {} : { poses: candidates }),
      kind, side, local, options, allowed, filter_calls,
      expected: result ? { id: result.pose.id, index: (baked ? BAKED.poses : candidates).indexOf(result.pose),
        cost: result.cost, distance: result.distance, angle: result.angle } : null });
  };
  const previous = graspVariantSelection();
  try {
    // Every shipped pose is queried at its own wrist, with nearby/sign-flipped queries
    // covering every library group without copying the source bake into this golden.
    for (const [index, p] of BAKED.poses.entries()) {
      add(`baked_${index}_self`, [p], query(p.wrist, p.quat), {}, null, true);
      if (index % 13 === 0) add(`baked_${index}_offset_sign`, [p],
        query(p.wrist.map((v, i) => v + [0.013, -0.007, 0.021][i]), p.quat.map(v => -v)),
        { previousId: p.id, grasp: p.grasp }, null, true);
    }
    const a = pose('a', [0, 0, 0]), b = pose('b', [0.02, 0, 0]);
    add('empty', [], query());
    add('wrong_side', [pose('right', [0, 0, 0], identity, 'body', 'right')], query());
    add('wrong_kind', [{ ...a, kind: 'other' }], query());
    add('tie_first', [a, b], query([0.01, 0, 0]));
    add('tie_reversed', [b, a], query([0.01, 0, 0]));
    for (const x of [0.0049, 0.005, 0.0051]) add(`hysteresis_${x}`, [a, b], query([x, 0, 0]), { previousId: 'b' });
    add('negative_cost', [a], query(), { previousId: 'a' });
    add('unknown_previous', [a, b], query(), { previousId: 'absent' });
    add('grasp_filter', [a, { ...b, grasp: 'handle' }], query(), { grasp: 'handle' });
    add('empty_grasp_is_unfiltered', [a, b], query(), { grasp: '' });
    add('missing_grasp', [a, b], query(), { grasp: 'missing' });
    add('predicate_select', [a, b], query(), {}, ['b']);
    add('predicate_reject_all', [a, b], query(), {}, []);
    add('filter_order', [a, { ...b, grasp: 'handle' }, pose('r', [0, 0, 0], identity, 'handle', 'right')],
      query(), { grasp: 'handle' }, ['b']);
    add('quaternion_sign', [a], query([0, 0, 0], [0, 0, 0, -1]));
    add('quaternion_rounded_dot_clamp', [pose('rounded', [0, 0, 0], [0, 0, 0, 1.00001])], query());
    add('rotation_beats_distance', [pose('rotated', [0, 0, 0], [0, 1, 0, 0]), b], query());
    add('distance_beats_rotation', [pose('rotated', [0, 0, 0], [0, 1, 0, 0]), pose('far', [0.2, 0, 0])], query());
    add('three_axis_distance', [pose('xyz', [0.03, -0.04, 0.12])], query());
  } finally { setGraspVariants(previous); }
  return { constants: { ANGLE_WEIGHT, HYSTERESIS }, cases };
}
