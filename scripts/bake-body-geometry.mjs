#!/usr/bin/env node
/**
 * Bakes a .glb body mesh into a TS module of base64 vertex data.
 *
 * The app never loads .glb at runtime: react-three-fiber is used without GLTFLoader, and a loader
 * would need an async path plus a web shim for asset resolution. Instead the positions and indices
 * are extracted here, offline, and emitted as base64 string constants that body-model.tsx decodes
 * synchronously at first use. That also drops everything the app does not use - the male GLB is
 * 7.5 MB, almost all of it a normal map that never reaches the renderer, against 1.28 MB baked.
 *
 * Only POSITION and the index buffer are kept. Normals are recomputed at runtime
 * (computeVertexNormals) and the material is overridden with a flat colour, so UVs, tangents and
 * textures are all dead weight. Orientation, centring and scale are also left to runtime -
 * buildGeometry() normalises any mesh to a fixed height, which is what lets meshes with different
 * units and poses be swapped for one another.
 *
 *   node scripts/bake-body-geometry.mjs <input.glb> <variant>
 *   npm run bake:body
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const GLTF_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** Component type -> [TypedArray, bytes per component]. */
const COMPONENT = {
  5120: [Int8Array, 1],
  5121: [Uint8Array, 1],
  5122: [Int16Array, 2],
  5123: [Uint16Array, 2],
  5125: [Uint32Array, 4],
  5126: [Float32Array, 4],
};
const NUM_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function parseGlb(buf) {
  const magic = buf.readUInt32LE(0);
  if (magic !== GLTF_MAGIC) throw new Error('not a .glb (bad magic)');
  const version = buf.readUInt32LE(4);
  if (version !== 2) throw new Error(`unsupported glTF version ${version}`);

  let json = null;
  let bin = null;
  let off = 12;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(body.toString('utf8'));
    else if (type === CHUNK_BIN) bin = body;
    off += 8 + len;
  }
  if (!json) throw new Error('no JSON chunk');
  if (!bin) throw new Error('no BIN chunk (external .bin buffers are not supported)');
  return { json, bin };
}

/**
 * Reads an accessor into a flat JS array, honouring byteStride - interleaved buffers are legal
 * glTF and a tightly-packed read would silently produce garbage from one.
 */
export function readAccessor(json, bin, index) {
  const acc = json.accessors[index];
  if (acc.sparse) throw new Error('sparse accessors are not supported');
  const [Arr, bytes] = COMPONENT[acc.componentType];
  const n = NUM_COMPONENTS[acc.type];
  const view = json.bufferViews[acc.bufferView];
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const stride = view.byteStride ?? n * bytes;

  const out = new Arr(acc.count * n);
  // Read through a DataView rather than per-type Buffer methods, which keeps this to one path.
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const get = {
    5120: (o) => dv.getInt8(o),
    5121: (o) => dv.getUint8(o),
    5122: (o) => dv.getInt16(o, true),
    5123: (o) => dv.getUint16(o, true),
    5125: (o) => dv.getUint32(o, true),
    5126: (o) => dv.getFloat32(o, true),
  }[acc.componentType];
  for (let i = 0; i < acc.count; i++) {
    const at = base + i * stride;
    for (let c = 0; c < n; c++) out[i * n + c] = get(at + c * bytes);
  }
  return out;
}

/** Column-major 4x4 multiply, matching glTF's matrix convention. */
function mulMat4(a, b) {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

function trsToMat4(node) {
  if (node.matrix) return Float64Array.from(node.matrix);
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return Float64Array.from([
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ]);
}

const IDENTITY = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** Walks the scene graph and returns every mesh primitive with its composed world transform. */
export function collectPrimitives(json) {
  const found = [];
  const walk = (nodeIndex, parent) => {
    const node = json.nodes[nodeIndex];
    const world = mulMat4(parent, trsToMat4(node));
    if (node.mesh != null) {
      for (const prim of json.meshes[node.mesh].primitives) found.push({ prim, world });
    }
    for (const child of node.children ?? []) walk(child, world);
  };
  const scene = json.scenes[json.scene ?? 0];
  for (const root of scene.nodes) walk(root, IDENTITY);
  return found;
}

export function applyMat4(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

export function bake(glbPath, variant) {
  const { json, bin } = parseGlb(readFileSync(glbPath));
  const prims = collectPrimitives(json);
  if (prims.length !== 1) {
    // Merging would need per-primitive index rebasing, and neither body mesh needs it. Fail loudly
    // rather than silently baking only part of a model.
    throw new Error(`expected exactly 1 mesh primitive, found ${prims.length}`);
  }
  const { prim, world } = prims[0];
  if (prim.mode != null && prim.mode !== 4) throw new Error(`expected triangles, got mode ${prim.mode}`);
  if (prim.indices == null) throw new Error('non-indexed primitives are not supported');

  const src = readAccessor(json, bin, prim.attributes.POSITION);
  const count = src.length / 3;
  const positions = new Float32Array(src.length);
  for (let i = 0; i < count; i++) {
    const [x, y, z] = applyMat4(world, src[i * 3], src[i * 3 + 1], src[i * 3 + 2]);
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  }

  const rawIndices = readAccessor(json, bin, prim.indices);
  // Uint16 indices halve the baked size; only widen when the mesh genuinely needs it. INDEX_BITS
  // tells the runtime which TypedArray to decode into.
  const bits = count > 65536 ? 32 : 16;
  const indices = bits === 16 ? Uint16Array.from(rawIndices) : Uint32Array.from(rawIndices);

  const b64 = (ta) => Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength).toString('base64');
  const rel = relative(ROOT, glbPath);
  const out = [
    `// AUTO-GENERATED from ${rel} by scripts/bake-body-geometry.mjs. Do not edit by hand.`,
    '// Positions (Float32, world transform baked in) + indices. Normals computed at runtime.',
    `export const VERTEX_COUNT = ${count};`,
    `export const INDEX_BITS = ${bits} as const;`,
    'export const POSITIONS_B64 =',
    `  "${b64(positions)}";`,
    'export const INDICES_B64 =',
    `  "${b64(indices)}";`,
    '',
  ].join('\n');

  const dest = resolve(ROOT, `src/components/scan/body-geometry.${variant}.ts`);
  writeFileSync(dest, out);
  console.log(
    `${variant.padEnd(7)} ${rel} -> ${relative(ROOT, dest)}  ` +
      `${count} verts, ${indices.length / 3} tris, ${bits}-bit indices, ${(out.length / 1e6).toFixed(2)} MB`,
  );
}

const MESHES = [
  ['assets/male_base_model.glb', 'male'],
  ['assets/female_base_mesh.glb', 'female'],
];

export const MESH_SOURCES = MESHES;

// Only bake when run directly - scripts/test-body-regions.mjs imports the GLB reader from here
// rather than keeping a second copy of it.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [argPath, argVariant] = process.argv.slice(2);
  if (argPath && argVariant) bake(resolve(ROOT, argPath), argVariant);
  else for (const [p, v] of MESHES) bake(resolve(ROOT, p), v);
}
