// node bench.mjs [scaling|scene|all]   -> numbers for docs/wasm_fluid_research.md
import { MPM, honeyScene, sceneStats, LIQUIDS } from './mpm_core.mjs';
const mode = process.argv[2] || 'all';
const now = () => performance.now();

function scaling() {
  console.log('## scaling: block of N particles settling on the table, ms per substep (single thread JS)');
  console.log('liquid | dx mm | N | active nodes | ms/substep | ns/particle/substep | substeps per 1/72 s | ms per 1/72 s frame');
  for (const [liq, dx] of [['honey', 0.004], ['honey', 0.002], ['water', 0.004]]) {
    for (const N of [5000, 20000, 50000, 100000]) {
      const sim = honeyScene({ dx, liquid: liq, maxParticles: N + 10 }); sim.setEmitter(null);
      const vol = N * sim.pvol, w = 0.17, d = 0.12, h = vol / (w * d);
      sim.addBlock(0.01, 0.262, 0.02, 0.01 + w, 0.262 + h, 0.02 + d);
      sim.n = Math.min(sim.n, N);
      for (let i = 0; i < 20; i++) sim.step(5e-4);              // warm-up + JIT
      let t0 = now(), steps = 0, simT = 0, frames = 0, subTot = 0;
      while (now() - t0 < 1500 && frames < 40) { subTot += sim.advance(1 / 72); frames++; }
      const ms = (now() - t0);
      const perSub = ms / subTot;
      console.log(`${liq} | ${dx * 1000} | ${sim.n} | ${sim.nActive} | ${perSub.toFixed(2)} | ${(perSub * 1e6 / sim.n).toFixed(0)} | ${(subTot / frames).toFixed(1)} | ${(ms / frames).toFixed(1)}`);
    }
  }
}

function scene(liq, dx, seconds, extra = {}) {
  const sim = honeyScene({ dx, liquid: liq, ...extra });
  console.log(`\n## scene: ${liq}, dx ${dx * 1000} mm, pour ${sim.emitter.mlps} ml/s for ${sim.emitter.tEnd} s, nozzle r ${(sim.emitter.r * 1000).toFixed(0)} mm (particle vol ${(sim.pvol * 1e6).toFixed(4)} ml)`);
  console.log('t s | particles | substeps/frame | ms/frame (wall) | ml jar | ml table | ml falling | ml floor | front cm (edge 20) | out ml');
  const fps = 60; let wall = 0, subs = 0, frames = 0, peak = 0;
  for (let f = 1; f <= seconds * fps; f++) {
    const t0 = now(); const s = sim.advance(1 / fps); const dt = now() - t0;
    wall += dt; subs += s; frames++; if (dt > peak) peak = dt;
    if (f % (fps / 2) === 0 && (f % fps === 0 || f < fps * 4)) {
      const st = sceneStats(sim);
      console.log(`${(f / fps).toFixed(1)} | ${st.n} | ${(subs / frames).toFixed(1)} | ${(wall / frames).toFixed(1)} (peak ${peak.toFixed(1)}) | ${st.ml_jar} | ${st.ml_table} | ${st.ml_falling} | ${st.ml_floor} | ${st.frontX_cm} | ${st.out_ml}`);
      wall = 0; subs = 0; frames = 0; peak = 0;
    }
  }
  const total = sim.n * sim.pvol + sim.removedVol, err = (total - sim.emittedVol) * 1e6;
  console.log(`volume ledger: emitted ${(sim.emittedVol * 1e6).toFixed(2)} ml, in sim + out ${(total * 1e6).toFixed(2)} ml (particle volume is exact; J-drift only affects pressure)`);
  return sim;
}

if (mode === 'scaling' || mode === 'all') scaling();
if (mode === 'scene' || mode === 'all') {
  scene('honey', 0.004, 8);
  scene('water', 0.004, 4);
}
if (mode === 'fine') scene('honey', 0.002, 6, { mlps: 15, pourSeconds: 3 });
if (mode === 'thin') scene('honey', 0.002, 6, { mlps: 4, pourSeconds: 4, nozzle: 0.002 });
