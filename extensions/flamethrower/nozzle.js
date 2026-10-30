// Nozzle cone geometry. Pure. A cone is { origin:[x,y,z], direction:[x,y,z] (unit), length (m), radius (m, at the far
// end), baseRadius (m, at the nozzle), dt, active, intensity (0..1) }. The weapon fills one cone object per frame; the
// helpers here let the game test hits against it (the weapon itself never applies damage or ignition).

export const DEG = Math.PI / 180;

/** Far-end radius of a cone of the given length and full spread angle (degrees). */
export function coneRadius(length, spreadDeg) { return Math.max(0, length) * Math.tan(spreadDeg * DEG / 2); }

/** A fresh cone object (inactive). */
export function makeCone() { return { origin: [0, 0, 0], direction: [0, 0, -1], length: 0, radius: 0, baseRadius: 0, dt: 0, active: false, intensity: 0 }; }

/** Radius of the cone at a distance along its axis (linear from baseRadius at the nozzle to radius at the end). */
export function coneRadiusAt(cone, along) {
  if (cone.length <= 0) return cone.baseRadius ?? 0;
  const t = Math.min(1, Math.max(0, along / cone.length)), b = cone.baseRadius ?? 0;
  return b + (cone.radius - b) * t;
}

/**
 * How much of the flame a point gets: 0 outside the cone or when inactive, up to cone.intensity on the axis near the
 * nozzle; falls off along the cone (to 0.5 at the end) and towards its edge (to 0.5 at the rim). Games scale damage
 * and heat with it.
 */
export function coneExposure(cone, p) {
  if (!cone.active || cone.length <= 0) return 0;
  const o = cone.origin, d = cone.direction;
  const rx = p[0] - o[0], ry = p[1] - o[1], rz = p[2] - o[2];
  const along = rx * d[0] + ry * d[1] + rz * d[2];
  if (along < 0 || along > cone.length) return 0;
  const px = rx - d[0] * along, py = ry - d[1] * along, pz = rz - d[2] * along;
  const perp = Math.sqrt(px * px + py * py + pz * pz), allowed = coneRadiusAt(cone, along);
  if (perp > allowed) return 0;
  const axial = 1 - 0.5 * (along / cone.length), radial = allowed > 0 ? 1 - 0.5 * (perp / allowed) : 1;
  return cone.intensity * axial * radial;
}

/** True when the point is inside an active cone. */
export function pointInCone(cone, p) { return coneExposure(cone, p) > 0; }

/** Bounding sphere of the cone written into out ({ center:[3], radius }); returns out. For broad-phase queries. */
export function coneBounds(cone, out = { center: [0, 0, 0], radius: 0 }) {
  const h = cone.length / 2;
  for (let i = 0; i < 3; i++) out.center[i] = cone.origin[i] + cone.direction[i] * h;
  out.radius = Math.sqrt(h * h + cone.radius * cone.radius);
  return out;
}
