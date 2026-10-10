// Hand profile (avatar handprofile.js) and the profile-driven closure (grasp closure.js): a synthetic hand of known
// sizes is measured, overridden and closed on a bottle; a bigger / thicker hand profile must still get contacts without
// going into the item, and the closure must depend on the profile only (extensions plan, "Håndprofil").
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { measureHandProfile, applyHandProfile, rigHandProfile, isHandProfile, HAND_PROFILE_FORMAT, PAD_CONTACT, createCharacterPlugin } from '../src/vendor/extensions/avatar/index.js';
import { handGeometry, closeToContact, gradeGrasp, placePalm, palmAnchor, defaultPose, SEARCH, CATALOG } from '../src/vendor/extensions/grasp/index.js';

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const SEG = { Thumb: ['Metacarpal', 'Proximal', 'Distal'], Index: ['Proximal', 'Intermediate', 'Distal'], Middle: ['Proximal', 'Intermediate', 'Distal'], Ring: ['Proximal', 'Intermediate', 'Distal'], Little: ['Proximal', 'Intermediate', 'Distal'] };
const add = (a, b) => a.map((v, i) => v + b[i]), scl = (a, k) => a.map(v => v * k);
const norm = a => scl(a, 1 / Math.hypot(...a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// Right hand at the origin: x radial (thumb side), y dorsal, z distal (the profile frame = the character frame here).
const PALM = { halfWidth: 0.04, halfThick: 0.015, length: 0.1 }, RADIUS = 0.009, THUMB_RADIUS = 0.011;
const DIGITS = {
  Thumb: { base: [0.025, -0.01, 0.02], dir: norm([0.6, -0.25, 0.75]), len: [0.04, 0.032, 0.028] },
  Index: { base: [0.03, 0, 0.09], dir: [0, 0, 1], len: [0.045, 0.027, 0.022] },
  Middle: { base: [0.01, 0, 0.095], dir: [0, 0, 1], len: [0.048, 0.03, 0.023] },
  Ring: { base: [-0.01, 0, 0.09], dir: [0, 0, 1], len: [0.045, 0.028, 0.022] },
  Little: { base: [-0.03, 0, 0.08], dir: [0, 0, 1], len: [0.036, 0.022, 0.02] },
};
function syntheticHand() {
  const fingers = {};
  for (const f of FINGERS) {
    const d = DIGITS[f], pts = [d.base];
    for (const l of d.len) pts.push(add(pts.at(-1), scl(d.dir, l)));
    fingers[f] = { pts, len: d.len, rest: { yaw: Math.atan2(d.dir[0], d.dir[2]) } };
  }
  const rest = { side: 'right', frame: { R: [1, 0, 0], D: [0, 1, 0], F: [0, 0, 1] }, wrist: [0, 0, 0], fingers, thumbTilt: Math.PI / 3 };
  const points = [];
  // palm: the surface of a box, Hand bone, full weight
  const { halfWidth: hw, halfThick: ht, length: pl } = PALM;
  for (let i = 0; i <= 16; i++) for (let k = 0; k <= 20; k++) {
    const x = -hw + 2 * hw * i / 16, z = pl * k / 20;
    points.push({ p: [x, -ht, z], bone: 'Hand', w: 1 }, { p: [x, ht, z], bone: 'Hand', w: 1 });
  }
  for (let j = 0; j <= 6; j++) for (let k = 0; k <= 20; k++) {
    const y = -ht + 2 * ht * j / 6, z = pl * k / 20;
    points.push({ p: [-hw, y, z], bone: 'Hand', w: 1 }, { p: [hw, y, z], bone: 'Hand', w: 1 });
  }
  // digits: a skin cylinder around every segment
  for (const f of FINGERS) {
    const d = DIGITS[f], r = f === 'Thumb' ? THUMB_RADIUS : RADIUS, u = norm(cross(d.dir, [0, 1, 0]).some(v => Math.abs(v) > 1e-6) ? cross(d.dir, [0, 1, 0]) : [1, 0, 0]), v = cross(d.dir, u);
    fingers[f].pts.slice(0, 3).forEach((a, s) => {
      for (let t = 0; t <= 8; t++) for (let k = 0; k < 16; k++) {
        const c = add(a, scl(d.dir, d.len[s] * t / 8)), ang = 2 * Math.PI * k / 16;
        points.push({ p: add(c, add(scl(u, r * Math.cos(ang)), scl(v, r * Math.sin(ang)))), bone: f + SEG[f][s], w: 1 });
      }
    });
  }
  return { rest, points };
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (tol ${tol})`);

test('hand profile: measured from the skin of a synthetic hand of known sizes', () => {
  const { rest, points } = syntheticHand(), p = measureHandProfile(rest, points);
  assert.ok(isHandProfile(p)); assert.equal(p.format, HAND_PROFILE_FORMAT); assert.equal(p.source, 'measured');
  near(p.palmThickness, 2 * PALM.halfThick, 0.002, 'palm thickness');
  near(p.palmWidth, 2 * PALM.halfWidth, 0.004, 'palm width');
  near(p.knuckle, Math.hypot(...DIGITS.Middle.base), 1e-4, 'wrist -> knuckle');
  near(p.palmCenter[1], -PALM.halfThick, 0.002, 'palm centre on the palmar skin');
  assert.ok(p.palmNormal[1] < -0.95, `palm normal palmar: ${p.palmNormal}`);
  assert.ok(p.palmPatch.length >= 6 && p.palmPatch.length <= 12 && p.palmPatch.every(q => Math.abs(q[1] + PALM.halfThick) < 0.002), 'palm patch on the palmar face');
  for (const f of FINGERS.slice(1)) {
    p.pad[f].forEach((r, s) => near(r, PAD_CONTACT.finger * RADIUS, 0.0012, `${f} pad ${s}`));
    p.girth[f].forEach((r, s) => near(r, RADIUS, 0.0012, `${f} girth ${s}`));
    p.segments[f].slice(0, 2).forEach((l, s) => near(l, DIGITS[f].len[s], 1e-4, `${f} segment ${s}`));
  }
  near(p.pad.Thumb[2], PAD_CONTACT.thumb * THUMB_RADIUS, 0.0015, 'thumb pad');
  assert.ok(p.thumbRoot > 0.006 && p.thumbRoot < 0.02, `thumb root ${p.thumbRoot}`);
  assert.ok(p.thenarPatch.length > 0 && p.thenarPatch.length <= 6, 'thenar points');
  // no skin: the rig-only profile (proportional defaults), same bones
  const rig = rigHandProfile(rest);
  assert.equal(rig.source, 'rig'); assert.deepEqual(rig.bases, p.bases); assert.equal(measureHandProfile(rest, []).source, 'rig');
});

test('hand profile: overrides (fields, per-digit merge, size, girth, thumbRoot, per side)', () => {
  const { rest, points } = syntheticHand(), p = measureHandProfile(rest, points);
  const big = applyHandProfile(p, { size: 1.5 });
  near(big.length, p.length * 1.5, 1e-4, 'size: length'); near(big.palmWidth, p.palmWidth * 1.5, 1e-4, 'size: width');
  near(big.bases.Index[2], p.bases.Index[2] * 1.5, 1e-4, 'size: bases'); near(big.pad.Index[1], p.pad.Index[1] * 1.5, 1e-4, 'size: pads');
  assert.match(big.source, /override/); assert.equal(p.source, 'measured', 'the measured profile is not mutated');
  const thick = applyHandProfile(p, { girth: 1.4 });
  near(thick.pad.Middle[0], p.pad.Middle[0] * 1.4, 1e-4, 'girth: pad'); near(thick.thumbRoot, p.thumbRoot * 1.4, 1e-4, 'girth: thumb root');
  near(thick.length, p.length, 1e-4, 'girth keeps lengths');
  const merged = applyHandProfile(p, { pad: { Index: [0.02, 0.02, 0.02] } });
  assert.deepEqual(merged.pad.Index, [0.02, 0.02, 0.02]); assert.deepEqual(merged.pad.Ring, p.pad.Ring, 'other digits kept');
  const root = applyHandProfile(p, { thumbRoot: p.thumbRoot + 0.005 });
  assert.ok(root.thenarPatch.every((q, i) => Math.abs(q[1] - (p.thenarPatch[i][1] - 0.005)) < 1e-4), 'a thicker thumb root moves the thenar points palmar');
  const sided = applyHandProfile(p, { left: { size: 2 }, right: { palmOffset: -0.003 } });
  near(sided.length, p.length, 1e-4, 'the other side override is ignored'); assert.equal(sided.palmOffset, -0.003);
  assert.equal(applyHandProfile(p, null), p);
});

test('closure: depends on the hand profile only; a bigger and thicker hand gets contacts without penetration', () => {
  const { rest, points } = syntheticHand(), small = measureHandProfile(rest, points);
  const shape = CATALOG.bottle_beer.shape, pose = defaultPose('bottle_beer', 'right');
  for (const [name, profile] of [['measured', small], ['1.3x, 1.4x girth', applyHandProfile(small, { size: 1.3, girth: 1.4 })]]) {
    const hand = handGeometry({ side: 'right' }, { profile });
    assert.equal(hand.profile, profile); near(hand.length, profile.length, 1e-9, `${name}: hand length from the profile`);
    const closed = closeToContact(pose, hand, shape, { search: 'mid' }), g = closed.grade;
    assert.ok(closed.tried === 1 ? g.score >= 24 - 1e-9 : closed.tried > 1, `${name}: the mid tier searches unless the placement grades full`);
    assert.ok(g.penetration <= 0.003, `${name}: penetration ${g.penetration * 1000} mm`);
    assert.ok(g.fingersTouching >= 3, `${name}: ${g.fingersTouching} fingertips touch`);
    assert.ok(g.palmGap > -0.003 && g.palmGap < 0.008, `${name}: palm gap ${g.palmGap * 1000} mm`);
    // the closure for the other hand size does not fit this one: the bigger hand closed with the small profile goes in
    if (profile !== small) {
      const smallClosed = closeToContact(pose, handGeometry({ side: 'right' }, { profile: small }), shape, { search: 'mid' });
      const misfit = gradeGrasp(hand, shape, smallClosed, smallClosed.angles);
      assert.ok(misfit.penetration > g.penetration + 0.002, `the small hand's grasp on the big hand: ${misfit.penetration * 1000} mm inside`);
    }
  }
});

test('closure: placePalm puts the profile palm patch at palmGap from the item; tiers', () => {
  const { rest, points } = syntheticHand(), shape = CATALOG.bottle_beer.shape, pose = defaultPose('bottle_beer', 'right');
  for (const size of [1, 1.5, 0.8]) {
    const hand = handGeometry({ side: 'right' }, { profile: applyHandProfile(measureHandProfile(rest, points), { size }) });
    const placed = placePalm(pose, hand, shape);
    assert.ok(placed.palmGap > 0.001 && placed.palmGap < 0.008, `size ${size}: palm patch ${placed.palmGap * 1000} mm from the bottle`);
    assert.ok(placed.wrist.every(Number.isFinite) && palmAnchor(pose).every(Number.isFinite));
    // unsearched (raw / low) tier: one placement; 'high' tries more than 'mid'
    const low = closeToContact(pose, hand, shape), mid = closeToContact(pose, hand, shape, { search: 'mid' }), high = closeToContact(pose, hand, shape, { search: 'high' });
    assert.ok(low.tried <= 2 && (mid.grade.score >= 24 - 1e-9 || mid.tried > low.tried), `tried ${low.tried} / ${mid.tried} / ${high.tried}`);
    assert.ok(mid.grade.score >= low.grade.score && high.grade.score >= mid.grade.score - 1e-9, 'a search never picks a worse grasp');
    // a given wrist ('high' re-check of a shown wrist) is never searched
    assert.equal(closeToContact(pose, hand, shape, { wrist: low.wrist, quat: low.quat, search: 'high' }).tried, 1);
  }
  assert.ok(Object.isFrozen(SEARCH) && SEARCH.mid && SEARCH.high);
});

test('entity: handProfile option and setHandProfile at runtime bump handProfileVersion and change restHand().profile', async () => {
  const { rest, points } = syntheticHand();
  const measured = measureHandProfile(rest, points);
  // a minimal character: no skin (rig-only profile) is enough for the override / setter plumbing
  const bones = {};
  const H = { hips: [0, 0.95, 0], spine: [0, 1.05, 0], chest: [0, 1.18, 0], upperChest: [0, 1.3, 0], neck: [0, 1.45, 0], head: [0, 1.55, 0] };
  for (const [s, x] of [['left', 1], ['right', -1]]) {
    Object.assign(H, { [`${s}Shoulder`]: [0.05 * x, 1.4, 0], [`${s}UpperArm`]: [0.18 * x, 1.4, 0], [`${s}LowerArm`]: [0.45 * x, 1.4, 0], [`${s}Hand`]: [0.7 * x, 1.4, 0],
      [`${s}UpperLeg`]: [0.09 * x, 0.9, 0], [`${s}LowerLeg`]: [0.09 * x, 0.5, 0], [`${s}Foot`]: [0.09 * x, 0.08, 0], [`${s}Toes`]: [0.09 * x, 0.02, 0.1] });
    ['Metacarpal', 'Proximal', 'Distal'].forEach((g, k) => { H[`${s}Thumb${g}`] = [(0.72 + 0.025 * k) * x, 1.4, 0.03 + 0.02 * k]; });
    for (const [f, z] of Object.entries({ Index: 0.025, Middle: 0.005, Ring: -0.015, Little: -0.033 })) ['Proximal', 'Intermediate', 'Distal'].forEach((g, k) => { H[`${s}${f}${g}`] = [(0.79 + 0.04 * k) * x, 1.4, z]; });
  }
  for (const k of Object.keys(H)) bones[k] = new THREE.Bone();
  const character = { id: 'fake', root: new THREE.Group(), meshes: [], humanoid: { bones }, restHeads: () => H, applyPose() {}, resetPose() {}, headBone: bones.head, dispose() {}, handProfile: { girth: 1.2 } };
  const scene = new THREE.Scene(), renderer = { xr: { getReferenceSpace: () => null } };
  const characters = createCharacterPlugin({ scene, renderer, quality: 'arms', handProfile: { palmOffset: -0.001 }, character: { id: 'fake', create: async () => character } });
  const player = await characters.createPlayer({ handProfile: { right: { size: 1.1 } } });
  const m = player.measuredHandProfile('right'), p = player.handProfile('right');
  assert.equal(m.source, 'rig');
  near(p.pad.Index[0], m.pad.Index[0] * 1.2 * 1.1, 1e-4, 'character girth, then player size');
  near(p.palmOffset, -0.001 * 1.1, 1e-6, 'plugin option, then player size');
  assert.equal(player.restHand('right').profile, p);
  const v0 = player.handProfileVersion;
  player.setHandProfile({ girth: 2 }, 'left');
  assert.ok(player.handProfileVersion > v0, 'version bumped');
  near(player.handProfile('left').pad.Index[0], m.pad.Index[0] * 1.2 * 2, 1e-4, 'runtime girth on top');
  near(player.handProfile('right').pad.Index[0], p.pad.Index[0], 1e-9, 'other side untouched');
  player.setHandProfile(null);
  near(player.handProfile('left').pad.Index[0], m.pad.Index[0] * 1.2, 1e-4, 'null clears the runtime override');
  assert.ok(measured && player.restHand('left').profile.format === HAND_PROFILE_FORMAT);
  player.dispose(); characters.dispose();
});

test('closure: the search stops at a full grade and never runs for a given wrist; a hand that cannot wrap fully searches', () => {
  const { rest, points } = syntheticHand(), shape = CATALOG.bottle_beer.shape, pose = defaultPose('bottle_beer', 'right'), measured = measureHandProfile(rest, points);
  let searched = 0;
  for (const override of [{ size: 0.5 }, { size: 1.8 }, { size: 1.3, girth: 1.6 }, { girth: 2 }, { size: 2.2 }]) {
    const hand = handGeometry({ side: 'right' }, { profile: applyHandProfile(measured, override) });
    const low = closeToContact(pose, hand, shape), mid = closeToContact(pose, hand, shape, { search: 'mid' }), tag = JSON.stringify(override);
    assert.ok(mid.grade.score >= low.grade.score, `${tag}: never worse than the unsearched placement`);
    assert.equal(closeToContact(pose, hand, shape, { wrist: low.wrist, quat: low.quat, search: 'mid' }).tried, 1, `${tag}: a given wrist is not searched`);
    if (low.grade.score >= 24 - 1e-9) { assert.equal(mid.tried, 1, `${tag}: full grade, no search`); continue; }
    searched++;
    assert.ok(mid.tried > 2, `${tag}: searched (tried ${mid.tried})`);
  }
  assert.ok(searched > 0, 'some hand size needs the search');
});
