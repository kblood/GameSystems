// Zombie lab: MakeHuman (CharacterCreator) zombies from the avatar extension's NPC animation, shot apart with the gore
// extension. Desktop: the mouse aims, a click fires the pistol. VR: the pistol sits in the right controller, the trigger
// fires. The settings panel edits the gore config (docs/gore_system.md); seam variants apply when zombies are re-attached.
// The gore extension itself knows nothing about the avatar extension: this page combines them (character contract).
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { createCharacterPlugin } from './vendor/extensions/avatar/index.js';
import { createGoreWorld, loadGibs, tearCloth } from './vendor/extensions/gore/index.js';
import { qMul, qAxisAngle } from './vendor/extensions/humanoid/index.js';
import { ccCharacters } from './character-select.js';
import { PhysicsWorld, box } from './physics.js';
import { createPistol } from './pistol.js';
import { bindPageLifecycle } from './page-lifecycle.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x120e0e); scene.fog = new THREE.Fog(0x120e0e, 9, 22);
const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.xr.enabled = true; renderer.shadowMap.enabled = false; document.body.prepend(renderer.domElement);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 60);
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);
camera.position.set(0, 1.62, 0); rig.position.set(0, 0, 2.6);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---- room
scene.add(new THREE.HemisphereLight(0xd8c8c0, 0x2a1d1a, 2.2));
const lamp = new THREE.DirectionalLight(0xffe2c4, 2.6); lamp.position.set(2, 6, 3); scene.add(lamp);
const physics = new PhysicsWorld();
const room = [
  box(scene, physics, [10, 0.2, 14], [0, -0.1, -3], 0x3b3532, { surface: 'concrete' }),
  box(scene, physics, [10, 3.2, 0.2], [0, 1.6, -10], 0x4a4440),
  box(scene, physics, [0.2, 3.2, 14], [-5, 1.6, -3], 0x463f3b),
  box(scene, physics, [0.2, 3.2, 14], [5, 1.6, -3], 0x463f3b),
];
for (let i = 0; i < 4; i++) box(scene, physics, [0.8, 0.9, 0.8], [i % 2 ? 3.6 : -3.6, 0.45, -1.5 - i * 2], 0x5a4a3a);
const walls = [{ normal: [0, 0, 1], d: 9.9 }, { normal: [1, 0, 0], d: 4.9 }, { normal: [-1, 0, 0], d: 4.9 }];

// ---- settings -> gore config
const settings = () => ({
  goreLevel: $('level').value,
  blood: { amount: +$('blood').value },
  insides: { bones: $('bones').checked, organs: $('organs').checked, flesh: $('organs').checked || $('bones').checked },
  gibs: { lifetime: +$('lifetime').value, max: +$('maxgibs').value },
  regions: { '*': { variant: $('variant').value } },
});
const gibs = await loadGibs();
const world = createGoreWorld({ THREE, scene, physics: physics.adapter, gibs, config: settings(), floorY: 0, walls });
const plugin = createCharacterPlugin({ scene, renderer, character: ccCharacters({ assetsURL: new URL('avatar-assets/', location.href).href, quality: { npc: { cloth: false } } }) });

// ---- zombies
const SKINS = ['#7d8a6c', '#8a917a', '#6f7d66', '#8d8676'], HAIR = ['short02', 'none'], CLOTH = ['#4b5560', '#5b4a3d', '#3d4a3a', '#6a6050'];
let seed = Number(params.get('seed') ?? 7);
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const zombies = [];
let walking = params.get('walk') !== '0', spawning = null;
const playerPos = () => new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);

function zombieOptions(i) {
  const r = () => rnd() * 2 - 1;
  return {
    id: `zombie-${i}`, seed: `zombie-${i}`, sex: rnd() < 0.7 ? 'male' : 'female', skin: SKINS[i % SKINS.length], eyeColor: '#c9c3a4', hairColor: '#2e2a24',
    hair: HAIR[i % HAIR.length], outfit: ['shirt', 'jeans', 'shoes'], body: { weight: r() * 0.7, muscle: r() * 0.6, age: 0.2 + rnd() * 0.6, height: r() * 0.5, proportions: r() * 0.5 },
    colors: { shirt: { primary: CLOTH[i % CLOTH.length] }, jeans: { primary: CLOTH[(i + 2) % CLOTH.length] } },
  };
}
async function spawn(count) {
  for (const z of zombies.splice(0)) { z.gore.dispose(); z.entity.dispose(); }
  world.effects.clear();
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * 1.35 + (rnd() - 0.5) * 0.4, zpos = -4.5 - rnd() * 2.5;
    const entity = await plugin.createNPC({ ...zombieOptions(i), position: [x, 0, zpos], yaw: 0 });
    const character = entity.character;
    for (const mesh of character.meshes) if (mesh.userData.ccClothing) for (const m of [].concat(mesh.material)) tearCloth(THREE, m, { amount: 0.25 + rnd() * 0.35, seed: rnd() });
    const gore = world.attach(character, { uncover: true }); // torn clothes: skin under the holes
    zombies.push({ entity, gore, character, position: new THREE.Vector3(x, 0, zpos), yaw: 0, phase: rnd() * 6, deadFor: 0 });
  }
}

// Zombie posture on top of the NPC walk: arms up front, shoulders hunched, head lolling. The gait itself comes from the
// avatar NPC animation: gore's mobility() / limbs() / limpSide() map onto its gait input (walk, limp, crawl). A crawling
// zombie gets no overlay: its arms are planted on the floor by the crawl IK.
const X = [1, 0, 0], Z = [0, 0, 1];
function zombiePose(pose, z, t) {
  const j = { ...pose.joints }, mul = (name, q) => { j[name] = qMul(q, j[name] ?? [0, 0, 0, 1]); };
  if (z.gore.mobility() === 'crawl') return pose;
  const sway = Math.sin(t * 2.1 + z.phase);
  for (const [s, k] of [['left', 1], ['right', -1]]) {
    if (z.gore.lost(`${s}UpperArm`)) continue;
    const lift = -1.25 + 0.12 * Math.sin(t * 3 + z.phase + k);
    mul(`${s}UpperArm`, qAxisAngle(X, lift)); mul(`${s}UpperArm`, qAxisAngle(Z, k * -0.12));
    mul(`${s}LowerArm`, qAxisAngle(X, -0.25 - 0.1 * sway * k));
  }
  mul('spine', qAxisAngle(X, 0.18)); mul('neck', qAxisAngle(Z, 0.25 * sway)); mul('head', qAxisAngle(X, 0.2));
  return { ...pose, joints: j };
}

function updateZombies(dt, t) {
  const player = playerPos();
  for (const z of zombies) {
    const g = z.gore, to = new THREE.Vector3(player.x - z.position.x, 0, player.z - z.position.z), dist = to.length();
    if (g.dead) {
      z.deadFor += dt;
      z.entity.updateNPC({ position: z.position.toArray(), yaw: z.yaw, moving: false, speed: 0, state: 'dead' }, dt);
      continue;
    }
    if (walking) z.yaw = Math.atan2(to.x, to.z); // stopped: they hold still (also for close-up screenshots)
    const speed = walking && dist > 0.75 ? 0.42 * g.speedFactor() : 0;
    if (speed > 0) z.position.addScaledVector(to.normalize(), speed * dt);
    // gore -> avatar gait (gore never imports avatar; the lab wires the two)
    const mobility = g.mobility(), gait = mobility === 'crawl' ? 'crawl' : mobility === 'limp' ? 'limp' : 'walk';
    const anim = z.entity.updateNPC({ position: z.position.toArray(), yaw: z.yaw, moving: speed > 0, speed, state: 'idle', aimPoint: player.toArray(),
      gait, limbs: g.limbs(), limpSide: g.limpSide() }, dt);
    z.anim = anim;
    if (anim?.pose) z.character.applyPose(zombiePose(anim.pose, z, t));
  }
}

// ---- pistol and shooting
const pistol = createPistol({ scene, head: camera, targets: () => room });
pistol.take('desktop', camera);
const mouse = new THREE.Vector2(), raycaster = new THREE.Raycaster();
let shots = 0, hits = 0, lastShot = null;
function shoot(origin, direction) {
  const hit = world.shoot(origin, direction, { damage: +$('damage').value });
  pistol.fire(origin, direction, !!hit); shots++;
  if (hit) hits++;
  lastShot = hit ? { region: hit.region, events: hit.events.map(e => e.type + (e.region ? `:${e.region}` : '') + (e.cause ? `:${e.cause}` : '')) } : null;
  return hit;
}
function mouseRay(event) {
  mouse.set((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouse, camera);
  return raycaster.ray;
}
let aim = null;
renderer.domElement.addEventListener('pointermove', e => { const r = mouseRay(e); aim = r.origin.clone().addScaledVector(r.direction, 8); });
renderer.domElement.addEventListener('pointerdown', e => {
  if (renderer.xr.isPresenting || e.button !== 0) return;
  const r = mouseRay(e);
  shoot(r.origin.clone(), r.direction.clone());
});
// VR: the right controller grip holds the pistol, its trigger fires along the barrel
for (const i of [0, 1]) {
  const grip = renderer.xr.getControllerGrip(i), ctrl = renderer.xr.getController(i);
  rig.add(grip, ctrl);
  ctrl.addEventListener('connected', e => { if (e.data.handedness === 'right') { pistol.take(i, grip); ctrl.userData.pistol = true; } });
  ctrl.addEventListener('selectstart', () => { if (!ctrl.userData.pistol) return; const r = pistol.ray(); shoot(r.origin, r.direction); });
}
renderer.xr.addEventListener('sessionend', () => pistol.take('desktop', camera));

// ---- UI
const showValue = id => { const v = $(`${id}-v`); if (v) v.textContent = $(id).value; };
for (const id of ['level', 'blood', 'bones', 'organs', 'lifetime', 'maxgibs']) $(id).addEventListener('input', () => { showValue(id); world.setConfig(settings()); });
$('damage').addEventListener('input', () => showValue('damage'));
$('variant').addEventListener('change', () => { world.setConfig(settings()); reattach(); });
$('reset').addEventListener('click', () => reattach());
$('walk').addEventListener('click', () => { walking = !walking; $('walk').textContent = walking ? 'Stop' : 'Gå'; });
$('respawn').addEventListener('click', () => { spawning = spawn(+$('count').value); });
$('enter-xr').addEventListener('click', () => vrButton.click());
const vrButton = VRButton.createButton(renderer, { optionalFeatures: ['local-floor'] }); vrButton.style.display = 'none'; document.body.append(vrButton);
/** Everything back on: the gore runtime is re-attached (picks up the seam variant), the zombies walk from the start. */
function reattach() {
  for (const z of zombies) {
    z.gore.dispose(); z.gore = world.attach(z.character, { uncover: true }); z.deadFor = 0;
    z.position.z = -4.5 - rnd() * 2.5; z.entity.updateNPC({ state: 'idle', gait: 'walk' }, 0);
  }
  world.effects.clear();
}

// ---- loop
const timer = new THREE.Clock();
let elapsed = 0, fps = 0, frames = 0, fpsAt = 0, drawCalls = 0;
function animate() {
  const dt = Math.min(timer.getDelta(), 0.05);
  elapsed += dt; frames++;
  if (elapsed - fpsAt > 1) { fps = frames / (elapsed - fpsAt); frames = 0; fpsAt = elapsed; }
  physics.step(dt);
  updateZombies(dt, elapsed);
  world.update(dt);
  pistol.update(dt, { aim });
  renderer.render(scene, camera);
  drawCalls = renderer.info.render.calls;
  if (frames % 10 === 0) status();
}
function status() {
  const s = world.stats();
  $('status').textContent = `${zombies.length} zombier · ${zombies.filter(z => z.gore.dead).length} døde\n` +
    `skud ${shots} · træf ${hits}${lastShot ? ` (${lastShot.region})` : ''}\n` +
    `gibs ${s.gibs} · blod ${s.effects.particles} · pletter ${s.effects.splats}\n` +
    `afskæring ${s.lastSeverMs.toFixed(2)} ms (snit ${s.severMs.toFixed(2)})\n` +
    `draw calls ${drawCalls} (zombier ${s.drawCalls}) · ${fps.toFixed(0)} fps`;
}
renderer.setAnimationLoop(animate);
document.querySelector('#crosshair').style.display = 'block';

spawning = spawn(Math.max(1, Math.min(5, Number(params.get('zombies') ?? $('count').value))));
const ready = spawning.then(() => true);

// Test hooks (scripts/gore-smoke.mjs): shoot a region through the real ray path, from the camera.
window.__lab = {
  THREE, scene, camera, renderer, world, zombies, pistol, ready,
  get walking() { return walking; }, set walking(v) { walking = !!v; },
  /** Fires from the camera at a region's centre of zombie i; returns the hit summary. */
  shootRegion(i, region, damage = null) {
    const z = zombies[i], target = z?.gore.regionCenter(region);
    if (!target) return null;
    if (damage) $('damage').value = damage;
    const origin = playerPos(), dir = target.clone().sub(origin).normalize();
    const hit = shoot(origin, dir);
    return hit ? { zombie: zombies.findIndex(x => x.gore === hit.zombie), region: hit.region, events: lastShot.events } : null;
  },
  stats: () => ({ ...world.stats(), drawCallsFrame: drawCalls, fps, shots, hits, zombies: zombies.map(z => ({ lost: z.gore.lostRegions(), dead: z.gore.dead, mobility: z.gore.mobility(), gait: z.anim?.gait ?? 'walk', contacts: z.anim?.contacts ?? null, drawCalls: z.gore.drawCalls(), attachMs: z.gore.attachMs, baked: z.gore.baked })) }),
  setConfig: c => world.setConfig(c), settings, reattach,
};
window.__pageLifecycle = bindPageLifecycle({ suspend: () => renderer.setAnimationLoop(null), resume: () => renderer.setAnimationLoop(animate), resetClock: () => timer.getDelta(),
  keepActiveWhenHidden: () => renderer.xr.isPresenting,
  dispose: () => { world.dispose(); plugin.dispose?.(); pistol.dispose(); renderer.dispose(); } });
