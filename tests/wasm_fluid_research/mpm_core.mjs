// Minimal 3D MLS-MPM viscous liquid (research prototype, plain JS, no deps).
// Units: SI (m, s, kg, Pa). Quadratic B-spline, APIC affine C, weakly compressible (J-based) pressure,
// viscosity either explicit (stress mu*(C+C^T), only stable for low mu) or implicit on the grid
// (Jacobi sweeps of (I - dt*mu/rho*Laplacian) v = v*, free surface = Neumann: empty neighbours are skipped).
// Static colliders are SDFs (box, capped vertical cylinder, floor plane) baked once onto the grid nodes.
// Same code runs in Node (bench.mjs) and the browser (viewer.html). Shape of the code is deliberately
// "C-like" (flat typed arrays, no objects in hot loops) so it ports 1:1 to C/Zig/Rust -> WASM or GDExtension.

export const LIQUIDS = {
  //            Pa.s      kg/m3      speed of sound (m/s, artificial)  wall slip damping 1/s   adhesion m/s   tension (fraction of K)
  honey: { mu: 5.0,   rho: 1420, c: 1.5, stick: 1, slipDamp: 60, adhesion: 0.03,  cohesion: 0.10, implicit: true },
  syrup: { mu: 0.15,  rho: 1330, c: 2.0, stick: 1, slipDamp: 15, adhesion: 0.015, cohesion: 0.05, implicit: true },
  oil:   { mu: 0.08,  rho: 915,  c: 2.5, stick: 1, slipDamp: 8,  adhesion: 0.01,  cohesion: 0.03, implicit: true },
  water: { mu: 0.001, rho: 1000, c: 4.0, slipDamp: 1,  adhesion: 0.0,   cohesion: 0.0,  implicit: false },
};

export class MPM {
  constructor(o) {
    const dx = this.dx = o.dx; this.inv = 1 / dx;
    this.nx = Math.ceil(o.size[0] / dx) + 1; this.ny = Math.ceil(o.size[1] / dx) + 1; this.nz = Math.ceil(o.size[2] / dx) + 1;
    this.size = o.size; const N = this.N = this.nx * this.ny * this.nz;
    const L = this.liq = Object.assign({}, LIQUIDS[o.liquid || 'honey'], o.liquidOverride || {});
    this.K = L.rho * L.c * L.c;
    this.pvol = Math.pow(dx * 0.5, 3); this.pmass = this.pvol * L.rho;    // 8 particles per cell
    this.jacobiIters = o.jacobiIters ?? 40; this.gravity = o.gravity ?? -9.81; this.cfl = o.cfl ?? 0.4;
    const M = this.max = o.maxParticles || 200000;
    this.px = new Float32Array(M); this.py = new Float32Array(M); this.pz = new Float32Array(M);
    this.vx = new Float32Array(M); this.vy = new Float32Array(M); this.vz = new Float32Array(M);
    this.C = new Float32Array(M * 9); this.J = new Float32Array(M); this.n = 0;
    this.gm = new Float32Array(N); this.gx = new Float32Array(N); this.gy = new Float32Array(N); this.gz = new Float32Array(N);
    this.tx = new Float32Array(N); this.ty = new Float32Array(N); this.tz = new Float32Array(N);
    this.active = new Int32Array(N); this.nActive = 0;
    this.colliders = o.colliders || [];
    this.sdf = new Float32Array(N); this.nrm = new Float32Array(N * 3);
    this._bakeSdf();
    this.prof = { p2g: 0, gridVisc: 0, collide: 0, g2p: 0, steps: 0 };
    this.vmax = 0; this.removedVol = 0; this.emittedVol = 0; this.time = 0; this._emitAcc = 0; this.emitter = null;
  }

  // ---------- static SDF colliders ----------
  sdfAt(x, y, z) {
    let d = 1e9;
    for (const c of this.colliders) {
      let s;
      if (c.type === 'plane') s = y - c.y;
      else if (c.type === 'box') {
        const qx = Math.abs(x - c.c[0]) - c.h[0], qy = Math.abs(y - c.c[1]) - c.h[1], qz = Math.abs(z - c.c[2]) - c.h[2];
        const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
        s = Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - (c.round || 0);
      } else if (c.type === 'cyl') {
        const r = Math.hypot(x - c.c[0], z - c.c[1]) - c.r, hh = 0.5 * (c.y1 - c.y0), q = Math.abs(y - 0.5 * (c.y0 + c.y1)) - hh;
        s = Math.hypot(Math.max(r, 0), Math.max(q, 0)) + Math.min(Math.max(r, q), 0) - (c.round || 0);
      }
      if (s < d) d = s;
    }
    return d;
  }
  _bakeSdf() {
    const { nx, ny, nz, dx } = this, e = dx * 0.25;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const id = i + nx * (j + ny * k), x = i * dx, y = j * dx, z = k * dx;
      const s = this.sdfAt(x, y, z); this.sdf[id] = s;
      if (s < 3 * dx) {
        let ax = this.sdfAt(x + e, y, z) - this.sdfAt(x - e, y, z), ay = this.sdfAt(x, y + e, z) - this.sdfAt(x, y - e, z), az = this.sdfAt(x, y, z + e) - this.sdfAt(x, y, z - e);
        const l = Math.hypot(ax, ay, az) || 1; this.nrm[id * 3] = ax / l; this.nrm[id * 3 + 1] = ay / l; this.nrm[id * 3 + 2] = az / l;
      }
    }
  }

  // ---------- particles ----------
  add(x, y, z, vx, vy, vz) {
    if (this.n >= this.max) return false;
    const p = this.n++;
    this.px[p] = x; this.py[p] = y; this.pz[p] = z; this.vx[p] = vx; this.vy[p] = vy; this.vz[p] = vz;
    this.C.fill(0, p * 9, p * 9 + 9); this.J[p] = 1; this.emittedVol += this.pvol; return true;
  }
  addBlock(x0, y0, z0, x1, y1, z1, v = [0, 0, 0]) {
    const s = this.dx * 0.5; let r = 1234567;
    const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * s * 0.5;
    for (let z = z0 + s / 2; z < z1; z += s) for (let y = y0 + s / 2; y < y1; y += s) for (let x = x0 + s / 2; x < x1; x += s)
      this.add(x + rnd(), y + rnd(), z + rnd(), v[0], v[1], v[2]);
  }
  // emitter: circular nozzle at pos, direction down, flow rate ml/s, speed m/s, active until tEnd
  setEmitter(e) { this.emitter = e; }
  _emit(dt) {
    const e = this.emitter; if (!e || this.time > e.tEnd) return;
    this._emitAcc += e.mlps * 1e-6 * dt / this.pvol;
    const s = this.dx * 0.5;
    while (this._emitAcc >= 1) {
      this._emitAcc -= 1;
      // place on a jittered disc, offset along the axis by the distance travelled this step
      const a = Math.random() * 2 * Math.PI, rr = e.r * Math.sqrt(Math.random()), h = Math.random() * e.speed * dt;
      this.add(e.pos[0] + rr * Math.cos(a), e.pos[1] - h, e.pos[2] + rr * Math.sin(a), 0, -e.speed, 0);
    }
  }

  // ---------- one substep ----------
  step(dt) {
    const { inv, dx, nx, ny, pmass, pvol, gm, gx, gy, gz, active, C, J } = this;
    const L = this.liq, K = this.K, mu = L.implicit ? 0 : L.mu, minP = -L.cohesion * K;
    const Q = -dt * pvol * 4 * inv * inv;
    const sxy = nx * ny;
    this._emit(dt);
    // clear previously touched nodes
    for (let a = 0; a < this.nActive; a++) { const id = active[a]; gm[id] = 0; gx[id] = 0; gy[id] = 0; gz[id] = 0; }
    let nA = 0;
    const _t0 = performance.now();
    // ---- P2G ----
    const n = this.n, px = this.px, py = this.py, pz = this.pz, vx = this.vx, vy = this.vy, vz = this.vz;
    for (let p = 0; p < n; p++) {
      const gxp = px[p] * inv, gyp = py[p] * inv, gzp = pz[p] * inv;
      const bx = Math.floor(gxp - 0.5), by = Math.floor(gyp - 0.5), bz = Math.floor(gzp - 0.5);
      const fx = gxp - bx, fy = gyp - by, fz = gzp - bz;
      const wx0 = 0.5 * (1.5 - fx) * (1.5 - fx), wx1 = 0.75 - (fx - 1) * (fx - 1), wx2 = 0.5 * (fx - 0.5) * (fx - 0.5);
      const wy0 = 0.5 * (1.5 - fy) * (1.5 - fy), wy1 = 0.75 - (fy - 1) * (fy - 1), wy2 = 0.5 * (fy - 0.5) * (fy - 0.5);
      const wz0 = 0.5 * (1.5 - fz) * (1.5 - fz), wz1 = 0.75 - (fz - 1) * (fz - 1), wz2 = 0.5 * (fz - 0.5) * (fz - 0.5);
      let j = J[p]; if (j < 0.5) j = 0.5; else if (j > 1.15) j = 1.15; J[p] = j;
      let pr = K * (1 - j); if (pr < minP) pr = minP;
      const c = p * 9;
      const c00 = C[c], c01 = C[c + 1], c02 = C[c + 2], c10 = C[c + 3], c11 = C[c + 4], c12 = C[c + 5], c20 = C[c + 6], c21 = C[c + 7], c22 = C[c + 8];
      // sigma = -p I + mu (C + C^T);  A = Q*sigma + m*C
      const a00 = Q * (-pr + 2 * mu * c00) + pmass * c00, a11 = Q * (-pr + 2 * mu * c11) + pmass * c11, a22 = Q * (-pr + 2 * mu * c22) + pmass * c22;
      const s01 = Q * mu * (c01 + c10), s02 = Q * mu * (c02 + c20), s12 = Q * mu * (c12 + c21);
      const a01 = s01 + pmass * c01, a10 = s01 + pmass * c10, a02 = s02 + pmass * c02, a20 = s02 + pmass * c20, a12 = s12 + pmass * c12, a21 = s12 + pmass * c21;
      const mvx = pmass * vx[p], mvy = pmass * vy[p], mvz = pmass * vz[p];
      for (let k = 0; k < 3; k++) {
        const wz = k === 0 ? wz0 : k === 1 ? wz1 : wz2, dz = (k - fz) * dx;
        for (let jj = 0; jj < 3; jj++) {
          const wyz = wz * (jj === 0 ? wy0 : jj === 1 ? wy1 : wy2), dy = (jj - fy) * dx;
          let id = bx + nx * (by + jj) + sxy * (bz + k);
          for (let i = 0; i < 3; i++, id++) {
            const w = wyz * (i === 0 ? wx0 : i === 1 ? wx1 : wx2), ddx = (i - fx) * dx;
            if (gm[id] === 0) active[nA++] = id;
            gm[id] += w * pmass;
            gx[id] += w * (mvx + a00 * ddx + a01 * dy + a02 * dz);
            gy[id] += w * (mvy + a10 * ddx + a11 * dy + a12 * dz);
            gz[id] += w * (mvz + a20 * ddx + a21 * dy + a22 * dz);
          }
        }
      }
    }
    this.nActive = nA; const _t1 = performance.now();
    // ---- grid: momentum -> velocity, gravity ----
    const g = this.gravity * dt;
    for (let a = 0; a < nA; a++) { const id = active[a], im = 1 / gm[id]; gx[id] *= im; gy[id] = gy[id] * im + g; gz[id] *= im; }
    // ---- implicit viscosity (Jacobi), free surface = skip empty neighbours ----
    if (L.implicit && L.mu > 0) this._viscosity(dt);
    const _t2 = performance.now();
    // ---- colliders ----
    const sdf = this.sdf, nrm = this.nrm, half = dx * 0.5, damp = Math.exp(-L.slipDamp * dt), adh = L.adhesion;
    for (let a = 0; a < nA; a++) {
      const id = active[a], s = sdf[id];
      if (s < half) {
        const ax = nrm[id * 3], ay = nrm[id * 3 + 1], az = nrm[id * 3 + 2];
        let vn = gx[id] * ax + gy[id] * ay + gz[id] * az;
        let tx = gx[id] - vn * ax, ty = gy[id] - vn * ay, tz = gz[id] - vn * az;
        if (vn < 0) vn = 0; else if (vn < adh) vn = 0;           // no penetration; adhesion keeps slow separation stuck
        if (s < 0) { tx = 0; ty = 0; tz = 0; vn = Math.max(vn, 0); } // deep inside: no slip
        else { tx *= damp; ty *= damp; tz *= damp; }                 // wall shear (honey creeps, water slides)
        gx[id] = tx + vn * ax; gy[id] = ty + vn * ay; gz[id] = tz + vn * az;
      }
    }
    const _t3 = performance.now();
    // ---- G2P ----
    const sx = this.size[0] - 2 * dx, sy = this.size[1] - 2 * dx, sz = this.size[2] - 2 * dx, lo = 2 * dx, i4 = 4 * inv * inv;
    let vmax2 = 0;
    for (let p = 0; p < this.n; p++) {
      const gxp = px[p] * inv, gyp = py[p] * inv, gzp = pz[p] * inv;
      const bx = Math.floor(gxp - 0.5), by = Math.floor(gyp - 0.5), bz = Math.floor(gzp - 0.5);
      const fx = gxp - bx, fy = gyp - by, fz = gzp - bz;
      const wx0 = 0.5 * (1.5 - fx) * (1.5 - fx), wx1 = 0.75 - (fx - 1) * (fx - 1), wx2 = 0.5 * (fx - 0.5) * (fx - 0.5);
      const wy0 = 0.5 * (1.5 - fy) * (1.5 - fy), wy1 = 0.75 - (fy - 1) * (fy - 1), wy2 = 0.5 * (fy - 0.5) * (fy - 0.5);
      const wz0 = 0.5 * (1.5 - fz) * (1.5 - fz), wz1 = 0.75 - (fz - 1) * (fz - 1), wz2 = 0.5 * (fz - 0.5) * (fz - 0.5);
      let ux = 0, uy = 0, uz = 0, b00 = 0, b01 = 0, b02 = 0, b10 = 0, b11 = 0, b12 = 0, b20 = 0, b21 = 0, b22 = 0;
      for (let k = 0; k < 3; k++) {
        const wz = k === 0 ? wz0 : k === 1 ? wz1 : wz2, dz = (k - fz) * dx;
        for (let jj = 0; jj < 3; jj++) {
          const wyz = wz * (jj === 0 ? wy0 : jj === 1 ? wy1 : wy2), dy = (jj - fy) * dx;
          let id = bx + nx * (by + jj) + sxy * (bz + k);
          for (let i = 0; i < 3; i++, id++) {
            const w = wyz * (i === 0 ? wx0 : i === 1 ? wx1 : wx2), ddx = (i - fx) * dx;
            const wvx = w * gx[id], wvy = w * gy[id], wvz = w * gz[id];
            ux += wvx; uy += wvy; uz += wvz;
            b00 += wvx * ddx; b01 += wvx * dy; b02 += wvx * dz;
            b10 += wvy * ddx; b11 += wvy * dy; b12 += wvy * dz;
            b20 += wvz * ddx; b21 += wvz * dy; b22 += wvz * dz;
          }
        }
      }
      const c = p * 9;
      C[c] = b00 * i4; C[c + 1] = b01 * i4; C[c + 2] = b02 * i4; C[c + 3] = b10 * i4; C[c + 4] = b11 * i4; C[c + 5] = b12 * i4; C[c + 6] = b20 * i4; C[c + 7] = b21 * i4; C[c + 8] = b22 * i4;
      J[p] *= 1 + dt * (C[c] + C[c + 4] + C[c + 8]);
      let x = px[p] + dt * ux, y = py[p] + dt * uy, z = pz[p] + dt * uz;
      // particle-level push-out from colliders (nearest node SDF)
      const nid = Math.round(x * inv) + nx * (Math.round(y * inv) + this.ny * Math.round(z * inv));
      const s = sdf[nid];
      if (s < 0 && nid >= 0 && nid < this.N) {
        const ax = nrm[nid * 3], ay = nrm[nid * 3 + 1], az = nrm[nid * 3 + 2];
        x -= s * ax; y -= s * ay; z -= s * az;
        const vn = ux * ax + uy * ay + uz * az; if (vn < 0) { ux -= vn * ax; uy -= vn * ay; uz -= vn * az; }
      }
      if (x < lo || y < lo || z < lo || x > sx || y > sy || z > sz) { this._remove(p); p--; continue; } // outflow
      px[p] = x; py[p] = y; pz[p] = z; vx[p] = ux; vy[p] = uy; vz[p] = uz;
      const v2 = ux * ux + uy * uy + uz * uz; if (v2 > vmax2) vmax2 = v2;
    }
    this.vmax = Math.sqrt(vmax2); this.time += dt;
    const pf = this.prof; pf.p2g += _t1 - _t0; pf.gridVisc += _t2 - _t1; pf.collide += _t3 - _t2; pf.g2p += performance.now() - _t3; pf.steps++;
  }
  _remove(p) {
    const q = --this.n; this.removedVol += this.pvol;
    if (p === q) return;
    this.px[p] = this.px[q]; this.py[p] = this.py[q]; this.pz[p] = this.pz[q];
    this.vx[p] = this.vx[q]; this.vy[p] = this.vy[q]; this.vz[p] = this.vz[q];
    this.J[p] = this.J[q]; this.C.copyWithin(p * 9, q * 9, q * 9 + 9);
  }
  _viscosity(dt) {
    const { gm, gx, gy, gz, tx, ty, tz, active, nActive: nA, nx, ny } = this;
    const L = this.liq, alpha = dt * L.mu / (L.rho * this.dx * this.dx), sxy = nx * ny;
    const off = [1, -1, nx, -nx, sxy, -sxy];
    const sdf = this.sdf, stick = L.stick ?? 1;
    // keep v* in t*, iterate in g*
    for (let a = 0; a < nA; a++) { const id = active[a]; tx[id] = gx[id]; ty[id] = gy[id]; tz[id] = gz[id]; }
    // Jacobi contraction per sweep is about r = 6a/(1+6a); sweep until the error is below 2 % (capped)
    const r = 6 * alpha / (1 + 6 * alpha), iters = Math.min(this.jacobiIters, Math.max(2, Math.ceil(Math.log(0.02) / Math.log(r))));
    this.lastIters = iters;
    for (let it = 0; it < iters; it++) {
      // Jacobi needs a copy of the previous iterate; reuse a scratch pass over the active list (ping-pong via closure arrays)
      const ox = this._ox || (this._ox = new Float32Array(this.N)), oy = this._oy || (this._oy = new Float32Array(this.N)), oz = this._oz || (this._oz = new Float32Array(this.N));
      for (let a = 0; a < nA; a++) { const id = active[a]; ox[id] = gx[id]; oy[id] = gy[id]; oz[id] = gz[id]; }
      for (let a = 0; a < nA; a++) {
        const id = active[a]; if (sdf[id] < 0) continue;   // nodes inside solids are boundary, not unknowns
        let sx = 0, sy = 0, sz = 0, cnt = 0;
        for (let o = 0; o < 6; o++) {
          const nb = id + off[o];
          if (sdf[nb] < 0) cnt += stick;               // solid neighbour = no-slip wall (v = 0), weighted by stick
          else if (gm[nb] > 0) { sx += ox[nb]; sy += oy[nb]; sz += oz[nb]; cnt++; }   // empty = free surface (skipped)
        }
        const d = 1 / (1 + alpha * cnt);
        gx[id] = (tx[id] + alpha * sx) * d; gy[id] = (ty[id] + alpha * sy) * d; gz[id] = (tz[id] + alpha * sz) * d;
      }
    }
  }

  // adaptive substep for one frame of length frameDt; returns number of substeps
  advance(frameDt, maxSub = 400) {
    let t = 0, sub = 0; const L = this.liq;
    while (t < frameDt - 1e-9 && sub < maxSub) {
      let dt = this.cfl * this.dx / (this.vmax + L.c + 1e-6);
      const em = this.emitter; if (em && this.time < em.tEnd) dt = Math.min(dt, this.cfl * this.dx / (em.speed + L.c));
      if (!L.implicit && L.mu > 0) dt = Math.min(dt, 0.1 * L.rho * this.dx * this.dx / L.mu);
      dt = Math.min(dt, frameDt - t); this.step(dt); t += dt; sub++;
    }
    return sub;
  }
}

// The test scene: a jar (vertical cylinder) standing on a table box near its +x edge, honey poured onto the
// jar's rim from above; it runs down the jar side, spreads on the table, goes over the table edge to the floor.
export function honeyScene(o = {}) {
  const dx = o.dx || 0.004;
  const size = [0.30, 0.46, 0.16];
  const tableTop = 0.26, edgeX = 0.20, floorY = 0.02;
  const colliders = [
    { type: 'plane', y: floorY },
    { type: 'box', c: [(edgeX - 0.05) / 2, tableTop / 2 + 0.06, size[2] / 2], h: [(edgeX + 0.05) / 2 - 0.002, tableTop / 2 - 0.06 - 0.002, size[2]], round: 0.002 },
    { type: 'cyl', c: [0.12, size[2] / 2], r: 0.03, y0: tableTop - 0.01, y1: tableTop + 0.10, round: 0.004 },
  ];
  const sim = new MPM({ dx, size, colliders, liquid: o.liquid || 'honey', maxParticles: o.maxParticles || 400000, jacobiIters: o.jacobiIters });
  sim.setEmitter({ pos: [0.12 + 0.026, size[1] - 0.03, size[2] / 2], r: o.nozzle || Math.max(0.004, dx), speed: o.speed || 0.6, mlps: o.mlps || 15, tEnd: o.pourSeconds || 3 });
  sim.scene = { tableTop, edgeX, floorY, jar: colliders[2] };
  return sim;
}

// classify particles for the evaluation metrics
export function sceneStats(sim) {
  const { tableTop, edgeX, floorY, jar } = sim.scene; const dx = sim.dx;
  let onJar = 0, onTable = 0, falling = 0, onFloor = 0, frontX = 0;
  for (let p = 0; p < sim.n; p++) {
    const x = sim.px[p], y = sim.py[p], z = sim.pz[p];
    const dj = Math.hypot(x - jar.c[0], z - jar.c[1]) - jar.r;
    if (y > tableTop + dx && dj < 3 * dx) onJar++;
    else if (y >= tableTop - dx && x < edgeX + 2 * dx) { onTable++; if (x > frontX) frontX = x; }
    else if (y < floorY + 4 * dx) onFloor++;
    else falling++;
  }
  const ml = sim.pvol * 1e6;
  return { n: sim.n, ml_jar: +(onJar * ml).toFixed(1), ml_table: +(onTable * ml).toFixed(1), ml_falling: +(falling * ml).toFixed(1), ml_floor: +(onFloor * ml).toFixed(1), frontX_cm: +(frontX * 100).toFixed(1), out_ml: +(sim.removedVol * 1e6).toFixed(1) };
}
