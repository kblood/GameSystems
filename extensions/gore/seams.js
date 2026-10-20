// GameSystems gore extension: the authored seams the bake cuts along (tools/bake_gibs.mjs). Pure (no three.js).
//
// One seam per non-root region (regions.js), each with named variants (SEAM_VARIANTS in config.js: 'clean', 'jagged'):
//   limb seams   field f = W(v) - threshold + jag · n(θ): W(v) is the skin weight of the region's limb subtree at vertex v,
//                so the cut follows the joint's weight transition on any MakeHuman-weighted mesh; θ is the angle around
//                the bone axis, n() a periodic saw pattern (torn edge). f >= 0 is the child side.
//   patch seams  field f = 1 - |ellipsoid(v)| + jag · n(θ) around a point on the skin: the anchor (from the rest joints)
//                is pushed along `dir` to the outermost skin vertex, the ellipsoid has radii [across, up, depth].
//                `interior` meshes (teeth, tongue) are not cut; their triangles join the patch below/above a plane.
// Everything is in the character's rest frame (+X left, +Y up, +Z forward, metres) and scales with the joints.
// Changing a seam changes the bake: re-run `node extensions/gore/tools/bake_gibs.mjs` (docs/gore_system.md).

export const SEAM_FORMAT = 'gamesystems.gore-seams.v1';

const variants = (jag, teeth) => ({ clean: { jag: 0 }, jagged: { jag, teeth } });

/** Limb seams: joint whose axis (joint -> tip joint) the saw pattern turns around; threshold on the subtree weight. */
export const LIMB_SEAMS = Object.freeze({
  chest: { axis: ['chest', 'neck'], threshold: 0.5, variants: variants(0.25, 6) },
  neck: { axis: ['neck', 'head'], threshold: 0.5, variants: variants(0.25, 7) },
  head: { axis: ['neck', 'head'], threshold: 0.5, variants: variants(0.25, 7) },
  ...Object.fromEntries(['left', 'right'].flatMap(s => [
    [`${s}UpperArm`, { axis: [`${s}UpperArm`, `${s}LowerArm`], threshold: 0.5, variants: variants(0.3, 6) }],
    [`${s}LowerArm`, { axis: [`${s}LowerArm`, `${s}Hand`], threshold: 0.5, variants: variants(0.3, 6) }],
    [`${s}Hand`, { axis: [`${s}Hand`, `${s}MiddleProximal`], threshold: 0.5, variants: variants(0.25, 5) }],
    [`${s}UpperLeg`, { axis: [`${s}UpperLeg`, `${s}LowerLeg`], threshold: 0.5, variants: variants(0.3, 7) }],
    [`${s}LowerLeg`, { axis: [`${s}LowerLeg`, `${s}Foot`], threshold: 0.5, variants: variants(0.3, 7) }],
    [`${s}Foot`, { axis: [`${s}Foot`, `${s}Toes`], threshold: 0.5, variants: variants(0.25, 5) }],
  ])),
});

/**
 * Patch seams. anchor(heads) -> [x, y, z] inside the body; dir: the way to the skin; radii [across, up, depth] in metres
 * at the base body (scaled by the joints at runtime only through the skin vertices, which follow the sliders).
 */
export const PATCH_SEAMS = Object.freeze({
  jaw: {
    anchor: h => lerp(h.head, h.neck, 0.55, [0, 0, 0.03]), dir: [0, -0.45, 0.89], radii: [0.052, 0.04, 0.05],
    interior: { axis: 1, below: 'teethMid' }, variants: variants(0.2, 5),
  },
  cranium: { anchor: h => add(h.head, [0, 0.08, -0.01]), dir: [0, 0.94, -0.34], radii: [0.075, 0.085, 0.055], variants: variants(0.22, 6) },
  chestLeft: { anchor: h => lerp(h.upperChest, h.neck, 0.42, [0.085, 0, 0]), dir: [0, 0, 1], radii: [0.06, 0.065, 0.06], variants: variants(0.2, 6) },
  chestRight: { anchor: h => lerp(h.upperChest, h.neck, 0.42, [-0.085, 0, 0]), dir: [0, 0, 1], radii: [0.06, 0.065, 0.06], variants: variants(0.2, 6) },
  // below the navel: the torso seam (chest) runs at the chest joint's weight transition just above it
  belly: { anchor: h => lerp(h.hips, h.spine, 0.6), dir: [0, 0, 1], radii: [0.065, 0.05, 0.06], variants: variants(0.2, 6) },
});

function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function lerp(a, b, t, off = [0, 0, 0]) { return [a[0] + (b[0] - a[0]) * t + off[0], a[1] + (b[1] - a[1]) * t + off[1], a[2] + (b[2] - a[2]) * t + off[2]]; }

/** Deterministic seed per seam id (FNV-1a). */
export function seamSeed(id) {
  let h = 2166136261;
  for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967296;
}
const tri = x => 2 * Math.abs(2 * (x - Math.floor(x + 0.5))) - 1;
/** Periodic torn-edge pattern in [-1, 1] over the angle θ (radians): two saw waves, phases from the seed. */
export function sawPattern(theta, teeth = 6, seed = 0) {
  const x = theta / (2 * Math.PI);
  return 0.62 * tri(teeth * x + seed) + 0.38 * tri((2 * teeth + 1) * x + seed * 7.13);
}
