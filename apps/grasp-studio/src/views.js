// Grasp Studio visuals (three.js): tracked / bone-model hands, the item, the countdown badge and the in-XR poke panel.
// Cheap by design: one instanced mesh + one line set per hand, canvas textures redrawn only when their content changes.
import * as THREE from 'three';
import { XR_JOINTS, XR_CHAINS } from './vendor/extensions/grasp/index.js';

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
export const TIP_COLORS = { free: 0xe8e2d6, touch: 0x3dff7a, inside: 0xff2a2a };
const TIP_NAMES = FINGERS.map(f => XR_CHAINS[f][3]);
const BONES = [];
for (const f of FINGERS) {
  const chain = f === 'Thumb' ? ['wrist', ...XR_CHAINS[f]] : ['wrist', XR_CHAINS[f][0].replace('phalanx-proximal', 'metacarpal'), ...XR_CHAINS[f]];
  for (let k = 1; k < chain.length; k++) BONES.push([chain[k - 1], chain[k]]);
}

/** Joints (spheres) + bones (lines) of one hand; fingertips coloured by contact state. */
export class HandView {
  constructor(scene, { color = 0xd8d2c4, radius = 0.006, opacity = 1 } = {}) {
    this.base = new THREE.Color(color);
    const material = new THREE.MeshBasicMaterial({ transparent: opacity < 1, opacity });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), material, XR_JOINTS.length);
    this.mesh.frustumCulled = false;
    this.radius = radius;
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
    this.lines.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BONES.length * 6), 3));
    this.lines.frustumCulled = false;
    this.group = new THREE.Group();
    this.group.add(this.mesh, this.lines);
    scene.add(this.group);
    this.m = new THREE.Matrix4(); this.c = new THREE.Color();
    this.show(null);
  }
  /** joints: name -> [x,y,z] (world) or null to hide; tips: { Thumb..Little: 'free' | 'touch' | 'inside' } */
  show(joints, tips = null) {
    this.group.visible = !!joints;
    if (!joints) return;
    XR_JOINTS.forEach((name, i) => {
      const p = joints[name] || joints.wrist, tip = TIP_NAMES.indexOf(name), r = tip >= 0 ? this.radius * 1.35 : this.radius;
      this.m.makeScale(r, r, r).setPosition(p[0], p[1], p[2]);
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, tip >= 0 && tips ? this.c.setHex(TIP_COLORS[tips[FINGERS[tip]]] ?? TIP_COLORS.free) : this.base);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    const a = this.lines.geometry.attributes.position;
    BONES.forEach(([from, to], k) => { const p = joints[from], q = joints[to]; a.array.set([...p, ...q], k * 6); });
    a.needsUpdate = true;
  }
}

/** The item: the catalogue silhouette: a lathe (item origin = base centre, +Y up), or a cylinder / box / parts (origin = centre). */
export function itemMesh(shape, { color = 0x5b3a12, opacity = 0.55, wireframe = false } = {}) {
  if (shape.type !== 'lathe') {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0, transparent: true, opacity, wireframe, depthWrite: !wireframe && opacity > 0.9 });
    const group = new THREE.Group();
    for (const p of shape.type === 'parts' ? shape.parts : [shape]) {
      const geometry = p.type === 'cylinder' ? new THREE.CylinderGeometry(p.radius, p.radius, p.half * 2, 32)
        : p.type === 'lathe' ? new THREE.LatheGeometry([new THREE.Vector2(0, p.profile[0][0]), ...p.profile.map(([y, r]) => new THREE.Vector2(r, y)), new THREE.Vector2(0, p.profile.at(-1)[0])], 32)
        : new THREE.BoxGeometry(...p.size);
      const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...(p.at || [0, 0, 0]));
      group.add(mesh);
    }
    return group;
  }
  const points = shape.profile.map(([y, r]) => new THREE.Vector2(r, y));
  points.unshift(new THREE.Vector2(0, shape.profile[0][0]));
  points.push(new THREE.Vector2(0, shape.profile.at(-1)[0]));
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0, transparent: true, opacity, wireframe, depthWrite: !wireframe && opacity > 0.9 });
  return new THREE.Mesh(new THREE.LatheGeometry(points, 32), material);
}

/** Canvas-texture helper: redraws only when the key changes. */
class CanvasTexture {
  constructor(w, h) {
    this.canvas = document.createElement('canvas'); this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas); this.texture.colorSpace = THREE.SRGBColorSpace;
    this.key = null;
  }
  draw(key, fn) { if (key === this.key) return; this.key = key; fn(this.ctx, this.canvas.width, this.canvas.height); this.texture.needsUpdate = true; }
}

/** Countdown / result badge above the item (always faces the camera). */
export class Badge {
  constructor(scene) {
    this.tex = new CanvasTexture(256, 256);
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.texture, transparent: true, depthTest: false }));
    this.sprite.scale.set(0.09, 0.09, 1); this.sprite.renderOrder = 10;
    scene.add(this.sprite);
  }
  /** state: { mode: 'hidden' | 'countdown' | 'result', progress, remaining, score, ok } */
  update(position, s) {
    this.sprite.visible = s.mode !== 'hidden';
    if (!this.sprite.visible) return;
    this.sprite.position.set(...position);
    const key = s.mode === 'countdown' ? `c${Math.round(s.progress * 40)}` : `r${s.score}${s.ok}`;
    this.tex.draw(key, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.lineWidth = 22; g.strokeStyle = '#ffffff33'; g.beginPath(); g.arc(w / 2, h / 2, 100, 0, Math.PI * 2); g.stroke();
      const colour = s.mode === 'countdown' ? '#f7c880' : s.ok ? '#3dff7a' : '#ff9a3d';
      g.strokeStyle = colour; g.beginPath();
      g.arc(w / 2, h / 2, 100, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (s.mode === 'countdown' ? s.progress : 1)); g.stroke();
      g.fillStyle = colour; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = 'bold 84px system-ui, sans-serif';
      g.fillText(s.mode === 'countdown' ? s.remaining.toFixed(1) : String(s.score), w / 2, h / 2);
    });
  }
}

/**
 * In-XR panel: a canvas plane with buttons pressed by poking with a fingertip (the index tip of either hand; main.js leaves
 * out the recording hand while it is being captured). buttons: [{ id, label, row, col, cols?, active? }], 4 columns x 4 rows; text: status lines below them.
 */
export class Panel {
  constructor(scene, { width = 0.4, height = 0.3, textRow = 2, maxLines = 5, font = 30 } = {}) {
    this.size = [width, height]; this.textRow = textRow; this.maxLines = maxLines; this.font = font;
    this.tex = new CanvasTexture(1024, Math.round(1024 * height / width));
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: this.tex.texture, transparent: true, side: THREE.DoubleSide }));
    scene.add(this.mesh);
    this.buttons = []; this.lines = []; this.hot = null; this.inside = new Set(); this.cooldown = 0;
    this.v = new THREE.Vector3();
  }
  rect(b) {
    const W = this.tex.canvas.width, pad = 14, cw = (W - pad * 5) / 4, bh = 92, top = 20;
    return [pad + b.col * (cw + pad), top + b.row * (bh + pad), cw * (b.cols || 1) + pad * ((b.cols || 1) - 1), bh];
  }
  render(buttons, lines) {
    this.buttons = buttons; this.lines = lines;
    const key = JSON.stringify([buttons.map(b => [b.id, b.label, b.active, b.disabled]), lines, this.hot]);
    this.tex.draw(key, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#111b20e8'; g.beginPath(); g.roundRect(0, 0, w, h, 28); g.fill();
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 34px system-ui, sans-serif';
      for (const b of buttons) {
        const [x, y, bw, bh] = this.rect(b);
        g.fillStyle = b.disabled ? '#1c2629' : b.id === this.hot ? '#f7c880' : b.active ? '#3b6f5a' : '#26373b';
        g.beginPath(); g.roundRect(x, y, bw, bh, 16); g.fill();
        g.fillStyle = b.disabled ? '#5d6a6d' : b.id === this.hot ? '#111' : '#f6eadb'; g.fillText(b.label, x + bw / 2, y + bh / 2);
      }
      g.textAlign = 'left'; g.font = `${this.font}px system-ui, sans-serif`; g.fillStyle = '#e8ded0';
      const y0 = this.rect({ row: Math.max(this.textRow, ...buttons.map(b => b.row)) + 1, col: 0 })[1] + 6;
      lines.slice(0, this.maxLines).forEach((line, i) => g.fillText(line, 24, y0 + i * (this.font + 10), w - 48));
    });
  }
  /** Forget pokes in progress (session start / end: a finger that was inside a button must not count as held). */
  reset() { this.inside = new Set(); this.hot = null; this.cooldown = 0; }
  /** Fingertips (world [x,y,z]) -> the id of a button newly pressed this frame, or null. */
  poke(tips, dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const W = this.tex.canvas.width, H = this.tex.canvas.height, [pw, ph] = this.size, now = new Set();
    let pressed = null;
    this.mesh.updateWorldMatrix(true, false);
    for (const tip of tips) {
      if (!tip) continue;
      this.mesh.worldToLocal(this.v.set(...tip));
      if (this.v.z < -0.02 || this.v.z > 0.012) continue;
      const px = (this.v.x / pw + 0.5) * W, py = (0.5 - this.v.y / ph) * H;
      for (const b of this.buttons) {
        const [x, y, bw, bh] = this.rect(b);
        if (b.disabled || px < x || px > x + bw || py < y || py > y + bh) continue;
        now.add(b.id);
        if (!this.inside.has(b.id) && !this.cooldown) { pressed = b.id; this.cooldown = 0.4; }
      }
    }
    this.inside = now; this.hot = [...now][0] ?? null;
    return pressed;
  }
}

/**
 * A short, loud result line in VR (save ok / NOT saved): a plane above the poke panel, green or red, shown for `seconds`.
 * show(text, { ok, seconds }); update(dt, position, quaternion) every frame.
 */
export class Toast {
  constructor(scene, { width = 0.4, height = 0.06 } = {}) {
    this.tex = new CanvasTexture(1024, Math.round(1024 * height / width));
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: this.tex.texture, transparent: true, side: THREE.DoubleSide, depthTest: false }));
    this.mesh.renderOrder = 11; this.mesh.visible = false;
    scene.add(this.mesh);
    this.left = 0; this.text = ''; this.ok = true;
  }
  show(text, { ok = true, seconds = ok ? 4 : 15 } = {}) {
    this.text = text; this.ok = ok; this.left = seconds;
    this.tex.draw(`${ok}${text}`, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = ok ? '#1f6b43f0' : '#9b1c1cf2'; g.beginPath(); g.roundRect(0, 0, w, h, 24); g.fill();
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 50px system-ui, sans-serif';
      g.fillText(text, w / 2, h / 2, w - 40);
    });
  }
  hide() { this.left = 0; }
  update(dt, position, quaternion, visible = true) {
    this.left = Math.max(0, this.left - dt);
    this.mesh.visible = visible && this.left > 0;
    if (!this.mesh.visible) return;
    this.mesh.position.copy(position); this.mesh.quaternion.copy(quaternion);
  }
}
