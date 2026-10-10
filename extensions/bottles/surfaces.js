import * as THREE from 'three';

// Only registered room surfaces receive liquid. Props, shards and puddles never
// contaminate ray tests. Face identity prevents nearby shelves merging puddles.
export class SurfaceWorld {
  constructor(meshes = []) { this.meshes = meshes; this.ray = new THREE.Raycaster(); }

  segment(from, to) {
    const direction = to.clone().sub(from), length = direction.length();
    if (length < 1e-8) return null;
    this.ray.set(from, direction.divideScalar(length));
    this.ray.near = 0; this.ray.far = length + 1e-6;
    for (const mesh of this.meshes) mesh.updateWorldMatrix(true, false);
    const hit = this.ray.intersectObjects(this.meshes, false)[0];
    if (!hit) return null;
    const localNormal = hit.face.normal.clone();
    const normal = localNormal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
    return { point: hit.point, normal, object: hit.object, localNormal,
      key: `${hit.object.uuid}:${localNormal.toArray().join(',')}`, fraction: hit.distance / length };
  }

  below(point, distance = 30) {
    return this.segment(point.clone().add(new THREE.Vector3(0, 0.002, 0)), point.clone().add(new THREE.Vector3(0, -distance, 0)));
  }
}

// Clip a growing puddle to its actual box face. This supports translated,
// rotated and inclined room boxes as well as elevated table/shelf surfaces.
export function puddlePolygon(hit, radius, segments = 40) {
  const n = hit.normal;
  const tangent = new THREE.Vector3(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0).cross(n).normalize();
  const bitangent = n.clone().cross(tangent);
  let polygon = Array.from({ length: segments }, (_, i) => {
    const a = i * Math.PI * 2 / segments;
    return hit.object.worldToLocal(hit.point.clone().addScaledVector(tangent, Math.cos(a) * radius).addScaledVector(bitangent, Math.sin(a) * radius));
  });
  const size = hit.object.geometry.parameters;
  const axes = ['x', 'y', 'z'].filter(axis => Math.abs(hit.localNormal[axis]) < 0.5);
  const extents = { x: size.width / 2, y: size.height / 2, z: size.depth / 2 };
  for (const axis of axes) for (const sign of [-1, 1]) {
    const output = [], bound = extents[axis];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const da = bound - sign * a[axis], db = bound - sign * b[axis];
      if (da >= 0) output.push(a);
      if ((da >= 0) !== (db >= 0)) output.push(a.clone().lerp(b, da / (da - db)));
    }
    polygon = output;
  }
  return polygon.map(p => hit.object.localToWorld(p).addScaledVector(n, 0.0015));
}
