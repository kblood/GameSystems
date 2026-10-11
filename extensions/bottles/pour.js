// Pouring and spills: rim overflow from the liquid LUT, leaks through holes (hydraulic head), ballistic drops that
// land in open bottles or on registered room surfaces as puddles, pour streams, and a volume ledger that always
// balances. Body velocity comes from BottleBodies (host physics adapter). Drawn effects follow the quality tier.
import * as THREE from 'three';
import { SurfaceWorld, puddlePolygon } from './surfaces.js';
import { dropComponents, mixComponents, receiveComponents } from './liquid_components.js';
import { bottleQuality } from './quality.js';
import { DEFAULT_LIQUID_SRGB, DROP_PATH_M, absorbanceOfSRGB, liquidAbsorbance, mixAbsorbance, mixIntoBottle, transmission,
  layerOpacity } from './liquid_color.js';

const UP = new THREE.Vector3(0, 1, 0), GRAVITY = new THREE.Vector3(0, -9.81, 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const puddleRadius = ml => Math.sqrt(ml * 1e-6 / (0.0015 * Math.PI)); // spread to PUDDLE_DEPTH_M (1.5 mm)
const dropGeometry = new THREE.SphereGeometry(1, 6, 4);
// Colour (liquid_color.js): every bottle, drop, stream and puddle carries an absorbance; mixing is ml-weighted in it.
const DEFAULT_ABSORBANCE = Object.freeze(absorbanceOfSRGB(DEFAULT_LIQUID_SRGB));
const MAX_DROP_MATERIALS = 48; // tinted drop/stream materials (quantised absorbance); beyond it the nearest is reused
const quantise = v => Math.min(255, Math.max(0, Math.round(v * 12)));
const dropKey = a => quantise(a[0]) * 65536 + quantise(a[1]) * 256 + quantise(a[2]); // a number: no per-frame string
const _T = new THREE.Color(), _centre = new THREE.Vector3();

// LUT coordinates belong to the Liquid mesh; holes persist in bottle-local space.
export function holeHydraulics(b, hole) {
  const liquidMesh = b.liquid.liquid;
  b.root.updateWorldMatrix(true, true);
  const worldPoint = b.root.localToWorld(hole.point.clone());
  const liquidPoint = liquidMesh.worldToLocal(worldPoint.clone());
  const q = liquidMesh.getWorldQuaternion(new THREE.Quaternion());
  const localUp = UP.clone().applyQuaternion(q.invert()).normalize();
  const scale = liquidMesh.getWorldScale(new THREE.Vector3()).y;
  const plane = b.liquid.lut.offset(localUp, b.fillMl / b.capacity);
  const head = (plane - liquidPoint.dot(localUp)) * scale;
  const normal = hole.normal.clone().applyQuaternion(b.root.getWorldQuaternion(new THREE.Quaternion())).normalize();
  if (head <= 0.002 || b.fillMl <= 1e-7) return { head, rateMl: 0, worldPoint, normal, availableMl: 0, exitSpeed: 0 };
  const exitSpeed = 0.62 * Math.sqrt(2 * 9.81 * head);
  const rateMl = Math.PI * hole.radius ** 2 * exitSpeed * 1e6;
  const stopFill = b.liquid.lut.fillAt(localUp, liquidPoint.dot(localUp) + 0.002 / scale);
  return { head, rateMl, worldPoint, normal, exitSpeed, availableMl: Math.max(0, b.fillMl - stopFill * b.capacity) };
}

export class PourSystem {
  /** surfaces: room meshes (box geometry) that receive liquid; bodies: BottleBodies (velocity of the bottles). */
  constructor(scene, factory, audio, surfaces = [], bodies = null, onDeposit = () => {}) {
    Object.assign(this, { scene, factory, audio, bodies });
    this.settings = factory.settings ?? bottleQuality('high');
    this.surfaces = new SurfaceWorld(surfaces);
    this.onDeposit = onDeposit;
    this.initialMl = 0; this.puddleMl = 0; this.lostMl = 0; this.burnedMl = 0; this.removedMl = 0;
    this.puddles = []; this.flights = []; this.streams = new Map();
    this.material = new THREE.MeshStandardMaterial({ color: 0xb57835, transparent: true, opacity: 0.78, roughness: 0.16, depthWrite: false });
    this.dropMaterials = new Map(); // dropKey(absorbance) -> material shared by every drop/stream of that liquid
  }
  register(b) { this.initialMl += b.fillMl; liquidAbsorbance(b); }
  /** Add ml to a bottle (counted in the ledger); absorbance: the added liquid's colour (default: more of the same). */
  refill(b, ml, absorbance = null) {
    const added = Math.min(Math.max(0, ml), b.capacity - b.fillMl);
    if (absorbance && added > 0) mixIntoBottle(b, absorbance, added);
    b.fillMl += added; this.initialMl += added; b.liquid.fill = b.fillMl / b.capacity;
    return added;
  }
  /** Material of drops and streams with absorbance a (Beer-Lambert through DROP_PATH_M); cached and bounded. */
  _dropMaterial(a) {
    const key = dropKey(a);
    let m = this.dropMaterials.get(key);
    if (m) return m;
    if (this.dropMaterials.size >= MAX_DROP_MATERIALS) { // reuse the nearest colour rather than growing without bound
      let best = Infinity;
      for (const [k, material] of this.dropMaterials) {
        const d = Math.abs((k >> 16) - (key >> 16)) + Math.abs(((k >> 8) & 255) - ((key >> 8) & 255)) + Math.abs((k & 255) - (key & 255));
        if (d < best) { best = d; m = material; }
      }
      return m;
    }
    m = this.material.clone();
    transmission(a, DROP_PATH_M, m.color); m.opacity = layerOpacity(m.color, 0.35, 0.9);
    this.dropMaterials.set(key, m);
    return m;
  }
  clear() {
    for (const p of this.puddles) { this.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
    for (const f of this.flights) this.scene.remove(f.mesh);
    for (const s of this.streams.values()) { this.scene.remove(s.mesh); s.mesh.geometry.dispose(); }
    this.puddles = []; this.flights = []; this.streams.clear();
    this.initialMl = this.puddleMl = this.lostMl = this.burnedMl = this.removedMl = 0;
  }
  // Restore physical flights without merging them or emitting new liquid. Saved high-quality flights remain logical state.
  restoreFlight(f) {
    const mesh=new THREE.Mesh(dropGeometry,this._dropMaterial(f.absorbance));
    const index=this.flights.length;mesh.visible=index<this.settings.maxFlights&&(this.settings.dropStride<=1||index%this.settings.dropStride===0);
    mesh.scale.setScalar(clamp(Math.cbrt(3*f.ml*1e-6/(4*Math.PI)),.0012,.015));mesh.position.copy(f.position);this.scene.add(mesh);
    this.flights.push({...f,components:{...f.components},absorbance:[...f.absorbance],position:f.position.clone(),velocity:f.velocity.clone(),mesh});
  }
  restoreVisualPuddle(saved) {
    const material=this.material.clone();material.side=THREE.DoubleSide;
    const mesh=new THREE.Mesh(new THREE.BufferGeometry(),material);mesh.renderOrder=3;
    const p={...saved,absorbance:[...saved.absorbance],hit:{...saved.hit,point:saved.hit.point.clone(),normal:saved.hit.normal.clone(),localNormal:saved.hit.localNormal.clone()},mesh};
    this.puddles.push(p);this.scene.add(mesh);this._puddleGeometry(p);this._trimPuddles();
  }
  restoreStream(key,saved) {
    const geometry=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(saved.points.map(p=>new THREE.Vector3(...p))),saved.segments,saved.radius,5,false);
    const mesh=new THREE.Mesh(geometry,this._dropMaterial(saved.absorbance));mesh.visible=this.settings.streams;this.scene.add(mesh);
    this.streams.set(key,{mesh,timer:saved.timer,point:new THREE.Vector3(...saved.point),velocity:new THREE.Vector3(...saved.velocity),active:true});
  }
  // Emitted volume lives until a swept collision lands it, including after the
  // source bottle shatters or its hole stops flowing.
  // absorbance: the liquid's colour (liquid_color.js); default: the source bottle's.
  emit(ml, point, velocity = new THREE.Vector3(), source = null, kind = source?.liquidKind ?? 'unknown', absorbance = null, components = null) {
    if (!(ml > 0) || !Number.isFinite(ml)) return;
    const a = absorbance ?? (source ? liquidAbsorbance(source) : DEFAULT_ABSORBANCE);
    const contents = dropComponents(ml,kind,source,components);
    if (this.flights.length >= this.settings.maxFlights) { // ceiling: merge, keep volume and colour; never label a mixture as pure water
      const f = this.flights.at(-1); mixAbsorbance(f.absorbance, f.ml, a, ml); mixComponents(f.components,contents); f.ml += ml; if (f.kind !== kind) f.kind = 'mixed'; return;
    }
    const mesh = new THREE.Mesh(dropGeometry, this._dropMaterial(a));
    mesh.scale.setScalar(clamp(Math.cbrt(3 * ml * 1e-6 / (4 * Math.PI)), 0.0012, 0.015));
    mesh.position.copy(point); this.scene.add(mesh);
    this.flights.push({ ml, position: point.clone(), velocity: velocity.clone(), source, kind, components: contents, absorbance: [a[0], a[1], a[2]], mesh, age: 0 });
  }
  spill(ml, point, velocity = new THREE.Vector3()) { this.emit(ml, point, velocity); }
  splash(ml, point, velocity = new THREE.Vector3(), energy = 1, source = null) {
    if (!(ml > 0)) return;
    const count = clamp(Math.ceil(ml / 18), 8, Math.max(8, this.settings.splashDrops));
    const burstSpeed = clamp(Math.sqrt(Math.max(0, energy) / Math.max(0.001, ml * 0.001)) * 0.16, 0.3, 2.5);
    for (let i = 0; i < count; i++) {
      const angle = i * 2.399963229728653, height = (i + 0.5) / count;
      const direction = new THREE.Vector3(Math.cos(angle), height * 0.8 + 0.15, Math.sin(angle)).normalize();
      this.emit(ml / count, point, velocity.clone().addScaledVector(direction, burstSpeed * (0.4 + 0.6 * height)), source);
    }
  }
  land(ml, hit, kind = 'unknown', source = null, absorbance = null, components = null) {
    if (!(ml > 0)) return;
    const a = absorbance ?? (source ? liquidAbsorbance(source) : DEFAULT_ABSORBANCE);
    if (hit.normal.y < 0.55) {
      this.emit(ml, hit.point.clone().addScaledVector(hit.normal, 0.004), new THREE.Vector3(0, -0.3, 0), source, kind, a, components);
      return;
    }
    this.puddleMl += ml;
    // Observational wetting event: the authoritative liquid volume remains in this ledger.
    this.onDeposit({ surfaceId: hit.object.userData?.materialId ?? hit.object.uuid,
      thermalId: hit.object.userData?.thermalId ?? null, position: hit.point.toArray(), ml, kind,
      sourceId: source?.id ?? null, stain: kind === 'water' ? 0 : kind === 'wine' ? 0.7 : 0.1, absorbance: [a[0], a[1], a[2]], components: dropComponents(ml,kind,source,components) });
    let p = this.puddles.find(p => p.hit.key === hit.key && p.hit.normal.dot(hit.normal) > 0.995 && p.hit.point.distanceToSquared(hit.point) < Math.max(0.08, p.targetRadius * 1.3) ** 2);
    if (!p) {
      const material = this.material.clone(); material.side = THREE.DoubleSide;
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material); mesh.renderOrder = 3;
      p = { mesh, hit, ml: 0, radius: 0.008, targetRadius: 0.008, age: 0, absorbance: [a[0], a[1], a[2]] };
      this.puddles.push(p); this.scene.add(mesh);
      this._trimPuddles();
    }
    mixAbsorbance(p.absorbance, p.ml, a, ml);
    p.ml += ml; p.targetRadius = puddleRadius(p.ml);
    this._mergePuddles(p);
    this._puddleGeometry(p);
  }
  /** Puddles on the same face that p has grown into join it: volume adds, colour mixes by ml, centre moves by ml. */
  _mergePuddles(p) {
    for (let i = this.puddles.length - 1; i >= 0; i--) {
      const q = this.puddles[i];
      if (q === p || q.hit.key !== p.hit.key || q.hit.normal.dot(p.hit.normal) <= 0.995) continue;
      const reach = (p.targetRadius + q.targetRadius) * 0.85;
      if (q.hit.point.distanceToSquared(p.hit.point) > reach * reach) continue;
      mixAbsorbance(p.absorbance, p.ml, q.absorbance, q.ml);
      p.hit.point.lerp(q.hit.point, q.ml / (p.ml + q.ml));
      p.ml += q.ml; p.targetRadius = puddleRadius(p.ml); p.radius = Math.max(p.radius, q.radius);
      this.scene.remove(q.mesh); q.mesh.geometry.dispose(); q.mesh.material.dispose();
      this.puddles.splice(i, 1);
    }
  }
  /** Puddles over the tier's ceiling stop being drawn (oldest first); their millilitres stay in the ledger. */
  _trimPuddles() {
    while (this.puddles.length > this.settings.maxPuddles) {
      const old = this.puddles.shift();
      this.scene.remove(old.mesh); old.mesh.geometry.dispose(); old.mesh.material.dispose();
    }
  }
  /** Tier settings (quality.js). */
  setQuality(settings) {
    const reshade = !!this.settings.puddleGradient !== !!settings.puddleGradient;
    this.settings = settings; this._trimPuddles();
    this.flights.forEach((f,i)=>{f.mesh.visible=i<settings.maxFlights&&(settings.dropStride<=1||i%settings.dropStride===0);});
    for(const s of this.streams.values())s.mesh.visible=settings.streams;
    if (reshade) for (const p of this.puddles) this._puddleGeometry(p);
  }
  /**
   * Puddle mesh and colour (rebuilt only while it spreads). The layer's depth is its volume over its drawn area (a fresh,
   * still-spreading puddle is thicker and darker); light crosses it twice (down to the surface and back), so
   * T = colour^(2·depth / refPath). Tiers with puddleGradient fan from the centre with per-vertex colour and alpha:
   * a thicker middle and a thin, clearer rim. Other tiers: one flat colour per puddle.
   */
  _puddleGeometry(p) {
    const polygon = puddlePolygon(p.hit, p.radius), positions = [], material = p.mesh.material;
    const depth = clamp(p.ml * 1e-6 / (Math.PI * p.radius * p.radius), 0.0004, 0.008), path = 2 * depth;
    const geometry = new THREE.BufferGeometry();
    if (this.settings.puddleGradient && polygon.length >= 3) {
      _centre.set(0, 0, 0); for (const v of polygon) _centre.add(v); _centre.multiplyScalar(1 / polygon.length);
      const centre = transmission(p.absorbance, path * 1.6, material.color), ca = layerOpacity(centre);
      const cr = centre.r, cg = centre.g, cb = centre.b;
      const rim = transmission(p.absorbance, path * 0.35, _T), ra = layerOpacity(rim, 0.08, 0.75), colors = [];
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length];
        positions.push(_centre.x, _centre.y, _centre.z, a.x, a.y, a.z, b.x, b.y, b.z);
        colors.push(cr, cg, cb, ca, rim.r, rim.g, rim.b, ra, rim.r, rim.g, rim.b, ra);
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
      if (!material.vertexColors) { material.vertexColors = true; material.needsUpdate = true; }
      material.color.setRGB(1, 1, 1); material.opacity = 1;
    } else {
      for (let i = 1; i < polygon.length - 1; i++) positions.push(...polygon[0].toArray(), ...polygon[i].toArray(), ...polygon[i + 1].toArray());
      if (material.vertexColors) { material.vertexColors = false; material.needsUpdate = true; }
      transmission(p.absorbance, path, material.color); material.opacity = layerOpacity(material.color);
    }
    p.mesh.geometry.dispose(); p.mesh.geometry = geometry;
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.computeVertexNormals();
  }
  inheritedVelocity(b, point) {
    if (!b.entry || !this.bodies) return new THREE.Vector3();
    const { linear, angular } = this.bodies.velocity(b.entry);
    return linear.add(angular.cross(point.clone().sub(b.root.position)));
  }
  rimPoints(b, liquidSpace = false) {
    const declared = b.liquid.info.rim_points;
    if (declared?.length) return declared;
    const rootRim = Array.from({ length: 24 }, (_, i) => {
      const a = i * Math.PI * 2 / 24, r = Math.min(b.radius * 0.24, 0.012);
      return new THREE.Vector3(Math.cos(a) * r, b.height * 0.985, Math.sin(a) * r);
    });
    if (!liquidSpace) return rootRim.map(p => p.toArray());
    b.root.updateWorldMatrix(true, true);
    return rootRim.map(p => b.liquid.liquid.worldToLocal(b.root.localToWorld(p.clone())).toArray());
  }
  _receiver(from, to, source) {
    let best = null;
    for (const b of this.factory.bottles) {
      if (b === source || b.broken || !b.open || b.fillMl >= b.capacity - 1e-6) continue;
      b.root.updateWorldMatrix(true, true);
      const normal = UP.clone().applyQuaternion(b.root.getWorldQuaternion(new THREE.Quaternion()));
      if (normal.y < 0.3) continue;
      const rim = this.rimPoints(b).map(p => new THREE.Vector3(...p));
      const localCentre = rim.reduce((v, p) => v.add(p), new THREE.Vector3()).multiplyScalar(1 / rim.length);
      const centre = b.root.localToWorld(localCentre.clone());
      const d0 = from.clone().sub(centre).dot(normal), d1 = to.clone().sub(centre).dot(normal);
      if (d0 < 0 || d1 > 0 || Math.abs(d0 - d1) < 1e-10) continue;
      const fraction = d0 / (d0 - d1), point = from.clone().lerp(to, fraction);
      const local = b.root.worldToLocal(point.clone());
      const mouthRadius = Math.max(...rim.map(p => Math.hypot(p.x - localCentre.x, p.z - localCentre.z)));
      if (Math.hypot(local.x, local.z) <= mouthRadius && (!best || fraction < best.fraction)) best = { bottle: b, point, fraction };
    }
    return best;
  }
  _flights(dt) {
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i], previous = f.position.clone();
      f.position.addScaledVector(f.velocity, dt).addScaledVector(GRAVITY, dt * dt * 0.5);
      f.velocity.addScaledVector(GRAVITY, dt); f.age += dt;
      const surface = this.surfaces.segment(previous, f.position), receiver = this._receiver(previous, f.position, f.source);
      let finished = false;
      if (receiver && (!surface || receiver.fraction < surface.fraction)) {
        const b = receiver.bottle, accepted = Math.min(f.ml, b.capacity - b.fillMl);
        if (accepted > 0) {
          receiveComponents(b,f.components,accepted,f.ml);
          mixIntoBottle(b, f.absorbance, accepted); // before fillMl grows: the weights are the ml already there
        }
        const fraction = f.ml > 0 ? Math.max(0,1-accepted/f.ml) : 0;
        for (const kind of Object.keys(f.components)) f.components[kind] *= fraction;
        b.fillMl += accepted; b.liquid.fill = b.fillMl / b.capacity; b.liquid.agitate(0.08); f.ml -= accepted;
        if (f.ml > 1e-9) { f.source = b; f.position.copy(receiver.point).add(new THREE.Vector3(b.radius, 0.002, 0)); }
        else finished = true;
      } else if (surface) { this.land(f.ml, surface, f.kind, f.source, f.absorbance, f.components); finished = true; }
      else if (f.age > 6 || f.position.y < -15) { this.lostMl += f.ml; finished = true; }
      if (finished) { this.scene.remove(f.mesh); this.flights.splice(i, 1); }
      else { f.mesh.position.copy(f.position); f.mesh.visible = i<this.settings.maxFlights&&(this.settings.dropStride <= 1 || i % this.settings.dropStride === 0); }
    }
  }
  _stream(key, point, velocity, rateMl, dt, absorbance = DEFAULT_ABSORBANCE) {
    let s = this.streams.get(key);
    if (!s) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material); this.scene.add(mesh);
      s = { mesh, timer: Infinity, point: new THREE.Vector3(Infinity, 0, 0), velocity: new THREE.Vector3() }; this.streams.set(key, s);
    }
    s.mesh.material = this._dropMaterial(absorbance); // the source's colour changes when it is poured into
    s.active = true; s.timer += dt; s.mesh.visible = this.settings.streams;
    if (s.timer < 0.1 && point.distanceToSquared(s.point) < 0.000025 && velocity.distanceToSquared(s.velocity) < 0.0025) return;
    s.timer = 0; s.point.copy(point); s.velocity.copy(velocity);
    const points = [point.clone()]; let prev = point.clone();
    for (let i = 1; i <= 48; i++) {
      const t = i / 30, next = point.clone().addScaledVector(velocity, t).addScaledVector(GRAVITY, t * t * 0.5);
      const hit = this.surfaces.segment(prev, next), receiver = this._receiver(prev, next, key.bottle ?? key);
      if (hit || receiver) { points.push(receiver && (!hit || receiver.fraction < hit.fraction) ? receiver.point : hit.point); break; }
      points.push(next); prev = next; if (next.y < -0.1) break;
    }
    s.mesh.geometry.dispose();
    const radius = clamp(Math.sqrt(rateMl * 1e-6 / (Math.PI * Math.max(0.1, velocity.length()))), 0.0006, 0.007);
    s.mesh.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), Math.min(40, points.length * 2), radius, 5, false);
  }
  _drain(b, dt) {
    const requests = []; let maxDrain = 0;
    for (const hole of b.holes ?? []) {
      const h = holeHydraulics(b, hole); if (h.rateMl <= 0) continue;
      maxDrain = Math.max(maxDrain, h.availableMl);
      const point = h.worldPoint.clone().addScaledVector(h.normal, 0.001);
      const velocity = this.inheritedVelocity(b, point).addScaledVector(h.normal, h.exitSpeed);
      requests.push({ key: hole, point, velocity, rate: h.rateMl, ml: Math.min(h.availableMl, h.rateMl * dt) });
    }
    if (b.open && b.fillMl > 1e-6) {
      b.root.updateWorldMatrix(true, true);
      const q = b.liquid.liquid.getWorldQuaternion(new THREE.Quaternion());
      const localUp = UP.clone().applyQuaternion(q.invert()).normalize();
      const fraction = b.fillMl / b.capacity, rim = this.rimPoints(b, true);
      const spill = b.liquid.lut.spill(localUp, fraction, rim);
      const excess = Math.max(0, fraction - spill.fill) * b.capacity;
      if (excess > 1e-6) {
        maxDrain = Math.max(maxDrain, excess);
        const lowest = rim.reduce((a, p) => new THREE.Vector3(...p).dot(localUp) < new THREE.Vector3(...a).dot(localUp) ? p : a);
        const point = b.liquid.liquid.localToWorld(new THREE.Vector3(...lowest));
        const axis = UP.clone().applyQuaternion(b.root.quaternion), rate = clamp((1 - axis.y) * 180, 25, 400);
        const velocity = this.inheritedVelocity(b, point).addScaledVector(axis, 0.55).add(new THREE.Vector3(0, -0.2, 0));
        requests.push({ key: b, point, velocity, rate, ml: Math.min(excess, rate * dt) });
      }
    }
    const total = requests.reduce((sum, r) => sum + r.ml, 0);
    const allowed = Math.min(b.fillMl, Math.max(maxDrain, total));
    const scale = total > allowed ? allowed / total : 1;
    for (const r of requests) {
      const ml = r.ml * scale; if (ml <= 1e-8) continue;
      b.fillMl = Math.max(0, b.fillMl - ml); this.emit(ml, r.point, r.velocity, b); this._stream(r.key, r.point, r.velocity, ml / dt, dt, liquidAbsorbance(b));
      if (performance.now() - b.lastPour > 650) { this.audio.play('pour', 300); b.lastPour = performance.now(); }
    }
    if (total > 0) b.liquid.fill = b.fillMl / b.capacity;
    b.leakFlowing = requests.some(r => r.key !== b && r.ml > 1e-8);
  }
  step(dt) {
    for (const s of this.streams.values()) s.active = false;
    const steps = Math.max(1, Math.ceil(dt * 60)), subdt = dt / steps;
    for (let j = 0; j < steps; j++) {
      for (const b of this.factory.bottles) if (!b.broken) this._drain(b, subdt);
      this._flights(subdt);
    }
    for (const [key, s] of this.streams) if (!s.active) { this.scene.remove(s.mesh); s.mesh.geometry.dispose(); this.streams.delete(key); }
    for (const p of this.puddles) {
      p.age += dt; const next = THREE.MathUtils.lerp(p.radius, p.targetRadius, Math.min(1, dt * 3));
      if (Math.abs(next - p.radius) > 0.0003) { p.radius = next; this._puddleGeometry(p); }
    }
  }
  /** Public sink for the persistent pool/fire owner. VFX eviction does not erase logical volume. */
  consumePuddleVolume(ml, { surfaceId = null, position = null, reason = 'burn' } = {}) {
    if (!Number.isFinite(ml) || ml < 0) throw new RangeError('ml must be finite and nonnegative');
    if(!['burn','remove'].includes(reason))throw new RangeError('Invalid puddle sink');
    const taken = Math.min(ml, this.puddleMl); let visible = taken;
    const candidates = this.puddles.filter(p => !surfaceId || (p.hit.object.userData?.materialId ?? p.hit.object.uuid) === surfaceId);
    if (position) candidates.sort((a,b) => a.hit.point.distanceToSquared(new THREE.Vector3(...position)) - b.hit.point.distanceToSquared(new THREE.Vector3(...position)));
    for (const p of candidates) {
      if (visible <= 1e-9) break;
      if (position && p.hit.point.distanceTo(new THREE.Vector3(...position)) > Math.max(0.3, p.targetRadius * 2)) continue;
      const amount = Math.min(visible,p.ml); p.ml -= amount; visible -= amount; p.targetRadius = puddleRadius(p.ml);
      if (p.ml < 1e-8) { this.scene.remove(p.mesh);p.mesh.geometry.dispose();p.mesh.material.dispose();this.puddles.splice(this.puddles.indexOf(p),1); }
      else this._puddleGeometry(p);
    }
    this.puddleMl -= taken;if(reason==='remove')this.removedMl+=taken;else this.burnedMl += taken; return taken;
  }
  /** Restore consumption state when the persistent owner restores its matching snapshot. */
  restorePuddleLedger({puddleMl,burnedMl=0,removedMl=0}) {
    if(![puddleMl,burnedMl,removedMl].every(v=>Number.isFinite(v)&&v>=0))throw new RangeError('Invalid liquid ledger');
    if(Math.abs(puddleMl+burnedMl+removedMl-this.puddleMl-this.burnedMl-this.removedMl)>1e-5)throw new Error('New liquid has been deposited since this snapshot');
    this.puddleMl=puddleMl;this.burnedMl=burnedMl;this.removedMl=removedMl;
  }
  ledger() {
    const inBottlesMl = [...this.factory.bottles].reduce((sum, b) => sum + b.fillMl, 0);
    const inFlightMl = this.flights.reduce((sum, f) => sum + f.ml, 0);
    return { initialMl: this.initialMl, inBottlesMl, inFlightMl, puddleMl: this.puddleMl, lostMl: this.lostMl, burnedMl: this.burnedMl, removedMl: this.removedMl,
      errorMl: this.initialMl - inBottlesMl - inFlightMl - this.puddleMl - this.lostMl - this.burnedMl - this.removedMl };
  }
}
