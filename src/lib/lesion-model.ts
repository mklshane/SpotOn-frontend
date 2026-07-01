import * as FileSystem from 'expo-file-system/legacy';
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
