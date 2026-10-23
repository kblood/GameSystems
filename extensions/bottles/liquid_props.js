// Per-liquid flow properties. Viscosity (mPa·s at ~20 C) scales the discharge coefficient of a hole in the hydraulics
// (pour.js holeHydraulics: v = cd * sqrt(2 g h)); the coefficient falls slowly with viscosity (low Reynolds number).
// Unknown kinds count as water (scale 1), so nothing changes for liquids that are not in the table.
// Godot: the same table belongs in bottle_pour.gd's cd / glug_k (see docs/pour_system.md).
export const LIQUID_VISCOSITY = Object.freeze({
  water: 1, beer: 1.4, soda: 1.2, wine: 1.6, spirits: 2.2, whiskey: 2.2, whisky: 2.2, vodka: 2.0, milk: 2, juice: 2.5, diesel: 3,
  petrol: 0.6, oil: 60, syrup: 400, honey: 10000,
});
const DISCHARGE_SLOPE = 0.18;

/** Discharge scale for a viscosity: 1 for water and thinner, ~0.58 for honey. */
export const dischargeScale = viscosity => 1 / (1 + DISCHARGE_SLOPE * Math.log10(Math.max(1, viscosity)));

const viscosityOf = kind => Object.hasOwn(LIQUID_VISCOSITY, kind) ? LIQUID_VISCOSITY[kind] : 1;

/**
 * Viscosity of what a bottle holds: its kind, or for a mixture the ml-weighted geometric mean over liquidComposition
 * (fractions; no allocation). Mixed without a composition counts as water.
 */
export function bottleViscosity(b) {
  const fractions = b.liquidComposition;
  if (fractions && b.liquidKind === 'mixed') {
    let sum = 0, logv = 0;
    for (const k in fractions) { const f = fractions[k]; if (f > 0) { sum += f; logv += f * Math.log(viscosityOf(k)); } }
    return sum > 0 ? Math.exp(logv / sum) : 1;
  }
  return viscosityOf(b.liquidKind);
}

/** Discharge scale of the bottle's current liquid (multiplies cd for holes and the glug rate). */
export const bottleDischargeScale = b => dischargeScale(bottleViscosity(b));
