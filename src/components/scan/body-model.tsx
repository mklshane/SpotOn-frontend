/* eslint-disable react/no-unknown-property -- react-three-fiber three.js props */
import { useEffect, useMemo } from 'react';
import { Box3, BufferAttribute, BufferGeometry, Vector3 } from 'three';

import { projectPointBetweenBodies } from '@/lib/body-projection';
import type { BodyVariant } from '@/lib/body-variant';

const SKIN = '#C6C7CD';
export const TARGET_HEIGHT = 3.7;
/** Flip to Math.PI if the model ends up facing away from the camera. */
const FACE_ROT_Y = 0;

export type BodyModelStatus = 'loading' | 'ready' | 'error';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
let B64_LUT: Uint8Array | null = null;
function decodeBase64(b64: string): ArrayBuffer {
  if (!B64_LUT) {
    B64_LUT = new Uint8Array(256);
    for (let i = 0; i < B64.length; i++) B64_LUT[B64.charCodeAt(i)] = i;
  }
  const lut = B64_LUT;
  const len = b64.length;
  let pad = 0;
  if (len && b64[len - 1] === '=') pad++;
  if (len > 1 && b64[len - 2] === '=') pad++;
  const n = ((len * 3) >> 2) - pad;
  const bytes = new Uint8Array(n);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const t =
      (lut[b64.charCodeAt(i)] << 18) |
      (lut[b64.charCodeAt(i + 1)] << 12) |
      (lut[b64.charCodeAt(i + 2)] << 6) |
      lut[b64.charCodeAt(i + 3)];
    if (p < n) bytes[p++] = (t >> 16) & 0xff;
    if (p < n) bytes[p++] = (t >> 8) & 0xff;
    if (p < n) bytes[p++] = t & 0xff;
  }
  return bytes.buffer;
}

type BakedGeometry = {
  VERTEX_COUNT: number;
  INDEX_BITS: 16 | 32;
  POSITIONS_B64: string;
  INDICES_B64: string;
};

/**
 * Loaded through require() rather than a static import so that opening the body screen only pays
 * to parse the ~1.3 MB base64 blob of the mesh actually shown. Metro bundles both either way, but
 * on Hermes the string-constant parse is not free and the unused variant never has to be touched.
 */
function loadBaked(variant: BodyVariant): BakedGeometry {
  return variant === 'female'
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./body-geometry.female')
    : // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./body-geometry.male');
}

/**
 * Build + fit one mesh. Synchronous, no file loading.
 *
 * Everything about placing the mesh in the scene is derived from the mesh itself, which is what
 * lets variants be swapped freely: the source meshes differ in units (metres vs centimetres), in
 * where their bounding box sits, and in pose, and none of that reaches the rest of the app. After
 * this runs, every variant is Y-up, centred on the origin and exactly TARGET_HEIGHT tall, so the
 * camera limits, marker radii and region thresholds are shared.
 */
function buildGeometry(variant: BodyVariant): { geo: BufferGeometry; box: Box3 } {
  const baked = loadBaked(variant);
  const positions = new Float32Array(decodeBase64(baked.POSITIONS_B64));
  const indices =
    baked.INDEX_BITS === 16
      ? new Uint16Array(decodeBase64(baked.INDICES_B64))
      : new Uint32Array(decodeBase64(baked.INDICES_B64));

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setIndex(new BufferAttribute(indices, 1));
  geo.computeVertexNormals();

  // Stand upright (source is Z-up), face the camera, center at origin, scale to a fixed height.
  geo.computeBoundingBox();
  let size = geo.boundingBox!.getSize(new Vector3());
  if (size.z > size.y) geo.rotateX(-Math.PI / 2);
  if (FACE_ROT_Y) geo.rotateY(FACE_ROT_Y);
  geo.computeBoundingBox();
  const center = geo.boundingBox!.getCenter(new Vector3());
  size = geo.boundingBox!.getSize(new Vector3());
  const s = TARGET_HEIGHT / size.y;
  geo.translate(-center.x, -center.y, -center.z);
  geo.scale(s, s, s);
  geo.computeBoundingBox();

  return { geo, box: geo.boundingBox!.clone() };
}

type Built = { geo: BufferGeometry; box: Box3; error: null } | { geo: null; box: null; error: string };

/**
 * Built once per variant and kept for the process lifetime. Both viewers and the preview card
 * mount and unmount constantly; rebuilding 41k vertices each time would be visible.
 */
const CACHE = new Map<BodyVariant, Built>();

export function getBodyGeometry(variant: BodyVariant): Built {
  const hit = CACHE.get(variant);
  if (hit) return hit;
  let built: Built;
  try {
    const { geo, box } = buildGeometry(variant);
    built = { geo, box, error: null };
  } catch (e) {
    const error = String((e as { message?: string })?.message ?? e);
    console.warn('[BodyModel] build error', variant, e);
    built = { geo: null, box: null, error };
  }
  CACHE.set(variant, built);
  return built;
}

/**
 * Where to draw a stored mark on the `variant` mesh. A point placed on that same mesh is returned
 * untouched; one placed on the other mesh is moved onto this one's surface. `mesh` is absent on
 * marks saved before the female mesh existed, and those were all placed on the male one.
 */
export function markPointOn(
  point: [number, number, number],
  mesh: BodyVariant | null | undefined,
  variant: BodyVariant,
): [number, number, number] {
  const from = mesh ?? 'male';
  if (from === variant) return point;
  const src = getBodyGeometry(from);
  const dst = getBodyGeometry(variant);
  if (!src.geo || !src.box || !dst.geo || !dst.box) return point;
  return projectPointBetweenBodies(
    point,
    { positions: src.geo.getAttribute('position').array, box: src.box },
    { positions: dst.geo.getAttribute('position').array, box: dst.box },
  );
}

export function BodyModel({
  variant,
  onReady,
  onStatus,
}: {
  variant: BodyVariant;
  onReady?: (box: Box3) => void;
  onStatus?: (status: BodyModelStatus, message?: string) => void;
}) {
  const built = useMemo(() => getBodyGeometry(variant), [variant]);

  useEffect(() => {
    if (built.geo && built.box) {
      onReady?.(built.box);
      onStatus?.('ready');
    } else {
      onStatus?.('error', built.error ?? 'no geometry');
    }
  }, [built, onReady, onStatus]);

  if (!built.geo) return null;
  return (
    <mesh geometry={built.geo}>
      <meshStandardMaterial color={SKIN} roughness={0.9} metalness={0.02} />
    </mesh>
  );
}
