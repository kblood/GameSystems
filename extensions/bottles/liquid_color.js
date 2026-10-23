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
  if (b.shownAbsorbance) { b.shownAbsorbance[0] = own[0]; b.shownAbsorbance[1] = own[1]; b.shownAbsorbance[2] = own[2]; }
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

// ---- Mixing a pour into a non-empty bottle -------------------------------------------------------------------------
// b.absorbance is the logical colour (what pours out next, what is saved); b.shownAbsorbance is what the liquid shader
// currently draws. They differ only while a mix fades in (tier 'full') or is held back (tier 'discrete').
export const EMPTY_ML = 0.5;           // below this a receiver is "empty": it simply takes the incoming colour
const SAME_LIQUID = 0.05;              // absorbance distance under which the incoming liquid counts as the same colour
const distance = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

/** Draw the bottle's logical colour in its liquid shader at once. */
export function showBottleColour(b) {
  const own = liquidAbsorbance(b), shown = (b.shownAbsorbance ??= [own[0], own[1], own[2]]);
  shown[0] = own[0]; shown[1] = own[1]; shown[2] = own[2];
  const uniform = b.liquid?.uniforms?.uLiquidColor?.value;
  if (uniform) transmission(shown, REF_PATH_M, uniform);
}

/**
 * Mix ml of absorbance a into bottle b (call before fillMl grows). Updates the logical colour exactly; what the shader
 * draws follows the tier: 'full' hands the bottle to `fading` (a Set the caller ticks with fadeBottleColours), 'discrete'
 * keeps the old colour until half the content is foreign. Returns true if the shader colour changed at once.
 */
export function receiveLiquidColour(b, a, ml, mode, fading) {
  const own = liquidAbsorbance(b);
  if (!b.shownAbsorbance) b.shownAbsorbance = [own[0], own[1], own[2]];
  const empty = b.fillMl <= EMPTY_ML, foreign = !empty && distance(own, a) > SAME_LIQUID;
  mixAbsorbance(own, b.fillMl, a, ml);
  if (empty) { b.foreignMl = 0; b.foreignShown = false; fading?.delete(b); showBottleColour(b); return true; }
  if (!foreign) return false;
  if (mode === 'full') { if (fading) fading.add(b); else showBottleColour(b); return !fading; }
  b.foreignMl = (b.foreignMl ?? 0) + ml;
  if (!b.foreignShown && b.foreignMl >= 0.5 * (b.fillMl + ml)) { b.foreignShown = true; showBottleColour(b); return true; }
  return false;
}

/** Move the shader colour of every bottle in `fading` towards its logical colour (exponential, time constant fade/3). */
export function fadeBottleColours(fading, dt, fade) {
  const k = fade > 0 ? 1 - Math.exp(-3 * dt / fade) : 1;
  for (const b of fading) {
    const own = b.absorbance, shown = b.shownAbsorbance;
    if (!own || !shown || b.broken) { fading.delete(b); continue; }
    shown[0] += (own[0] - shown[0]) * k; shown[1] += (own[1] - shown[1]) * k; shown[2] += (own[2] - shown[2]) * k;
    const done = distance(own, shown) < 0.002;
    if (done) { shown[0] = own[0]; shown[1] = own[1]; shown[2] = own[2]; fading.delete(b); }
    const uniform = b.liquid?.uniforms?.uLiquidColor?.value;
    if (uniform) transmission(shown, REF_PATH_M, uniform);
  }
}
