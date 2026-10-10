// Liquid colour as absorbance (Beer-Lambert). A liquid's colour is stored the way the bottle shader uses it: the linear
// colour seen through REF_PATH_M of liquid (uLiquidColor / uRefPath in bottle_liquid.js). Its absorbance per reference
// path is a = -ln(colour), so the transmission through any thickness is T = exp(-a * path / REF_PATH_M)
// = colour^(path / REF_PATH_M): a 1.5 mm puddle of the same wine is much lighter than the bottle.
//
// Mixing is volume-weighted in absorbance space (a_mix = Σ ml_i a_i / Σ ml_i), which is subtractive mixing: red + blue
// gives a dark purple, not a grey average. Every bottle (b.absorbance), flight, stream and puddle carries a 3-number
// absorbance; its volume is the ml it already tracks, so the composition ledger is just "ml-weighted absorbance".
import * as THREE from 'three';

export const REF_PATH_M = 0.045;          // bottle_liquid.js uRefPath default
export const PUDDLE_DEPTH_M = 0.0015;     // pour.js spreads puddles to this mean depth
export const DROP_PATH_M = 0.015;         // path drawn for drops and streams (thin, but they must still read as liquid)
export const MAX_ABSORBANCE = -Math.log(1e-4); // the shader clamps the colour at 1e-4
export const DEFAULT_LIQUID_SRGB = Object.freeze([0xb5 / 255, 0x78 / 255, 0x35 / 255]); // the old fixed stream colour

const scratch = new THREE.Color();

/** Absorbance (per REF_PATH_M) of a linear THREE.Color, into out ([r, g, b]). */
export function absorbanceOfColor(color, out = [0, 0, 0]) {
  out[0] = Math.min(MAX_ABSORBANCE, -Math.log(Math.max(color.r, 1e-4)));
  out[1] = Math.min(MAX_ABSORBANCE, -Math.log(Math.max(color.g, 1e-4)));
  out[2] = Math.min(MAX_ABSORBANCE, -Math.log(Math.max(color.b, 1e-4)));
  return out;
}

/** Absorbance of an sRGB triple (a *.liquid.json `color`, 0..1). */
export function absorbanceOfSRGB(srgb, out = [0, 0, 0]) {
  return absorbanceOfColor(scratch.setRGB(srgb[0], srgb[1], srgb[2], THREE.SRGBColorSpace), out);
}

/** Linear transmission colour through `path` metres: exp(-a * path / refPath). */
export function transmission(a, path, out = new THREE.Color(), refPath = REF_PATH_M) {
  const k = path / refPath;
  return out.setRGB(Math.exp(-a[0] * k), Math.exp(-a[1] * k), Math.exp(-a[2] * k), THREE.LinearSRGBColorSpace);
}

/** Mix ml of absorbance `a` into `target` that holds targetMl (in place). An empty target takes `a`. */
export function mixAbsorbance(target, targetMl, a, ml) {
  const total = Math.max(0, targetMl) + Math.max(0, ml);
  if (!(total > 0)) return target;
  const wt = Math.max(0, targetMl) / total, wa = Math.max(0, ml) / total;
  target[0] = target[0] * wt + a[0] * wa;
  target[1] = target[1] * wt + a[1] * wa;
  target[2] = target[2] * wt + a[2] * wa;
  return target;
}

/** Opacity of a layer with transmission T: clear liquids are a faint sheen, dark ones nearly opaque. */
export function layerOpacity(T, min = 0.22, max = 0.92) {
  const lum = 0.2126 * T.r + 0.7152 * T.g + 0.0722 * T.b;
  return min + (max - min) * (1 - Math.min(1, Math.max(0, lum)));
}

/**
 * A bottle's absorbance, created on first use from its liquid (uLiquidColor uniform, else info.color, else the default
 * amber) and kept on the record as b.absorbance.
 */
export function liquidAbsorbance(b) {
  if (b.absorbance) return b.absorbance;
  const uniform = b.liquid?.uniforms?.uLiquidColor?.value;
  const srgb = b.liquid?.info?.color;
  b.absorbance = uniform ? absorbanceOfColor(uniform) : absorbanceOfSRGB(srgb?.length >= 3 ? srgb : DEFAULT_LIQUID_SRGB);
  return b.absorbance;
}

/** Set a bottle's absorbance and push it to its liquid shader (uLiquidColor = colour through REF_PATH_M). */
export function setBottleAbsorbance(b, a) {
  const own = liquidAbsorbance(b);
  if (own !== a) { own[0] = a[0]; own[1] = a[1]; own[2] = a[2]; }
  const uniform = b.liquid?.uniforms?.uLiquidColor?.value;
  if (uniform) transmission(own, REF_PATH_M, uniform);
  return own;
}

/** Change a bottle's liquid colour (sRGB 0..1, as in *.liquid.json); keeps puddles/streams/mixing in step. */
export function setBottleLiquidColor(b, srgb) {
  return setBottleAbsorbance(b, absorbanceOfSRGB(srgb));
}

/** Mix ml of absorbance `a` into a bottle that holds b.fillMl (call before adding the ml). */
export function mixIntoBottle(b, a, ml) {
  const own = liquidAbsorbance(b);
  mixAbsorbance(own, b.fillMl, a, ml);
  return setBottleAbsorbance(b, own);
}
