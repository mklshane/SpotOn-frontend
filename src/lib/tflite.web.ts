/**
 * Web implementation of react-native-fast-tflite's `loadTensorflowModel`, over LiteRT.js.
 *
 * react-native-fast-tflite is a Nitro native module with no web build. LiteRT.js
 * (`@litertjs/core`, Google AI Edge) runs the *same* `.tflite` files in the browser, so the web
 * replica gets the shipped models unmodified rather than a re-export or a server round-trip.
 *
 * VERIFIED AT PARITY 2026-09-08 against the Python `tf.lite.Interpreter` reference, same input:
 * max abs logit deviation 3.8e-6 (wasm) / 9.5e-6 (webgpu), identical argmax, softmax equal to six
 * decimals. Introspected shapes match the documented contract exactly, including the classifier's
 * NCHW [1,3,260,260] — so readClassifierLayout()'s layout sniffing works here unchanged and must
 * not be short-circuited.
 *
 * The returned handle deliberately mimics fast-tflite's: `inputs`/`outputs` carrying `shape`, and
 * `run(ArrayBuffer[]) => Promise<TypedArray[]>`.
 */
import {
  loadAndCompile,
  loadLiteRt,
  Tensor,
  isWebGPUSupported,
  type CompiledModel,
} from '@litertjs/core';

/** Where scripts/copy-litert-wasm.mjs stages the runtime. */
const WASM_PATH = '/litert/';

export interface TensorInfo {
  name: string;
  dataType: string;
  shape: number[];
}

export interface TfliteModel {
  inputs: TensorInfo[];
  outputs: TensorInfo[];
  run(inputs: ArrayBuffer[]): Promise<Float32Array[]>;
  runSync(inputs: ArrayBuffer[]): Float32Array[];
}

let runtime: Promise<void> | null = null;

/**
 * Load the LiteRT WASM runtime once.
 *
 * JSPI is requested first because it lets WebGPU fall back to WASM per-operator instead of
 * dropping the whole model to CPU. Browsers without JSPI throw here, so the retry is what keeps
 * Safari and older Chrome working.
 */
function ensureRuntime(): Promise<void> {
  if (!runtime) {
    runtime = (async () => {
      try {
        await loadLiteRt(WASM_PATH, { jspi: true });
      } catch (e) {
        console.warn('[tflite.web] JSPI runtime unavailable, retrying without it', e);
        await loadLiteRt(WASM_PATH);
      }
    })().catch((e) => {
      runtime = null; // allow a retry on the next call
      throw e;
    });
  }
  return runtime;
}

function describe(d: { name: string; dtype: string; shape: Int32Array }): TensorInfo {
  return { name: d.name, dataType: d.dtype, shape: Array.from(d.shape) };
}

function wrap(model: CompiledModel): TfliteModel {
  const inputs = model.getInputDetails().map(describe);
  const outputs = model.getOutputDetails().map(describe);

  return {
    inputs,
    outputs,
    async run(buffers: ArrayBuffer[]): Promise<Float32Array[]> {
      const tensors = buffers.map((buf, i) =>
        Tensor.fromTypedArray(new Float32Array(buf), inputs[i]?.shape),
      );
      try {
        const out = (await model.run(tensors)) as Tensor[];
        return await Promise.all(out.map(async (t) => new Float32Array(await t.data())));
      } finally {
        // LiteRT tensors hold WASM/GPU memory that GC won't reclaim.
        for (const t of tensors) t.delete();
      }
    },
    runSync(): Float32Array[] {
      // Only the live frame processor in scan/capture.tsx calls this, and the web build replaces
      // that screen with scan/capture.web.tsx (still capture). LiteRT.js has no sync entry point.
      throw new Error('runSync is not available on web — use run()');
    },
  };
}

/**
 * Load and compile a `.tflite` model.
 *
 * Mirrors fast-tflite's signature; the second argument (native delegates) is accepted and
 * ignored, since the accelerator is chosen here instead.
 */
export async function loadTensorflowModel(
  source: { url: string },
  _delegates?: unknown,
): Promise<TfliteModel> {
  await ensureRuntime();
  const accelerator = isWebGPUSupported() ? 'webgpu' : 'wasm';
  try {
    return wrap(await loadAndCompile(source.url, { accelerator }));
  } catch (e) {
    if (accelerator === 'wasm') throw e;
    // A model WebGPU can't compile is still perfectly runnable on the CPU backend.
    console.warn('[tflite.web] WebGPU compile failed, falling back to wasm', e);
    return wrap(await loadAndCompile(source.url, { accelerator: 'wasm' }));
  }
}
