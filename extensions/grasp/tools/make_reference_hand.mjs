#!/usr/bin/env node
// Writes ../reference_hand.json: the rest hand of the reference character the baked grasps were fitted on (the
// CharacterCreator male body of the Contracts character plugin, MIT, CharacterCreatorXR fork; joint heads from its test
// fixture packages/character-plugin/tests/fixtures/rest_heads.json, prepared by the avatar extension's prepareRig), in the shape
// closure.handGeometry() reads, plus the world scale at which its hand length is REFERENCE_HAND.length (the grasp lab's
// player scale). Lets grasp tools and apps (Grasp Studio, tests) use the reference hand without the plugin.
//   CONTRACTS_DIR=<path> node tools/make_reference_hand.mjs      (default: ../../../NightfallContractsWebXR-interaction)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { handGeometry, REFERENCE_HAND } from '../closure.js';

const here = dirname(fileURLToPath(import.meta.url));
const contracts = resolve(process.env.CONTRACTS_DIR || resolve(here, '../../../../NightfallContractsWebXR-interaction'));
const plugin = resolve(contracts, 'packages/character-plugin');
const { prepareRig } = await import(pathToFileURL(resolve(here, '../../avatar/rigdata.js')).href);
const heads = JSON.parse(readFileSync(resolve(plugin, 'tests/fixtures/rest_heads.json'), 'utf8')).heads;
const rig = prepareRig(heads);
const r6 = v => Math.round(v * 1e6) / 1e6, v3 = v => v.map(r6);
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const sides = {};
for (const side of ['left', 'right']) {
  const h = rig.hands[side];
  sides[side] = { side, frame: { F: v3(h.frame.F), D: v3(h.frame.D), R: v3(h.frame.R) }, wrist: v3(rig.H[`${side}Hand`]),
    fingers: Object.fromEntries(FINGERS.map(f => [f, { pts: h.fingers[f].pts.map(v3), len: h.fingers[f].len.map(r6), rest: { yaw: r6(h.fingers[f].rest.yaw) } }])) };
}
const length = handGeometry(sides.left).length;
const out = { schema: 'gamesystems.reference-hand.v1',
  source: 'CharacterCreator male rest pose (Contracts character plugin, MIT; tests/fixtures/rest_heads.json via rigdata.prepareRig); tools/make_reference_hand.mjs',
  scale: r6(REFERENCE_HAND.length / length), restLength: r6(length), hands: sides };
writeFileSync(resolve(here, '../reference_hand.json'), JSON.stringify(out) + '\n');
console.log(`reference_hand.json: rest hand length ${length.toFixed(4)} m, scale ${out.scale} -> ${REFERENCE_HAND.length} m`);
