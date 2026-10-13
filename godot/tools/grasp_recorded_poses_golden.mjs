import { recordedPoses, isPose, RECORDED_SCHEMA } from '../../extensions/grasp/record.js';

const row = [0, 0, 0, 0];
const valid = (id = 'sample/right/body/recorded') => ({
  id, kind: 'sample', grasp: 'body', side: 'right', wrist: [0, 0, 0], quat: [0, 0, 0, 1],
  angles: [[0, 0, 0, 0], ...Array.from({ length: 4 }, () => [...row])],
  open: [[0, 0, 0, 0, 2], ...Array.from({ length: 4 }, () => [...row])],
});

function malformedCases() {
  const cases = [];
  const add = (name, mutate) => {
    const pose = valid(name);
    mutate(pose);
    cases.push(pose);
  };
  add('bad-id', pose => { pose.id = 42; });
  add('bad-side', pose => { pose.side = 'both'; });
  add('bad-wrist-length', pose => { pose.wrist.pop(); });
  add('bad-wrist-nonfinite-json-null', pose => { pose.wrist[1] = null; });
  add('bad-quaternion-norm', pose => { pose.quat = [0, 0, 0, 0]; });
  add('quaternion-tolerance-inside', pose => { pose.quat = [0, 0, 0, 1.0009]; });
  add('quaternion-tolerance-outside', pose => { pose.quat = [0, 0, 0, 1.001]; });
  add('bad-angles-count', pose => { pose.angles.pop(); });
  add('bad-open-row', pose => { pose.open[2] = [0, 0, '0', 0]; });
  add('non-thumb-five-values', pose => { pose.angles[2].push(0); });
  add('hand-length-lower-exclusive', pose => { pose.handLength = 0.08; });
  add('hand-length-upper-exclusive', pose => { pose.handLength = 0.35; });
  add('hand-length-valid', pose => { pose.handLength = 0.081; });
  add('extra-metadata-is-ignored', pose => { pose.recorded = { frames: 'not validated here' }; pose.palm = 'ignored'; });
  return cases;
}

const good = valid();
const cases = [
  { name: 'schema-present', input: { schema: RECORDED_SCHEMA, poses: [good, ...malformedCases()] } },
  { name: 'schema-absent', input: { poses: [valid('absent-schema')] } },
  { name: 'schema-null-is-falsy-in-js', input: { schema: null, poses: [valid('null-schema')] } },
  { name: 'schema-empty-is-falsy-in-js', input: { schema: '', poses: [valid('empty-schema')] } },
  { name: 'schema-false-is-falsy-in-js', input: { schema: false, poses: [valid('false-schema')] } },
  { name: 'schema-zero-is-falsy-in-js', input: { schema: 0, poses: [valid('zero-schema')] } },
  { name: 'truthy-nonstring-schema', input: { schema: 1, poses: [valid('numeric-schema')] } },
  { name: 'truthy-array-schema', input: { schema: [], poses: [valid('array-schema')] } },
  { name: 'truthy-object-schema', input: { schema: {}, poses: [valid('object-schema')] } },
  { name: 'wrong-schema', input: { schema: 'gamesystems.recorded-grasps.v2', poses: [valid('wrong-schema')] } },
  { name: 'missing-poses', input: { schema: RECORDED_SCHEMA } },
  { name: 'non-array-poses', input: { schema: RECORDED_SCHEMA, poses: {} } },
  { name: 'non-object-document', input: null },
];

export function graspRecordedPosesCases() {
  return cases.map(({ name, input }) => ({
    name,
    input,
    accepted_indices: input && Array.isArray(input.poses)
      ? input.poses.flatMap((pose, index) => isPose(pose) ? [index] : []) : [],
    accepted: recordedPoses(input).map(pose => pose.id),
  }));
}
