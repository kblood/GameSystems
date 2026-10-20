// Minimal glTF binary (.glb) reader for the gore bake (node only, no three.js): meshes with their attributes, indices,
// morph targets (incl. normalized integer and sparse accessors, KHR_mesh_quantization), skin joint names and node
// transforms. Enough for CharacterCreator / MakeHuman exports; not a general glTF loader.
import { readFileSync } from 'node:fs';

const COMPONENTS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

export function parseGLB(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a glb');
  let offset = 12, json = null, bin = null;
  while (offset < buf.length) {
    const len = buf.readUInt32LE(offset), type = buf.readUInt32LE(offset + 4);
    const chunk = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) bin = chunk;
    offset += 8 + len;
  }
  return { json, bin };
}

/** Accessor -> typed array (Float32Array for normalized / float data, else its integer type), count × itemSize. */
export function readAccessor({ json, bin }, index) {
  const a = json.accessors[index], size = SIZES[a.type], Type = COMPONENTS[a.componentType];
  const n = a.count * size, raw = new Type(n);
  if (a.bufferView != null) {
    const view = json.bufferViews[a.bufferView], stride = view.byteStride || size * Type.BYTES_PER_ELEMENT;
    const base = (view.byteOffset || 0) + (a.byteOffset || 0);
    const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
    for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) raw[i * size + k] = dv[get](base + i * stride + k * Type.BYTES_PER_ELEMENT, true);
  }
  let out = raw;
  if (a.normalized || a.componentType === 5126) {
    out = new Float32Array(n);
    const s = a.normalized ? NORM[a.componentType] : 1;
    for (let i = 0; i < n; i++) out[i] = a.normalized ? Math.max(raw[i] / s, -1) : raw[i];
  }
  if (a.sparse) {
    const sp = a.sparse, idx = readView({ json, bin }, sp.indices.bufferView, sp.indices.byteOffset, sp.count, 1, sp.indices.componentType);
    const vals = readView({ json, bin }, sp.values.bufferView, sp.values.byteOffset, sp.count, size, a.componentType);
    if (!(out instanceof Float32Array) && (a.normalized || a.componentType === 5126)) out = Float32Array.from(out);
    const s = a.normalized ? NORM[a.componentType] : 1;
    for (let i = 0; i < sp.count; i++) for (let k = 0; k < size; k++) out[idx[i] * size + k] = a.normalized ? Math.max(vals[i * size + k] / s, -1) : vals[i * size + k];
  }
  return out;
}
function readView({ json, bin }, viewIndex, byteOffset = 0, count, size, componentType) {
  const view = json.bufferViews[viewIndex], Type = COMPONENTS[componentType];
  const start = bin.byteOffset + (view.byteOffset || 0) + byteOffset;
  return new Type(bin.buffer.slice(start, start + count * size * Type.BYTES_PER_ELEMENT));
}

/**
 * Reads a .glb file: { meshes: [{ name, node, primitive, attributes: { NAME: array }, itemSize: { NAME: n }, index,
 * targets: [{ POSITION, NORMAL? }], targetNames, joints: [bone names] | null }], nodes, skins: [{ joints, inverseBindMatrices }], json }.
 * Multi-primitive meshes get one entry per primitive, named like three.js GLTFLoader does (name, name_1, ...).
 */
export function readGLB(path) {
  const glb = parseGLB(readFileSync(path));
  const { json } = glb, meshes = [];
  json.nodes.forEach((node, ni) => {
    if (node.mesh == null) return;
    const mesh = json.meshes[node.mesh], skin = node.skin != null ? json.skins[node.skin] : null;
    mesh.primitives.forEach((p, pi) => {
      const attributes = {}, itemSize = {};
      for (const [k, v] of Object.entries(p.attributes)) { attributes[k] = readAccessor(glb, v); itemSize[k] = SIZES[json.accessors[v].type]; }
      const index = p.indices != null ? Uint32Array.from(readAccessor(glb, p.indices)) : Uint32Array.from({ length: attributes.POSITION.length / 3 }, (_, i) => i);
      const targets = (p.targets || []).map(t => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, readAccessor(glb, v)])));
      meshes.push({ name: pi ? `${mesh.name}_${pi}` : mesh.name, node: node.name, primitive: pi, material: json.materials?.[p.material]?.name ?? null,
        attributes, itemSize, index, targets, targetNames: mesh.extras?.targetNames ?? [], joints: skin ? skin.joints.map(j => json.nodes[j].name) : null, skin: node.skin ?? null });
    });
  });
  const skins = (json.skins || []).map(sk => ({ joints: sk.joints.map(j => json.nodes[j].name), inverseBindMatrices: sk.inverseBindMatrices != null ? readAccessor(glb, sk.inverseBindMatrices) : null }));
  return { meshes, nodes: json.nodes, skins, json };
}
