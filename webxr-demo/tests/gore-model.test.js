// The pure parts of the gore extension: the region tree (regions.js), the config (config.js) and the damage model
// (damage.js). No three.js, no assets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REGIONS, REGION_IDS, REGION, SEAM_IDS, subtree, ancestors, JOINT_REGION, boneRegions, regionFromSkin } from '../../extensions/gore/regions.js';
import { DEFAULT_GORE_CONFIG, resolveGoreConfig, validateGoreConfig, effectiveConfig, GORE_LEVELS } from '../../extensions/gore/config.js';
import { createDamageModel, MOBILITY } from '../../extensions/gore/damage.js';
import { LIMB_SEAMS, PATCH_SEAMS, sawPattern, seamSeed } from '../../extensions/gore/seams.js';
import { JOINTS } from '../../extensions/humanoid/index.js';

const model = layer => createDamageModel(effectiveConfig(resolveGoreConfig(layer)));

test('regions form one depth-first tree: every subtree is a contiguous run of REGIONS', () => {
  assert.equal(REGIONS[0].id, 'pelvis'); assert.equal(REGIONS.filter(r => !r.parent).length, 1);
  for (const r of REGIONS) {
    const ids = subtree(r.id), at = REGION_IDS.indexOf(r.id);
    assert.deepEqual(ids, REGION_IDS.slice(at, at + ids.length), r.id);
    if (r.parent) assert.ok(REGION_IDS.indexOf(r.parent) < at, `${r.id} after its parent`);
  }
  assert.deepEqual(subtree('leftUpperArm'), ['leftUpperArm', 'leftLowerArm', 'leftHand']);
  assert.deepEqual(ancestors('jaw'), ['head', 'neck', 'chest', 'pelvis']);
  assert.deepEqual(SEAM_IDS, REGION_IDS.slice(1));
});

test('every canonical joint belongs to a region; fingers and toes fall to the hand and foot', () => {
  for (const [j] of JOINTS) assert.ok(REGION[JOINT_REGION[j]], j);
  assert.equal(JOINT_REGION.leftIndexDistal, 'leftHand'); assert.equal(JOINT_REGION.rightToes, 'rightFoot');
  assert.equal(JOINT_REGION.upperChest, 'chest'); assert.equal(JOINT_REGION.hips, 'pelvis');
  // patches own no joints; every seam has a bake recipe
  for (const r of REGIONS.filter(r => r.kind === 'patch')) { assert.deepEqual([...r.joints], []); assert.ok(PATCH_SEAMS[r.id], r.id); }
  for (const r of REGIONS.filter(r => r.kind === 'limb')) assert.ok(LIMB_SEAMS[r.id], r.id);
});

test('bone regions follow the skeleton: unknown bones inherit through their parent', () => {
  const names = ['Root', 'pelvis', 'upperarm_l', 'twist_l', 'hand_l'];
  const joint = { pelvis: 'hips', upperarm_l: 'leftUpperArm', hand_l: 'leftHand' };
  const parent = [-1, 0, 1, 2, 3];
  const br = boneRegions(names, n => joint[n] ?? null, i => parent[i]);
  assert.deepEqual([...br].map(i => REGION_IDS[i]), ['pelvis', 'pelvis', 'leftUpperArm', 'leftUpperArm', 'leftHand']);
  // a hit between upper arm (bone 2) and hand (bone 4) weighted towards the hand
  const c = (b, w) => [[b, 0, 0, 0], [w, 0, 0, 0]];
  assert.equal(regionFromSkin(br, [c(2, 1), c(4, 1), c(4, 1)], [0.2, 0.4, 0.4]), 'leftHand');
  assert.equal(regionFromSkin(br, [c(2, 1), c(4, 1), c(4, 1)], [0.9, 0.05, 0.05]), 'leftUpperArm');
});

test('seam saw pattern and seeds are deterministic and bounded', () => {
  assert.equal(seamSeed('leftUpperArm'), seamSeed('leftUpperArm')); assert.notEqual(seamSeed('leftUpperArm'), seamSeed('rightUpperArm'));
  for (let i = 0; i < 64; i++) { const v = sawPattern(i / 10, 6, 3); assert.ok(v >= -1 && v <= 1, `${v}`); }
  assert.ok(Math.abs(sawPattern(1.3, 6, 3) - sawPattern(1.3 + 2 * Math.PI, 6, 3)) < 1e-9, "periodic around the seam");
});

test('the default config is valid and covers every region', () => {
  assert.deepEqual(validateGoreConfig(resolveGoreConfig()), { ok: true, errors: [] });
  assert.deepEqual(Object.keys(DEFAULT_GORE_CONFIG.regions), REGION_IDS);
  assert.equal(DEFAULT_GORE_CONFIG.regions.pelvis.severable, false);
  assert.deepEqual(GORE_LEVELS, ['off', 'low', 'high']);
});

test('config layers merge global -> type -> character; "*" changes every region', () => {
  const global = { goreLevel: 'low', blood: { color: '#204010' } };
  const runner = { totalHealth: 120, regions: { '*': { variant: 'clean' }, head: { health: 10 } } };
  const one = { regions: { leftUpperArm: { severable: false } }, gibs: { max: 4 } };
  const cfg = resolveGoreConfig(global, runner, one);
  assert.equal(cfg.goreLevel, 'low'); assert.equal(cfg.blood.color, '#204010'); assert.equal(cfg.blood.amount, 1);
  assert.equal(cfg.totalHealth, 120); assert.equal(cfg.regions.head.health, 10); assert.equal(cfg.regions.head.damageScale, 2);
  assert.ok(REGION_IDS.every(id => cfg.regions[id].variant === 'clean'));
  assert.equal(cfg.regions.leftUpperArm.severable, false); assert.equal(cfg.gibs.max, 4); assert.equal(cfg.gibs.lifetime, 14);
});

test('invalid configs name every problem', () => {
  assert.throws(() => resolveGoreConfig({ goreLevel: 'max' }), /goreLevel must be one of off, low, high/);
  const { ok, errors } = validateGoreConfig({ ...resolveGoreConfig(), totalHealth: 0, blood: { color: 'red', amount: 3, spurtSeconds: 1 },
    regions: { ...resolveGoreConfig().regions, tail: {}, pelvis: { ...DEFAULT_GORE_CONFIG.regions.pelvis, severable: true } } });
  assert.equal(ok, false);
  for (const m of ['totalHealth', 'regions.tail is not a region', 'regions.tail', 'pelvis.severable must be false', 'blood.color', 'blood.amount'])
    assert.ok(errors.some(e => e.includes(m)), `${m}: ${errors.join(' | ')}`);
  assert.throws(() => resolveGoreConfig({ gibs: { max: 1.5 } }), /gibs.max must be an integer/);
  assert.throws(() => resolveGoreConfig('high'), /layers must be objects/);
});

test('gore levels cap what the config asks for', () => {
  const off = effectiveConfig(resolveGoreConfig({ goreLevel: 'off' }));
  assert.equal(off.sever, false); assert.equal(off.blood.amount, 0); assert.equal(off.gibs.max, 0);
  assert.deepEqual(off.insides, { bones: false, organs: false, flesh: false }); assert.ok(Object.values(off.regions).every(r => !r.severable));
  const low = effectiveConfig(resolveGoreConfig({ goreLevel: 'low', gibs: { max: 50, lifetime: 30 } }));
  assert.equal(low.sever, true); assert.equal(low.gibs.max, 8); assert.equal(low.gibs.lifetime, 6); assert.equal(low.insides.organs, false);
  assert.ok(Math.abs(low.blood.amount - 0.35) < 1e-9);
  const high = effectiveConfig(resolveGoreConfig({ gibs: { max: 50 } }));
  assert.equal(high.gibs.max, 50); assert.equal(high.insides.organs, true);
});

test('severing takes the subtree; the zombie lives on without an arm', () => {
  const m = model();
  const ev = m.hit('leftUpperArm', 30);
  assert.deepEqual(ev.map(e => e.type), ['damage']); assert.equal(m.region('leftUpperArm').health, 15);
  const ev2 = m.hit('leftUpperArm', 20);
  assert.deepEqual(ev2.map(e => e.type), ['damage', 'sever']);
  assert.deepEqual(ev2[1].lost, ['leftUpperArm', 'leftLowerArm', 'leftHand']);
  assert.deepEqual(m.lostRegions(), ['leftUpperArm', 'leftLowerArm', 'leftHand']);
  assert.equal(m.dead, false); assert.equal(m.mobility(), 'walk'); assert.equal(m.canAttack(), true);
  assert.deepEqual(m.hit('leftHand', 100), [], 'a lost region takes no hits');
  m.hit('rightHand', 40);
  assert.equal(m.canAttack(), false);
});

test('chained loss: a forearm cut first, then the upper arm takes only what is left', () => {
  const m = model();
  assert.deepEqual(m.hit('leftLowerArm', 40)[1].lost, ['leftLowerArm', 'leftHand']);
  assert.deepEqual(m.hit('leftUpperArm', 45)[1].lost, ['leftUpperArm']);
});

test('death: head off, head destroyed, cranium, total damage', () => {
  let m = model();
  const ev = m.hit('neck', 30);
  assert.deepEqual(ev.map(e => e.type), ['damage', 'sever', 'death']);
  assert.deepEqual(ev[1].lost, ['neck', 'head', 'jaw', 'cranium']); assert.equal(m.cause, 'vital'); assert.equal(m.mobility(), 'none');
  // a dead zombie can still be shot apart, without a second death
  assert.deepEqual(m.hit('leftUpperArm', 100).map(e => e.type), ['damage', 'sever']);
  m = model({ regions: { head: { severable: false } } });
  assert.deepEqual(m.hit('head', 30).map(e => e.type), ['damage', 'death']); assert.equal(m.cause, 'head');
  m = model();
  assert.deepEqual(m.hit('cranium', 20).at(-1), { type: 'death', cause: 'vital', region: 'cranium' });
  m = model({ totalHealth: 50 });
  m.hit('leftLowerLeg', 30); assert.equal(m.dead, false);
  assert.equal(m.hit('rightLowerLeg', 30).at(-1).cause, 'total');
});

test('missing legs and feet slow the zombie down; it crawls without a leg', () => {
  const m = model();
  assert.equal(m.speedFactor(), MOBILITY.walk);
  m.sever('leftFoot'); assert.equal(m.mobility(), 'limp'); assert.equal(m.speedFactor(), MOBILITY.limp);
  m.sever('rightLowerLeg'); assert.equal(m.mobility(), 'crawl');
  m.reset(); assert.equal(m.mobility(), 'walk'); assert.deepEqual(m.lostRegions(), []);
});

test('a hurt (not severed) leg limps on that side; limbs() and the crawl speeds follow the arms left', () => {
  let m = model();
  m.hit('rightLowerLeg', 15); assert.equal(m.mobility(), 'walk', 'a scratch does not limp');
  m.hit('rightLowerLeg', 10); assert.equal(m.mobility(), 'limp'); assert.equal(m.limpSide(), 'right');
  assert.deepEqual(m.limbs(), { leftArm: true, rightArm: true, leftLeg: true, rightLeg: true });
  m.sever('leftUpperLeg');
  assert.equal(m.mobility(), 'crawl'); assert.equal(m.limpSide(), 'right', 'the remaining hurt leg');
  assert.equal(m.limbs().leftLeg, false); assert.equal(m.speedFactor(), MOBILITY.crawl);
  m.sever('leftLowerArm'); assert.equal(m.limbs().leftArm, false); assert.equal(m.speedFactor(), MOBILITY.oneArmCrawl);
  m.sever('rightUpperArm'); assert.equal(m.speedFactor(), MOBILITY.legsOnlyCrawl);
  m.sever('rightUpperLeg'); assert.equal(m.mobility(), 'crawl'); assert.equal(m.speedFactor(), 0, 'helpless');
  m.sever('leftHand'); assert.equal(m.limbs().leftArm, false);
  // a lost hand alone still pulls with the forearm stump
  m = model(); m.sever('rightHand'); m.sever('leftLowerLeg');
  assert.equal(m.limbs().rightArm, true); assert.equal(m.speedFactor(), MOBILITY.crawl);
});

test('mobility speeds and the limp threshold come from the config and are validated', () => {
  const m = model({ mobility: { limpSpeed: 0.8, crawlSpeed: 0.5, oneArmCrawlSpeed: 0.25, limpBelow: 0.9 } });
  m.hit('leftUpperLeg', 4); assert.equal(m.mobility(), 'walk'); m.hit('leftUpperLeg', 4); assert.equal(m.mobility(), 'limp'); assert.equal(m.speedFactor(), 0.8);
  m.sever('leftLowerLeg'); assert.equal(m.speedFactor(), 0.5);
  m.sever('rightUpperArm'); assert.equal(m.speedFactor(), 0.25);
  assert.equal(validateGoreConfig(resolveGoreConfig()).ok, true);
  assert.deepEqual(DEFAULT_GORE_CONFIG.mobility, { limpBelow: 0.5, limpSpeed: MOBILITY.limp, crawlSpeed: MOBILITY.crawl, oneArmCrawlSpeed: MOBILITY.oneArmCrawl, legsOnlyCrawlSpeed: MOBILITY.legsOnlyCrawl });
  const { ok, errors } = validateGoreConfig({ ...resolveGoreConfig(), mobility: { ...DEFAULT_GORE_CONFIG.mobility, crawlSpeed: -1, limpBelow: 2 } });
  assert.equal(ok, false);
  assert.ok(errors.includes('mobility.crawlSpeed must be in 0..2') && errors.includes('mobility.limpBelow must be in 0..1'), errors.join('; '));
  // effectiveConfig keeps the section at every gore level
  assert.throws(() => resolveGoreConfig({ mobility: { limpSpeed: 'fast' } }), /mobility.limpSpeed/);
  assert.equal(effectiveConfig(resolveGoreConfig({ goreLevel: 'off', mobility: { limpSpeed: 0.7 } })).mobility.limpSpeed, 0.7);
});

test('severAt, damageScale and severable steer when a region comes off; gore off severs nothing', () => {
  let m = model({ regions: { leftUpperLeg: { severAt: 0.5 } } });
  assert.equal(m.hit('leftUpperLeg', 29).length, 1); assert.equal(m.hit('leftUpperLeg', 1)[1].type, 'sever');
  m = model({ regions: { leftHand: { damageScale: 4 } } });
  assert.equal(m.hit('leftHand', 5)[1].type, 'sever');
  m = model({ regions: { leftHand: { severable: false } } });
  assert.deepEqual(m.hit('leftHand', 500).map(e => e.type), ['damage', 'death']); assert.equal(m.lost('leftHand'), false);
  assert.deepEqual(m.sever('leftHand', { force: true })[0].lost, ['leftHand']);
  m = model({ goreLevel: 'off' });
  assert.ok(m.hit('neck', 500).every(e => e.type !== 'sever')); assert.equal(m.dead, true);
  assert.deepEqual(m.snapshot().regions.neck.lost, false);
});
