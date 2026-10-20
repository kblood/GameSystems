// GameSystems gore extension: blood and chunk effects, shared by every zombie of a gore world. Four draw calls in total,
// CPU simulated in fixed-size pools (Quest friendly):
//   particles  blood spray (THREE.Points); drops that reach the floor (or a wall plane) leave a splat
//   splats     floor / wall blood decals (one InstancedMesh, oldest replaced first, `decals.max`)
//   wounds     bullet wounds that follow a bone (one InstancedMesh, `decals.wounds` per zombie)
//   chunks     small meat bits thrown by severs (one InstancedMesh, ballistic, settle on the floor)
// API: spray(point, dir, { count, speed, spread, size }), splat(point, normal, size), wound(bone, worldPoint, worldNormal,
// owner, region), clearWounds(owner, region?), chunks(point, dir, count), emitter(getPoint, getDir, seconds, rate),
// update(dt), setConfig(cfg), stats(), dispose(). Floor: y = floorY; walls: planes { normal: [x,y,z], d } (n·p + d = 0).
import { dotTexture, splatTexture } from './materials.js';

export function createGoreEffects(THREE, scene, { config, floorY = 0, walls = [] } = {}) {
  let cfg = config;
  const maxP = Math.max(16, cfg.particles.max), maxS = Math.max(1, cfg.decals.max || 1), maxW = 256, maxC = 96;
  const group = new THREE.Group(); group.name = 'gore-effects'; scene.add(group);
  const blood = new THREE.Color(cfg.blood.color);

  // ---- particles
  const pPos = new Float32Array(maxP * 3), pVel = new Float32Array(maxP * 3), pLife = new Float32Array(maxP);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setDrawRange(0, 0);
  const pMat = new THREE.PointsMaterial({ color: blood, size: 0.022, map: dotTexture(THREE), transparent: true, alphaTest: 0.3, depthWrite: false });
  const points = new THREE.Points(pGeo, pMat); points.frustumCulled = false; points.name = 'gore-blood'; group.add(points);
  let pCount = 0;

  // ---- splats
  const sTex = splatTexture(THREE);
  const sMat = new THREE.MeshStandardMaterial({ color: blood.clone().multiplyScalar(0.8), alphaMap: sTex, transparent: true, depthWrite: false, roughness: 0.25,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const splats = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), sMat, maxS);
  splats.count = 0; splats.frustumCulled = false; splats.name = 'gore-splats'; group.add(splats);
  let sNext = 0, sUsed = 0;

  // ---- wounds
  const wMat = new THREE.MeshStandardMaterial({ color: 0x2a0303, alphaMap: sTex, transparent: true, depthWrite: false, roughness: 0.3,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const wounds = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), wMat, maxW);
  wounds.count = 0; wounds.frustumCulled = false; wounds.name = 'gore-wounds'; group.add(wounds);
  const woundList = []; // { bone, local: Matrix4, owner, region }

  // ---- chunks
  const cMat = new THREE.MeshStandardMaterial({ color: 0x6a1010, roughness: 0.35 });
  const chunkMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), cMat, maxC);
  chunkMesh.count = 0; chunkMesh.frustumCulled = false; chunkMesh.name = 'gore-chunks'; group.add(chunkMesh);
  const chunkList = []; // { p, v, r, q, spin, life }
  const emitters = [];

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rnd2 = () => rnd() * 2 - 1;

  function splat(point, normal, size = 0.25) {
    if (!cfg.decals.max) return;
    if (normal.y < 0.7 && !cfg.decals.walls) return;
    if (normal.y >= 0.7 && !cfg.decals.floor) return;
    q.setFromUnitVectors(Z, normal);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(Z, rnd() * Math.PI * 2));
    s.set(size, size * (0.7 + 0.5 * rnd()), 1);
    v.copy(point).addScaledVector(normal, 0.002);
    splats.setMatrixAt(sNext, m4.compose(v, q, s));
    sNext = (sNext + 1) % Math.min(maxS, cfg.decals.max); sUsed = Math.min(Math.min(maxS, cfg.decals.max), sUsed + 1);
    splats.count = sUsed; splats.instanceMatrix.needsUpdate = true;
  }

  function spray(point, dir, { count = 24, speed = 2.2, spread = 0.45, size = 1 } = {}) {
    const n = Math.round(count * cfg.blood.amount);
    for (let i = 0; i < n; i++) {
      const k = pCount < maxP ? pCount++ : Math.floor(rnd() * maxP);
      pPos[3 * k] = point.x; pPos[3 * k + 1] = point.y; pPos[3 * k + 2] = point.z;
      const sp = speed * (0.4 + 0.8 * rnd());
      pVel[3 * k] = (dir.x + rnd2() * spread) * sp; pVel[3 * k + 1] = (dir.y + rnd2() * spread + 0.2) * sp; pVel[3 * k + 2] = (dir.z + rnd2() * spread) * sp;
      pLife[k] = 1.2 + rnd() * 0.6;
    }
    pMat.size = 0.02 * size;
  }

  function wound(bone, point, normal, owner, region, size = 0.045) {
    const perOwner = woundList.filter(w => w.owner === owner);
    if (perOwner.length >= cfg.decals.wounds || !cfg.decals.wounds) {
      if (!perOwner.length) return;
      woundList.splice(woundList.indexOf(perOwner[0]), 1);
    }
    if (woundList.length >= maxW) woundList.shift();
    q.setFromUnitVectors(Z, normal).multiply(new THREE.Quaternion().setFromAxisAngle(Z, rnd() * 6.283));
    s.set(size, size, size);
    v.copy(point).addScaledVector(normal, 0.003);
    bone.updateWorldMatrix(true, false);
    const local = new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(m4.compose(v, q, s));
    woundList.push({ bone, local, owner, region });
  }
  function clearWounds(owner, regions = null) {
    for (let i = woundList.length - 1; i >= 0; i--) if (woundList[i].owner === owner && (!regions || regions.includes(woundList[i].region))) woundList.splice(i, 1);
  }

  function chunks(point, dir, count = 6) {
    const n = Math.round(count * Math.min(1, cfg.blood.amount + 0.2));
    for (let i = 0; i < n; i++) {
      if (chunkList.length >= maxC) chunkList.shift();
      const sp = 1.5 + 2 * rnd();
      chunkList.push({ p: point.clone(), v: new THREE.Vector3(dir.x + rnd2() * 0.6, dir.y + 0.5 + rnd() * 0.6, dir.z + rnd2() * 0.6).multiplyScalar(sp),
        r: 0.008 + 0.014 * rnd(), q: new THREE.Quaternion().setFromAxisAngle(v.set(rnd2(), rnd2(), rnd2()).normalize(), rnd() * 6), spin: rnd2() * 12, life: 6 + rnd() * 4, rest: false });
    }
  }

  /** A bleeding stump: sprays from getPoint() along getDir() for `seconds` (fading), `rate` bursts per second. */
  function emitter(getPoint, getDir, seconds, rate = 14) {
    if (!(seconds > 0) || !(cfg.blood.amount > 0)) return null;
    const e = { getPoint, getDir, t: 0, seconds, rate, acc: 0, alive: true };
    emitters.push(e);
    return e;
  }

  const P = new THREE.Vector3(), D = new THREE.Vector3(), N = new THREE.Vector3();
  function update(dt) {
    dt = Math.min(dt, 0.05);
    // emitters
    for (let i = emitters.length - 1; i >= 0; i--) {
      const e = emitters[i];
      e.t += dt;
      if (!e.alive || e.t >= e.seconds) { emitters.splice(i, 1); continue; }
      e.acc += dt * e.rate * (1 - e.t / e.seconds) * (0.6 + 0.4 * Math.sin(e.t * 18) ** 2);
      while (e.acc >= 1) { e.acc -= 1; e.getPoint(P); e.getDir(D); spray(P, D, { count: 3, speed: 1.4, spread: 0.25 }); }
    }
    // particles
    let w = 0;
    for (let k = 0; k < pCount; k++) {
      pLife[k] -= dt;
      pVel[3 * k + 1] -= 9.81 * dt;
      let x = pPos[3 * k] + pVel[3 * k] * dt, y = pPos[3 * k + 1] + pVel[3 * k + 1] * dt, z = pPos[3 * k + 2] + pVel[3 * k + 2] * dt;
      let dead = pLife[k] <= 0;
      if (!dead && y <= floorY) { if (rnd() < 0.18) splat(P.set(x, floorY, z), N.set(0, 1, 0), 0.06 + 0.12 * rnd()); dead = true; }
      if (!dead) for (const wall of walls) {
        const d = wall.normal[0] * x + wall.normal[1] * y + wall.normal[2] * z + wall.d;
        if (d <= 0) { if (rnd() < 0.25) splat(P.set(x, y, z).addScaledVector(N.fromArray(wall.normal), -d), N, 0.05 + 0.1 * rnd()); dead = true; break; }
      }
      if (dead) continue;
      pPos[3 * w] = x; pPos[3 * w + 1] = y; pPos[3 * w + 2] = z;
      pVel[3 * w] = pVel[3 * k]; pVel[3 * w + 1] = pVel[3 * k + 1]; pVel[3 * w + 2] = pVel[3 * k + 2]; pLife[w] = pLife[k];
      w++;
    }
    pCount = w;
    pGeo.setDrawRange(0, pCount); pGeo.attributes.position.needsUpdate = true;
    points.visible = pCount > 0;
    // wounds
    for (let i = 0; i < woundList.length; i++) {
      const wd = woundList[i];
      wounds.setMatrixAt(i, m4.multiplyMatrices(wd.bone.matrixWorld, wd.local));
    }
    wounds.count = woundList.length; wounds.instanceMatrix.needsUpdate = true; wounds.visible = woundList.length > 0;
    // chunks
    for (let i = chunkList.length - 1; i >= 0; i--) {
      const c = chunkList[i];
      c.life -= dt;
      if (c.life <= 0) { chunkList.splice(i, 1); continue; }
      if (!c.rest) {
        c.v.y -= 9.81 * dt; c.p.addScaledVector(c.v, dt);
        c.q.multiply(q.setFromAxisAngle(Z, c.spin * dt));
        if (c.p.y <= floorY + c.r * 0.6) { c.p.y = floorY + c.r * 0.6; if (Math.abs(c.v.y) < 1) { c.rest = true; if (rnd() < 0.5) splat(P.copy(c.p).setY(floorY), N.set(0, 1, 0), 0.05); } c.v.y *= -0.25; c.v.x *= 0.5; c.v.z *= 0.5; }
      }
    }
    chunkList.forEach((c, i) => chunkMesh.setMatrixAt(i, m4.compose(c.p, c.q, s.set(c.r, c.r * 0.7, c.r * 1.2).multiplyScalar(Math.min(1, c.life)))));
    chunkMesh.count = chunkList.length; chunkMesh.instanceMatrix.needsUpdate = true; chunkMesh.visible = chunkList.length > 0;
  }

  return {
    group, spray, splat, wound, clearWounds, chunks, emitter, update,
    setConfig(next) {
      cfg = next;
      blood.set(cfg.blood.color); pMat.color.copy(blood); sMat.color.copy(blood).multiplyScalar(0.8);
      if (sUsed > Math.min(maxS, cfg.decals.max)) { sUsed = Math.min(maxS, cfg.decals.max); splats.count = sUsed; sNext = 0; }
    },
    clear() { pCount = 0; sUsed = 0; sNext = 0; splats.count = 0; woundList.length = 0; chunkList.length = 0; emitters.length = 0; },
    stats: () => ({ particles: pCount, splats: sUsed, wounds: woundList.length, chunks: chunkList.length, emitters: emitters.length, drawCalls: [points, splats, wounds, chunkMesh].filter(o => o.visible && (o.count ?? 1) > 0).length }),
    dispose() {
      scene.remove(group);
      for (const o of [points, splats, wounds, chunkMesh]) { o.geometry.dispose(); o.material.dispose(); }
      sTex.dispose(); pMat.map.dispose();
    },
  };
}
