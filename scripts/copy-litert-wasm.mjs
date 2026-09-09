/**
 * Stage prebuilt web runtimes into public/ so the web build can serve them from our own origin.
 *
 * Two of them:
 *   - LiteRT.js's WASM runtime (loaded by URL at runtime, not through the bundler)
 *   - maplibre-gl's UMD build (see the maplibre note further down)
 *
 * LiteRT.js loads its runtime by URL at runtime (`loadLiteRt('/litert/')`), not through the
 * bundler, so the files have to exist as static assets. They live in node_modules and are far
 * too big to commit, hence this copy step - wired into postinstall so a fresh clone is ready
 * without anyone remembering it.
 *
 * All variants are copied because the right one depends on the browser (JSPI support, cross-
 * origin isolation). Only ONE is ever downloaded by a given client, so this costs hosting
 * storage, not tester bandwidth.
 *
 * No-ops when @litertjs/core isn't installed, so native-only checkouts and CI stay green.
 */
import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- LiteRT.js ----
const litertSrc = join(root, 'node_modules', '@litertjs', 'core', 'wasm');
const litertDest = join(root, 'public', 'litert');

// LiteRT picks its wasm variant from a RELAXED-SIMD probe, not from the jspi option:
//   const relaxedSimd = await supportsFeature("relaxedSimd")   (@litertjs/core dist/index.js)
// and falls back to `litert_wasm_compat_internal.js` when the browser lacks it. Safari only
// shipped relaxed SIMD in 18.4, so omitting `compat` 404s the runtime on older iOS and surfaces
// as a bare ClassifierError('model-load') - this was shipped broken on 2026-09-08 and is why
// `compat` is back.
//
// `threaded` stays out: it is only ever selected when `options.threads` is passed, which we never
// do (it would also need SharedArrayBuffer, hence COOP/COEP, and COEP blocks the cross-origin
// Supabase clinic photos).
//
// Each client downloads exactly ONE of these, so the extra variant costs hosting, not bandwidth.
const LITERT_VARIANTS = [
  'litert_wasm_jspi_internal',   // relaxed SIMD + JSPI  (Chrome, Safari 26.6+)
  'litert_wasm_internal',        // relaxed SIMD, no JSPI (Safari 18.4–26.5)
  'litert_wasm_compat_internal', // no relaxed SIMD       (Safari < 18.4, older Android)
];

if (existsSync(litertSrc)) {
  await mkdir(litertDest, { recursive: true });
  for (const base of LITERT_VARIANTS) {
    for (const ext of ['.js', '.wasm']) {
      await cp(join(litertSrc, base + ext), join(litertDest, base + ext));
    }
  }
  const files = await readdir(litertDest);
  let bytes = 0;
  for (const f of files) bytes += (await stat(join(litertDest, f))).size;
  console.log(`[litert] staged ${files.length} files (${(bytes / 1e6).toFixed(1)} MB) -> public/litert/`);
} else {
  console.log('[litert] @litertjs/core not installed - skipping wasm copy');
}

// --------------------------------------------------------------- maplibre-gl ----
//
// maplibre-gl is loaded as a prebuilt UMD script at runtime rather than imported, because Metro
// cannot bundle it correctly: maplibre runs tile parsing in a Web Worker, and when Metro bundles
// the ESM build that worker never answers. The map then downloads its style, renders nothing,
// requests zero tiles and reports no error - a silently blank map.
//
// Serving dist/maplibre-gl.js ourselves keeps the worker inlined the way maplibre built it, and
// avoids a third-party CDN for a health app. Note this is why the dependency is pinned to a 5.x
// release: 6.x dropped the UMD build and ships a separate worker module.
const mlSrc = join(root, 'node_modules', 'maplibre-gl', 'dist');
const mlDest = join(root, 'public', 'maplibre');

if (existsSync(join(mlSrc, 'maplibre-gl.js'))) {
  await mkdir(mlDest, { recursive: true });
  let bytes = 0;
  for (const f of ['maplibre-gl.js', 'maplibre-gl.css']) {
    await cp(join(mlSrc, f), join(mlDest, f));
    bytes += (await stat(join(mlDest, f))).size;
  }
  console.log(`[maplibre] staged 2 files (${(bytes / 1e6).toFixed(1)} MB) -> public/maplibre/`);
} else {
  console.log('[maplibre] no UMD build found (is maplibre-gl 6.x installed? it has none) - skipping');
}
