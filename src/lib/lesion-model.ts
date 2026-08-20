import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'react-native';
import { loadTensorflowModel } from 'react-native-fast-tflite';

/** The loaded TFLite model handle (single-class YOLO lesion detector). */
export type LesionModel = Awaited<ReturnType<typeof loadTensorflowModel>>;

// Bundled as a Metro asset (metro.config.js adds `tflite` to assetExts).
//
// === lesion_det_y11n_v1, bundled 2026-08-20 at Shane's instruction. ===
//
// YOLO11n trained for SpotOn, exported float16 @ 768 by `~/Downloads/detector_export_from_banked.ipynb`
// from the Drive-banked `lesion_det_y11n_v1_ckpt/best.pt` (epoch 53). Training died at epoch 54, but
// the run's armoured checkpointing banked every epoch and mAP50 was flat 0.706 -> 0.710 across the
// final ten, so the notebook treats ep53 as the finished model rather than a truncated one. Its
// recorded score is **mAP50 0.710**; that is the only number the export carries, and there is no
// matching figure for the predecessor on this disk, so it cannot be read as an improvement on its
// own — see DETECTOR_AB.md / `synth/eval/detector_ab.py` for the comparison that can.
//
// DROP-IN ON CONTRACT, verified by interpreter inspection 2026-08-20 — both models are
// input "images" [1, 768, 768, 3] float32 NHWC (0..1 RGB) and output "Identity" [1, 5, 12096]
// float32, i.e. channel-major YOLO head with 4 box channels + 1 class over 12096 anchors. So
// `readLayout` below, the still path (classifier/lesion-detector.ts) and the frame processor
// (scan/capture.tsx) all introspect the same numbers they did before; nothing downstream changes
// shape. 5.4 MB against the predecessor's 6.2 MB.
//
// MEASURED, 2026-08-20 (`synth/eval/detector_ab.py`, 200-image ISIC holdout, classifier held
// constant at the shipped D13). Full table and reasoning in `synth/eval/DETECTOR_AB.md`, round 2.
// Downstream it is a wash: top-1 identical at 72.0%, malignant sens 74.2% -> 73.3%, spec
// 80.0% -> 83.8%, boxes slightly tighter (median size 0.541 -> 0.517) and slightly better centred
// (0.030 -> 0.027), and where both models fire they agree within 0.1 on 99% of images. Latency
// p90 38.7 -> 43.3 ms, still inside the ~83 ms live budget.
//
// THE ONE REAL REGRESSION IS DETECTION RATE: 99.0% -> 90.5%, i.e. 19 of 200 stills produce no box
// against 2. On a miss, classify.ts falls back to the full frame plus the DoG zoom refinement —
// the weaker path that DETECTOR_CROP_ENABLED exists to avoid — so this swap moves ~8.5% of stills
// onto it. Nothing the classifier scores got worse; how often the detector fires did.
//
// THE LIVE-PATH BARS ARE UNREFITTED, AND THEY NO LONGER FIT. CREATE_SCORE / KEEP_SCORE /
// LOCK_SCORE in capture-core.ts were set against the itobos score distribution. This model is more
// polarized (median confidence 0.363 -> 0.316, but p90 0.529 -> 0.799), so KEEP_SCORE 0.28 now
// rejects 35.9% of real lesions against 15.2% before — on the live camera, a box that appears less
// often. They were deliberately left alone: DETECTOR_AB.md's round-1 rule is that lowering a bar
// which can admit FALSE boxes needs the recall-vs-non-skin-FPR sweep in
// `synth/eval/detector_eval.py`, and the lesion-only holdout cannot measure that side. Run that
// sweep against this model before moving either bar.
//
// DET_CONF 0.2 on the still path is unaffected — it sits below this model's p1 (0.202), so it
// rejects nothing that fired.
//
// --- previously bundled: itobos_plus_large_v2_float16_best (6.2 MB, 768) ---
// Swapped in 2026-06-30/07-01 from `yolo_best_float16` (21.4 MB, 640) with no recorded rationale,
// which is why detector_ab.py exists at all. It remains in assets/models as the fallback to revert
// to; do not delete it.
const MODEL_ASSET = require('../../assets/models/lesion_det_y11n_v1_float16.tflite');

let modelPromise: Promise<LesionModel> | null = null;

/**
 * Load the lesion-detection model once and cache it, so the live camera
 * (`scan/capture.tsx`) and the still-image quality gate (`scan/quality.tsx`) share
 * a single instance. In dev, Metro serves the asset over http, which the native
 * loader can't fetch directly — so download it to a local file first.
 *
 * Idempotent and safe to call before the camera exists — see `prewarmLesionModel`, which is what
 * the body-part screen uses to get the load off the capture screen's critical path.
 */
export function getLesionModel(): Promise<LesionModel> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const src = Image.resolveAssetSource(MODEL_ASSET);
      let uri = src.uri;
      if (uri.startsWith('http')) {
        const dest = `${FileSystem.cacheDirectory}lesion_det_y11n_v1_float16.tflite`;
        await FileSystem.downloadAsync(uri, dest);
        uri = dest;
      }
      const m = await loadTensorflowModel({ url: uri }, []);
      // Warm up before handing the model out. TFLite defers a chunk of its setup (XNNPACK delegate
      // partitioning, buffer allocation) to the first invoke, which measures ~12 ms slower than the
      // steady state on desktop and more on a phone. Paying that here, inside the load promise,
      // means no caller can be handed a model whose first real frame is its slowest — and since
      // this resolves before anyone holds the handle, it cannot race the camera's interpreter use.
      try {
        const s = m.inputs[0]?.shape ?? [];
        const n = s.length === 4 ? s[1] * s[2] * s[3] : 0;
        if (n > 0) await m.run([new Float32Array(n).buffer as ArrayBuffer]);
      } catch {
        // A failed warm-up is not a failed load — the model is usable either way.
      }
      return m;
    })().catch((e) => {
      modelPromise = null; // allow a retry on the next call
      throw e;
    });
  }
  return modelPromise;
}

/** Read input size + YOLO output layout from a loaded model. */
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

/**
 * Start loading (and warming) the detector ahead of the camera screen.
 *
 * The model used to be loaded in capture.tsx's mount effect, so reading 5.4 MB off disk, building
 * the interpreter and paying the first-invoke cost all happened while the user was already pointing
 * the camera at a lesion and waiting for a box. The body-part screen is several seconds of
 * unhurried tapping immediately before capture, which is free time to spend on it.
 *
 * Fire-and-forget: failures are swallowed here because this is an optimisation, not a
 * prerequisite — capture.tsx still calls getLesionModel() and still surfaces a real load failure.
 */
export function prewarmLesionModel(): void {
  getLesionModel().catch(() => {});
}
