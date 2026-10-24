// Handle grips: which hand shape fits a furniture handle. No new grasp data and no change to the existing grasp library:
//   bar / lever / wheel rim -> the procedural 'pole/grip' poses of extensions/grasp (a cylinder wrapped by the hand; they are only a
//   READ of PROCEDURAL_POSES, the opt-in switch setProceduralGrasps() stays off), re-framed onto the handle,
//   knob      -> a pinch descriptor (thumb against fingers on a sphere), no pose rows,
//   recessed  -> a fingertip descriptor (hook behind the edge), no pose rows.
// A game that wants the baked rows enables procedural grasps itself; one that does not gets the descriptor and keeps its open/closing hand.
// Frame: handle frame = origin at the handle centre, +Y along the bar; `frame.quaternion` turns that frame into the PART frame
// (furniture frame while the part is closed).
import { PROCEDURAL_POSES } from '../grasp/baked_grasps.js';

const S = Math.SQRT1_2;
const POLE = PROCEDURAL_POSES.filter(p => p.kind === 'pole' && p.grasp === 'grip');
const BY_SIDE = { left: POLE.filter(p => p.side === 'left'), right: POLE.filter(p => p.side === 'right') };

/** Quaternion [x,y,z,w] from handle frame (+Y along the bar) to part frame. */
export const frameQuaternion = orientation => (orientation === 'horizontal' ? [0, 0, -S, S] : [0, 0, 0, 1]);

/**
 * Grip for one side on a normalised handle (spec part.handles[i]). Returns
 * { style, mode: 'wrap'|'pinch'|'fingertips', side, shape, frame: { position, quaternion }, pose: null | { id, wrist, quat, angles, open }, source }.
 * `pose` is a copy: the library is never modified.
 */
export function handleGrip(handle, side = 'right') {
  if (side !== 'left' && side !== 'right') throw new RangeError('side must be left or right');
  const quaternion = frameQuaternion(handle.orientation), position = [...handle.at];
  if (handle.style === 'knob') return { style: 'knob', mode: 'pinch', side, shape: { type: 'sphere', radius: handle.radius }, frame: { position, quaternion }, pose: null, source: 'descriptor' };
  if (handle.style === 'recessed') return { style: 'recessed', mode: 'fingertips', side, shape: { type: 'box', size: [0.02, handle.length, 0.02] }, frame: { position, quaternion }, pose: null, source: 'descriptor' };
  // wheel: the hand takes the rim, a tangent bar at the rim point (the rim of radius length/2, grabbed at +X of the wheel centre)
  const framePos = handle.style === 'wheel' ? [position[0] + handle.length / 2, position[1], position[2]] : position;
  const rows = BY_SIDE[side];
  let best = null;
  for (const p of rows) if (!best || Math.abs(p.wrist[1]) < Math.abs(best.wrist[1]) - 1e-9 || (Math.abs(Math.abs(p.wrist[1]) - Math.abs(best.wrist[1])) < 1e-9 && p.default && !best.default)) best = p;
  const pose = best ? { id: best.id, wrist: [best.wrist[0], 0, best.wrist[2]], quat: [...best.quat],
    angles: best.angles.map(r => [...r]), open: best.open.map(r => [...r]) } : null;
  return { style: handle.style, mode: 'wrap', side, shape: { type: 'cylinder', radius: handle.radius, half: handle.length / 2 }, frame: { position: framePos, quaternion }, pose, source: pose ? 'grasp:pole/grip' : 'descriptor' };
}

/** Grips of both hands for every handle of a part: [{ handleIndex, left, right, twoHand }]. */
export function partGrips(part) {
  return part.handles.map((h, handleIndex) => ({ handleIndex, twoHand: h.twoHand || part.minHands === 2, left: handleGrip(h, 'left'), right: handleGrip(h, 'right') }));
}
