import { CATALOG, signedDistance, surfaceNormal } from '../../extensions/grasp/catalog.js';

const add = (points, value) => points.push(value);
function offsets(shape, points) {
  if (shape.type === 'parts') { for (const part of shape.parts) offsets(part, points); return; }
  const at = shape.at ?? [0, 0, 0];
  const push = (x, y, z) => add(points, [at[0] + x, at[1] + y, at[2] + z]);
  push(0, 0, 0);
  if (shape.type === 'box') {
    push(shape.size[0] / 2, 0, 0); push(0, shape.size[1] / 2, 0); push(0, 0, shape.size[2] / 2);
  } else if (shape.type === 'cylinder') {
    push(shape.radius, 0, 0); push(0, shape.half, 0); push(0, -shape.half, 0);
  } else if (shape.type === 'lathe') {
    const profile = shape.profile;
    push(profile[0][1], profile[0][0], 0);
    push(0, profile[profile.length - 1][0], 0);
    for (const [y, radius] of profile) push(radius, y, 0);
  }
}

export function graspSdfCases() {
  const cases = [];
  for (const [kind, entry] of Object.entries(CATALOG)) {
    const points = [];
    offsets(entry.shape, points);
    for (const point of [[0, 0, 0], [0.01, 0.05, 0.02], [-0.08, 0.14, 0.06], [0.2, 0.3, -0.1]]) add(points, point);
    const unique = new Map(points.map(point => [JSON.stringify(point), point]));
    for (const [index, point] of [...unique.values()].entries()) {
      cases.push({ name: `${kind}:${index}`, kind, point, distance: signedDistance(entry.shape, point), normal: surfaceNormal(entry.shape, point) });
    }
  }
  for (const [name, shape] of Object.entries({
    box: { type: 'box', size: [1, 1, 1] },
    cylinder: { type: 'cylinder', radius: 1, half: 1 },
    lathe: { type: 'lathe', profile: [[0, 1], [1, 0.5], [2, 1]] },
  })) {
    const point = [1e200, 0, 0];
    cases.push({ name: `extreme:${name}`, shape, point, distance: signedDistance(shape, point), normal: surfaceNormal(shape, point) });
  }
  return cases;
}
