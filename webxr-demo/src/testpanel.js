// Headset test panel (GameSystems/tools/headset-lab; extensions plan steps 3 and 10). main.js loads it only with
// ?testpanel. It adds a small panel above the demo's VR panel (and the same controls on the desktop HUD):
//   - frame interval (mean and worst over the last second) and the time the last 'grab' event took: the avatar's
//     listener adapts the grasp there, incl. the closure search at grasp quality 'mid'/'high' (once per bottle and hand,
//     memoised), so this is the closure-search cost on the device;
//   - "Hånd": cycles runtime hand-profile overrides on the avatar's player (entity.setHandProfile; null = none). The next
//     grab closes on the new profile (the avatar rebuilds its grasp hand when handProfileVersion changes);
//   - "Greb": cycles the grasp quality (grasp extension setGraspQuality: low | mid | high); ?grasp=<tier> sets the start.
// Debug only: it wraps host.emit to time 'grab' and chains scene.onBeforeRender; nothing else depends on it.
import * as THREE from 'three';
import { setGraspQuality, graspQuality, GRASP_QUALITY } from './vendor/extensions/grasp/index.js';

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
  function cycleTier() {
    const next = TIERS[(TIERS.indexOf(graspQuality()) + 1) % TIERS.length];
    setGraspQuality(next);
    hud(`Grebskvalitet: ${next}`);
    refresh();
  }

  // VR: info line + two buttons above the demo's panel (Interaction picks uiTargets with the controller ray).
  const panel = new THREE.Group(); panel.position.set(0, 2.2, 0.95);
  const info = canvasPlane(1.13, 0.12), handButton = canvasPlane(0.55, 0.12, 512, true), tierButton = canvasPlane(0.55, 0.12, 512, true);
  info.mesh.position.set(0, 0.07, 0);
  handButton.mesh.position.set(-0.29, -0.07, 0); tierButton.mesh.position.set(0.29, -0.07, 0);
  handButton.mesh.userData.action = cycleProfile; tierButton.mesh.userData.action = cycleTier;
  panel.add(info.mesh, handButton.mesh, tierButton.mesh);
  scene.add(panel);
  interaction.uiTargets.push(handButton.mesh, tierButton.mesh);

  // Desktop: the same controls in the HUD.
  const dom = document.createElement('div');
  dom.style.cssText = 'pointer-events:auto;margin-top:8px;display:flex;gap:7px;flex-wrap:wrap;align-items:center;font-size:12px';
  const domInfo = document.createElement('span');
  const domHand = Object.assign(document.createElement('button'), { onclick: cycleProfile });
  const domTier = Object.assign(document.createElement('button'), { onclick: cycleTier });
  dom.append(domHand, domTier, domInfo);
  (document.getElementById('top') || document.body).append(dom);

  function refresh() {
    const frame = `Frame: ${ms(mean)} ms snit / ${ms(max)} maks`, grab = `Greb: ${ms(lastGrab)} ms (${graspQuality()}, #${grabCount})`;
    info.draw([`${frame} · ${grab}`]);
    handButton.draw([`Hånd: ${HAND_PROFILES[profile].label}`]);
    tierButton.draw([`Greb: ${graspQuality()}`]);
    domInfo.textContent = `${frame} · ${grab}`;
    domHand.textContent = `Hånd: ${HAND_PROFILES[profile].label}`;
    domTier.textContent = `Greb: ${graspQuality()}`;
  }
  refresh();
  return {
    get lastGrabMs() { return lastGrab; }, get grabCount() { return grabCount; }, get frame() { return { mean, max }; },
    get profile() { return HAND_PROFILES[profile]; }, cycleProfile, cycleTier,
  };
}
