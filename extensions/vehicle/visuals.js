import { VEHICLE_PARTS } from './index.js';

// Three.js is supplied by the host. No global renderer, scene, or physics engine is captured.
export function bindVehicleVisual(root, { THREE, strict = true } = {}) {
  if (!root?.getObjectByName || !THREE?.Quaternion || !THREE?.Vector3) throw new TypeError('root and THREE required');
  const rootRest = { position: root.position.clone(), quaternion: root.quaternion.clone() };
  const modelRoot = root.getObjectByName('Aster_Sedan') ?? root;
  const hinges = Object.entries(VEHICLE_PARTS).map(([key, part]) => {
    const object = root.getObjectByName(part.node);
    if (!object && strict) throw new Error(`Vehicle model missing ${part.node}`);
    return { key, object, angle: part.angle, axis: new THREE.Vector3(...part.axis), rest: object?.quaternion.clone() };
  });
  const wheels = ['FL', 'FR', 'RL', 'RR'].map(label => {
    const object = root.getObjectByName(`Wheel_${label}`), steer = root.getObjectByName(`Steer_${label}`);
    return { object, steer, front: label.startsWith('F'), rest: object?.quaternion.clone(), steerRest: steer?.quaternion.clone(),
      objectPosition: object?.position.clone(), steerPosition: steer?.position.clone() };
  });
  const wheelPivots = new Set(wheels.map(w => w.steer).filter(Boolean));
  if (strict && wheels.some(w => (w.steer && w.steer.parent !== modelRoot) || (w.object && w.object.parent !== w.steer)))
    throw new Error('Vehicle steering pivots must belong to the root and wheel pivots to their steering pivot');
  // Keep wheels attached to the ground-following root while the body pitches,
  // rolls and heaves on its own local group.
  const chassis = new THREE.Group(); chassis.name = 'VehicleChassisVisual'; modelRoot.add(chassis);
  for (const child of [...modelRoot.children]) {
    if (child === chassis || wheelPivots.has(child)) continue;
    modelRoot.remove(child); chassis.add(child);
  }
  const q = new THREE.Quaternion(), x = new THREE.Vector3(1, 0, 0), y = new THREE.Vector3(0, 1, 0);
  const lampMaterials = new Set();
  root.traverse(object => {
    for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
      if (material.name?.startsWith('Lamp_LED')) lampMaterials.add(material);
    }
  });
  const lightDefaults = new Map([...lampMaterials].map(m => [m, m.emissiveIntensity]));
  return {
    update(state, { moveRoot = false, suspension = null } = {}) {
      for (const h of hinges) if (h.object) h.object.quaternion.copy(h.rest).multiply(q.setFromAxisAngle(h.axis, h.angle * state.parts[h.key].fraction));
      for (const w of wheels) {
        if (w.object) w.object.quaternion.copy(w.rest).multiply(q.setFromAxisAngle(x, state.wheelAngle));
        if (w.steer && w.front) w.steer.quaternion.copy(w.steerRest).multiply(q.setFromAxisAngle(y, state.controls.steer * 0.48));
      }
      for (const material of lampMaterials) material.emissiveIntensity = state.lights && state.electrics ? 3 : 0.12;
      if (moveRoot) { root.position.fromArray(state.position); root.rotation.y = state.heading; }
      if (suspension != null) {
        const bodyOffsetM = Number(suspension.bodyOffsetM), pitchRad = Number(suspension.pitchRad), rollRad = Number(suspension.rollRad), staticSagM = Number(suspension.staticSagM);
        if (![bodyOffsetM, pitchRad, rollRad, staticSagM].every(Number.isFinite) || staticSagM < 0 || !suspension.compressionM)
          throw new TypeError('Invalid vehicle suspension visual state');
        chassis.position.set(0, bodyOffsetM, 0);
        chassis.rotation.set(pitchRad, 0, rollRad, 'XYZ');
        for (const w of wheels) {
          const key = w.object?.name?.replace('Wheel_', '') ?? w.steer?.name?.replace('Steer_', '');
          if (!key) continue;
          const compression = Number(suspension.compressionM[{ FL: 'frontLeft', FR: 'frontRight', RL: 'rearLeft', RR: 'rearRight' }[key]]);
          if (!Number.isFinite(compression)) throw new TypeError(`Missing suspension compression for wheel ${key}`);
          const delta = compression - staticSagM;
          if (w.steer) w.steer.position.y = w.steerPosition.y + delta;
        }
      }
    },
    dispose() {
      for (const [m, intensity] of lightDefaults) m.emissiveIntensity = intensity;
      for (const child of [...chassis.children]) { chassis.remove(child); modelRoot.add(child); }
      modelRoot.remove(chassis);
      root.position.copy(rootRest.position); root.quaternion.copy(rootRest.quaternion);
      for (const w of wheels) {
        if (w.steerPosition) w.steer.position.copy(w.steerPosition);
        if (w.rest) w.object.quaternion.copy(w.rest);
        if (w.steerRest) w.steer.quaternion.copy(w.steerRest);
      }
    },
  };
}
