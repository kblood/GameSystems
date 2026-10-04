# Native (LLVM via numba) reference for the same MLS-MPM P2G/G2P kernel as mpm_core.mjs, to estimate the
# JS -> WASM -> native gap on this machine.  python native_ref_numba.py
# Same scene as the JS probe: 60k water particles (8 per 4 mm cell) settling in a box, single thread, float32.
import time, numpy as np, numba as nb

@nb.njit(fastmath=True, cache=False)
def step(px, v, C, J, gm, gv, active, n, nx, ny, nz, dx, dt, K, pmass, pvol, g):
    w = np.empty((3, 3), np.float32); u = np.zeros(3, np.float32); B = np.zeros((3, 3), np.float32); A = np.zeros((3, 3), np.float32)
    inv = 1.0 / dx; Q = -dt * pvol * 4 * inv * inv; sxy = nx * ny; nA = 0
    for p in range(n):
        gxp = px[p, 0] * inv; gyp = px[p, 1] * inv; gzp = px[p, 2] * inv
        bx = int(np.floor(gxp - 0.5)); by = int(np.floor(gyp - 0.5)); bz = int(np.floor(gzp - 0.5))
        f0 = gxp - bx; f1 = gyp - by; f2 = gzp - bz
        w[0, 0] = 0.5 * (1.5 - f0) ** 2; w[0, 1] = 0.75 - (f0 - 1) ** 2; w[0, 2] = 0.5 * (f0 - 0.5) ** 2
        w[1, 0] = 0.5 * (1.5 - f1) ** 2; w[1, 1] = 0.75 - (f1 - 1) ** 2; w[1, 2] = 0.5 * (f1 - 0.5) ** 2
        w[2, 0] = 0.5 * (1.5 - f2) ** 2; w[2, 1] = 0.75 - (f2 - 1) ** 2; w[2, 2] = 0.5 * (f2 - 0.5) ** 2
        j = min(max(J[p], 0.5), 1.15); J[p] = j
        pr = K * (1 - j)
        for a in range(3):
            for b in range(3): A[a, b] = pmass * C[p, a, b]
        for d in range(3): A[d, d] += Q * (-pr)
        for k in range(3):
            dz = (k - f2) * dx
            for jj in range(3):
                dy = (jj - f1) * dx; wyz = w[2, k] * w[1, jj]
                idb = bx + nx * (by + jj) + sxy * (bz + k)
                for i in range(3):
                    ww = wyz * w[0, i]; ddx = (i - f0) * dx; idx = idb + i
                    if gm[idx] == 0: active[nA] = idx; nA += 1
                    gm[idx] += ww * pmass
                    for d in range(3):
                        gv[idx, d] += ww * (pmass * v[p, d] + A[d, 0] * ddx + A[d, 1] * dy + A[d, 2] * dz)
    for a in range(nA):
        idx = active[a]; im = 1.0 / gm[idx]
        gv[idx, 0] *= im; gv[idx, 1] = gv[idx, 1] * im + g * dt; gv[idx, 2] *= im
        y = (idx // nx) % ny
        if y < 3 and gv[idx, 1] < 0: gv[idx, 1] = 0
    i4 = 4 * inv * inv
    for p in range(n):
        gxp = px[p, 0] * inv; gyp = px[p, 1] * inv; gzp = px[p, 2] * inv
        bx = int(np.floor(gxp - 0.5)); by = int(np.floor(gyp - 0.5)); bz = int(np.floor(gzp - 0.5))
        f0 = gxp - bx; f1 = gyp - by; f2 = gzp - bz
        w[0, 0] = 0.5 * (1.5 - f0) ** 2; w[0, 1] = 0.75 - (f0 - 1) ** 2; w[0, 2] = 0.5 * (f0 - 0.5) ** 2
        w[1, 0] = 0.5 * (1.5 - f1) ** 2; w[1, 1] = 0.75 - (f1 - 1) ** 2; w[1, 2] = 0.5 * (f1 - 0.5) ** 2
        w[2, 0] = 0.5 * (1.5 - f2) ** 2; w[2, 1] = 0.75 - (f2 - 1) ** 2; w[2, 2] = 0.5 * (f2 - 0.5) ** 2
        u[:] = 0; B[:, :] = 0
        for k in range(3):
            dz = (k - f2) * dx
            for jj in range(3):
                dy = (jj - f1) * dx; wyz = w[2, k] * w[1, jj]
                idb = bx + nx * (by + jj) + sxy * (bz + k)
                for i in range(3):
                    ww = wyz * w[0, i]; ddx = (i - f0) * dx; idx = idb + i
                    for d in range(3):
                        wv = ww * gv[idx, d]; u[d] += wv
                        B[d, 0] += wv * ddx; B[d, 1] += wv * dy; B[d, 2] += wv * dz
        for a in range(3):
            for b in range(3): C[p, a, b] = B[a, b] * i4
        J[p] *= 1 + dt * (C[p, 0, 0] + C[p, 1, 1] + C[p, 2, 2])
        for d in range(3):
            v[p, d] = u[d]; px[p, d] = min(max(px[p, d] + dt * u[d], 2 * dx), 0.28)
    for a in range(nA):
        idx = active[a]; gm[idx] = 0; gv[idx, 0] = 0; gv[idx, 1] = 0; gv[idx, 2] = 0
    return nA

dx = 0.004; nx, ny, nz = 76, 116, 41; N = nx * ny * nz
s = dx / 2; xs = np.arange(0.01 + s / 2, 0.18, s); ys = np.arange(0.03 + s / 2, 0.055, s); zs = np.arange(0.02 + s / 2, 0.14, s)
P = np.stack(np.meshgrid(xs, ys, zs, indexing='ij'), -1).reshape(-1, 3)
P = P[np.lexsort((P[:, 0], P[:, 1], P[:, 2]))].astype(np.float32)   # x fastest, like the JS block
n = len(P); v = np.zeros_like(P); C = np.zeros((n, 3, 3), np.float32); J = np.ones(n, np.float32)
gm = np.zeros(N, np.float32); gv = np.zeros((N, 3), np.float32); active = np.zeros(N, np.int32)
rho, c = 1000.0, 4.0; pvol = s ** 3
args = (nx, ny, nz, np.float32(dx), np.float32(3e-4), np.float32(rho * c * c), np.float32(pvol * rho), np.float32(pvol), np.float32(-9.81))
for _ in range(30): step(P, v, C, J, gm, gv, active, n, *args)
t = time.perf_counter(); R = 50
for _ in range(R): step(P, v, C, J, gm, gv, active, n, *args)
ms = (time.perf_counter() - t) / R * 1000
print(f"numba native, single thread: n={n} ms/step={ms:.2f} ns/particle={ms * 1e6 / n:.0f}")
