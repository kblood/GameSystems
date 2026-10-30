// fire-fx three layer: createFireFX({ THREE, scene, camera, quality, budget }). THREE is passed in (this folder imports no
// three.js). Three InstancedMeshes (flames, particles, scorches) = at most 3 draw calls per view, plus a fixed pool of
// PointLights. Everything is allocated here once; update() reuses vectors and typed arrays and allocates nothing.
import { FIRE_FX_LIMITS, resolveBudget, tierLimits } from './quality.js';
import { createParticlePool, PARTICLE_KIND } from './pool.js';
import { createFlameRegistry, createScorchRing, flameBounds, selectLights, readVec } from './flames.js';
import { FLAME_VERTEX, FLAME_FRAGMENT, PARTICLE_VERTEX, PARTICLE_FRAGMENT, SCORCH_VERTEX, SCORCH_FRAGMENT } from './shaders.js';

const FLAME_ASPECT = 1.6;          // flame height / width
const LIGHT_COLOR = 0xff8a3a;
const KIND_DEFAULTS = [            // per PARTICLE_KIND: speed (m/s), spread (rad), life (s), size (m)
  { speed: 0.8, spread: 0.6, life: 1.4, size: 0.02 },
  { speed: 3.5, spread: 0.35, life: 0.5, size: 0.012 },
  { speed: 6, spread: 0.12, life: 0.5, size: 0.1 },
];

/**
 * Visual fire: flames, embers/sparks/puffs, a shared light pool and scorch decals.
 *
 * @param {object} options
 * @param {object} options.THREE         the three.js namespace (r160+; tested with 0.170)
 * @param {object} options.scene         where the meshes and lights are added
 * @param {object} options.camera        the camera used for frustum culling and light choice (in XR pass the camera the
 *                                       renderer updates; one frustum is used for both eyes, with a margin)
 * @param {'low'|'medium'|'high'} [options.quality='high']  also accepts the host names 'minimal' and 'mid'
 * @param {{particles?:number, lights?:number, flames?:number, scorches?:number}} [options.budget]  hard caps (allocation
 *                                       sizes); default the 'high' tier; clamped to FIRE_FX_LIMITS
 * @param {number} [options.cullMargin=1.25]  bounding sphere scale for the frustum test
 * @param {number} [options.lightIntensity=6] PointLight intensity for an intensity-1 flame of size 1 m
 * @param {number} [options.seed=4242]
 */
export function createFireFX({ THREE, scene, camera, quality = 'high', budget = {}, cullMargin = 1.25, lightIntensity = 6, seed = 4242 } = {}) {
  if (!THREE?.InstancedMesh || !THREE.ShaderMaterial || !THREE.PointLight || !THREE.Frustum) throw new TypeError('createFireFX needs THREE (InstancedMesh, ShaderMaterial, PointLight, Frustum)');
  if (!scene?.add) throw new TypeError('createFireFX needs a scene');
  if (!camera?.projectionMatrix) throw new TypeError('createFireFX needs a camera');
  const caps = resolveBudget(budget);
  let limits = tierLimits(quality, caps), disposed = false, clock = 0;

  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const pool = createParticlePool(caps.particles);
  const flames = createFlameRegistry(caps.flames);
  const scorches = createScorchRing(caps.scorches);

  // --- flames
  const flameGeometry = new THREE.PlaneGeometry(1, 1);
  const flameParams = new Float32Array(Math.max(1, caps.flames) * 4);
  const flameParamAttr = new THREE.InstancedBufferAttribute(flameParams, 4);
  flameParamAttr.setUsage?.(THREE.DynamicDrawUsage);
  flameGeometry.setAttribute('flameParams', flameParamAttr);
  const flameMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } }, defines: { OCTAVES: limits.octaves },
    vertexShader: FLAME_VERTEX, fragmentShader: FLAME_FRAGMENT,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const flameMesh = new THREE.InstancedMesh(flameGeometry, flameMaterial, Math.max(1, caps.flames));
  flameMesh.name = 'fire-fx:flames'; flameMesh.count = 0; flameMesh.frustumCulled = false; flameMesh.renderOrder = 7;
  flameMesh.instanceMatrix.setUsage?.(THREE.DynamicDrawUsage);

  // --- particles
  const particleGeometry = new THREE.PlaneGeometry(1, 1);
  const pData = new Float32Array(Math.max(1, caps.particles) * 4);
  const pDataAttr = new THREE.InstancedBufferAttribute(pData, 4);
  pDataAttr.setUsage?.(THREE.DynamicDrawUsage);
  particleGeometry.setAttribute('pData', pDataAttr);
  const particleMaterial = new THREE.ShaderMaterial({
    vertexShader: PARTICLE_VERTEX, fragmentShader: PARTICLE_FRAGMENT,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const particleMesh = new THREE.InstancedMesh(particleGeometry, particleMaterial, Math.max(1, caps.particles));
  particleMesh.name = 'fire-fx:particles'; particleMesh.count = 0; particleMesh.frustumCulled = false; particleMesh.renderOrder = 8;
  particleMesh.instanceMatrix.setUsage?.(THREE.DynamicDrawUsage);

  // --- scorches
  const scorchGeometry = new THREE.PlaneGeometry(1, 1);
  const sSeed = new Float32Array(Math.max(1, caps.scorches));
  const sSeedAttr = new THREE.InstancedBufferAttribute(sSeed, 1);
  scorchGeometry.setAttribute('sSeed', sSeedAttr);
  const scorchMaterial = new THREE.ShaderMaterial({
    defines: { OCTAVES: Math.min(3, limits.octaves) },
    vertexShader: SCORCH_VERTEX, fragmentShader: SCORCH_FRAGMENT,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const scorchMesh = new THREE.InstancedMesh(scorchGeometry, scorchMaterial, Math.max(1, caps.scorches));
  scorchMesh.name = 'fire-fx:scorches'; scorchMesh.count = 0; scorchMesh.frustumCulled = false; scorchMesh.renderOrder = 1;

  // --- lights (fixed pool; lights above the tier are invisible, unused lights inside it get intensity 0 so the number of
  // lights in the scene, and with it the lit shaders, does not change from frame to frame)
  const lights = [];
  for (let i = 0; i < caps.lights; i++) {
    const l = new THREE.PointLight(LIGHT_COLOR, 0, 4, 2);
    l.name = `fire-fx:light${i}`; l.visible = i < limits.lights; l.castShadow = false;
    lights.push(l); scene.add(l);
  }
  scene.add(scorchMesh, flameMesh, particleMesh);

  // --- scratch (reused every frame)
  const frustum = new THREE.Frustum(), projScreen = new THREE.Matrix4(), sphere = new THREE.Sphere();
  const camPos = new THREE.Vector3(), cam = [0, 0, 0], center = [0, 0, 0];
  const lightIndex = new Int32Array(FIRE_FX_LIMITS.lights), lightScore = new Float32Array(FIRE_FX_LIMITS.lights);
  const tmpQ = new THREE.Quaternion(), tmpM = new THREE.Matrix4(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), zAxis = new THREE.Vector3(0, 0, 1), tmpN = new THREE.Vector3();
  const sparkPos = [0, 0, 0], sparkDir = [0, 0, 0];
  let drawnFlames = 0, activeLights = 0;

  function writeScorch(slot) {
    const s = scorches.slots[slot];
    tmpN.set(s.normal[0], s.normal[1], s.normal[2]);
    tmpQ.setFromUnitVectors(zAxis, tmpN);
    tmpP.set(s.position[0] + s.normal[0] * 0.004, s.position[1] + s.normal[1] * 0.004, s.position[2] + s.normal[2] * 0.004);
    tmpS.set(s.radius * 2, s.radius * 2, 1);
    tmpM.compose(tmpP, tmpQ, tmpS);
    scorchMesh.setMatrixAt(slot, tmpM);
    sSeed[slot] = s.seed;
  }
  function rewriteScorches() {
    for (let i = 0; i < scorches.count; i++) writeScorch(i);
    scorchMesh.count = scorches.count; scorchMesh.instanceMatrix.needsUpdate = true; sSeedAttr.needsUpdate = true;
  }

  function emit(kind, x, y, z, dx, dy, dz, speed, spread, life, size) {
    // Random direction inside a cone around (dx,dy,dz), speed jittered ±30 %.
    let vx = dx + (random() * 2 - 1) * spread, vy = dy + (random() * 2 - 1) * spread, vz = dz + (random() * 2 - 1) * spread;
    const len = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1, v = speed * (0.7 + 0.6 * random()) / len;
    vx *= v; vy *= v; vz *= v;
    return pool.spawn(x, y, z, vx, vy, vz, life * (0.7 + 0.6 * random()), size * (0.75 + 0.5 * random()), kind, random());
  }

  function live() { if (disposed) throw new Error('fire-fx is disposed'); }

  const api = {
    /** The three objects, for debugging and tests. */
    objects: { flames: flameMesh, particles: particleMesh, scorches: scorchMesh, lights },
    get quality() { return limits.quality; },
    /**
     * Adds a flame (or updates the one with this id). position: base of the flame; normal: surface normal (the flame
     * still rises along world up; the normal only nudges the base); size: width in m (height = 1.6 × size);
     * intensity: 0..1+ (brightness, light, embers). Returns false when budget.flames flames already exist.
     */
    addFlame({ id, position, normal, size, intensity } = {}) { live(); return flames.add({ id, position, normal, size, intensity }); },
    /** Moves a flame without allocating; size and intensity are optional. False for an unknown id. */
    moveFlame(id, position, size, intensity) { if (disposed) return false; return flames.move(id, position, size, intensity); },
    removeFlame(id) { if (disposed) return false; return flames.remove(id); },
    /**
     * Emits sparks. direction: their mean direction (normalised here); count is scaled by the tier (sparkScale) and
     * capped at FIRE_FX_LIMITS.sparksPerCall. opts (reuse one object per caller to avoid garbage): { kind: 'spark' |
     * 'ember' | 'puff', speed (m/s), spread (0..1, cone jitter), life (s), size (m) }. Returns how many were emitted.
     */
    spark(position, direction, count = 8, opts) {
      if (disposed || !readVec(position, sparkPos) || !readVec(direction ?? [0, 1, 0], sparkDir)) return 0;
      const kind = opts?.kind === 'puff' ? PARTICLE_KIND.puff : opts?.kind === 'ember' ? PARTICLE_KIND.ember : PARTICLE_KIND.spark, d = KIND_DEFAULTS[kind];
      const len = Math.hypot(sparkDir[0], sparkDir[1], sparkDir[2]) || 1;
      let n = Math.round(Math.max(0, count) * limits.sparkScale);
      if (count > 0 && n === 0) n = 1;
      n = Math.min(n, FIRE_FX_LIMITS.sparksPerCall);
      let emitted = 0;
      for (let i = 0; i < n; i++) if (emit(kind, sparkPos[0], sparkPos[1], sparkPos[2], sparkDir[0] / len, sparkDir[1] / len, sparkDir[2] / len,
        opts?.speed ?? d.speed, opts?.spread ?? d.spread, opts?.life ?? d.life, opts?.size ?? d.size) >= 0) emitted++;
      return emitted;
    },
    /** Stamps a scorch decal (a quad on the surface facing along normal). Oldest are replaced past the tier's cap. */
    scorch(position, normal, radius = 0.3) {
      live();
      const slot = scorches.add(position, normal, radius);
      if (slot < 0) return -1;
      writeScorch(slot);
      scorchMesh.count = scorches.count; scorchMesh.instanceMatrix.needsUpdate = true; sSeedAttr.needsUpdate = true;
      return slot;
    },
    /** 'low' | 'medium' | 'high' (or 'minimal' / 'mid'). Lowers/raises live caps inside the budget; never allocates. */
    setQuality(tier) {
      live();
      const next = tierLimits(tier, caps);
      pool.setLimit(next.particles);
      if (next.scorches !== scorches.limit) { scorches.setLimit(next.scorches); rewriteScorches(); }
      for (let i = 0; i < lights.length; i++) { lights[i].visible = i < next.lights; if (!lights[i].visible) lights[i].intensity = 0; }
      if (next.octaves !== limits.octaves) {
        flameMaterial.defines.OCTAVES = next.octaves; flameMaterial.needsUpdate = true;
        scorchMaterial.defines.OCTAVES = Math.min(3, next.octaves); scorchMaterial.needsUpdate = true;
      }
      limits = next;
      return limits.quality;
    },
    /** Per frame: culls flames, assigns lights, emits embers, steps particles, uploads instances. time in s (optional). */
    update(dt, time) {
      if (disposed) return;
      dt = typeof dt === 'number' && dt > 0 && Number.isFinite(dt) ? Math.min(dt, 0.1) : 0;
      clock = typeof time === 'number' && Number.isFinite(time) ? time : clock + dt;
      flameMaterial.uniforms.uTime.value = clock;

      camera.updateMatrixWorld();
      projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projScreen);
      camPos.setFromMatrixPosition(camera.matrixWorld); cam[0] = camPos.x; cam[1] = camPos.y; cam[2] = camPos.z;

      // Flames: frustum check on the bounds, draw up to the tier's limit.
      const list = flames.list, m = flameMesh.instanceMatrix.array;
      drawnFlames = 0;
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        r.visible = false; r.lit = false;
        if (r.intensity <= 0 || r.size <= 0 || drawnFlames >= limits.flames) continue;
        const radius = flameBounds(r, center);
        sphere.center.set(center[0], center[1], center[2]); sphere.radius = radius * cullMargin + 0.05;
        if (!frustum.intersectsSphere(sphere)) continue;
        r.visible = true; r.slot = drawnFlames;
        const o = drawnFlames * 16, s = r.size;
        m[o] = s; m[o + 1] = 0; m[o + 2] = 0; m[o + 3] = 0; m[o + 4] = 0; m[o + 5] = s; m[o + 6] = 0; m[o + 7] = 0;
        m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = s; m[o + 11] = 0;
        m[o + 12] = r.position[0] + r.normal[0] * s * 0.1; m[o + 13] = r.position[1]; m[o + 14] = r.position[2] + r.normal[2] * s * 0.1; m[o + 15] = 1;
        const p = drawnFlames * 4;
        flameParams[p] = r.intensity; flameParams[p + 1] = r.seed; flameParams[p + 2] = 1; flameParams[p + 3] = FLAME_ASPECT;
        drawnFlames++;
        // Embers rise from visible flames.
        r.emit = Math.min(r.emit + limits.embersPerFlame * r.intensity * Math.max(0.1, r.size) * dt, 8);
        while (r.emit >= 1) {
          r.emit -= 1;
          emit(PARTICLE_KIND.ember, r.position[0] + (random() - 0.5) * s * 0.5, r.position[1] + s * (0.3 + random() * 0.8), r.position[2] + (random() - 0.5) * s * 0.5,
            0, 1, 0, 0.6 + s, 0.6, 1.4, 0.015 + s * 0.02);
        }
      }
      flameMesh.count = drawnFlames;
      flameMesh.instanceMatrix.needsUpdate = true; flameParamAttr.needsUpdate = true;

      // Lights: the brightest/nearest visible flames get the real lights; their shader halo is switched off.
      activeLights = selectLights(list, Math.min(limits.lights, lights.length), cam, lightIndex, lightScore);
      for (let k = 0; k < lights.length; k++) {
        const l = lights[k];
        if (k >= activeLights) { l.intensity = 0; continue; }
        const r = list[lightIndex[k]];
        r.lit = true; flameParams[r.slot * 4 + 2] = 0;
        const flicker = 0.85 + 0.15 * Math.sin(clock * 12 + r.seed * 20) * Math.sin(clock * 7.7 + r.seed * 5);
        l.position.set(r.position[0] + r.normal[0] * r.size * 0.3, r.position[1] + r.size * 0.6, r.position[2] + r.normal[2] * r.size * 0.3);
        l.intensity = lightIntensity * r.intensity * Math.max(0.2, r.size) * flicker;
        l.distance = 3 + r.size * 6;
      }

      // Particles: step, then pack the live ones into instances 0..n-1.
      pool.step(dt);
      const pm = particleMesh.instanceMatrix.array, { pos, age, life, size, kind, alive, seed: pSeed } = pool;
      let n = 0;
      for (let i = 0; i < pool.limit; i++) {
        if (!alive[i]) continue;
        const f = age[i] / life[i], s = size[i], o = n * 16, k = i * 3;
        pm[o] = s; pm[o + 1] = 0; pm[o + 2] = 0; pm[o + 3] = 0; pm[o + 4] = 0; pm[o + 5] = s; pm[o + 6] = 0; pm[o + 7] = 0;
        pm[o + 8] = 0; pm[o + 9] = 0; pm[o + 10] = s; pm[o + 11] = 0; pm[o + 12] = pos[k]; pm[o + 13] = pos[k + 1]; pm[o + 14] = pos[k + 2]; pm[o + 15] = 1;
        const q = n * 4, t = kind[i];
        pData[q] = t === PARTICLE_KIND.puff ? 1 - f : 1 - f * 0.8;
        pData[q + 1] = t === PARTICLE_KIND.puff ? 0.8 * (1 - f) * (1 - f) : Math.min(1, (1 - f) * 3) * Math.min(1, age[i] * 20 + 0.2);
        pData[q + 2] = t; pData[q + 3] = pSeed[i];
        n++;
      }
      particleMesh.count = n;
      particleMesh.instanceMatrix.needsUpdate = true; pDataAttr.needsUpdate = true;
    },
    /** Counts for HUDs and budgets (allocates a small object). drawCalls is per view: stereo XR without multiview doubles it. */
    stats() {
      const ps = pool.stats();
      return {
        quality: limits.quality, octaves: limits.octaves,
        drawCalls: (flameMesh.count > 0) + (particleMesh.count > 0) + (scorchMesh.count > 0),
        instances: { flames: flameMesh.count, particles: particleMesh.count, scorches: scorchMesh.count, total: flameMesh.count + particleMesh.count + scorchMesh.count },
        flames: { registered: flames.count, drawn: drawnFlames, drawLimit: limits.flames, capacity: caps.flames, rejected: flames.rejected },
        particles: { live: ps.live, limit: ps.limit, capacity: ps.capacity, spawned: ps.spawned, recycled: ps.recycled, dropped: ps.dropped },
        lights: { active: activeLights, limit: Math.min(limits.lights, lights.length), capacity: lights.length },
        scorches: { live: scorches.count, limit: scorches.limit, capacity: caps.scorches, replaced: scorches.replaced },
        budget: { ...caps },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(flameMesh, particleMesh, scorchMesh, ...lights);
      for (const l of lights) l.dispose?.();
      for (const mesh of [flameMesh, particleMesh, scorchMesh]) { mesh.count = 0; mesh.geometry.dispose(); mesh.material.dispose(); mesh.dispose?.(); }
      flames.clear(); pool.clear(); scorches.clear();
    },
  };
  return api;
}
