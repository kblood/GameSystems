// Bottle and window-pane breakage: impact assessment (damage.js), damage marks and leak holes, bottle shattering
// (splash + shard asset as debris bodies), shots through bottles and panes, bottles crossing panes, debris lifetime.
// Physics only through BottleBodies (host physics adapter). Debris counts follow the quality tier (quality.js).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assessPane } from './damage.js';
import { bottleQuality } from './quality.js';

let loader = null;
/** Bullet holes a bottle can take; further hits only mark it. */
export const MAX_HOLES = 3;
export const MAX_HOLE_RADIUS = 0.02;
function disposeMark(mark) {
  mark.parent?.remove(mark);mark.geometry?.dispose();
  for(const material of Array.isArray(mark.material)?mark.material:[mark.material])material?.dispose();
}

export class BreakageSystem {
  /** bodies: BottleBodies (or any { shard, remove, velocity, isHeld }). */
  constructor(scene, bodies, factory, pour, audio) {
    this.scene = scene; this.bodies = bodies; this.factory = factory; this.pour = pour; this.audio = audio;
    this.settings = factory.settings ?? bottleQuality('high');
    this.panes = [];
    this.debris = [];
    this.previous = new Map();
    this.generation = 0;
    this.onBroken = null; // (bottle) => void, called once when a bottle shatters, before it is removed
    factory.onImpact = (b, impact) => this.impactBottle(b, impact);
  }

  impactBottle(b, impact) {
    const y = impact.localPoint?.[1] ?? b.height * 0.5;
    const result = b.profile.assess({ speed: impact.speed, y, fill: b.fillMl / b.capacity,
      surface: impact.surface, strikerMass: impact.strikerMass, damage: b.damage });
    b.damage = Math.min(1, b.damage + result.damage);
    if (result.outcome === 'pierce') {
      const point = impact.localPoint ? new THREE.Vector3(...impact.localPoint) : b.root.worldToLocal(new THREE.Vector3(...impact.point));
      const normal = impact.localNormal ? new THREE.Vector3(...impact.localNormal) : new THREE.Vector3(...impact.normal).transformDirection(b.root.matrixWorld.clone().invert());
      this.addHoleLocal(b, point, normal, result.holeRadius ?? b.breakInfo.leak?.hole_r_m ?? 0.0025, false);
      return;
    }
    if (result.outcome === 'crack' || result.outcome === 'dent') {
      b.damageStage = result.outcome;
      const localPoint = impact.localPoint ? new THREE.Vector3(...impact.localPoint) : b.root.worldToLocal(new THREE.Vector3(...impact.point));
      const localNormal = impact.localNormal ? new THREE.Vector3(...impact.localNormal) : new THREE.Vector3(...impact.normal).transformDirection(b.root.matrixWorld.clone().invert());
      this.addDamageMarkLocal(b, localPoint, localNormal, result.outcome);
      return;
    }
    if (result.outcome === 'shatter' || result.outcome === 'neck_snap') this.breakBottle(b, impact.speed, impact);
  }

  addDamageMark(b, point, normal, kind) {
    const local = b.root.worldToLocal(point.clone());
    const localNormal = normal.transformDirection(b.root.matrixWorld.clone().invert());
    return this.addDamageMarkLocal(b, local, localNormal, kind);
  }

  addDamageMarkLocal(b, local, localNormal, kind) {
    const ring = new THREE.Mesh(new THREE.CircleGeometry(kind === 'crack' ? 0.012 : 0.009, 12),
      new THREE.MeshBasicMaterial({ color: kind === 'crack' ? 0xaedce4 : 0x9e9a91, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    ring.position.copy(local).addScaledVector(localNormal, 0.001);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), localNormal);
    ring.userData.damageMark = true; ring.userData.damageKind = kind; b.root.add(ring); b.damageMarks ??= []; b.damageMarks.push(ring);
    while (b.damageMarks.length > this.settings.damageMarks) disposeMark(b.damageMarks.shift());
  }

  addHole(b, point, normal, radius = 0.0025, isExit = false) {
    if (!b || b.broken || (b.holes?.length ?? 0) >= MAX_HOLES) return null;
    b.root.updateWorldMatrix(true, true);
    const local = b.root.worldToLocal(point.clone());
    const localNormal = normal.clone().transformDirection(b.root.matrixWorld.clone().invert()).normalize();
    return this.addHoleLocal(b, local, localNormal, radius, isExit);
  }

  addHoleLocal(b, local, localNormal, radius = 0.0025, isExit = false) {
    if (!b || b.broken || (b.holes?.length ?? 0) >= MAX_HOLES) return null;
    if (!Number.isFinite(radius) || radius <= 0) throw new TypeError('Invalid bottle hole radius');
    b.root.updateWorldMatrix(true, true);
    localNormal.normalize();
    const holeRadius = Math.min(MAX_HOLE_RADIUS, Math.max(0.0015, radius * (isExit ? 1.5 : 1)));
    const mark = new THREE.Group();
    mark.position.copy(local).addScaledVector(localNormal, 0.0008);
    mark.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), localNormal);
    const ring = new THREE.Mesh(new THREE.CircleGeometry(holeRadius * 2.8, 20), new THREE.MeshBasicMaterial({ color: 0xc8d9d7, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    const dark = new THREE.Mesh(new THREE.CircleGeometry(holeRadius, 16), new THREE.MeshBasicMaterial({ color: 0x080c0d, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }));
    mark.add(ring, dark); dark.position.z = 0.0002; mark.userData.damageMark = true; b.root.add(mark);
    b.holes.push({ point: local, normal: localNormal, radius: holeRadius, mark, isExit });
    return b.holes.at(-1);
  }

  pane(name, position, yaw, size, tempered = false) {
    if(typeof name!=='string'||!name||this.panes.some(pane=>pane.name===name))throw new Error('Invalid or duplicate pane id');
    if(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite)||!Number.isFinite(yaw))throw new TypeError('Invalid pane transform');
    if(!Array.isArray(size)||size.length!==2||!size.every(v=>Number.isFinite(v)&&v>0)||typeof tempered!=='boolean')throw new TypeError('Invalid pane dimensions or material');
    const group = new THREE.Group();
    group.position.set(...position); group.rotation.y = yaw;
    const [w, h] = size;
    const material = new THREE.MeshPhysicalMaterial({ color: tempered ? 0xaadbe3 : 0x9bc7d4, transparent: true, opacity: 0.26, metalness: 0.1, roughness: 0.08, side: THREE.DoubleSide, depthWrite: false });
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    sheet.userData.paneName = name;
    group.add(sheet);
    const frame = new THREE.MeshStandardMaterial({ color: tempered ? 0x313a3b : 0x5a463a, metalness: 0.4, roughness: 0.5 });
    for (const x of [-w / 2, w / 2]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, h + 0.08, 0.07), frame); m.position.x = x; group.add(m);
    }
    for (const y of [-h / 2, h / 2]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, 0.06, 0.07), frame); m.position.y = y; group.add(m);
    }
    this.scene.add(group);
    const pane = { name, group, sheet, w, h, tempered, broken: false, damage: 0, holes: [], cracks: [] };
    sheet.userData.pane = pane;
    this.panes.push(pane);
    return pane;
  }

  createPanes() {
    this.pane('Husvindue', [-2.9, 1.45, -0.5], Math.PI, [1.2, 1.3]);
    this.pane('Butiksrude', [4.4, 1.16, 0.6], -49 * Math.PI / 180, [1.6, 2.2]);
    this.pane('Hærdet rude', [-4.0, 0.66, 1.0], 35 * Math.PI / 180, [1.0, 1.2], true);
  }

  breakPane(pane, point, energy = 1, projectile = false) {
    if (pane.broken) return;
    const local = pane.group.worldToLocal(point.clone());
    const edgeDistance = Math.min(pane.w / 2 - Math.abs(local.x), pane.h / 2 - Math.abs(local.y));
    const result = assessPane(pane.tempered ? 'tempered' : 'annealed', { energy, projectile, edgeDistance,
      damage: pane.damage, incidence: 1, contact: 0.02, hardness: 0.95 });
    pane.damage = Math.min(1, pane.damage + result.damage);
    if (result.outcome === 'chip' || result.outcome === 'cracked' || result.outcome === 'punched') {
      const holeRadius = result.outcome === 'punched' ? Math.max(0.012, result.radius ?? 0.018) : 0;
      this.markPaneDamage(pane, local, result.outcome, holeRadius);
      this.audio.play('glassHit');
      return result;
    }
    if (result.outcome !== 'shattered') return result;
    pane.broken = true; pane.sheet.visible = false;
    this.audio.play(pane.tempered ? 'smallShatter' : 'shatter');
    const count = pane.tempered ? 48 : 32, stride = this.settings.shardStride;
    const material = new THREE.MeshPhysicalMaterial({ color: 0xb9e3e8, transparent: true, opacity: 0.5, metalness: 0.05, roughness: 0.12, side: THREE.DoubleSide });
    for (let i = 0; i < count; i += stride) {
      const angle = i * Math.PI * (3 - Math.sqrt(5));
      const radius = Math.sqrt((i + 0.5) / count);
      const x = local.x + Math.cos(angle) * radius * pane.w * 0.55;
      const y = local.y + Math.sin(angle) * radius * pane.h * 0.55;
      const nextAngle = angle + 2.2, nx = local.x + Math.cos(nextAngle) * (radius + 0.12) * pane.w * 0.55;
      const ny = local.y + Math.sin(nextAngle) * (radius + 0.12) * pane.h * 0.55;
      const geometry = new THREE.BufferGeometry();
      const cx = (2 * x + nx) / 3, cy = (2 * y + ny) / 3;
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([x - cx, y - cy, 0, nx - cx, y - cy, 0, x - cx, ny - cy, 0], 3));
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(pane.group.localToWorld(new THREE.Vector3(cx, cy, 0)));
      mesh.quaternion.copy(pane.group.quaternion); this.scene.add(mesh);
      const away = mesh.position.clone().sub(point).normalize();
      const velocity = away.multiplyScalar(0.5 + Math.sqrt(Math.max(0, energy)) * 0.35 + Math.random()).add(new THREE.Vector3(0, 0.7, 0));
      const angularVelocity = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(18);
      const entry = this.bodies.shard(mesh, { size: new THREE.Vector3(0.08, 0.08, 0.002), mass: 0.015, velocity, angularVelocity });
      this.debris.push({ mesh, entry, life: 5 });
    }
    this.trimDebris();
    return result;
  }

  markPaneDamage(pane, local, outcome, radius = 0) {
    const center = new THREE.Vector3(local.x, local.y, 0.001);
    const crackCount = outcome === 'chip' ? 4 : 9;
    for (let i = 0; i < crackCount; i++) {
      const angle = i * Math.PI * 2 / crackCount + (Math.random() - 0.5) * 0.2;
      const length = (0.08 + Math.random() * 0.12) * (outcome === 'chip' ? 0.4 : 1);
      const end = center.clone().add(new THREE.Vector3(Math.cos(angle) * length, Math.sin(angle) * length, 0));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([center, end]), new THREE.LineBasicMaterial({ color: 0xc5e4ea, transparent: true, opacity: 0.78 }));
      line.position.z = 0.001; pane.group.add(line); pane.cracks.push(line);
    }
    if (radius > 0) {
      const hole = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), new THREE.MeshBasicMaterial({ color: 0x25383b, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
      hole.position.copy(center); pane.group.add(hole); pane.holes.push({ point: new THREE.Vector2(local.x, local.y), radius, mesh: hole });
    }
    while (pane.cracks.length > 72) disposeMark(pane.cracks.shift());
  }

  capturePaneState() {
    return this.panes.map(pane => ({
      name: pane.name, w: pane.w, h: pane.h, tempered: pane.tempered,
      broken: pane.broken, damage: pane.damage,
      holes: pane.holes.map(hole => ({ point: hole.point.toArray(), radius: hole.radius })),
      cracks: pane.cracks.map(line => ({
        vertices: Array.from(line.geometry.getAttribute('position').array),
        position: line.position.toArray(), color: line.material.color.getHex(), opacity: line.material.opacity,
      })),
    }));
  }

  preparePaneRestore(raw) {
    if (!Array.isArray(raw) || raw.length !== this.panes.length) throw new Error('Pane checkpoint topology differs');
    const saved = new Map();
    for (const item of raw) {
      if (!item || typeof item.name !== 'string' || saved.has(item.name)) throw new Error('Invalid pane checkpoint id');
      const pane = this.panes.find(candidate => candidate.name === item.name);
      if (!pane || item.w !== pane.w || item.h !== pane.h || item.tempered !== pane.tempered) throw new Error('Saved pane does not match authored scene');
      if (typeof item.broken !== 'boolean' || !Number.isFinite(item.damage) || item.damage < 0 || item.damage > 1 ||
        !Array.isArray(item.holes) || !Array.isArray(item.cracks) || item.holes.length > 4096 || item.cracks.length > 72) throw new Error('Invalid saved pane state');
      const holes = item.holes.map(hole => {
        if (!Array.isArray(hole?.point) || hole.point.length !== 2 || !hole.point.every(Number.isFinite) || hole.point.some(v=>Math.abs(v)>1000) || !Number.isFinite(hole.radius) || hole.radius <= 0 || hole.radius>1000) throw new Error('Invalid saved pane hole');
        return { point: [...hole.point], radius: hole.radius };
      });
      const cracks = item.cracks.map(crack => {
        if (!Array.isArray(crack?.vertices) || crack.vertices.length !== 6 || !crack.vertices.every(Number.isFinite) || crack.vertices.some(v=>Math.abs(v)>1000) ||
          !Array.isArray(crack.position) || crack.position.length !== 3 || !crack.position.every(Number.isFinite) || crack.position.some(v=>Math.abs(v)>1000) ||
          !Number.isSafeInteger(crack.color) || crack.color < 0 || crack.color > 0xffffff ||
          !Number.isFinite(crack.opacity) || crack.opacity < 0 || crack.opacity > 1) throw new Error('Invalid saved pane crack');
        return { vertices: [...crack.vertices], position: [...crack.position], color: crack.color, opacity: crack.opacity };
      });
      saved.set(item.name, { pane, w:pane.w, h:pane.h, tempered:pane.tempered, broken: item.broken, damage: item.damage, holes, cracks });
    }
    if (this.panes.some(pane => !saved.has(pane.name))) throw new Error('Pane checkpoint topology differs');
    return { commit: () => {
      if(this.panes.length!==saved.size||this.panes.some(pane=>{const staged=saved.get(pane.name);return !staged||pane!==staged.pane||pane.w!==staged.w||pane.h!==staged.h||pane.tempered!==staged.tempered;})) throw new Error('Pane checkpoint topology changed');
      this.reset(); // Shards are transient physics debris; pane damage is the persisted state.
      for (const { pane, broken, damage, holes, cracks } of saved.values()) {
        pane.broken = broken; pane.damage = damage; pane.sheet.visible = !broken;
        for (const hole of holes) {
          const point = new THREE.Vector2(...hole.point), center = new THREE.Vector3(point.x, point.y, 0.001);
          const mesh = new THREE.Mesh(new THREE.CircleGeometry(hole.radius, 24), new THREE.MeshBasicMaterial({ color: 0x25383b, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
          mesh.position.copy(center); pane.group.add(mesh); pane.holes.push({ point, radius: hole.radius, mesh });
        }
        for (const crack of cracks) {
          const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(crack.vertices, 3));
          const material = new THREE.LineBasicMaterial({ color: crack.color, transparent: true, opacity: crack.opacity });
          const line = new THREE.Line(geometry, material); line.position.fromArray(crack.position); pane.group.add(line); pane.cracks.push(line);
        }
      }
    } };
  }

  async breakBottle(b, speed = 6, impact = {}) {
    if (b.broken) return;
    if (!b.shatters && b.profile.material !== 'ceramic') { this.audio.play(b.isPlastic ? 'plastic' : 'clink'); return; }
    b.broken = true;
    const position = b.root.position.clone();
    const quaternion = b.root.quaternion.clone();
    const hitPoint = impact.point ? new THREE.Vector3(...impact.point) : position.clone();
    const motion = impact.velocity && impact.angularVelocity ? null : this.bodies.velocity(b.entry);
    const inherited = impact.velocity ? new THREE.Vector3(...impact.velocity) : motion.linear;
    const omega = impact.angularVelocity ? new THREE.Vector3(...impact.angularVelocity) : motion.angular;
    inherited.add(omega.clone().cross(hitPoint.clone().sub(position)));
    const direction = impact.normal ? new THREE.Vector3(...impact.normal).negate().normalize() : inherited.clone().normalize();
    if (direction.lengthSq() < 1e-6) direction.set(0, 1, 0);
    const ml = b.fillMl;
    if (ml > 0) {
      const bodyMass = this.bodies.isHeld(b.entry) ? 0 : b.mass ?? b.profile.mass(ml / b.capacity); // a held body is kinematic (no mass)
      this.pour.splash(ml, hitPoint, inherited, Math.max(1, impact.energy ?? 0.5 * bodyMass * speed * speed), b);
      b.fillMl = 0; b.liquid.fill = 0;
    }
    this.onBroken?.(b); // the extension sends 'broken': hands let go (the demo's interaction.dropBottle, the avatar)
    this.factory.remove(b);
    this.audio.play('smallShatter');
    const generation = this.generation;
    const shardPath = b.asset.shards || b.breakInfo.files?.shards;
    if (!shardPath) return;
    try {
      const root = (await (loader ??= new GLTFLoader()).loadAsync(this.factory.path(shardPath))).scene;
      if (generation !== this.generation) return;
      root.position.copy(position); root.quaternion.copy(quaternion); root.updateMatrixWorld(true);
      const pieces = [];
      root.traverse(o => { if (o.isMesh) pieces.push(o); });
      const stride = this.settings.shardStride;
      for (let i = 0; i < pieces.length; i += stride) {
        const o = pieces[i];
        const mesh = o.clone();
        mesh.geometry = o.geometry; mesh.material = o.material;
        o.updateWorldMatrix(true, false);
        mesh.position.setFromMatrixPosition(o.matrixWorld);
        mesh.quaternion.setFromRotationMatrix(o.matrixWorld);
        mesh.scale.setFromMatrixScale(o.matrixWorld);
        mesh.castShadow = true;
        this.scene.add(mesh);
        const radial = mesh.position.clone().sub(hitPoint).add(new THREE.Vector3((Math.random() - 0.5) * 0.1, 0.1, (Math.random() - 0.5) * 0.1)).normalize();
        const extras = o.userData.extras ?? o.userData;
        const cls = extras.class || extras.shard_class || 'shard';
        const bounds = o.geometry.boundingBox ?? (o.geometry.computeBoundingBox(), o.geometry.boundingBox);
        const center = bounds.getCenter(new THREE.Vector3()).multiply(mesh.scale);
        const dims = bounds.getSize(new THREE.Vector3()).multiply(new THREE.Vector3(Math.abs(mesh.scale.x), Math.abs(mesh.scale.y), Math.abs(mesh.scale.z)));
        const fraction = cls === 'chunk' ? 0.12 : cls === 'sliver' ? 0.015 : 0.04;
        const mass = Math.max(0.0002, extras.mass_kg ?? b.profile.shellMass * (extras.mass_fraction ?? fraction));
        const shardVelocity = inherited.clone().addScaledVector(radial, Math.min(8, speed * (cls === 'chunk' ? 0.18 : 0.35)));
        const shardAngular = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(12);
        const entry = this.bodies.shard(mesh, { size: dims, center, mass, velocity: shardVelocity, angularVelocity: shardAngular });
        this.debris.push({ mesh, entry, life: cls === 'sliver' ? 4 : 9 });
      }
      this.trimDebris();
    } catch (error) { console.warn('Could not load shard asset', shardPath, error); }
  }

  shoot(origin, direction) {
    this.scene.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(origin, direction, 0, 100);
    const targets = [...this.factory.bottles].flatMap(b => {
      const meshes = []; b.root.traverse(o => { if (o.isMesh && o.visible && !o.name.startsWith('Liquid') && !this.isDamageMark(o)) meshes.push(o); }); return meshes;
    });
    targets.push(...this.panes.filter(p => !p.broken).map(p => p.sheet));
    const savedSides = [];
    for (const b of this.factory.bottles) b.root.traverse(o => {
      if (!o.isMesh || !o.visible || this.isDamageMark(o) || o.name.startsWith('Liquid')) return;
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      for (const material of materials) if (material) { savedSides.push([material, material.side]); material.side = THREE.DoubleSide; }
    });
    const hits = ray.intersectObjects(targets, false);
    for (const [material, side] of savedSides) material.side = side;
    if (!hits.length) return null;
    const processed = new Set(); let firstHit = null, remainingEnergy = 500;
    for (const hit of hits) {
      const pane = hit.object.userData.pane, b = hit.object.userData.bottle;
      const target = pane || b;
      if (!target || processed.has(target)) continue;
      if (b) {
        const local = b.root.worldToLocal(hit.point.clone());
        if ((b.holes ?? []).some(hole => hole.point.distanceTo(local) < hole.radius * 1.2)) continue;
      }
      if (pane) {
        const p = pane.group.worldToLocal(hit.point.clone());
        if (pane.holes.some(hole => hole.point.distanceTo(new THREE.Vector2(p.x, p.y)) < hole.radius * 0.9)) continue;
      }
      processed.add(target); firstHit ??= hit;
      if (pane) {
        const result = this.breakPane(pane, hit.point, remainingEnergy, true);
        this.audio.play('glassHit');
        if (result?.outcome !== 'punched') break;
        remainingEnergy -= result.absorbed ?? remainingEnergy * 0.55;
      } else {
        b.liquid.agitate(0.7);
        const localY = b.root.worldToLocal(hit.point.clone()).y;
        const result = b.profile.assess({ projectile: true, energy: remainingEnergy, y: localY, fill: b.fillMl / b.capacity });
        const normal = hit.face?.normal ? hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize() : direction.clone().negate();
        if (result.outcome === 'pierce') {
          const hole = this.addHole(b, hit.point, normal, b.breakInfo.leak?.hole_r_m ?? 0.0025, false);
          const exits = hits.filter(h => h.object.userData.bottle === b && h.distance > hit.distance + 0.01 &&
            h.face?.normal?.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(h.object.matrixWorld)).dot(direction) > 0);
          const exit = exits.at(-1);
          if (exit && remainingEnergy > 150 && b.holes.length < MAX_HOLES) {
            const exitNormal = exit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(exit.object.matrixWorld)).normalize();
            this.addHole(b, exit.point, exitNormal, hole?.radius ?? 0.0025, true);
          }
          this.audio.play('plasticHit'); remainingEnergy -= result.absorbed ?? 50;
          if (remainingEnergy > 8) continue;
        } else if (result.outcome === 'shatter') this.breakBottle(b, 8, { point: hit.point.toArray(), normal: normal.toArray(), energy: remainingEnergy });
        else { this.addDamageMark(b, hit.point, normal, result.outcome); this.audio.play('clink'); }
        break;
      }
      if (remainingEnergy <= 8) break;
    }
    return firstHit;
  }

  isDamageMark(object) {
    for (let o = object; o; o = o.parent) if (o.userData?.damageMark) return true;
    return false;
  }

  step(dt) {
    for (const b of this.factory.bottles) {
      const now = b.root.position.clone();
      const prev = this.previous.get(b);
      if (prev && !b.broken) {
        for (const pane of this.panes) {
          if (pane.broken) continue;
          const p0 = pane.group.worldToLocal(prev.clone());
          const p1 = pane.group.worldToLocal(now.clone());
          if (p0.z * p1.z > 0 || Math.abs(p1.z - p0.z) < 1e-5) continue;
          const t = -p0.z / (p1.z - p0.z);
          const hit = p0.lerp(p1, t);
          if (Math.abs(hit.x) > pane.w / 2 + b.radius || Math.abs(hit.y) > pane.h / 2 + b.height / 2) continue;
          const speed = this.bodies.velocity(b.entry).linear.length();
          if (speed > (b.isPlastic ? 6 : 1.5)) {
            this.breakPane(pane, pane.group.localToWorld(hit), 0.5 * b.profile.mass(b.fillMl / b.capacity) * speed * speed, false);
            if (b.shatters && speed > 5) this.breakBottle(b, speed);
            break;
          }
        }
      }
      this.previous.set(b, now);
    }
    for (const [b] of this.previous) if (!this.factory.bottles.has(b)) this.previous.delete(b);
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      if (d.life <= 0) { this.bodies.remove(d.entry); this.scene.remove(d.mesh); this.debris.splice(i, 1); }
    }
  }

  trimDebris() {
    while (this.debris.length > this.settings.maxDebris) { const d = this.debris.shift(); this.bodies.remove(d.entry); this.scene.remove(d.mesh); }
  }

  /** Tier settings (quality.js); fewer debris bodies apply at once. */
  setQuality(settings) { this.settings = settings; this.trimDebris(); }

  /** Remove the panes from the scene (extension dispose). */
  disposePanes() { for (const pane of this.panes) this.scene.remove(pane.group); this.panes = []; }

  reset() {
    this.generation++;
    for (const pane of this.panes) {
      pane.broken = false; pane.damage = 0; pane.sheet.visible = true;
      for (const mark of [...pane.cracks, ...pane.holes.map(h => h.mesh)]) disposeMark(mark);
      pane.cracks = []; pane.holes = [];
    }
    for (const d of this.debris) { this.bodies.remove(d.entry); this.scene.remove(d.mesh); }
    this.debris = [];
    this.previous.clear();
  }
}
