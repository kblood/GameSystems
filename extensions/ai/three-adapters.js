// GameSystems ai extension: three.js adapters. THREE is passed in (the extension never imports three), so the decision
// logic stays engine-free and any three version the host uses works.
//
//   const boxes = boxesFromObjects(THREE, staticMeshes)              // world AABBs of the level's static meshes
//   const navmesh = createNavGrid({ boxes, bounds })                 // nav.js
//   const raycast = createRaycast(THREE, staticMeshes)               // (from, to) -> true when blocked
//   const debug = createAIDebug(THREE, scene, aiWorld)               // paths, state labels, slots, perception cones
//   debug.visible = true; debug.update() each frame
import { DEG } from './math.js';

/** World-space AABBs ({ min, max } arrays) of every mesh under `objects` (or of each object when perMesh is false). */
export function boxesFromObjects(THREE, objects, { perMesh = true } = {}) {
  const out = [], box = new THREE.Box3();
  for (const object of [].concat(objects)) {
    object.updateWorldMatrix(true, true);
    if (!perMesh) { box.setFromObject(object); if (!box.isEmpty()) out.push({ min: box.min.toArray(), max: box.max.toArray() }); continue; }
    object.traverse(o => {
      if (!o.isMesh || o.userData.aiIgnore) return;
      box.setFromObject(o);
      if (!box.isEmpty()) out.push({ min: box.min.toArray(), max: box.max.toArray() });
    });
  }
  return out;
}

/** Occlusion test for perception and cover: true when a mesh of `objects` lies between from and to. Allocation-free. */
export function createRaycast(THREE, objects, { recursive = true, epsilon = 0.02 } = {}) {
  const caster = new THREE.Raycaster(), origin = new THREE.Vector3(), dir = new THREE.Vector3(), hits = [];
  const list = typeof objects === 'function' ? objects : () => objects;
  return (from, to) => {
    origin.set(from.x, from.y, from.z); dir.set(to.x - from.x, to.y - from.y, to.z - from.z);
    const d = dir.length();
    if (d < epsilon) return false;
    dir.multiplyScalar(1 / d);
    caster.set(origin, dir); caster.near = 0; caster.far = d - epsilon;
    hits.length = 0;
    caster.intersectObjects(list(), recursive, hits);
    return hits.length > 0;
  };
}

const STATE_COLORS = {
  roam: '#8a9a8a', idle: '#8a9a8a', patrol: '#8a9a8a', investigate: '#e0c060', suspicious: '#e0c060', search: '#d0a040', hold: '#c0b080',
  chase: '#e07040', surround: '#e09060', windup: '#ff3030', lunge: '#ff0000', recover: '#c06060', combat: '#ff5050', cover: '#6090ff',
  retreat: '#80a0ff', flank: '#c060ff', dead: '#555555',
};

/**
 * Debug overlay: per agent its path (corners), a state label, its perception cone and, for the horde, the surround slots
 * and the escape lane around the player. Toggle with `visible`; call update() each frame (cheap when hidden).
 */
export function createAIDebug(THREE, scene, world, { maxSegments = 4096, labels = true } = {}) {
  const group = new THREE.Group(); group.name = 'ai-debug'; group.visible = false;
  const positions = new Float32Array(maxSegments * 6), colors = new Float32Array(maxSegments * 6);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9, toneMapped: false });
  const lines = new THREE.LineSegments(geometry, material); lines.frustumCulled = false; lines.renderOrder = 999;
  group.add(lines); scene.add(group);
  const color = new THREE.Color(), sprites = new Map();
  let n = 0;
  const seg = (ax, ay, az, bx, by, bz, hex) => {
    if (n >= maxSegments) return;
    color.set(hex);
    const k = n * 6;
    positions[k] = ax; positions[k + 1] = ay; positions[k + 2] = az; positions[k + 3] = bx; positions[k + 4] = by; positions[k + 5] = bz;
    colors[k] = colors[k + 3] = color.r; colors[k + 1] = colors[k + 4] = color.g; colors[k + 2] = colors[k + 5] = color.b;
    n++;
  };
  const circle = (x, y, z, r, hex, k = 12) => { for (let i = 0; i < k; i++) { const a = i / k * Math.PI * 2, b = (i + 1) / k * Math.PI * 2; seg(x + Math.sin(a) * r, y, z + Math.cos(a) * r, x + Math.sin(b) * r, y, z + Math.cos(b) * r, hex); } };

  function label(agent) {
    if (!labels || typeof document === 'undefined') return null;
    let s = sprites.get(agent);
    if (!s) {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
      const texture = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
      sprite.scale.set(0.6, 0.15, 1); sprite.renderOrder = 1000; group.add(sprite);
      s = { sprite, canvas, texture, text: '' };
      sprites.set(agent, s);
    }
    return s;
  }
  function drawLabel(s, text, hex) {
    if (s.text === text) return;
    s.text = text;
    const g = s.canvas.getContext('2d');
    g.clearRect(0, 0, 256, 64); g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 8, 256, 48);
    g.font = 'bold 26px system-ui, sans-serif'; g.fillStyle = hex; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 32);
    s.texture.needsUpdate = true;
  }

  const api = {
    group,
    get visible() { return group.visible; },
    set visible(v) { group.visible = !!v; },
    update() {
      if (!group.visible) return;
      n = 0;
      const player = world.player, y = (world.nav.floorY ?? 0) + 0.03;
      for (const agent of world.agents) {
        const st = agent.intent.state, hex = STATE_COLORS[st] ?? '#ffffff', p = agent.position;
        // path
        const m = agent.move;
        if (m.hasPath && !agent.dead) {
          let px = p.x, pz = p.z;
          for (let i = m.index; i < m.path.length; i++) { const c = m.path[i]; seg(px, y, pz, c.x, y, c.z, '#40e0ff'); px = c.x; pz = c.z; }
          circle(px, y, pz, 0.08, '#40e0ff', 6);
        }
        // velocity
        const v = agent.intent.velocity;
        if (agent.intent.moving) seg(p.x, y + 0.02, p.z, p.x + v.x, y + 0.02, p.z + v.z, '#ffffff');
        // perception cone (sight range, current half angle)
        if (!agent.dead) {
          const s = agent.sense, half = (agent.perception.alert ? s.alertViewHalfAngle : s.viewHalfAngle) * DEG, r = Math.min(s.sightRange, 12);
          const ey = agent.eye.y, cone = agent.perception.seen ? '#ff4040' : agent.perception.alert ? '#ffb040' : '#60ff60';
          const ax = Math.sin(agent.yaw - half), az = Math.cos(agent.yaw - half), bx = Math.sin(agent.yaw + half), bz = Math.cos(agent.yaw + half);
          seg(p.x, ey, p.z, p.x + ax * r, ey, p.z + az * r, cone); seg(p.x, ey, p.z, p.x + bx * r, ey, p.z + bz * r, cone);
          for (let i = 0; i < 10; i++) {
            const a = agent.yaw - half + (2 * half) * i / 10, b = agent.yaw - half + (2 * half) * (i + 1) / 10;
            seg(p.x + Math.sin(a) * r, ey, p.z + Math.cos(a) * r, p.x + Math.sin(b) * r, ey, p.z + Math.cos(b) * r, cone);
          }
          if (agent.sense.senseRadius > 0) circle(p.x, y, p.z, agent.sense.senseRadius, '#406040', 16);
        }
        // slot link
        if (agent.slot && agent.slot.index >= 0 && player.active) {
          const r = world.horde.ring, a = agent.slot.angle;
          seg(p.x, y + 0.05, p.z, player.head.x + Math.sin(a) * r, y + 0.05, player.head.z + Math.cos(a) * r, '#ff80ff');
        }
        const s = label(agent);
        if (s) {
          const extra = agent.intent.telegraph > 0 ? ` ${Math.round(agent.intent.telegraph * 100)}%` : agent.intent.paused ? ` (${agent.physical})` : '';
          drawLabel(s, `${agent.id}: ${st}${extra}`, hex);
          s.sprite.position.set(p.x, agent.eye.y + 0.45, p.z);
        }
      }
      // surround slots and the escape lane
      if (player.active && world.horde.slots && world.agents.some(a => a.slot?.index >= 0)) {
        const h = player.head, r = world.horde.ring;
        for (let i = 0; i < world.horde.slots; i++) {
          const a = world.horde.slotAngle(i);
          circle(h.x + Math.sin(a) * r, y, h.z + Math.cos(a) * r, 0.12, world.horde.slotValid(i) ? '#ff80ff' : '#603060', 8);
        }
        const l = world.horde.laneAngle;
        seg(h.x, y, h.z, h.x + Math.sin(l) * 2, y, h.z + Math.cos(l) * 2, '#40ff80');
      }
      for (const [agent, s] of sprites) if (!world.agents.includes(agent)) { group.remove(s.sprite); s.texture.dispose(); s.sprite.material.dispose(); sprites.delete(agent); }
      geometry.setDrawRange(0, n * 2);
      geometry.attributes.position.needsUpdate = true; geometry.attributes.color.needsUpdate = true;
    },
    dispose() {
      group.removeFromParent(); geometry.dispose(); material.dispose();
      for (const s of sprites.values()) { s.texture.dispose(); s.sprite.material.dispose(); }
      sprites.clear();
    },
  };
  return api;
}
