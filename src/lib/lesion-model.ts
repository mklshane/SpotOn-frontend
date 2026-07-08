import { Buffer } from 'buffer';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';
import { Image } from 'react-native';
import { loadTensorflowModel } from 'react-native-fast-tflite';

/** The loaded TFLite model handle (single-class YOLOv8 lesion detector). */
export type LesionModel = Awaited<ReturnType<typeof loadTensorflowModel>>;

// Bundled as a Metro asset (metro.config.js adds `tflite` to assetExts).
const MODEL_ASSET = require('../../assets/models/itobos_plus_large_v2_float16_best.tflite');

let modelPromise: Promise<LesionModel> | null = null;

/**
 * Load the lesion-detection model once and cache it, so the live camera
 * (`scan/capture.tsx`) and the still-image quality gate (`scan/quality.tsx`) share
 * a single instance. In dev, Metro serves the asset over http, which the native
 * loader can't fetch directly — so download it to a local file first.
 */
export function getLesionModel(): Promise<LesionModel> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const src = Image.resolveAssetSource(MODEL_ASSET);
      let uri = src.uri;
      if (uri.startsWith('http')) {
        const dest = `${FileSystem.cacheDirectory}itobos_plus_large_v2_float16_best.tflite`;
        await FileSystem.downloadAsync(uri, dest);
        uri = dest;
      }
      return loadTensorflowModel({ url: uri }, []);
    })().catch((e) => {
      modelPromise = null; // allow a retry on the next call
      throw e;
    });
  }
  return modelPromise;
}

/** Read input size + YOLOv8 output layout from a loaded model. */
export function readLayout(model: LesionModel) {
  const shape = model.outputs[0].shape; // [1, d1, d2]
  const d1 = shape[1];
  const d2 = shape[2];
  const chMajor = d1 < d2; // [1, channels, anchors]
  const channels = chMajor ? d1 : d2;
  const anchors = chMajor ? d2 : d1;
  const inShape = model.inputs[0].shape;
  const inputSize = inShape.length === 4 ? (inShape[3] === 3 ? inShape[1] : inShape[2]) : 640;
  return { chMajor, channels, anchors, numClasses: channels - 4, inputSize };
}

/** Best-box detection on a still photo (normalized box + confidence), or null. */
export type StillDetection = { conf: number; cx: number; cy: number; w: number; h: number };

const FUSE_SCORE = 0.25; // mirrors capture.tsx — fuse nearby confident anchors into one box

/**
 * Run the shared lesion model on a still image, off the camera thread. The live detector
 * verdict is carried through the capture→crop→quality flow, but a gallery upload never sees
 * the live detector — this gives that path (and any still) a real detector verdict instead of
 * the skin-colour fallback. Mirrors the app's preprocessing (center square crop -> model input)
 * and decode (argmax + Weighted Boxes Fusion) so it agrees with the live camera and the offline
 * eval (SpotOn-synthetic/synth/eval/detector_eval).
 *
 * Fully defensive: any failure (decode, native inference, unexpected layout) resolves to `null`
 * so the caller falls back to its prior behaviour — this can never make the gate stricter by
 * crashing.
 */
export async function detectOnImage(uri: string): Promise<StillDetection | null> {
  try {
    const model = await getLesionModel();
    const { chMajor, channels, anchors, numClasses, inputSize } = readLayout(model);

    // Center-crop to square, then resize to the model input (matches the resize-plugin's crop).
    const info = await manipulateAsync(uri, [], {});
    const s = Math.min(info.width, info.height);
    const crop = {
      originX: Math.floor((info.width - s) / 2),
      originY: Math.floor((info.height - s) / 2),
      width: s,
      height: s,
    };
    const manip = await manipulateAsync(uri, [{ crop }, { resize: { width: inputSize, height: inputSize } }], {
      compress: 1,
      format: SaveFormat.JPEG,
      base64: true,
    });
    const raw = jpeg.decode(Buffer.from(manip.base64 ?? '', 'base64'), { useTArray: true, formatAsRGBA: true });

    const px = inputSize * inputSize;
    const input = new Float32Array(px * 3);
    for (let i = 0; i < px; i++) {
      input[i * 3] = raw.data[i * 4] / 255;
      input[i * 3 + 1] = raw.data[i * 4 + 1] / 255;
      input[i * 3 + 2] = raw.data[i * 4 + 2] / 255;
    }

    const inputBuffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    const outputs = model.runSync([inputBuffer as ArrayBuffer]);
    const out = new Float32Array(outputs[0] as ArrayBuffer);

    // Pass 1 — argmax over the single class.
    let best = 0;
    let bcx = 0;
    let bcy = 0;
    let bbw = 0;
    let bbh = 0;
    for (let i = 0; i < anchors; i++) {
      let score = 0;
      for (let k = 0; k < numClasses; k++) {
        const v = out[chMajor ? (4 + k) * anchors + i : i * channels + (4 + k)];
        if (v > score) score = v;
      }
      if (score > best) {
        best = score;
        bcx = out[chMajor ? i : i * channels];
        bcy = out[chMajor ? anchors + i : i * channels + 1];
        bbw = out[chMajor ? 2 * anchors + i : i * channels + 2];
        bbh = out[chMajor ? 3 * anchors + i : i * channels + 3];
      }
    }
    if (best <= 0) return null;

    // Pass 2 — Weighted Boxes Fusion of nearby confident anchors (steadier box).
    const gate = Math.max(bbw, bbh) * 0.5;
    let ws = 0;
    let sx = 0;
    let sy = 0;
    let sw = 0;
    let sh = 0;
    for (let i = 0; i < anchors; i++) {
      let score = 0;
      for (let k = 0; k < numClasses; k++) {
        const v = out[chMajor ? (4 + k) * anchors + i : i * channels + (4 + k)];
        if (v > score) score = v;
      }
      if (score < FUSE_SCORE) continue;
      const ax = out[chMajor ? i : i * channels];
      const ay = out[chMajor ? anchors + i : i * channels + 1];
      if (Math.abs(ax - bcx) > gate || Math.abs(ay - bcy) > gate) continue;
      const aw = out[chMajor ? 2 * anchors + i : i * channels + 2];
      const ah = out[chMajor ? 3 * anchors + i : i * channels + 3];
      ws += score;
      sx += score * ax;
      sy += score * ay;
      sw += score * aw;
      sh += score * ah;
    }
    if (ws > 0) return { conf: best, cx: sx / ws, cy: sy / ws, w: sw / ws, h: sh / ws };
    return { conf: best, cx: bcx, cy: bcy, w: bbw, h: bbh };
  } catch (e) {
    console.warn('[lesion] still detection failed', e);
    return null;
  }
}
