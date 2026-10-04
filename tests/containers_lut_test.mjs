// node tests/containers_lut_test.mjs  (run containers_lut_test.py first: writes out/containers_lut_cases.json)
import fs from 'node:fs';
import { makeLut } from '../shaders/three/liquid_lut_v2.js';
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const cases = JSON.parse(fs.readFileSync(root + 'tests/out/containers_lut_cases.json'));
let worst = 0, worstF = 0, n = 0, bad = 0;
for (const [name, c] of Object.entries(cases)) {
  const lut = makeLut(fs.readFileSync(root + c.file, 'utf8'));
  for (let i = 0; i < c.up.length; i++) {
    const up = { x: c.up[i][0], y: c.up[i][1], z: c.up[i][2] };
    worst = Math.max(worst, Math.abs(lut.offset(up, c.fill[i]) - c.d[i]));
    worstF = Math.max(worstF, Math.abs(lut.fillAt(up, c.d_probe[i]) - c.fill_at_expected[i]));
    if (c.spill) { const s = lut.spill(up, c.fill[i]); if (s.spilled !== c.spill[i][0] || Math.abs(s.fill - c.spill[i][1]) > 1e-4) bad++; }
    n++;
  }
}
const t0 = performance.now(); const lut = makeLut(fs.readFileSync(root + 'export/container_tank.liquid.json', 'utf8'));
const t1 = performance.now(); let acc = 0; const N = 200000;
for (let i = 0; i < N; i++) acc += lut.offset({ x: Math.sin(i * 0.37), y: Math.cos(i * 0.11), z: 0.3 }, (i % 100) / 100);
const t2 = performance.now();
console.log(`JS cases=${n} max|d err|=${worst.toExponential(2)} m  max|fill_at err|=${worstF.toExponential(2)}  spill mismatches=${bad}  decode=${(t1 - t0).toFixed(1)}ms  offset=${((t2 - t1) / N * 1000).toFixed(2)}us/call`);
process.exit(worst < 2e-5 && worstF < 2e-3 && bad === 0 ? 0 : 1);
