// Fire in the bottle demo, from the GameSystems systems (as fire.html, without its room/alarm/sprinkler lab): thermal +
// pools take the bottles' spills through 'liquid:deposit' (pools/bottle-bridge.js burns the bottles' puddle volume as
// the pool burns), and liquidKind decides what burns (pools LIQUID_FIRE_PRESETS): the jerrycan's diesel and strong
// alcohol ('spirits': whisky, spirit bottles, hip flasks). A shot that lands in a burnable pool lights it. Flames are
// drawn over burning pools (blue-tinged for alcohol, orange for diesel), sized by pool radius and fire intensity.
import * as THREE from 'three';
import thermalExtension from './vendor/extensions/thermal/index.js';
import poolsExtension from './vendor/extensions/pools/index.js';
import { connectBottlePools } from './vendor/extensions/pools/bottle-bridge.js';

/** liquidKind for a catalog item: 'diesel' | 'spirits' | 'wine' | undefined (unknown: never burns). */
export function liquidKindOf(id, design = '') {
  if (id === 'container_jerrycan' && design === 'container_jerrycan_fuel') return 'diesel';
  if (/whisk|spirit|hipflask/.test(id)) return 'spirits';
  if (/wine|bordeaux/.test(id)) return 'wine';
  return undefined;
}

const FLAME_SLOTS = 12, CONES = 5, IGNITE_REACH = 0.08;
const COLORS = { spirits: [0x2f6dff, 0xff9d3a], diesel: [0xff4a12, 0xffa02e] };

/** Loads thermal + pools into the host and bridges the bottles; returns { update(dt), igniteAlong(origin, dir), stats(), dispose() }. */
export async function createBarFire({ host, scene, bottles }) {
  const thermal = await host.load(thermalExtension, { autoSpread: true, spreadRadius: 0.6, spreadConductance: 12 });
  const pools = await host.load(poolsExtension, { airConductance: 0.5 });
  const unbridge = connectBottlePools({ host, bottles, pools });
  const group = new THREE.Group(); group.name = 'bar-fire'; scene.add(group);
  const cone = new THREE.ConeGeometry(0.05, 0.32, 7).translate(0, 0.16, 0);
  const slots = Array.from({ length: FLAME_SLOTS }, () => {
    const slot = new THREE.Group(); slot.visible = false; group.add(slot);
    for (let i = 0; i < CONES; i++) {
      const m = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false }));
      slot.add(m);
    }
    return slot;
  });
  const light = new THREE.PointLight(0xff9a4a, 0, 3.5, 2); group.add(light);
  let t = 0, burningCount = 0;
  const kindOf = p => (p.components.diesel ?? 0) > (p.components.spirits ?? 0) ? 'diesel' : 'spirits';

  return {
    thermal, pools,
    /** A shot along the ray: lights the nearest burnable pool the ray lands in (within its radius). Returns the pool or null. */
    igniteAlong(origin, direction) {
      let best = null, bestT = Infinity;
      for (const p of pools.visible(128)) {
        if (!p.fuelJ || p.burning || Math.abs(direction.y) < 1e-4) continue;
        const along = (p.position[1] - origin.y) / direction.y; if (along <= 0 || along >= bestT) continue;
        const x = origin.x + direction.x * along - p.position[0], z = origin.z + direction.z * along - p.position[2];
        if (Math.hypot(x, z) <= p.radius + IGNITE_REACH) { best = p; bestT = along; }
      }
      return best && pools.ignite(best.id) ? best : null;
    },
    update(dt) {
      t += dt;
      const burning = pools.visible(128).filter(p => p.burning)
        .map(p => ({ p, intensity: thermal.state(p.thermalId).intensity ?? 0 })).sort((a, b) => b.intensity - a.intensity);
      burningCount = burning.length;
      let strongest = 0;
      slots.forEach((slot, i) => {
        const entry = burning[i]; slot.visible = !!entry; if (!entry) return;
        const { p, intensity } = entry, [base, tip] = COLORS[kindOf(p)];
        const spread = Math.max(0.02, p.radius * 0.6), width = THREE.MathUtils.clamp(p.radius / 0.1, 0.5, 1.6);
        const power = THREE.MathUtils.clamp(intensity / 250, 0.3, 1.2);
        slot.position.set(p.position[0], p.position[1] + 0.004, p.position[2]);
        slot.children.forEach((m, k) => {
          m.material.color.setHex(k % 2 ? tip : base);
          m.position.set(Math.sin(k * 2.4) * spread, 0, Math.cos(k * 2.4) * spread);
          m.scale.set(width, power * (0.75 + Math.sin(t * 9 + k * 1.7 + i) * 0.25), width);
        });
        const size = width;
        strongest = Math.max(strongest, power * size);
        if (i === 0) light.position.set(p.position[0], p.position[1] + 0.35, p.position[2]);
      });
      light.intensity = burning.length ? 2.5 * strongest * (0.85 + Math.sin(t * 13) * 0.15) : 0;
    },
    stats: () => ({ pools: pools.all().length, burning: burningCount }),
    dispose() {
      unbridge(); scene.remove(group); cone.dispose();
      for (const slot of slots) for (const m of slot.children) m.material.dispose();
    },
  };
}
