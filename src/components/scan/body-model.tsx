/* eslint-disable react/no-unknown-property -- react-three-fiber three.js props */
import { useEffect } from 'react';
import { Box3, BufferAttribute, BufferGeometry, Vector3 } from 'three';

import { INDEX_BITS, INDICES_B64, POSITIONS_B64 } from './body-geometry';

const SKIN = '#C6C7CD';
const TARGET_HEIGHT = 3.7;
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

/** Build + fit the geometry once at module load (synchronous, no file loading). */
function buildGeometry(): { geo: BufferGeometry; box: Box3 } {
  const positions = new Float32Array(decodeBase64(POSITIONS_B64));
  const indices =
    INDEX_BITS === 16
      ? new Uint16Array(decodeBase64(INDICES_B64))
      : new Uint32Array(decodeBase64(INDICES_B64));

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

let BODY_GEO: BufferGeometry | null = null;
let BODY_BOX: Box3 | null = null;
let BUILD_ERR: string | null = null;
try {
  const built = buildGeometry();
  BODY_GEO = built.geo;
  BODY_BOX = built.box;
} catch (e) {
  BUILD_ERR = String((e as { message?: string })?.message ?? e);
  console.warn('[BodyModel] build error', e);
}

export function BodyModel({
  onReady,
  onStatus,
}: {
  onReady?: (box: Box3) => void;
  onStatus?: (status: BodyModelStatus, message?: string) => void;
}) {
  useEffect(() => {
    if (BODY_GEO && BODY_BOX) {
      onReady?.(BODY_BOX);
      onStatus?.('ready');
    } else {
      onStatus?.('error', BUILD_ERR ?? 'no geometry');
    }
  }, [onReady, onStatus]);

  if (!BODY_GEO) return null;
  return (
    <mesh geometry={BODY_GEO}>
      <meshStandardMaterial color={SKIN} roughness={0.9} metalness={0.02} />
    </mesh>
  );
}
