// Headset test panel (GameSystems/tools/headset-lab; extensions plan steps 3 and 10). main.js loads it only with
// ?testpanel. It adds a small panel above the demo's VR panel (and the same controls on the desktop HUD):
//   - frame interval (mean and worst over the last second) and the time the last 'grab' event took: the avatar's
//     listener adapts the grasp there, incl. the closure search at grasp quality 'mid'/'high' (once per bottle and hand,
//     memoised), so this is the closure-search cost on the device;
//   - "Hånd": cycles runtime hand-profile overrides on the avatar's player (entity.setHandProfile; null = none). The next
//     grab closes on the new profile (the avatar rebuilds its grasp hand when handProfileVersion changes);
//   - "Vægt": the visual weight lag of the shown hand (grasp/weight_lag.js; ON here, ?weightlag=off starts it off) and "Rå hånd":
//     show the unlagged hand while it is on (the raw hand can always be seen);
//   - "Greb": cycles the grasp quality (grasp extension setGraspQuality: low | mid | high); ?grasp=<tier> sets the start.
// Debug only: it wraps host.emit to time 'grab' and chains scene.onBeforeRender; nothing else depends on it.
import * as THREE from 'three';
import { setGraspQuality, graspQuality, GRASP_QUALITY } from './vendor/extensions/grasp/index.js';
import { setBottleLiquidColor } from './vendor/extensions/bottles/index.js';

export const HAND_PROFILES = Object.freeze([
  { label: 'normal', override: null },
  { label: 'størrelse 1,15', override: { size: 1.15 } },
  { label: 'størrelse 0,9', override: { size: 0.9 } },
  { label: 'tykkelse 1,3', override: { girth: 1.3 } },
  { label: 'tykkelse 0,8', override: { girth: 0.8 } },
]);
const TIERS = ['low', 'mid', 'high'];
const ms = v => (v == null ? '–' : v.toFixed(1).replace('.', ','));

/** A plane with a canvas texture that can be redrawn. */
function canvasPlane(width, height, px = 1024, button = false) {
  const canvas = document.createElement('canvas');
  canvas.width = px; canvas.height = Math.round(px * height / width);
  const ctx = canvas.getContext('2d'), texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, transparent: true }));
  const draw = lines => {
    ctx.fillStyle = button ? '#263b40' : '#101c20'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = button ? '#a8bdba' : '#4c6a70'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
    ctx.fillStyle = '#fff1d5'; ctx.textBaseline = 'middle'; ctx.textAlign = button ? 'center' : 'left';
    const size = Math.round(canvas.height / (lines.length + 0.9));
    ctx.font = `bold ${size}px system-ui`;
    lines.forEach((line, i) => ctx.fillText(line, button ? canvas.width / 2 : 24, (i + 0.95) * size + (canvas.height - (lines.length + 0.9) * size) / 2, canvas.width - 40));
    texture.needsUpdate = true;
  };
  return { mesh, draw };
}

export function installTestPanel({ host, interaction, scene, hud = () => {}, search = location.search }) {
  const start = new URLSearchParams(search).get('grasp');
  if (GRASP_QUALITY.includes(start)) setGraspQuality(start);
  let profile = 0, lastGrab = null, grabCount = 0;

  // Time the synchronous 'grab' event: every listener runs inside emit (Interaction calls host.emit at call time).
  const emit = host.emit;
  host.emit = (event, data) => {
    if (event !== 'grab') return emit(event, data);
    const t0 = performance.now();
    try { return emit(event, data); } finally { lastGrab = performance.now() - t0; grabCount++; }
  };

  // Frame interval from render to render (XR frames too: the demo renders once per frame).
  let last = 0, sum = 0, n = 0, worst = 0, windowStart = 0, mean = null, max = null;
  const before = scene.onBeforeRender;
  scene.onBeforeRender = function (...args) {
    const now = performance.now();
    if (last) { const d = now - last; sum += d; n++; worst = Math.max(worst, d); }
    last = now;
    if (now - windowStart > 1000) { if (n) { mean = sum / n; max = worst; } sum = 0; n = 0; worst = 0; windowStart = now; refresh(); }
    return before.apply(this, args);
  };

  const avatarPlayer = () => host.get('avatar')?.player ?? null;
  function cycleProfile() {
    const player = avatarPlayer();
    if (!player?.setHandProfile) { hud('Ingen avatar: håndprofil kan ikke ændres'); return; }
    profile = (profile + 1) % HAND_PROFILES.length;
    player.setHandProfile(HAND_PROFILES[profile].override);
    hud(`Hånd: ${HAND_PROFILES[profile].label} (gælder fra næste greb)`);
    refresh();
  }
  const avatarApi = () => host.get('avatar') ?? null;
  function toggleWeight() {
    const a = avatarApi(); if (!a?.setWeightLag) { hud('Ingen avatar: vægtlag kan ikke skiftes'); return; }
    a.setWeightLag(!a.weightLag); hud(`Vægtlag: ${a.weightLag ? 'til' : 'fra'}`); refresh();
  }
  function toggleRaw() {
    const a = avatarApi(); if (!a?.setShowRawHand) { hud('Ingen avatar: rå hånd kan ikke skiftes'); return; }
    a.setShowRawHand(!a.showRawHand); hud(`Rå hånd: ${a.showRawHand ? 'vist (uden vægtlag)' : 'fra'}`); refresh();
  }
  function cycleTier() {
    const next = TIERS[(TIERS.indexOf(graspQuality()) + 1) % TIERS.length];
    setGraspQuality(next);
    hud(`Grebskvalitet: ${next}`);
    refresh();
  }

  // Colour mixing recipe (desktop button): the first two open bottles with liquid become red and blue, then 60 ml of the
  // blue one drops into the red one. mid/high fade the glass to purple, minimal/low switch once half is foreign.
  function mixRecipe() {
    const d = window.__demo, open = d ? [...d.factory.bottles].filter(b => b.open && !b.broken && b.fillMl > 100) : [];
    if (open.length < 2) { hud('Blanding: kræver to åbne flasker med væske'); return; }
    const [target, donor] = open.filter(b => b.capacity - b.fillMl > 80).slice(0, 1).concat(open.filter(b => b.fillMl > 100).slice(-1));
    if (!target || target === donor) { hud('Blanding: ingen modtager med plads'); return; }
    setBottleLiquidColor(target, [0.9, 0.08, 0.08]); setBottleLiquidColor(donor, [0.08, 0.1, 0.9]);
    target.liquidKind = 'wine'; donor.liquidKind = 'water';
    const ml = Math.min(60, donor.fillMl - 1); donor.fillMl -= ml; donor.liquid.fill = donor.fillMl / donor.capacity;
    const mouth = target.root.localToWorld(new THREE.Vector3(0, target.height, 0)).add(new THREE.Vector3(0, 0.25, 0));
    d.pour.emit(ml, mouth, new THREE.Vector3(), donor);
    hud(`Blanding: ${ml.toFixed(0)} ml blå væske i rød (${d.pour.settings.liquidMix})`);
  }

  // VR: info line + two buttons above the demo's panel (Interaction picks uiTargets with the controller ray).
  const panel = new THREE.Group(); panel.position.set(0, 2.2, 0.95);
  const info = canvasPlane(1.13, 0.12), handButton = canvasPlane(0.55, 0.12, 512, true), tierButton = canvasPlane(0.55, 0.12, 512, true);
  const weightButton = canvasPlane(0.55, 0.12, 512, true), rawButton = canvasPlane(0.55, 0.12, 512, true);
  weightButton.mesh.position.set(-0.29, -0.21, 0); rawButton.mesh.position.set(0.29, -0.21, 0);
  weightButton.mesh.userData.action = toggleWeight; rawButton.mesh.userData.action = toggleRaw;
  info.mesh.position.set(0, 0.07, 0);
  handButton.mesh.position.set(-0.29, -0.07, 0); tierButton.mesh.position.set(0.29, -0.07, 0);
  handButton.mesh.userData.action = cycleProfile; tierButton.mesh.userData.action = cycleTier;
  panel.add(info.mesh, handButton.mesh, tierButton.mesh, weightButton.mesh, rawButton.mesh);
  scene.add(panel);
  interaction.uiTargets.push(handButton.mesh, tierButton.mesh, weightButton.mesh, rawButton.mesh);

  // Desktop: the same controls in the HUD.
  const dom = document.createElement('div');
  dom.style.cssText = 'pointer-events:auto;margin-top:8px;display:flex;gap:7px;flex-wrap:wrap;align-items:center;font-size:12px';
  const domInfo = document.createElement('span');
  const domHand = Object.assign(document.createElement('button'), { onclick: cycleProfile });
  const domTier = Object.assign(document.createElement('button'), { onclick: cycleTier });
  const domMix = Object.assign(document.createElement('button'), { onclick: mixRecipe, textContent: 'Blanding' });
  const domWeight = Object.assign(document.createElement('button'), { onclick: toggleWeight });
  const domRaw = Object.assign(document.createElement('button'), { onclick: toggleRaw });
  dom.append(domHand, domTier, domWeight, domRaw, domMix, domInfo);
  (document.getElementById('top') || document.body).append(dom);

  function refresh() {
    const frame = `Frame: ${ms(mean)} ms snit / ${ms(max)} maks`, grab = `Greb: ${ms(lastGrab)} ms (${graspQuality()}, #${grabCount})`;
    info.draw([`${frame} · ${grab}`]);
    handButton.draw([`Hånd: ${HAND_PROFILES[profile].label}`]);
    tierButton.draw([`Greb: ${graspQuality()}`]);
    const a = avatarApi(), lag = a?.weightLag ? 'til' : 'fra', raw = a?.showRawHand ? 'vist' : 'fra';
    weightButton.draw([`Vægt: ${lag}`]); rawButton.draw([`Rå hånd: ${raw}`]);
    domWeight.textContent = `Vægt: ${lag}`; domRaw.textContent = `Rå hånd: ${raw}`;
    domInfo.textContent = `${frame} · ${grab}`;
    domHand.textContent = `Hånd: ${HAND_PROFILES[profile].label}`;
    domTier.textContent = `Greb: ${graspQuality()}`;
  }
  refresh();
  return {
    get lastGrabMs() { return lastGrab; }, get grabCount() { return grabCount; }, get frame() { return { mean, max }; },
    get profile() { return HAND_PROFILES[profile]; }, cycleProfile, cycleTier, mixRecipe, toggleWeight, toggleRaw,
  };
}
