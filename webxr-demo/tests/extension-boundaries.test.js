// Module boundaries of GameSystems/extensions: each extension's runtime files import only their own files, the
// extensions listed for it in DEPS and the packages listed in PACKAGES. That is what keeps avatar usable without grasp,
// bottles or a particular character system (it gets the character through the provider it is handed, humanoid
// contract.js), and every character provider replaceable. Tooling (tools/ folders, *.mjs scripts run in node) may reach
// further and is not checked here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';

const root = fileURLToPath(new URL('../../extensions/', import.meta.url));

/** Extensions an extension's runtime may import (its public API or a named file). Every extension folder is listed. */
const DEPS = {
  ai: [],
  acoustics: ['host'], adapters: ['host'], alarms: ['host'], avatar: ['humanoid'], bottles: ['host'], cameras: ['host'],
  'character-cc': ['humanoid'], 'character-vrm': ['humanoid'], checkpoint: ['host', 'supply'], coatings: ['host'],
  electricity: ['host'], flow: ['host'], gore: ['host', 'humanoid'], grasp: [], hitreact: ['humanoid'], host: [], humanoid: [], materials: ['host'], mechanics: ['host'],
  missions: ['host'], 'pool-interest': ['host', 'pools'], pools: ['host', 'thermal'], smoke: ['host'], sprinklers: ['host'],
  supply: ['host'], thermal: ['host'], tools: ['host'], vehicle: ['host'], workshop: [],
};
/** Packages beyond three (three and three/addons/* are allowed everywhere except PURE). */
const PACKAGES = { adapters: ['cannon-es'], 'character-vrm': ['@pixiv/three-vrm'] };
/** Extensions that must stay engine-free: no three.js import at all. */
const PURE = ['humanoid', 'grasp', 'host', 'ai', 'hitreact'];

const extensions = readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();

function runtimeFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!['tools', 'node_modules', 'assets'].includes(e.name)) runtimeFiles(p, out); }
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** Import specifiers (static, re-export, dynamic) of a source file, comments removed. */
export function specifiers(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const out = [];
  for (const m of code.matchAll(/(?:^\s*import\s+(?:[\w*{}\s,$]+\s+from\s+)?|^\s*export\s+[\w*{}\s,$]+\s+from\s+|\bimport\s*\(\s*)['"]([^'"]+)['"]/gm)) out.push(m[1]);
  return out;
}

test('every extension folder has a declared dependency list', () => {
  assert.deepEqual(extensions, Object.keys(DEPS).sort(), 'add a new extension to DEPS (and PACKAGES) in this test');
});

test('specifiers() finds static, re-export and dynamic imports and skips comments', () => {
  const src = `import * as THREE from 'three';\nimport './side.js';\nexport { a } from '../host/index.js';\n// import x from '../grasp/index.js';\n/* import y from 'z'; */\nconst m = () => import('./loader.js');`;
  assert.deepEqual(specifiers(src), ['three', './side.js', '../host/index.js', './loader.js']);
});

for (const name of extensions) {
  test(`${name}: runtime imports stay inside its declared boundaries`, () => {
    const home = resolve(root, name), allowed = new Set(DEPS[name] ?? []), packages = new Set(PACKAGES[name] ?? []);
    const problems = [];
    for (const file of runtimeFiles(home)) {
      const where = relative(root, file).split(sep).join('/');
      for (const spec of specifiers(readFileSync(file, 'utf8'))) {
        if (spec.startsWith('.')) {
          const target = resolve(dirname(file), spec), rel = relative(root, target).split(sep);
          if (rel[0] === '..') { problems.push(`${where}: ${spec} leaves extensions/`); continue; }
          if (rel[0] !== name && !allowed.has(rel[0])) problems.push(`${where}: ${spec} reaches into ${rel[0]} (not in DEPS.${name})`);
          if (rel[0] === name && relative(home, target).split(sep)[0] === 'tools') problems.push(`${where}: ${spec} imports tooling at runtime`);
        } else if (spec === 'three' || spec.startsWith('three/addons/')) {
          if (PURE.includes(name)) problems.push(`${where}: ${spec} (${name} must stay engine-free)`);
        } else if (spec.startsWith('node:')) problems.push(`${where}: ${spec} is node-only (runtime runs in the browser)`);
        else if (!packages.has(spec)) problems.push(`${where}: package ${spec} (not in PACKAGES.${name})`);
      }
    }
    assert.deepEqual(problems, []);
  });
}

test('avatar and grasp never import a character system; character systems never import avatar', () => {
  for (const [from, banned] of [['avatar', ['character-cc', 'character-vrm', 'grasp', 'bottles']], ['grasp', ['avatar', 'character-cc', 'character-vrm']],
    ['character-cc', ['avatar', 'grasp', 'character-vrm']], ['character-vrm', ['avatar', 'grasp', 'character-cc']]]) {
    for (const b of banned) assert.ok(!DEPS[from].includes(b), `${from} must not depend on ${b}`);
  }
});
