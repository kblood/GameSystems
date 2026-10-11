import { VEHICLE_PARTS } from './index.js';

// Three.js is supplied by the host. No global renderer, scene, or physics engine is captured.
export function bindVehicleVisual(root, { THREE, strict = true } = {}) {
  if (!root?.getObjectByName || !THREE?.Quaternion || !THREE?.Vector3) throw new TypeError('root and THREE required');
  const hinges = Object.entries(VEHICLE_PARTS).map(([key, part]) => {
    const object = root.getObjectByName(part.node);
    if (!object && strict) throw new Error(`Vehicle model missing ${part.node}`);
    return { key, object, angle: part.angle, axis: new THREE.Vector3(...part.axis), rest: object?.quaternion.clone() };
  });
  const wheels = ['FL', 'FR', 'RL', 'RR'].map(label => {
    const object = root.getObjectByName(`Wheel_${label}`), steer = root.getObjectByName(`Steer_${label}`);
    return { object, steer, front: label.startsWith('F'), rest: object?.quaternion.clone(), steerRest: steer?.quaternion.clone() };
  });
  const q = new THREE.Quaternion(), x = new THREE.Vector3(1, 0, 0), y = new THREE.Vector3(0, 1, 0);
  const lampMaterials = new Set();
  root.traverse(object => {
    for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
      if (material.name?.startsWith('Lamp_LED')) lampMaterials.add(material);
    }
  });
  const lightDefaults = new Map([...lampMaterials].map(m => [m, m.emissiveIntensity]));
  return {
    update(state, { moveRoot = false } = {}) {
      for (const h of hinges) if (h.object) h.object.quaternion.copy(h.rest).multiply(q.setFromAxisAngle(h.axis, h.angle * state.parts[h.key].fraction));
      for (const w of wheels) {
        if (w.object) w.object.quaternion.copy(w.rest).multiply(q.setFromAxisAngle(x, state.wheelAngle));
        if (w.steer && w.front) w.steer.quaternion.copy(w.steerRest).multiply(q.setFromAxisAngle(y, state.controls.steer * 0.48));
      }
      for (const material of lampMaterials) material.emissiveIntensity = state.lights && state.electrics ? 3 : 0.12;
      if (moveRoot) { root.position.fromArray(state.position); root.rotation.y = state.heading; }
    },
    dispose() { for (const [m, intensity] of lightDefaults) m.emissiveIntensity = intensity; },
  };
}
