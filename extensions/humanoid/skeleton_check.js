// GameSystems humanoid extension: skeleton check at load (extensions plan, "Karakter-kontrakt"). Pure, no three.js.
//   checkSkeleton(heads)  which canonical joints a rig has, whether each hand has fingers ("mitten" = no usable finger
//                         chain: the avatar then drives a stiff hand), and warnings when the knuckles are far from the
//                         expected hand geometry (typical for auto-rigs).
//   completeHands(heads)  rest heads with a synthetic finger set for mitten hands, so hand frames and the IK rig data
//                         (avatar rigdata.prepareRig) are defined for any rig. Synthetic joints have no bone: poses written
//                         to them are ignored by applyPose, the hand stays stiff.
// heads: { joint: [x, y, z] } rest joint heads in the character frame (+X left, +Y up, +Z forward), e.g. restHeads(h).
import { JOINT_NAMES } from './canonical.js';
import { vAdd, vSub, vScale, vDot, vCross, vLen, vNorm } from './qmath.js';

export const SIDES = ['left', 'right'];
export const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const SEGMENTS = {
  Thumb: ['Metacarpal', 'Proximal', 'Distal'], Index: ['Proximal', 'Intermediate', 'Distal'], Middle: ['Proximal', 'Intermediate', 'Distal'],
  Ring: ['Proximal', 'Intermediate', 'Distal'], Little: ['Proximal', 'Intermediate', 'Distal'],
};
const fingerJoints = side => FINGERS.flatMap(f => SEGMENTS[f].map(g => `${side}${f}${g}`));
/** Joints every avatar needs (body IK); a rig without them is rejected. */
export const REQUIRED = ['hips', 'spine', 'head', ...SIDES.flatMap(s => ['UpperArm', 'LowerArm', 'Hand', 'UpperLeg', 'LowerLeg', 'Foot'].map(k => s + k))];

/**
 * Expected hand proportions, relative to the forearm (elbow -> wrist), from the CharacterCreator body (forearm 0.25 m,
 * wrist -> middle knuckle 0.10 m, knuckle span 0.054 m) with wide tolerances: only clearly wrong rigs warn.
 */
export const HAND_EXPECT = Object.freeze({
  knuckle: [0.2, 0.65],        // wrist -> middle knuckle / forearm
  span: [0.12, 0.45],          // index knuckle <-> little knuckle / forearm
  fingerAlign: 0.35,           // cos(min) between a finger's first segment and wrist -> middle knuckle
  palmAlign: 0.5,              // cos(min) between forearm and wrist -> middle knuckle
});
const ratioIn = (x, [a, b]) => x >= a && x <= b;
const fmt = x => x.toFixed(2);

/**
 * Report: { ok, missing: [joints], missingRequired: [joints], fingers: 'full' | 'partial' | 'none',
 *           hands: { left|right: { fingers: 'full' | 'partial' | 'none', mitten, missing: [joints] } },
 *           mitten (any hand), warnings: [string] }.
 * A hand is a mitten when the joints the hand frame needs (index, middle, little proximal) are missing; 'partial' hands
 * keep their fingers, the missing segments are folded by createHumanoid (they follow their parent).
 */
export function checkSkeleton(heads) {
  const has = j => Array.isArray(heads?.[j]) && heads[j].every(Number.isFinite);
  const missing = JOINT_NAMES.filter(j => !has(j)), missingRequired = REQUIRED.filter(j => !has(j));
  const warnings = [], hands = {};
  if (missingRequired.length) warnings.push(`rig lacks required joint(s): ${missingRequired.join(', ')}`);
  for (const s of SIDES) {
    const all = fingerJoints(s), gone = all.filter(j => !has(j));
    const mitten = !['IndexProximal', 'MiddleProximal', 'LittleProximal'].every(k => has(s + k)) || !has(`${s}Hand`);
    const fingers = !gone.length ? 'full' : gone.length === all.length ? 'none' : 'partial';
    hands[s] = { fingers, mitten, missing: gone };
    if (mitten) warnings.push(`${s} hand has no usable finger chain (${fingers === 'none' ? 'no finger joints' : `missing ${gone.length} of ${all.length}`}): stiff mitten hand`);
    else if (fingers === 'partial') warnings.push(`${s} hand lacks ${gone.join(', ')}: those segments follow their parent`);
    if (!mitten && has(`${s}LowerArm`)) warnings.push(...knuckleWarnings(heads, s, has));
  }
  const kinds = SIDES.map(s => hands[s].fingers);
  const fingers = kinds.every(k => k === 'full') ? 'full' : kinds.every(k => k === 'none') ? 'none' : 'partial';
  return { ok: !missingRequired.length, missing, missingRequired, fingers, hands, mitten: SIDES.some(s => hands[s].mitten), warnings };
}

function knuckleWarnings(heads, s, has) {
  const out = [], W = heads[`${s}Hand`], forearm = vLen(vSub(W, heads[`${s}LowerArm`]));
  if (!(forearm > 1e-4)) return [`${s} forearm has zero length`];
  const K = f => heads[`${s}${f}Proximal`], M = K('Middle'), toM = vSub(M, W), palm = vLen(toM), F = vNorm(toM);
  const k = palm / forearm, span = vLen(vSub(K('Index'), K('Little'))) / forearm;
  if (!ratioIn(k, HAND_EXPECT.knuckle)) out.push(`${s} knuckles far from the expected hand geometry: wrist -> middle knuckle ${fmt(k)} x forearm (expected ${HAND_EXPECT.knuckle.join('-')})`);
  if (!ratioIn(span, HAND_EXPECT.span)) out.push(`${s} knuckle span ${fmt(span)} x forearm (expected ${HAND_EXPECT.span.join('-')})`);
  const align = vDot(vNorm(vSub(W, heads[`${s}LowerArm`])), F);
  if (align < HAND_EXPECT.palmAlign) out.push(`${s} hand points away from the forearm at rest (cos ${fmt(align)})`);
  for (const f of ['Index', 'Middle', 'Ring', 'Little']) {
    const a = K(f), b = heads[`${s}${f}Intermediate`];
    if (!a || !b) continue;
    const c = vDot(vNorm(vSub(b, a)), F);
    if (c < HAND_EXPECT.fingerAlign) out.push(`${s} ${f.toLowerCase()} finger points away from the hand at rest (cos ${fmt(c)})`);
  }
  // The thumb sits on the index side of the hand.
  const thumb = heads[`${s}ThumbMetacarpal`] ?? heads[`${s}ThumbProximal`];
  if (thumb && vDot(vSub(thumb, M), vSub(K('Index'), K('Little'))) <= 0) out.push(`${s} thumb is on the little-finger side of the hand`);
  return out;
}

/**
 * Rest heads with a synthetic finger set for each mitten hand (from the wrist and the forearm: palm down, thumb toward
 * the character's front, CharacterCreator proportions scaled by forearm length). Returns { heads, synthetic: [joints] }.
 * Other hands and joints are returned unchanged (same arrays).
 */
export function completeHands(heads, report = checkSkeleton(heads)) {
  const out = { ...heads }, synthetic = [];
  for (const s of SIDES) {
    if (!report.hands[s].mitten || !heads[`${s}Hand`] || !heads[`${s}LowerArm`]) continue;
    const W = heads[`${s}Hand`], forearm = vSub(W, heads[`${s}LowerArm`]), k = vLen(forearm) / 0.25;
    const F = vNorm(forearm);
    let R = vSub([0, 0, 1], vScale(F, F[2]));                   // radial (thumb side): the character's front, across the hand
    R = vLen(R) > 1e-3 ? vNorm(R) : vNorm(vCross(F, [0, 1, 0]));
    const D = vNorm(s === 'left' ? vCross(R, F) : vCross(F, R)); // back of the hand (rigdata.handFrame chirality)
    const at = (f, r, d) => vAdd(W, vAdd(vScale(F, f * k), vAdd(vScale(R, r * k), vScale(D, d * k))));
    // [knuckle along F, across R, dorsal D] and segment lengths (m at forearm 0.25 m), straight fingers.
    const layout = {
      Thumb: [[0.025, 0.02, -0.012], [0.04, 0.032, 0.026], 0.6], Index: [[0.095, 0.022, 0], [0.045, 0.027, 0.022], 0],
      Middle: [[0.1, 0, 0], [0.048, 0.03, 0.024], 0], Ring: [[0.095, -0.017, 0], [0.044, 0.028, 0.022], 0],
      Little: [[0.086, -0.032, -0.002], [0.034, 0.021, 0.019], 0],
    };
    for (const f of FINGERS) {
      const [[a, b, c], lens, spread] = layout[f];
      let p = at(a, b, c);
      const dir = vNorm(vAdd(vScale(F, Math.cos(spread)), vScale(R, Math.sin(spread))));
      SEGMENTS[f].forEach((g, i) => {
        const j = `${s}${f}${g}`;
        if (!heads[j]) { out[j] = p; synthetic.push(j); }
        p = vAdd(p, vScale(dir, lens[i] * k));
      });
    }
  }
  return { heads: out, synthetic };
}
