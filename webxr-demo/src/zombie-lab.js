// Zombie lab: MakeHuman (CharacterCreator) zombies from the avatar extension's NPC animation, shot apart with the gore
// extension and driven by the ai extension's zombie brain. Desktop: the mouse aims, a click fires the pistol. VR: the
// pistol sits in the right controller, the trigger fires. The settings panel edits the gore config (docs/gore_system.md);
// seam variants apply when zombies are re-attached. The zombies path around the barricade (grid navmesh), hear the
// pistol, surround the player and attack after a visible windup (docs/ai_system.md); damage shows as a HUD and a red
// vignette, the camera is never moved. ?aidebug=1 (or the button, or the I key) shows paths, states, surround slots and
// sight cones. gore, avatar and ai know nothing about each other: this page combines them.
// Hit reactions (extensions/hitreact): a shot pushes the hit chain and the pelvis with spring-dampers, the feet stay
// planted (leg IK), a hard push takes a balance step, many hits knock the zombie down; the reaction's physical state goes
// to the AI (world.setPhysicalState). ?hitreact=0 falls back to the old placeholder timers. ?ragdoll=1 turns on the
// opt-in active ragdoll (cannon-es through the physics adapter) for downed and dead zombies; default off.
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { createCharacterPlugin } from './vendor/extensions/avatar/index.js';
import { createGoreWorld, loadGibs, tearCloth } from './vendor/extensions/gore/index.js';
import { createAIWorld, createNavGrid, createZombieBrain, mobilityFromGore, stepBody, boxesFromObjects, createRaycast, createAIDebug, wrapAngle } from './vendor/extensions/ai/index.js';
import { qMul, qAxisAngle } from './vendor/extensions/humanoid/index.js';
import { createHitReactor } from './vendor/extensions/hitreact/index.js';
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
const obstacles = [];
for (let i = 0; i < 4; i++) obstacles.push(box(scene, physics, [0.8, 0.9, 0.8], [i % 2 ? 3.6 : -3.6, 0.45, -1.5 - i * 2], 0x5a4a3a));
// a barricade in the back half: the zombies spawn behind it and path around its open (right) end
obstacles.push(box(scene, physics, [4.1, 1.1, 0.25], [-1.05, 0.55, -5.5], 0x6a5440));
room.push(...obstacles);
const HIT_REACT = params.get('hitreact') !== '0';
const HIT_REACT_CONFIG = { ragdoll: { enabled: params.get('ragdoll') === '1' } };
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

// ---- AI: a nav grid baked from the props, sight rays against walls and props, one zombie brain per zombie
const navmesh = createNavGrid({ bounds: { minX: -4.75, minZ: -9.75, maxX: 4.75, maxZ: 3.9 }, boxes: boxesFromObjects(THREE, obstacles) });
const ai = createAIWorld({ navmesh, raycast: createRaycast(THREE, room.slice(1)), seed: Number(params.get('seed') ?? 7) });
const aiDebug = createAIDebug(THREE, scene, ai);
aiDebug.visible = params.get('aidebug') === '1';
const plugin = createCharacterPlugin({ scene, renderer, character: ccCharacters({ assetsURL: new URL('avatar-assets/', location.href).href, quality: { npc: { cloth: false } } }) });

// ---- zombies
const SKINS = ['#7d8a6c', '#8a917a', '#6f7d66', '#8d8676'], HAIR = ['short02', 'none'], CLOTH = ['#4b5560', '#5b4a3d', '#3d4a3a', '#6a6050'];
let seed = Number(params.get('seed') ?? 7);
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const zombies = [];
let walking = params.get('walk') !== '0', spawning = null;
const playerPos = () => new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
const spawnZ = () => -6.6 - rnd() * 1.8;   // behind the barricade

function zombieOptions(i) {
  const r = () => rnd() * 2 - 1;
  return {
    id: `zombie-${i}`, seed: `zombie-${i}`, sex: rnd() < 0.7 ? 'male' : 'female', skin: SKINS[i % SKINS.length], eyeColor: '#c9c3a4', hairColor: '#2e2a24',
    hair: HAIR[i % HAIR.length], outfit: ['shirt', 'jeans', 'shoes'], body: { weight: r() * 0.7, muscle: r() * 0.6, age: 0.2 + rnd() * 0.6, height: r() * 0.5, proportions: r() * 0.5 },
    colors: { shirt: { primary: CLOTH[i % CLOTH.length] }, jeans: { primary: CLOTH[(i + 2) % CLOTH.length] } },
  };
}
async function spawn(count) {
  for (const z of zombies.splice(0)) { z.react?.dispose(); z.gore.dispose(); z.entity.dispose(); ai.removeAgent(z.agent); }
  world.effects.clear();
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * 1.35 + (rnd() - 0.5) * 0.4, zpos = spawnZ();
    const entity = await plugin.createNPC({ ...zombieOptions(i), position: [x, 0, zpos], yaw: 0 });
    const character = entity.character;
    for (const mesh of character.meshes) if (mesh.userData.ccClothing) for (const m of [].concat(mesh.material)) tearCloth(THREE, m, { amount: 0.25 + rnd() * 0.35, seed: rnd() });
    const gore = world.attach(character, { uncover: true }); // torn clothes: skin under the holes
    const z = { entity, gore, character, position: new THREE.Vector3(x, 0, zpos), yaw: 0, phase: rnd() * 6, deadFor: 0, mob: {}, physical: 'standing', physicalFor: 0, crawling: false };
    z.agent = ai.addAgent(createZombieBrain(), { position: z.position, get yaw() { return z.yaw; } }, { id: `zombie-${i}` });
    if (HIT_REACT) z.react = createHitReactor(THREE, { character, physics: physics.adapter, config: HIT_REACT_CONFIG, lost: id => z.gore.lost(id) });
    syncGore(z);
    zombies.push(z);
  }
  alertAll();
}
/** The lab's zombies know where you are at the start (?alert=0: they roam until they hear or see you). */
function alertAll() {
  if (params.get('alert') !== '0') ai.stimulus({ type: 'voice', position: playerPos(), radius: 40, occlude: false });
}
/** gore -> ai: mobility (walk / limp / crawl, working limbs, dead or headless). */
function syncGore(z) { ai.setMobility(z.agent, mobilityFromGore(z.gore, z.mob)); }

// Zombie posture on top of the NPC walk: arms up front, shoulders hunched, head lolling; the attack windup reaches
// further (intent.telegraph). The gait itself comes from the avatar NPC animation: gore's mobility() / limbs() /
// limpSide() map onto its gait input (walk, limp, crawl). A crawling zombie gets no overlay: its arms are planted on the
// floor by the crawl IK.
const X = [1, 0, 0], Z = [0, 0, 1];
function zombiePose(pose, z, t) {
  const j = { ...pose.joints }, mul = (name, q) => { j[name] = qMul(q, j[name] ?? [0, 0, 0, 1]); };
  if (z.gore.mobility() === 'crawl') return pose;
  const sway = Math.sin(t * 2.1 + z.phase), reach = z.agent.intent.telegraph;
  for (const [s, k] of [['left', 1], ['right', -1]]) {
    if (z.gore.lost(`${s}UpperArm`)) continue;
    const lift = -1.25 - 0.3 * reach + 0.12 * Math.sin(t * 3 + z.phase + k) * (1 - reach);
    mul(`${s}UpperArm`, qAxisAngle(X, lift)); mul(`${s}UpperArm`, qAxisAngle(Z, k * -0.12));
    mul(`${s}LowerArm`, qAxisAngle(X, -0.25 - 0.1 * sway * k));
  }
  mul('spine', qAxisAngle(X, 0.18 + 0.2 * reach)); mul('neck', qAxisAngle(Z, 0.25 * sway)); mul('head', qAxisAngle(X, 0.2));
  return { ...pose, joints: j };
}

// The player as the AI sees it: the camera is the head, tracked controllers are the hands (VR personal space, grabs,
// shoves). Stopped (walk off) or on the death screen the AI does not run at all.
const head = new THREE.Vector3(), tmpV = new THREE.Vector3();
const handPoints = [{ x: 0, y: 0, z: 0, tracked: false }, { x: 0, y: 0, z: 0, tracked: false }], aiPlayer = { head, hands: handPoints, floorY: 0 };
const handGrips = [null, null];
function updateAI(dt) {
  head.setFromMatrixPosition(camera.matrixWorld);
  for (const h of handPoints) h.tracked = false;
  if (renderer.xr.isPresenting) for (const grip of handGrips) {
    if (!grip?.userData.handedness || !grip.visible) continue;
    const h = handPoints[grip.userData.handedness === 'left' ? 0 : 1];
    grip.getWorldPosition(tmpV); h.x = tmpV.x; h.y = tmpV.y; h.z = tmpV.z; h.tracked = true;
  }
  if (walking && !playerState.dead) ai.update(dt, aiPlayer);
}

/**
 * Physical layer. With the hit reactor (default) a hit goes to extensions/hitreact, which owns the body and reports its
 * physical state (applied in updateZombies). Losing a leg still knocks the zombie down for the crawl's own fall (a timed
 * downed -> recovering -> standing; the crawl IK owns the body, the reactor stands aside). Death is inert (with ?ragdoll=1
 * the reactor turns the body into a passive ragdoll). Without the reactor (?hitreact=0) the old placeholder: a hit
 * staggers for a moment (destabilized). The brain pauses movement and attacks meanwhile (world.setPhysicalState).
 */
function physicalAfterHit(z, hit, direction) {
  const region = hit.region;
  syncGore(z);
  if (z.gore.dead) {
    if (z.react) { z.react.hit({ region, point: hit.point, direction, impulse: PISTOL_IMPULSE }); z.react.kill(); }
    setPhysical(z, 'inert', 0); return;
  }
  if (z.gore.mobility() === 'crawl' && !z.crawling) { z.crawling = true; z.react?.reset(); setPhysical(z, 'downed', 1.0); return; }
  if (z.react && !z.crawling) { z.react.hit({ region, point: hit.point, direction, impulse: PISTOL_IMPULSE }); return; }
  if (z.crawling) return;
  if (z.physical === 'standing' || z.physical === 'destabilized') setPhysical(z, 'destabilized', /leg|foot/i.test(region) ? 0.45 : 0.3);
}
/** The reactor's pose onto the bones; its state changes go to the AI (held until the reactor changes them again). */
function react(z, pose, dt) {
  const r = z.react.update(dt, pose);
  for (const e of r.events) if (e.to !== z.physical) setPhysical(z, e.to, Infinity);
  // a ragdoll that fell away from where the body stood: the body gets up where the pelvis landed (if that is walkable)
  const shift = z.react.takeRecenter?.();
  if (shift) { const to = navmesh.closest({ x: z.position.x + shift[0], y: 0, z: z.position.z + shift[2] }); if (to) { z.position.x = to.x; z.position.z = to.z; } }
  z.reactState = r;
}
function setPhysical(z, state, seconds) { z.physical = state; z.physicalFor = seconds; ai.setPhysicalState(z.agent, state); }
function updatePhysical(z, dt) {
  if (z.physical === 'standing' || z.physical === 'inert') return;
  z.physicalFor -= dt;
  if (z.physicalFor > 0) return;
  setPhysical(z, z.physical === 'downed' ? 'recovering' : 'standing', 0.35);
}

function updateZombies(dt, t) {
  const player = playerPos();
  for (const z of zombies) {
    const g = z.gore;
    updatePhysical(z, dt);
    if (g.dead) {
      z.deadFor += dt;
      const dead = z.entity.updateNPC({ position: z.position.toArray(), yaw: z.yaw, moving: false, speed: 0, state: 'dead' }, dt);
      if (z.react?.ragdollEnabled && dead?.pose) react(z, dead.pose, dt);   // the passive ragdoll replaces the death animation
      continue;
    }
    // the brain's intent moves the body (stopped: they hold still, also for close-up screenshots)
    const intent = z.agent.intent;
    let speed = 0;
    if (walking && !playerState.dead) {
      speed = stepBody(z.position, intent, dt, navmesh) / Math.max(dt, 1e-4);
      const turn = wrapAngle(intent.face - z.yaw), rate = (intent.gait === 'crawl' ? 1.6 : 3.2) * dt;
      z.yaw += Math.max(-rate, Math.min(rate, turn));
    }
    // gore -> avatar gait (gore never imports avatar; the lab wires the two)
    const mobility = g.mobility(), gait = mobility === 'crawl' ? 'crawl' : mobility === 'limp' ? 'limp' : 'walk';
    const anim = z.entity.updateNPC({ position: z.position.toArray(), yaw: z.yaw, moving: speed > 0.02, speed, state: 'idle', aimPoint: player.toArray(),
      gait, limbs: g.limbs(), limpSide: g.limpSide() }, dt);
    z.anim = anim;
    if (anim?.pose) {
      if (z.react) react(z, zombiePose(anim.pose, z, t), dt);
      else z.character.applyPose(zombiePose(anim.pose, z, t));
    }
  }
}

// ---- pistol and shooting
const pistol = createPistol({ scene, head: camera, targets: () => room });
pistol.take('desktop', camera);
const mouse = new THREE.Vector2(), raycaster = new THREE.Raycaster();
const PISTOL_IMPULSE = 2.7;   // N·s: a 9 mm bullet (7.5 g at ~360 m/s), handed to the AI hit hook
let shots = 0, hits = 0, lastShot = null;
function shoot(origin, direction) {
  if (playerState.dead) return null;
  const damage = +$('damage').value, hit = world.shoot(origin, direction, { damage });
  pistol.fire(origin, direction, !!hit); shots++;
  if (hit) hits++;
  lastShot = hit ? { region: hit.region, events: hit.events.map(e => e.type + (e.region ? `:${e.region}` : '') + (e.cause ? `:${e.cause}` : '')) } : null;
  // the AI hears the shot (zombies in earshot investigate) and the hit zombie reacts
  ai.shotFired(origin, hit?.point ?? origin.clone().addScaledVector(direction, 25));
  const z = hit && zombies.find(x => x.gore === hit.zombie);
  if (z) { ai.hit(z.agent, { region: hit.region, point: hit.point, direction, impulse: PISTOL_IMPULSE, damage }); physicalAfterHit(z, hit, direction); }
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
// VR: the right controller grip holds the pistol, its trigger fires along the barrel; both grips are the AI's hands
for (const i of [0, 1]) {
  const grip = renderer.xr.getControllerGrip(i), ctrl = renderer.xr.getController(i);
  rig.add(grip, ctrl);
  handGrips[i] = grip;
  ctrl.addEventListener('connected', e => { grip.userData.handedness = e.data.handedness; if (e.data.handedness === 'right') { pistol.take(i, grip); ctrl.userData.pistol = true; } });
  ctrl.addEventListener('disconnected', () => { grip.userData.handedness = null; });
  ctrl.addEventListener('selectstart', () => {
    if (playerState.dead) { restart(); return; }   // the trigger restarts on the death screen
    if (!ctrl.userData.pistol) return;
    const r = pistol.ray(); shoot(r.origin, r.direction);
  });
}
renderer.xr.addEventListener('sessionend', () => pistol.take('desktop', camera));

// ---- player damage: health, a red vignette (a CSS overlay on desktop, a camera-attached quad in VR), the death screen
const MAX_HEALTH = 100;
const playerState = { health: MAX_HEALTH, dead: false, hurt: 0, damageTaken: 0, attacks: [] };
const vignetteCanvas = Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
{
  const g = vignetteCanvas.getContext('2d'), grad = g.createRadialGradient(128, 128, 40, 128, 128, 128);
  grad.addColorStop(0, 'rgba(160,0,0,0)'); grad.addColorStop(0.6, 'rgba(160,0,0,0.35)'); grad.addColorStop(1, 'rgba(120,0,0,0.95)');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
}
const vignette = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(vignetteCanvas), transparent: true, depthTest: false, depthWrite: false, opacity: 0, toneMapped: false }));
vignette.position.set(0, 0, -0.12); vignette.renderOrder = 2000; vignette.visible = false; vignette.name = 'damage-vignette'; camera.add(vignette);
ai.on('attack', e => {
  if (playerState.dead) return;
  playerState.health = Math.max(0, playerState.health - e.damage); playerState.damageTaken += e.damage;
  playerState.hurt = Math.min(1, playerState.hurt + 0.35 + e.damage / 30);
  playerState.attacks.push({ zombie: e.agent.id, kind: e.kind, target: e.target, damage: e.damage });
  if (playerState.health <= 0) { playerState.dead = true; $('death').style.display = 'flex'; }
});
/** Back to the start: full health, zombies re-attached behind the barricade. */
function restart() {
  playerState.health = MAX_HEALTH; playerState.dead = false; playerState.hurt = 0;
  $('death').style.display = 'none';
  reattach();
}
function updateHUD(dt) {
  const k = playerState.dead ? 0.85 : Math.min(1, playerState.hurt + (1 - playerState.health / MAX_HEALTH) * 0.35);
  playerState.hurt = Math.max(0, playerState.hurt - dt * 0.8);
  $('vignette').style.opacity = k.toFixed(3);
  vignette.material.opacity = k; vignette.visible = renderer.xr.isPresenting && k > 0.01;
  $('health').textContent = `Liv ${Math.ceil(playerState.health)}`;
}

// ---- UI
const showValue = id => { const v = $(`${id}-v`); if (v) v.textContent = $(id).value; };
for (const id of ['level', 'blood', 'bones', 'organs', 'lifetime', 'maxgibs']) $(id).addEventListener('input', () => { showValue(id); world.setConfig(settings()); });
$('damage').addEventListener('input', () => showValue('damage'));
$('variant').addEventListener('change', () => { world.setConfig(settings()); reattach(); });
$('reset').addEventListener('click', () => reattach());
$('walk').addEventListener('click', () => { walking = !walking; $('walk').textContent = walking ? 'Stop' : 'Gå'; });
$('respawn').addEventListener('click', () => { spawning = spawn(+$('count').value); });
$('enter-xr').addEventListener('click', () => vrButton.click());
$('aidebug').addEventListener('click', () => toggleDebug());
$('restart').addEventListener('click', () => restart());
addEventListener('keydown', e => { if (e.key === 'i' || e.key === 'I') toggleDebug(); });
function toggleDebug(v = !aiDebug.visible) { aiDebug.visible = v; $('aidebug').textContent = v ? 'Skjul AI' : 'Vis AI'; }
toggleDebug(aiDebug.visible);
const vrButton = VRButton.createButton(renderer, { optionalFeatures: ['local-floor'] }); vrButton.style.display = 'none'; document.body.append(vrButton);
/** Everything back on: the gore runtime is re-attached (picks up the seam variant), the zombies start over. */
function reattach() {
  for (const z of zombies) {
    z.gore.dispose(); z.gore = world.attach(z.character, { uncover: true }); z.deadFor = 0;
    z.position.z = spawnZ(); z.entity.updateNPC({ state: 'idle', gait: 'walk' }, 0);
    z.physical = 'standing'; z.physicalFor = 0; z.crawling = false; z.react?.reset();
  }
  world.effects.clear();
  ai.reset();
  for (const z of zombies) syncGore(z);
  alertAll();
}

// ---- loop
const timer = new THREE.Clock();
let elapsed = 0, fps = 0, frames = 0, fpsAt = 0, drawCalls = 0;
function animate() {
  const dt = Math.min(timer.getDelta(), 0.05);
  elapsed += dt; frames++;
  if (elapsed - fpsAt > 1) { fps = frames / (elapsed - fpsAt); frames = 0; fpsAt = elapsed; }
  physics.step(dt);
  updateAI(dt);
  updateZombies(dt, elapsed);
  aiDebug.update();
  updateHUD(dt);
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
    `draw calls ${drawCalls} (zombier ${s.drawCalls}) · ${fps.toFixed(0)} fps\n` +
    `AI: ${zombies.map(z => z.agent.intent.state).join(' · ')}`;
}
renderer.setAnimationLoop(animate);
document.querySelector('#crosshair').style.display = 'block';

spawning = spawn(Math.max(1, Math.min(5, Number(params.get('zombies') ?? $('count').value))));
const ready = spawning.then(() => true);

// Test hooks (scripts/gore-smoke.mjs, scripts/ai-smoke.mjs): shoot a region through the real ray path, from the camera.
window.__lab = {
  THREE, scene, camera, renderer, world, zombies, pistol, ready, ai, navmesh, aiDebug, player: playerState, restart, toggleDebug,
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
  /** Fires from the camera along a direction (a miss is still a gunshot the zombies hear). */
  fire(direction) { return !!shoot(playerPos(), new THREE.Vector3(...direction).normalize()); },
  stats: () => ({ ...world.stats(), drawCallsFrame: drawCalls, fps, shots, hits, zombies: zombies.map(z => ({ lost: z.gore.lostRegions(), dead: z.gore.dead, mobility: z.gore.mobility(), gait: z.anim?.gait ?? 'walk', contacts: z.anim?.contacts ?? null, drawCalls: z.gore.drawCalls(), attachMs: z.gore.attachMs, baked: z.gore.baked })) }),
  /** AI snapshot: per zombie its state, position, physical state, telegraph, path corners and surround slot. */
  aiStats: () => ({ world: ai.stats(), health: playerState.health, dead: playerState.dead, attacks: playerState.attacks.slice(),
    zombies: zombies.map(z => ({ id: z.agent.id, state: z.agent.intent.state, physical: z.agent.physical, telegraph: z.agent.intent.telegraph, gait: z.agent.intent.gait,
      react: z.react ? { state: z.react.state, ragdoll: z.react.ragdollActive, instability: +z.react.reaction.instability.toFixed(3) } : null,
      attack: z.agent.intent.attack, target: z.agent.intent.target, position: z.position.toArray(), alert: z.agent.perception.alert, contact: !!z.agent.perception.contact,
      memory: z.agent.perception.memory, path: z.agent.move.hasPath ? z.agent.move.path.map(p => [p.x, p.z]) : [], slot: z.agent.slot ? { ...z.agent.slot } : null })) }),
  setConfig: c => world.setConfig(c), settings, reattach, hitReact: { enabled: HIT_REACT, config: HIT_REACT_CONFIG },
};
window.__pageLifecycle = bindPageLifecycle({ suspend: () => renderer.setAnimationLoop(null), resume: () => renderer.setAnimationLoop(animate), resetClock: () => timer.getDelta(),
  keepActiveWhenHidden: () => renderer.xr.isPresenting,
  dispose: () => { aiDebug.dispose(); world.dispose(); plugin.dispose?.(); pistol.dispose(); renderer.dispose(); } });
