import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHELVES, BAR_ITEMS } from '../src/lineup.js';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const sourceRoot = resolve(scriptDir, '../..');
const dist = resolve(scriptDir, '../dist/assets');
const catalog = JSON.parse(await readFile(resolve(sourceRoot, 'catalog.json'), 'utf8'));
const byId = new Map(catalog.assets.map(x => [x.id, x]));
const keys = [...SHELVES.flatMap(s => s.items), ...BAR_ITEMS].map(x => x[0]);
const files = new Set(['catalog.json']);
const requiredSidecars = new Set();
for(const file of ['export/vehicles/aster_sedan.glb','export/vehicles/aster_sedan_low.glb','export/vehicles/aster_sedan.vehicle.json']){files.add(file);requiredSidecars.add(file);}
for (const id of keys) {
  const a = byId.get(id);
  if (!a) throw new Error(`Unknown catalog item ${id}`);
  for (const k of ['file', 'shards', 'broken', 'break_info', 'liquid_sidecar']) if (a[k]) files.add(a[k]);
  if (a.liquid_sidecar) requiredSidecars.add(a.liquid_sidecar);
  const stem = a.file.replace(/\.glb$/, '');
  files.add(stem + '.liquid_v2.json');
  files.add(stem + '.liquid.json');
}
for (const row of [...SHELVES.flatMap(s => s.items), ...BAR_ITEMS]) {
  if (!row[1]) continue;
  const stem = `export/designs/${row[1]}`;
  files.add(stem + '.glb'); files.add(stem + '.liquid.json');
}
for (const name of ['glass_shatter_large', 'glass_shatter_small', 'glass_clink_hard', 'plastic_bottle_bounce', 'bullet_hit_glass', 'bullet_hit_plastic', 'liquid_glug', 'liquid_splash_small', 'cork_pop']) {
  files.add(`audio/ogg/${name}_01.ogg`);
}
let count = 0;
for (const rel of files) {
  const from = resolve(sourceRoot, rel);
  try { await readFile(from); } catch (error) {
    if (requiredSidecars.has(rel)) throw new Error(`Missing catalog liquid sidecar: ${rel}`, { cause: error });
    continue;
  }
  const to = resolve(dist, rel);
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
  count++;
}
console.log(`Copied ${count} GameSystems assets to dist/assets`);
