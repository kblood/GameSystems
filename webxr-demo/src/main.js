import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { PhysicsWorld, box } from './physics.js';
import { Interaction, DESKTOP_EYE } from './interaction.js';
import { SHELVES, BAR_ITEMS, BAR_X, BAR_TOP } from './lineup.js';
import { assetUrl } from './urls.js';
import { createHost } from './vendor/extensions/host/index.js';
import bottlesExtension from './vendor/extensions/bottles/index.js';
import materialsExtension from './vendor/extensions/materials/index.js';
import { createBarFire, liquidKindOf } from './bar-fire.js';
import { createPistol } from './pistol.js';

const status = document.getElementById('status');
const toastNode = document.getElementById('toast');
let toastTimer;
function toast(message) {
  toastNode.textContent = message; toastNode.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastNode.classList.remove('visible'), 1700);
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8298a3);
scene.fog = new THREE.Fog(0x8298a3, 8, 24);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.02, 120);
camera.position.set(0, DESKTOP_EYE, 0);
const rig = new THREE.Group(); rig.position.set(0, 0, 2.6); rig.add(camera); scene.add(rig);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
document.body.prepend(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xc5dcf5, 0x554538, 1.6));
const sun = new THREE.DirectionalLight(0xffe5c1, 1.3);
sun.position.set(2, 5, 4); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -6; sun.shadow.camera.right = 6; sun.shadow.camera.top = 5; sun.shadow.camera.bottom = -5;
scene.add(sun);
const lamp = new THREE.PointLight(0xffd6a0, 17, 6); lamp.position.set(0, 2.2, 1); scene.add(lamp);

const physics = new PhysicsWorld();
// Optional features are extensions (GameSystems/extensions/host); the core sends events, extensions react.
const game = {};
const host = createHost({ THREE, scene, renderer, camera, game, physics: physics.adapter, quality: 2,
  assetURL: path => new URL(path, document.baseURI) });
let factory, pour, breakage, interaction, materialSystem, fire, pistol;
let generation = 0;
let paused = false;
const quality = document.getElementById('quality');
const pauseButton = document.getElementById('pause');

function buildRoom() {
  box(scene, physics, [10, 0.2, 10], [0, -0.1, 0], 0x77706d, { surface: 'concrete' });
  box(scene, physics, [1.6, BAR_TOP, 0.9], [BAR_X, BAR_TOP / 2, -0.05], 0x6b472c, { surface: 'wood' });
  for (const shelf of SHELVES) {
    box(scene, physics, [3.5, 0.05, 0.4], [0, shelf.y - 0.025, -0.25], 0x8b5b35, { surface: 'wood' });
    const light = new THREE.SpotLight(0xffe4b2, 13, 2.5, 0.65, 0.75);
    light.position.set(0, shelf.y + 0.55, 0.45); light.target.position.set(0, shelf.y, -0.2);
    scene.add(light, light.target);
  }
  const c = 0x393638, winX = -2.9, winW = 1.34, winY = 1.45, winH = 1.44;
  const x0 = -4.5, x1 = 2.1, l = winX - winW / 2, r = winX + winW / 2;
  box(scene, physics, [l - x0, 2.6, 0.1], [(x0 + l) / 2, 1.3, -0.5], c);
  box(scene, physics, [x1 - r, 2.6, 0.1], [(r + x1) / 2, 1.3, -0.5], c);
  const low = winY - winH / 2, high = winY + winH / 2;
  box(scene, physics, [winW, low, 0.1], [winX, low / 2, -0.5], c);
  box(scene, physics, [winW, 2.6 - high, 0.1], [winX, (high + 2.6) / 2, -0.5], c);
  const barLight = new THREE.SpotLight(0xffe4b2, 14, 3.2, 0.7, 0.7);
  barLight.position.set(BAR_X, 2.1, 0.8); barLight.target.position.set(BAR_X, BAR_TOP, 0);
  scene.add(barLight, barLight.target);
}
buildRoom();

function setQuality(value) {
  const level = THREE.MathUtils.clamp(Number(value), 0, 3);
  quality.value = String(level);
  renderer.setPixelRatio(Math.min(devicePixelRatio, [0.7, 0.9, 1.2, 1.6][level]));
  renderer.shadowMap.enabled = level >= 2;
  sun.castShadow = level >= 2;
  host.setQuality(level); // bottles: minimal/low/mid/high; avatar: minimal = off, higher = on
  toast(`Kvalitet: ${['minimal', 'lav', 'mellem', 'høj'][level]}`);
}

function setPause() {
  paused = !paused;
  pauseButton.textContent = paused ? 'Fortsæt' : 'Pause';
  if (paused) interaction?.releaseAll();
  toast(paused ? 'Pause' : 'Fortsætter');
}

async function populate(token) {
  const queue = [];
  for (const shelf of SHELVES) shelf.items.forEach(([id, design], i) => {
    const fill = 0.35 + 0.1 * ((i * 7 + Math.floor(shelf.y * 10)) % 6);
    queue.push({ id, design, fill, position: new THREE.Vector3((i - (shelf.items.length - 1) / 2) * 0.36, shelf.y + 0.003, -0.2), open: false });
  });
  BAR_ITEMS.forEach(([id, design, fill, x, open], i) => queue.push({ id, design, fill, position: new THREE.Vector3(BAR_X + x, BAR_TOP + 0.003, i >= 6 ? -0.2 : 0.05), open }));
  let loaded = 0, failed = 0;
  // Limit concurrent shader/model work; each source asset remains in the parent GameSystems tree.
  const workers = Array.from({ length: 4 }, async () => {
    while (queue.length && token === generation) {
      const item = queue.shift();
      try {
        const b = await factory.spawn(item.id, item.design, item.fill, item.position, item.open);
        const kind = liquidKindOf(item.id, item.design); if (kind) b.liquidKind = kind; // what burns when spilled (bar-fire.js)
        if (token !== generation) { factory.remove(b); break; }
        pour.register(b);
        loaded++;
      } catch (error) { failed++; console.error(`Unable to load ${item.design || item.id}`, error); }
      status.textContent = `Indlæser flasker: ${loaded + failed}/29`;
    }
  });
  await Promise.all(workers);
  if (token === generation) {
    status.textContent = `${loaded} beholdere · ${breakage.panes.length} ruder${failed ? ` · ${failed} kunne ikke indlæses` : ''}`;
    toast(failed ? 'Nogle modeller kunne ikke indlæses' : 'Scenen er klar');
  }
}

async function reset() {
  if (!factory || !breakage || !pour) return;
  const token = ++generation;
  interaction?.releaseAll();
  breakage.reset();
  pistol?.reset();
  pour.clear();
  materialSystem?.reset();
  for (const b of [...factory.bottles]) factory.remove(b);
  status.textContent = 'Nulstiller…';
  await populate(token);
}

let audioAdapter = null;
/** Contact sound for every bottle impact the physics reports (strength from the impact speed, material from the bottle and the surface hit). */
function hookContactSounds(audio) {
  const previous = factory.onImpact; // the breakage system's handler; it runs first and marks a shattered bottle broken
  factory.onImpact = (b, impact) => {
    previous?.(b, impact);
    if (b.broken) return;
    audio.contact({ material1: b.isPlastic ? 'plastic' : b.profile?.material === 'ceramic' ? 'ceramic' : 'glass', material2: impact.surface,
      speed: impact.speed, normal: impact.normal, position: impact.point, sourceId: b.id });
  };
  host.on('pistol', e => { if (e.state === 'dropped') audio.contact({ material1: 'pistol', material2: 'concrete', speed: 2.5 }); });
}

async function init() {
  try {
    const response = await fetch(assetUrl('catalog.json'));
    if (!response.ok) throw new Error(`catalog.json: HTTP ${response.status}`);
    const catalog = await response.json();
    // Bottle deposits route to independently registered material surfaces; the adapter applies wet friction.
    const materialSurfaces = new Map(physics.surfaces.map(mesh => {
      mesh.userData.materialId = mesh.uuid; mesh.userData.dryColor = mesh.material.color.clone(); return [mesh.uuid, mesh];
    }));
    materialSystem = await host.load(materialsExtension, { applySurface(id, state) {
      const mesh = materialSurfaces.get(id); if (!mesh) return;
      physics.adapter.setFriction(mesh.userData.physicsBody, state.friction);
      mesh.material.color.copy(mesh.userData.dryColor).multiplyScalar(1 - state.wetness * 0.15);
      mesh.material.roughness = 0.8 - state.wetness * 0.4;
    } });
    if (!materialSystem) throw new Error('materials extension failed to load');
    for (const [id, mesh] of materialSurfaces) materialSystem.add(id, { material: mesh.userData.surface === 'wood' ? 'wood' : 'concrete' });
    // Bottles are an extension on the physics adapter (GameSystems/extensions/bottles); it steps from physics.step.
    // Optional sound (?audio): spatial voice pool, material contact sounds, grab/release. Without the parameter nothing changes:
    // the bottles keep their own HTML audio.
    let audio = null;
    if (new URLSearchParams(location.search).has('audio')) {
      try {
        const audioModule = await import('./vendor/extensions/audio/index.js');
        audio = await host.load(audioModule.default, { assetURL: assetUrl });
        if (audio) { audioAdapter = audioModule.createBottleAudioAdapter(audio); window.__audio = audio; }
      } catch (error) { console.error('audio', error); }
    }
    // Viscosity-dependent hole outflow (beer/spirits drain a little slower; liquid_props.js): off by default, on with ?testpanel, ?viscosity=on|off decides.
    const demoParams = new URLSearchParams(location.search), viscosityParam = demoParams.get('viscosity');
    const liquidViscosity = viscosityParam === 'on' ? true : viscosityParam === 'off' ? false : demoParams.has('testpanel');
    const bottles = await host.load(bottlesExtension, { catalog, assetURL: assetUrl, surfaces: physics.surfaces, audio: audioAdapter ?? undefined, liquidViscosity });
    if (!bottles) throw new Error('bottles extension failed to load');
    ({ factory, pour, breakage } = bottles);
    if (audio) hookContactSounds(audio);
    breakage.createPanes();
    // Spilled diesel and strong alcohol burn (thermal + pools, bar-fire.js); a shot into such a pool lights it.
    fire = await createBarFire({ host, scene, bottles });
    host.on('shot', ({ origin, direction, hit }) => {
      if (hit) return;
      const pool = fire.igniteAlong(origin, direction);
      if (pool) toast(pool.components.diesel ? 'Dieselen brænder' : 'Spiritussen brænder');
    });
    // A pistol with a laser sight in a holster on the right hip (pistol.js); dropped, it is back in the holster after 20 s.
    pistol = createPistol({ scene, head: camera,
      targets: () => {
        const meshes = [...physics.surfaces, ...breakage.panes.filter(p => !p.broken).map(p => p.sheet)];
        for (const b of factory.bottles) b.root.traverse(o => { if (o.isMesh) meshes.push(o); });
        return meshes;
      },
      surfaces: () => physics.surfaces,
      onReturn: () => toast('Pistolen er tilbage i hylsteret') });
    interaction = new Interaction({ renderer, scene, camera, rig, factory, physics, breakage, host, pistol,
      actions: { reset, pause: setPause, quality: setQuality }, hud: toast });
    host.on('broken', ({ bottle }) => interaction.dropBottle(bottle)); // before the avatar's listener: hands let go first
    game.interaction = interaction;
    window.__demo = { interaction, factory, breakage, pour, bottles, physics, camera, rig, renderer, scene, host, materials: materialSystem, fire, pistol };
    // Headset test panel (tools/headset-lab): frame time, grab cost, hand-profile and grasp-quality buttons; only with ?testpanel.
    if (new URLSearchParams(location.search).has('testpanel')) {
      import('./testpanel.js').then(m => { window.__testpanel = m.installTestPanel({ host, interaction, scene, hud: toast }); })
        .catch(error => console.error('testpanel', error));
    }
    setQuality(2);
    const loading = populate(++generation);
    // The avatar is an optional extension (?avatar=0 or off skips it). It is loaded with a dynamic import, so a missing
    // Contracts sync or a load failure leaves the plain demo running with the generic controller models.
    if (!['0', 'off'].includes(new URLSearchParams(location.search).get('avatar'))) {
      host.load(() => import('./avatar.js'), { id: 'avatar' }).then(a => {
        if (a) window.__avatar = a; else toast('Avatar kunne ikke indlæses');
      });
    }
    await loading;
  } catch (error) {
    status.textContent = `Kunne ikke starte: ${error.message}`;
    console.error(error);
  }
}

document.getElementById('reset').addEventListener('click', reset);
pauseButton.addEventListener('click', setPause);
quality.addEventListener('change', () => setQuality(quality.value));
const vrButton = VRButton.createButton(renderer, { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
vrButton.style.display = 'none';
document.body.append(vrButton);
document.getElementById('enter-xr').addEventListener('click', () => vrButton.click());
renderer.xr.addEventListener('sessionstart', () => {
  document.getElementById('crosshair').style.display = 'none';
  toast('Grip: grib (pistolen sidder i hylsteret på højre hofte; frie hånd ved proppen: drej + træk af) · trigger: skyd · venstre stick: flyt · højre: drej, op/ned: rejs dig/buk dig');
  host.emit('xrStart', {});
});
// Interaction's own sessionend handler (registered first) has already released holds and restored the desktop camera.
renderer.xr.addEventListener('sessionend', () => { document.getElementById('crosshair').style.display = ''; host.emit('xrEnd', {}); });
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!paused && interaction) {
    interaction.step(dt);
    host.update(dt);
    fire?.update(dt);
    physics.step(dt); // then the bottles extension (liquid, pouring, breakage) from physics.onStep
  }
  renderer.render(scene, camera);
});
init();
