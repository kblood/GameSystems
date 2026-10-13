import { mirrorPose } from '../../extensions/grasp/record.js';
import { BAKED, RECORDED } from '../../extensions/grasp/baked_grasps.js';

const zeroRows = () => Array.from({ length: 5 }, () => [0, 0, 0, 0]);
const base = (side = 'right') => ({
  id: `sample/${side}/body/source`, kind: 'sample', grasp: 'body', side, mode: 'wrap', default: true,
  wrist: [0.03, -0.02, 0], quat: [0.2, -0.3, 0.4, Math.sqrt(0.71)],
  angles: [[1, 2, 3, 4, 5], ...zeroRows().slice(1)], open: zeroRows(),
  handLength: 0.19, palm: [0.01, -0.02, 0.03], recorded: { at: 'synthetic', source: 'test' },
  unknownMetadata: { nested: ['preserved'] }, mirroredFrom: 'old-source',
});

const noOpen = base('left');
delete noOpen.open;
const cases = [
  { name: 'synthetic-right-with-metadata', input: base('right') },
  { name: 'synthetic-left', input: base('left') },
  { name: 'missing-open-uses-default', input: noOpen },
  { name: 'null-open-uses-default', input: { ...base('right'), open: null } },
  { name: 'false-open-uses-default', input: { ...base('right'), open: false } },
  { name: 'empty-open-is-truthy', input: { ...base('right'), open: [] } },
  { name: 'replace-first-side-token-only', input: { ...base('right'), id: 'x/right/a/right/z' } },
  { name: 'id-without-side-token', input: { ...base('left'), id: 'legacy-pose' } },
  { name: 'canonical-baked-right', input: BAKED.poses.find(pose => pose.side === 'right') },
  { name: 'canonical-recorded-left', input: RECORDED.find(pose => pose.side === 'left') },
];

export function graspMirrorCases() {
  return cases.map(({ name, input }) => ({ name, input, expected: mirrorPose(input) }));
}
