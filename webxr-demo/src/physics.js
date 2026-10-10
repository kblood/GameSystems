import * as THREE from 'three';
import { createCannonPhysics } from './vendor/extensions/adapters/physics-cannon.js';

// The demo's physics: the cannon adapter (GameSystems/extensions/adapters, the only module that imports cannon-es) with
// the room's static boxes. Extensions get `adapter` as ctx.physics; the bottles extension creates its own bodies on it
// and steps from adapter.onStep. hold/release/remove take adapter handles (a bottle's `entry`).
export class PhysicsWorld {
  constructor() {
    this.adapter = createCannonPhysics(undefined, { allowSleep: true, friction: 0.55, restitution: 0.12 });
    this.surfaces = []; // room meshes that receive liquid (pouring, puddles)
  }

  staticBox(size, position, surface = 'concrete') {
    return this.adapter.addBody({ type: 'box', size: [size.x, size.y, size.z] }, 0, { position }, { userData: { surface }, contacts: false });
  }

  hold(entry, pose) { this.adapter.hold(entry, pose); }
  release(entry, velocity, spin) { this.adapter.release(entry, velocity, spin); }
  remove(entry) { this.adapter.remove(entry); }
  /** Fixed-step physics; the bottles extension runs from the adapter's onStep at the end of it. */
  step(dt) { this.adapter.step(dt); }
}

export function box(scene, physics, size, position, color, { surface = 'solid', collide = true } = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
  mesh.position.set(...position);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.userData.surface = surface;
  scene.add(mesh);
  if (collide) {
    mesh.userData.physicsBody = physics.staticBox(new THREE.Vector3(...size), mesh.position, surface);
    physics.surfaces.push(mesh);
  }
  return mesh;
}
