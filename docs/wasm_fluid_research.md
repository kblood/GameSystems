# 3D viscous-liquid simulation (honey, water): requirements, WASM/WebXR feasibility, experiment path

Status: research, 2026-10-04. Companion to `spill_system_research.md` (analytic spill core). No production code changed.
Prototype: `tests/wasm_fluid_research/` (plain JS MLS-MPM, runs in Node and in Chrome; numbers below are measured).

## 0. Verdict (short)

- **A real 3D sim of honey is feasible as a desktop ULTRA experiment, not as a WebXR/Quest feature.** The measured CPU
  prototype runs a honey pour (45 ml, 5 k particles at 4 mm) at 10-30 % of realtime in single-threaded JS. A GPU compute
  port (WebGPU in Chrome, or Godot `RenderingDevice` compute) on the dev PC (RTX 3080 Ti) gets realtime for 20-50 k
  particles. That is enough for a bounded "honey on table edge + bottle" volume at 2-4 mm resolution.
- **No single grid/particle method gives rope coiling cheaply.** A 1-3 mm honey thread needs 0.5-1 mm cells across it,
  which costs 30-60x more than the bulk flow. The right model for threads and coils is a 1D viscous-thread rod
  (Bergou et al. 2010, "Discrete Viscous Threads"). It costs tens of microseconds per thread. Recommended ULTRA design: **MPM bulk
  (mound, sheet over edges, film on bottle, sticking) + DVT rods for strands/coils + analytic system for everything
  else**. The analytic core stays the volume owner when the sim is off.
- **WASM is not the bottleneck to solve.** V8 JS reached roughly native-scalar speed on this kernel. Measured: JS
  ≈ 450 ns per particle per substep, and a numba/LLVM native reference ≈ 280 ns. So WASM SIMD + threads buys about 5-10x
  on CPU, and a GPU buys 50-100x. On Quest the CPU path is too slow (≤ 1-3 k particles at the honey substep count). WebGPU
  inside WebXR on the Quest Browser is still experimental (behind a flag). **Quest/WebXR: not planned.** Keep the analytic system there.
- **Lowest-effort experiment path:** the JS test bed that now exists (physics and parameter work, headless numbers),
  then a WebGPU (WGSL) port of the same kernels in the same viewer (realtime, 50 k+ particles). Port to Godot compute
  only if the look earns it. Details in section 4.

## 1. What "convincing honey" requires

| phenomenon | physics that must be present | resolution / step needed | cheap alternative |
|---|---|---|---|
| mound that stays where it lands, slow spread | high viscosity (μ ≈ 2-10 Pa·s), no-slip floor | dx ≤ 4 mm is enough for a 5-10 mm mound | analytic Huppert spread (already in spill core) |
| sheet over a table edge, running down the side face | viscosity + wall adhesion (no-slip, tension at the contact line) | film is 1-3 mm thick, so it needs 2-3 cells across: **dx 1-2 mm** near the wall (at 4 mm the film is one particle thick and looks sandy; see screenshot notes in section 3) | rivulet/sheet strips (spill core S3) |
| film running slowly down a bottle | same as above, curved wall, Nusselt speed v = ρgh²/3μ ≈ 1-15 mm/s | dx ≤ 1-2 mm and a no-slip wall in the viscous solve; a 4 mm grid overestimates the speed 5-50x | shader film (spill core S5) |
| strands that thin for seconds before breaking | viscosity ≫ surface tension (capillary thinning dr/dt ≈ −0.07 γ/μ) | the thread radius falls from 3 mm to 0.1 mm, so no fixed grid resolves it | DVT rod or tube shader with r(t) |
| **rope coiling / folding** on impact | slender viscous thread, bending + twisting, compressive buckling at the floor | a 1-3 mm thread needs ≥ 4 samples across it, so dx 0.25-0.75 mm *along the whole fall*. Coiling frequency is 10-100 Hz for honey (Ribe, Habibi & Bonn, "Liquid rope coiling", Annu. Rev. Fluid Mech. 2012), so each coil needs dt ≤ 1 ms | **DVT rod** (Bergou 2010): reproduces coiling, folding and breakup with O(n) implicit steps on ~50-200 vertices |
| sticky residue, strings between bottle and lid | adhesion + cohesion (negative pressure) + surface tension | surface tension in MPM/SPH needs a curvature or pairwise cohesion model; not in the prototype | strand tube + decal |

Time-step limits for honey (μ = 5 Pa·s, ρ = 1420):

| dx | explicit viscous limit ρdx²/(6μ) | substeps at 60 Hz (explicit) | CFL limit at 2 m/s fall, c = 1.5 m/s (weakly compressible) |
|---|---|---|---|
| 4 mm | 0.76 ms | 22 | 0.46 ms (36 substeps) |
| 2 mm | 0.19 ms | 88 | 0.23 ms (72) |
| 1 mm | 0.047 ms | 350 | 0.11 ms (145) |
| 0.5 mm | 0.012 ms | 1400 | 0.06 ms (290) |

So any method must have (a) **implicit viscosity** (Batty & Bridson 2008; Takahashi et al. 2015; Weiler et al. 2018)
and (b) either an **incompressible pressure projection** (FLIP/APIC with a Poisson solve; dt then depends only on the
velocity CFL) or a weakly compressible model with many substeps. The prototype uses implicit viscosity with weakly
compressible pressure and needs about 28 substeps per 60 Hz frame at 4 mm, and about 30-36 at 2 mm.

## 2. Techniques for viscous liquids

Particle counts are for **one 60-90 Hz frame budget of about 3-4 ms**. Measured = prototype; the rest are estimates
scaled from the measured JS cost and the cited demos.

| technique | viscous behaviour | realtime precedent | cost driver | colliders | verdict |
|---|---|---|---|---|---|
| **MLS-MPM (APIC)** (Hu et al. 2018; viscoelastic: Ram et al. 2015) | good: honey, viscoelastic, sticking via grid BCs; no neighbour search | WebGPU-Ocean (matsuoka-601): about 100 k particles on an iGPU, 300 k on a mid GPU; `holtsetio/flow` (three.js WebGPURenderer); Zibra Liquids (Unity, MLS-MPM): about 100 k on mobile (Android), not Quest | particles × substeps (P2G + G2P about 1000 flops per particle-substep); implicit viscosity on active nodes | SDF on grid nodes (box, cylinder, convex, baked trimesh SDF); one-way is trivial, two-way via grid momentum exchange | **best fit for the bulk flow**; GPU-friendly (atomics in P2G; WGSL has no float atomics, so use fixed-point i32 like WebGPU-Ocean) |
| SPH / PBF + XSPH viscosity (Macklin & Müller 2013) | XSPH is artificial: honey looks like jelly or slime; real high viscosity needs implicit SPH (Takahashi 2015, Weiler 2018 in SPlisHSPlasH), which costs a CG solve over neighbour lists | PBF paper: 128 k particles in 10 ms on a desktop GPU; many WebGPU SPH demos with 10-100 k | neighbour search (hash grid + sort) every substep | particle boundaries or SDF/volume maps (Bender et al.) | fine for water; for honey only with implicit viscosity, and then heavier than MPM |
| FLIP/APIC + pressure projection (Batty & Bridson 2008 viscous solve) | the reference for buckling and coiling in graphics (Batty 2008, "Variational Stokes" Larionov et al. 2017) | offline; GPU realtime FLIP exists for water, not with implicit viscosity | 2 sparse linear solves (pressure + viscosity) per step; big dt | cut-cell / SDF | best quality per particle, highest complexity (multigrid/PCG on GPU); a phase-2 upgrade of the MPM grid |
| narrow-band / sparse grids (NB-FLIP, SPGrid) | speed-up for big volumes | offline | — | — | not needed: our volume is 20-30 cm wide |
| height field (shallow water / lubrication) | spreading and fingering of a puddle only, no overhangs or ropes | realtime everywhere | grid cells | 2.5D | already planned as a desktop add-on (spill core option a) |
| **discrete viscous threads (Bergou, Audoly, Vouga, Wardetzky, Grinspun 2010)** | coiling, folding, thinning, breakup of a thread | the paper reports 3 orders of magnitude faster than explicit; a 100-vertex rod is a banded O(n) solve, **≈ 10-50 µs per step on CPU** (estimate) | vertices × Newton iterations | contact with floor, table, bottle via SDF; one-way | **the right tool for strands and coils**; render with the existing stream tube shader |
| particles-on-surface / thin film (e.g. lubrication on meshes) | film down bottles, tears/legs | research code, a few realtime shader fakes | mesh-resolution PDE | the mesh itself | shader approximation (spill core S5) is enough |

Rendering options and costs (desktop GPU; Quest costs in brackets):
- **Instanced spheres** (prototype): cheapest; reads as grains below 2 mm spacing. 1 draw; 0.1-0.5 ms for 50 k.
- **Screen-space fluid** (depth splat + bilateral blur + normals; NVIDIA, van der Laan et al. 2009, used by WebGPU-Ocean):
  the best look per ms. About 0.5-1 ms per eye on desktop [2-3 ms per eye on Quest]. Needs a custom render pass:
  `CompositorEffect` (Forward+/Mobile) in Godot, a render target chain in three.js.
- **Marching cubes on the MPM grid** (density → mesh, GPU): stable surface, good for a frozen hand-off mesh; 1-2 ms for
  a 64³ block. Godot Compatibility/WebGL has no compute, so it would be CPU only there.
- **Ray-marched particles / SDF splats**: expensive per pixel; not worth it.

## 3. Prototype (built, measured)

`tests/wasm_fluid_research/`:
- `mpm_core.mjs`: 3D MLS-MPM. It has a quadratic B-spline, APIC, weakly compressible J-pressure and a cohesion clamp.
  Viscosity is **implicit on the grid** (Jacobi on `(I − dt·μ/ρ·∇²)v = v*`, sweeps adapt to α), with empty neighbours
  as the free surface and solid neighbours as **no-slip walls**. Static SDF colliders (plane, rounded box, rounded
  cylinder) are baked once onto the nodes. Wall adhesion clamps slow separating velocity, and a wall shear damping
  term is included. A nozzle emitter, outflow removal and an exact volume ledger are included. The code is "C-shaped"
  (flat typed arrays, no allocation per step), so it ports 1:1 to WGSL, GLSL compute, C or Zig.
- `bench.mjs`: `node bench.mjs scaling|scene|fine`. `viewer.html` + `serve.mjs`: `node serve.mjs` (interactive,
  orbit camera, slow-motion if over budget) or `node serve.mjs shot honey 1,2.5,5` (headless Chrome screenshots in `out/`).
- `native_ref_numba.py`: the same P2G/G2P kernel, compiled native (numba/LLVM), as a JS-vs-native reference.

Scene: a jar (r 3 cm, 10 cm tall) stands on a table block 5 cm from the edge. The table top is 24 cm above the floor
(the local volume is 30 × 46 × 16 cm). Honey is poured at 15 ml/s for 3 s from 7 cm above the jar rim, near its
outer edge.

### Measured cost (Ryzen 7 5700G, Node 24, single thread)

Scaling (block of N particles settling on the table; the ms include implicit viscosity for honey):

| liquid | dx | N | ms / substep | ns / particle / substep | substeps per 1/72 s | ms per 72 Hz frame |
|---|---|---|---|---|---|---|
| honey | 4 mm | 4.2 k | 3.1 | 742 | 14 | 44 |
| honey | 4 mm | 16.7 k | 8.5 | 506 | 16 | 132 |
| honey | 4 mm | 46 k | 20.2 | 440 | 16 | 332 |
| honey | 4 mm | 98 k | 44.6 | 454 | 16 | 728 |
| honey | 2 mm | 20 k | 14.0 | 702 | 28 | 393 |
| honey | 2 mm | 100 k | 48.5 | 485 | 31 | 1479 |
| water | 4 mm | 17.8 k | 7.4 | 417 | 39 | 285 |
| water | 4 mm | 99 k | 35.8 | 362 | 40 | 1413 |

Phase split at 4.6 k honey particles: P2G 0.93 ms, implicit viscosity 2.0 ms (11 k active nodes), colliders 0.17 ms,
G2P 0.92 ms per substep. **Native reference** (numba, same kernel, 61 k particles, water): 17.3 ms per substep
(282 ns per particle) against 22 ms in JS. JS is within about 1.3x of scalar native code here. The kernel is
FLOP-bound: about 1000 flops per particle-substep.

Honey scene, dx 4 mm (`node bench.mjs scene`):

| t (s) | particles | substeps per frame | ms per 60 Hz frame | ml on jar | ml on table | ml falling | ml on floor | ml out of volume |
|---|---|---|---|---|---|---|---|---|
| 1 | 1874 | 28 | 35 | 8.8 | 6.0 | 0.2 | 0 | 0 |
| 2 | 3740 | 28 | 86 | 11.7 | 11.4 | 6.8 | 0 | 0.1 |
| 3 | 5347 | 28.5 | 154 | 12.8 | 13.4 | 14.4 | 2.1 | 2.2 |
| 5 | 4623 | 28.6 | 195 | 3.0 | 9.9 | 6.1 | 17.9 | 8.0 |
| 8 | 3545 | 28.1 | 116 | 1.3 | 7.8 | 0.7 | 18.6 | 16.6 |

The volume ledger is exact: 44.99 ml emitted = in sim + out. Water at 4 mm needs 68 substeps per frame (c = 4 m/s).
It runs at about 25 ms per frame for its 570 resident particles, because water leaves the 16 cm volume within
about 0.3 s.

FINE_PLACEHOLDER

What it shows (screenshots `tests/wasm_fluid_research/out/honey_t*.png`):
- **Right:** honey coats the jar and lid and collects as a mound around the jar foot. It goes over the table edge as a
  **sheet stuck to the vertical side face** (adhesion + no-slip). That is the behaviour the analytic system can only
  fake. It then falls in a curtain to the floor and builds a floor puddle.
- **Wrong or missing at 4 mm:**
  - The film on the jar and the table side is one particle thick, so it renders as scattered grains.
  - The film is too fast: the first impact chunk slides down the jar at about 0.9 m/s, while the Nusselt speed is
    centimetres per second. The wall shear is under-resolved.
  - There is no surface tension, so nothing beads up or necks.
  - The stream cannot form a thin thread or coil.
  - The floor puddle spreads too far and partly leaves the volume.
  - The first fix I needed was the no-slip wall term in the viscous solve. Without it, honey slid off the rim like water.
- Before the viscosity was implicit, the explicit limit forced the stiff substep counts in the table of section 1.

## 4. Experiment path (recommended)

Goal: a desktop test bed to try 3D viscous liquid (honey, syrup, oil, water) on a table edge and down a bottle. It must
be visible, measurable and tunable. It feeds the ULTRA tier and the calibration of the analytic system.

Installed on this PC: Node 24, Chrome 154 (WebGPU), three.js r170 (vendored, includes `three.webgpu.js`), puppeteer-core,
Godot 4.7.2 (Forward+ with `RenderingDevice` compute), Python 3.13 with numpy + numba, and an RTX 3080 Ti.
**Not installed:** emscripten, Rust, Zig, clang. A C/WASM build is therefore not possible without a download. Ask
first: emsdk is about 1 GB, Zig is about 50 MB (a single archive that targets both wasm32 and native, so it is the
cheapest way to get a shared core), and rustup + wasm-bindgen is about 300 MB.

| option | effort | realtime capacity on dev PC | iteration speed | ties to the game | verdict |
|---|---|---|---|---|---|
| **A. JS CPU test bed (done)** | 0 (exists) | about 5 k particles at 10-30 % speed | headless numbers in seconds; physics changes are easy | none (standalone) | use **now** for physics, parameters and the ledger |
| **B. WebGPU WGSL port in the same viewer** | **M (about 500-700 lines: 6 kernels + fixed-point P2G + screen-space or instanced render)** | 50-200 k particles realtime at 4 mm; 2 mm honey with 20-50 k is realtime | hot reload in a browser; reuse of WebGPU-Ocean / `flow` structure (check licences before copying code) | three.js side of the library | **next step**: the best look-per-effort for evaluating "is it worth it" |
| C. Godot `RenderingDevice` compute (GLSL) | M-L (same kernels plus RD buffer plumbing, MultiMesh or `CompositorEffect` rendering; Forward+/Mobile only) | same GPU class as B | slower (shader reload, no headless GPU in `--headless`) | runs next to Jolt, the bottles and the spill core | do this **after B proves the look**; the kernels port from WGSL to GLSL almost line for line |
| D. C/Zig core → GDExtension + WASM (shared CPU core) | L (toolchain + bindings both sides + SIMD + threads) | about 5-10x the JS numbers: 3-5 k particles realtime at honey substep counts | slow | both engines, Quest-native possible | **not for experimenting**; only if a CPU ULTRA path is ever needed (it probably is not) |
| E. Offline reference (SPlisHSPlasH implicit viscosity, or Houdini/Blender FLIP) | S to set up (download) | offline | n/a | none | use it to judge "what honey should look like" and to record coil and strand shapes |

What we would learn from A + B:
1. Whether bulk honey on edges and bottles looks better than the analytic sheets and tubes. Evaluate side by side at
   1, 2 and 4 mm.
2. The cost per active spill at playable resolution (target ≤ 2 ms GPU at 2 mm for a 20 × 30 × 16 cm volume).
3. **Calibration data for the analytic core:** the edge pin height `h_pin`, the overflow flux `q'(e)`, the spreading
   law prefactor, the sheet width and speed on vertical faces, and the bottle film speed. Measure these from the sim
   (bench already reports volumes per region over time) and fit the per-liquid constants in `spill_system_research.md` §2.
   This is the cheapest lasting value of the experiment, even if 3D sim never ships.
4. **Recorded shapes:** coil radius/frequency vs fall height and flow rate (from a DVT rod or an offline reference),
   strand thinning curves, and sheet outlines. These are baked into small tables or curve textures that drive the stream
   tube / floor-coil instances in the analytic system.

## 5. ULTRA design if it ships: "honey on a table edge and bottle"

- **Bounded local volume, created on demand:**
  - Created when a viscous stream, or a puddle that is overflowing an edge, is within 1.5 m of the camera and in
    view, and the GPU tier allows it.
  - Size: an AABB of 20-30 × 30-50 × 16-20 cm around the contact. At dx = 2 mm that is a 128 × 192 × 96 node grid
    (sparse: only about 20-30 k nodes are active).
  - At most 1-2 volumes at a time.
- **Particle budget:** 1 ml = 1000 particles at 2 mm (8 per cell), or 125 at 4 mm. A typical honey spill of 30-80 ml
  is therefore 30-80 k particles at 2 mm (desktop GPU only) or 4-10 k at 4 mm.
- **Inflow:** the analytic stream or parcel, or a puddle overflow, that enters the AABB becomes particles at the
  boundary. Its velocity is clamped to ≤ 1 m/s, which reduces substeps. The sub-particle remainder goes to an
  accumulator, as in the prototype emitter, so the ledger is exact.
- **Outflow:**
  - Particles that leave a side become analytic parcels or droplets with their velocity.
  - Particles that leave downward as a thin stream, or are thinner than 2 cells, hand over to a DVT strand or the stream
    tube. They carry their volume.
- **Freeze:**
  - Trigger: no inflow, and the kinetic energy has been below 1e-6 J for 1 s, or the sim has run for 20 s.
  - Each connected cluster on a face becomes an analytic puddle: volume, centroid, and radius from the footprint.
  - The film on a bottle becomes the glass film shader (`wet_top`).
  - The remaining shape becomes a decal, or a marching-cubes mesh baked once.
  - Then the volume is destroyed: zero idle cost.
- **Ownership:** while a volume exists, the spill core holds a "volume-owned" counter instead of puddle entries. The
  invariant Σ containers + flight + droplets + spills + sim volumes + evaporated = const still holds.
- **Tiers:**
  - ULTRA_SIM (desktop GPU): MPM + DVT strands + screen-space surface.
  - ULTRA (default ULTRA, Quest): the analytic system with tubes and recorded coil animations.
  - Lower tiers: as in the spill doc.
- **Rigid bodies:** one-way. Colliders are SDFs of boxes, cylinders and convex hulls, rebuilt only when a body moves
  (per node, in the active band). Two-way coupling (honey pushing a bottle) is not worth it. A bottle that is picked
  up is a moving SDF with its velocity applied as a grid BC.

## 6. WASM and WebXR/Quest (short)

- **WASM features:**
  - SIMD128 ships in all browsers.
  - Relaxed SIMD (FMA, etc.) is on by default in Chrome 114+ and Firefox 145+, and behind a flag in Safari.
  - Threads need `SharedArrayBuffer`, which needs COOP/COEP headers. `serve.mjs` already sends them, and the
    `webxr-test` skill checks `crossOriginIsolated`.
  - Toolchains:
    - Emscripten: `-msimd128 -pthread`, `wasm_simd128.h`.
    - Rust: wasm-bindgen, with `wasm-bindgen-rayon` for threads, which needs nightly + atomics.
    - Zig: one toolchain for both wasm32 and native, so it is the cleanest way to share a core with a GDExtension.
- **Expected gains** (literature and our measurement):
  - Plain WASM is about 1-1.6x JS on particle loops. On this kernel V8 JS is already within 1.3x of scalar native.
  - SIMD gives 1.7-4.5x (TensorFlow.js WASM backend report; a 3D stencil like P2G vectorises worse, so expect ~2x).
  - Threads give 1.8-2.9x on 4 cores (P2G needs coloured or atomic scatter).
  - Net: about 4-8x over our JS numbers. That means **about 2-4 k honey particles per 4 ms frame budget** on a
    desktop CPU, and roughly a third of that on a Quest 3 CPU.
- **Data to the GPU:** a Float32Array view on WASM memory feeds a `BufferAttribute`: zero copy in JS, one
  `bufferSubData`. 12 B × 20 k = 240 KB per frame, well under 0.2 ms.
- **Godot on the web:**
  - GDExtension on the web needs the extensions build and the same cross-origin isolation.
  - The Compatibility (WebGL2) renderer has no compute, so a Godot-web sim would be CPU/WASM only.
  - Native Godot desktop/Quest would use the C core as a GDExtension.
- **WebGPU in WebXR on Quest:**
  - WebGPU exists in Quest Browser (since v32).
  - The WebXR/WebGPU binding (`XRGPUBinding`) is an Editor's Draft. Quest Browser exposes it only as an experimental
    flag (announced for v146).
  - three.js `WebGPURenderer` has no general XR support yet.
  - So GPU compute in a WebXR session is not shippable today.
  - A WebGL2 GPGPU (render-to-texture MPM) is possible but painful (scatter needs point-sprite blending).
- **Quest GPU budget:** the Adreno 740 is shared with stereo rendering at 72-90 Hz. Zibra (MLS-MPM) claims about
  100 k particles on Android phones at low substep counts, but does not support Quest. Our honey needs about 30
  substeps per frame, which leaves **about 2-5 k particles** in a ~2 ms budget, plus 2-3 ms per eye for a screen-space
  surface. **Not worth it; keep the analytic system on Quest/WebXR.**

## 7. Staged plan

| stage | content | size | done when |
|---|---|---|---|
| E0 (done) | JS MLS-MPM test bed, honey/water scene, bench, viewer, native reference | — | numbers in section 3 |
| E1 | test-bed physics: surface tension (pairwise cohesion or CSF on the grid), contact-angle adhesion, a sparse 2 mm run, a second scene "bottle tilted, honey down the outside"; metric outputs fitted to spill core constants | S-M (≈ 300 lines JS) | the fitted `h_pin`, `q'`, sheet speed are written into a table next to spill §2 |
| E2 | WebGPU port (WGSL: clear, P2G fixed-point atomics, grid + Jacobi viscosity + SDF BC, G2P), instanced and screen-space render, same scene and HUD; read back only stats | M (≈ 600 lines) | 50 k honey particles at 2 mm in realtime on the dev PC; side-by-side screenshots vs the analytic look |
| E3 | DVT viscous-thread rod (CPU JS, 50-200 vertices, implicit) for the strand under the edge and the floor coil; coupling: MPM outflow → rod inflow | M (≈ 400 lines) | coiling appears for honey at 20-40 cm fall heights; record coil radius/frequency tables |
| E4 (decision gate) | judge: is MPM bulk + rods visibly better than the analytic system + recorded coils? | — | go / no-go |
| E5 (if go) | Godot port: RD compute kernels (GLSL), SDF from Jolt shapes, handoff to `SpillSystem` (inflow, outflow, freeze), ULTRA_SIM flag | L | ledger closes; 0 cost at rest; ≤ 2 ms GPU per active volume |
| — | shared C/Zig core to WASM + GDExtension, Quest | — | not planned (section 6) |

Risks:
- A weakly compressible honey bounces at impacts if c is too low. A pressure projection (FLIP/APIC + Poisson) would
  fix it at the cost of a solver.
- Films thinner than 2 cells are inherently wrong (speed, grains). A screen-space surface hides the grains but not the
  speed.
- Surface tension in MPM is fiddly.
- GPU float atomics: WGSL has none, so P2G needs fixed-point i32 atomics with care for the range.
- GPU readback for gameplay events has 1-2 frames of latency. Keep gameplay in the analytic ledger.
- Effort creep: E1-E3 are research; set the E4 gate.

## 8. Sources

- Bergou, Audoly, Vouga, Wardetzky, Grinspun, *Discrete Viscous Threads*, SIGGRAPH 2010:
  http://www.cs.columbia.edu/cg/pdfs/171-threads.pdf
- Batty & Bridson, *Accurate Viscous Free Surfaces for Buckling, Coiling, and Rotating Liquids*, SCA 2008:
  https://www.cs.ubc.ca/~rbridson/docs/batty-sca08-viscosity.pdf
- Takahashi et al., *Implicit Formulation for SPH-based Viscous Fluids*, CGF 2015: https://gamma.cs.unc.edu/ViscousSPH/
- Weiler, Koschier, Brand, Bender, *A Physically Consistent Implicit Viscosity Solver for SPH Fluids*, CGF 2018:
  https://animation.rwth-aachen.de/publication/0558/ (in SPlisHSPlasH: https://splishsplash.physics-simulation.org/features/)
- Ram et al., *A Material Point Method for Viscoelastic Fluids, Foams and Sponges*, SCA 2015:
  https://diglib.eg.org/items/cfce487e-f45c-4a4c-b940-23a33a99156a
- Hu et al., *A Moving Least Squares Material Point Method* (MLS-MPM), SIGGRAPH 2018 (Taichi mpm88)
- Macklin & Müller, *Position Based Fluids*, SIGGRAPH 2013:
  https://www.researchgate.net/publication/260398844_Position_Based_Fluids
- Ribe, Habibi, Bonn, *Liquid Rope Coiling*, Annu. Rev. Fluid Mech. 44 (2012)
- WebGPU-Ocean (MLS-MPM + screen-space rendering in WebGPU): https://github.com/matsuoka-601/webgpu-ocean; write-up:
  https://tympanus.net/codrops/2025/02/26/webgpu-fluid-simulations-high-performance-real-time-rendering/
- `holtsetio/flow` (MLS-MPM in three.js WebGPURenderer): https://github.com/holtsetio/flow
- Zibra Liquids (MLS-MPM, mobile/Android, Quest not supported):
  https://80.lv/articles/zibra-liquids-gets-experimental-android-support
- Quest Browser WebGPU (v32) and WebXR/WebGPU experimental flag: https://en.wikipedia.org/wiki/Meta_Quest_Browser,
  https://x.com/rcabanier/status/2047408843244912810; binding spec: https://immersive-web.github.io/WebXR-WebGPU-Binding/;
  three.js status: https://discourse.threejs.org/t/webgpurenderer-vr-support/76048
- WASM SIMD/threads gains: TensorFlow.js WASM backend:
  https://blog.tensorflow.org/2020/09/supercharging-tensorflowjs-webassembly.html; relaxed SIMD status:
  https://platform.uno/blog/state-of-webassembly-2024-2025/
- Godot web export, threads/extensions and COOP/COEP:
  https://docs.godotengine.org/en/latest/tutorials/export/exporting_for_web.html
