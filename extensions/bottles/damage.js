// Deterministic browser counterpart of BottleBreakProfile and GlassDamageModel.
// Calibration, thickness, local weak zones, material, contact surface and fill
// participate in assessment; visual quality never changes these calculations.
export const SURFACES = {
  concrete: { k: 8e6, bottom: 999, sharp: 1 }, solid: { k: 8e6, bottom: 999, sharp: 1 },
  stone: { k: 8e6, bottom: 999, sharp: 1.1 }, metal: { k: 6e6, bottom: 999, sharp: 1 },
  glass: { k: 1.2e6, bottom: 999, sharp: 0.9 }, bottle: { k: 1.2e6, bottom: 999, sharp: 0.9 },
  wood: { k: 8e5, bottom: 8, sharp: 1 }, plastic: { k: 3e5, bottom: 8, sharp: 0.9 },
};
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class BottleDamageProfile {
  constructor(info = {}, asset = {}) {
    this.info = info; this.wall = info.wall_thickness_m ?? 0.003;
    this.material = info.material ?? (/pet|plastic/i.test(asset.glass || '') ? 'plastic' : 'glass');
    this.shatters = !!info.shatters && this.material !== 'plastic';
    this.height = info.height_m ?? asset.height_m ?? 0.25;
    this.shellMass = info.glass_mass_kg ?? info.shell_mass_kg ?? (this.material === 'plastic' ? 0.035 : 0.35);
    this.capacity = info.capacity_ml ?? asset.capacity_ml ?? 500;
    this.densityMl = info.liquid_mass_kg_per_ml ?? 0.001;
    this.base = info.base_z ?? 0.012; this.shoulder = info.shoulder_z ?? this.height * 0.7;
    this.neck = info.neck_z ?? this.height * 0.85;
    const calibration = info.calibration;
    this.criticalForce = this.material === 'plastic' ? 900 : 4300;
    if (calibration) {
      const v = calibration.v_n ?? 4.3, y = (this.base + this.shoulder) / 2;
      const surface = calibration.surface ?? 'concrete';
      this.criticalForce = v * Math.sqrt(this.stiffness(surface, v) * this.mass(calibration.fill ?? 1, true))
        * (SURFACES[surface]?.sharp ?? 1) / (Math.pow(this.wall / 0.003, 1.2) * this.strength(y));
    }
  }
  mass(fill, coupled = false) { return this.shellMass + 0.01 + (coupled ? 0.5 : 1) * this.capacity * this.densityMl * fill; }
  zone(y) { return y < this.base ? 'base' : y < this.shoulder ? 'body' : y < this.neck ? 'shoulder' : 'neck'; }
  strength(y) {
    let strength = ({ base: 1.4, body: 1, shoulder: 0.85, neck: 0.55, ...this.info.zone_factor })[this.zone(y)];
    for (const zone of this.info.weak_zones ?? []) if (y >= zone.z0 && y <= zone.z1) strength *= Math.pow(Math.max(0.1, zone.thinness ?? 1), -0.5);
    return strength;
  }
  stiffness(surface, speed) {
    const s = SURFACES[surface] ?? SURFACES.concrete;
    const ks = s.k * (1 + Math.pow(speed / s.bottom, 2)), kw = 1.2e6 * this.wall / 0.003;
    return 1 / (1 / ks + 1 / kw);
  }
  assess({ speed = 0, y = this.height / 2, fill = 0.5, surface = 'concrete', strikerMass = Infinity, damage = 0, energy, projectile = false }) {
    const zone = this.zone(y);
    if (projectile) {
      if (energy < 8) return { outcome: 'crack', ratio: energy / 8, damage: clamp(energy / 8, 0, 0.9), zone, energy };
      return { outcome: this.shatters ? 'shatter' : 'pierce', ratio: 2, damage: 0, zone, energy };
    }
    const self = this.mass(fill, true), effective = Number.isFinite(strikerMass) ? self * strikerMass / (self + strikerMass) : self;
    const sharp = (SURFACES[surface] ?? SURFACES.concrete).sharp;
    const force = speed * Math.sqrt(this.stiffness(surface, speed) * effective);
    const critical = this.criticalForce * Math.pow(this.wall / 0.003, 1.2) * this.strength(y) / sharp * Math.max(0.5, 1 - 0.5 * damage);
    const ratio = force / Math.max(1, critical);
    let outcome = 'none';
    if (!this.shatters) outcome = ratio >= (this.info.leak?.ratio ?? (this.material === 'plastic' ? 1 : Infinity)) ? 'pierce' : ratio >= 0.5 ? 'dent' : 'none';
    else outcome = ratio >= 1 || damage >= 1 ? 'shatter' : ratio >= 0.5 ? 'crack' : 'none';
    return { outcome, ratio, damage: outcome === 'crack' ? 0.5 * ratio ** 3 : 0, zone, energy: 0.5 * effective * speed ** 2 };
  }
}

export const GLASS_PROFILES = {
  annealed: { thickness: 4, ref: 4, chip: 0.35, crack: 2, break: 1.8, shatter: 6, perf: 15, edge: 0.75, edgeZone: 0.06 },
  tempered: { thickness: 5, ref: 4, chip: 0.6, crack: 28, break: 1, shatter: 1, perf: 4, edge: 0.22, edgeZone: 0.05 },
};

export function assessPane(profile, { energy, edgeDistance = 0.5, damage = 0, projectile = false, caliber = 0.009, incidence = 1, contact = 0.02, hardness = 0.95 }) {
  const p = GLASS_PROFILES[profile];
  const tr = p.thickness / p.ref, t = clamp(edgeDistance / p.edgeZone, 0, 1);
  const edge = p.edge + (1 - p.edge) * t * t * (3 - 2 * t);
  const fatigue = Math.max(0.15, 1 - 0.6 * damage);
  const span = clamp(Math.sqrt(Math.max(edgeDistance, 0) / 0.5), 0.6, 1.5);
  const shape = (1 + 2.5 * (1 - Math.min(hardness, 1))) * Math.pow(clamp(contact / 0.02, 0.25, 6), 0.25);
  const crack = p.crack * tr ** 2 * edge * span * shape * fatigue;
  const normalEnergy = energy * incidence ** 2;
  const perf = p.perf * tr ** 1.6 * (caliber / 0.009) ** 0.9 * edge ** 0.3 * fatigue;
  if (projectile) {
    if (incidence < 0.26) return { outcome: 'chip', absorbed: energy, damage: 0.02 };
    if (normalEnergy >= perf) return { outcome: profile === 'tempered' ? 'shattered' : 'punched', absorbed: perf, damage: 0.14, radius: caliber * 0.5 + p.thickness * 0.001 * 2.2 };
  }
  return { outcome: normalEnergy >= crack * p.shatter ? 'shattered' : normalEnergy >= crack * p.break ? 'punched' : normalEnergy >= crack ? 'cracked' : normalEnergy >= p.chip * Math.sqrt(tr) ? 'chip' : 'none', absorbed: Math.min(energy, crack * p.break), damage: normalEnergy >= crack ? Math.min(0.4, normalEnergy / Math.max(crack, 1e-6) * 0.08) : 0.01 };
}
