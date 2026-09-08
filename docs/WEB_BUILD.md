# The web build

SpotOn runs in a browser as well as on a phone, so testers we can't reach can use the app from a
URL instead of installing anything. It is the same codebase, the same screens and — importantly —
the **same `.tflite` models**, not a mock and not a server round-trip.

```bash
npm run web                 # dev server
npx expo export -p web      # static build -> dist/
```

## What makes it work

Expo web (react-native-web) renders the existing screens unchanged. Five native dependencies have
no web build, and each is handled by a `.web.ts` sibling that Metro resolves automatically:

| Native module | Web replacement | File |
|---|---|---|
| `react-native-fast-tflite` | LiteRT.js (`@litertjs/core`) | `src/lib/tflite.web.ts` |
| `expo-file-system` (a no-op stub on web) | OPFS + a service worker | `src/lib/fs.web.ts`, `public/fs-sw.js` |
| `expo-secure-store` | `localStorage` — **not secure** | `src/lib/secure-store.web.ts` |
| `react-native-vision-camera` | `getUserMedia` + canvas still | `src/app/scan/capture.web.tsx` |
| `expo-print` / `expo-sharing` | browser print-to-PDF | `src/lib/report/report-pdf.web.ts` |
| `Image.resolveAssetSource` (absent in RNW) | `expo-asset` | `src/lib/asset-uri.web.ts` |
| `@maplibre/maplibre-react-native` | maplibre-gl | `src/lib/maplibre.web.ts` + `maplibre-web-impl.tsx` |

`expo-sqlite` ships a real web backend (wa-sqlite on OPFS). three.js/r3f, Reanimated,
gesture-handler and SVG all work as-is.

### Four resolution traps, all of which cost real time

1. **A `.web.tsx` sibling of a `.ts` module does not resolve.** Every shim here is `.web.ts` and
   works; `maplibre.web.tsx` next to `maplibre.ts` was silently ignored and Metro kept bundling
   the native file. That is why the map implementation lives in `maplibre-web-impl.tsx` behind a
   plain `maplibre.web.ts` re-export. Match the platform file's extension to the native one.
2. **maplibre-gl cannot be bundled by Metro.** It parses tiles in a Web Worker; bundled through
   Metro that worker never answers, so the map fetches its style, renders nothing, requests zero
   tiles and reports *no error*. It is loaded as a prebuilt UMD script from `public/maplibre/`
   instead (staged by `scripts/copy-litert-wasm.mjs`). **Keep maplibre-gl pinned to 5.x** — 6.x
   dropped the UMD build and ships a separate worker module, which reintroduces the bug.
3. **`layout: undefined` silently drops a map layer.** maplibre validates the layer spec and
   rejects `undefined`, so the pins never appeared. Optional keys are omitted, not passed as
   undefined. Keep the `map.on('error')` handler — it is what surfaced this.
4. **COEP `require-corp` blocks cross-origin images.** It killed every Supabase clinic photo.
   Serve **`credentialless`** instead: still cross-origin isolated (SharedArrayBuffer available
   for the WASM runtimes), but no-cors cross-origin images load.

### Inference is real, and verified at parity

LiteRT.js runs the shipped `.tflite` files unmodified. Measured 2026-09-08 against the Python
`tf.lite.Interpreter` reference on an identical input: **max abs logit deviation 3.8e-6** (WASM) /
9.5e-6 (WebGPU), identical argmax, softmax equal to six decimals.

The shim sits at `loadTensorflowModel`, *below* `lesion-model.ts` and `classifier-model.ts`, so
model caching, warm-up and layout introspection stay single-sourced. `readClassifierLayout()`'s
NHWC-vs-NCHW sniffing reads LiteRT's shapes correctly (D13 introspects as `[1,3,260,260]`, NCHW)
and must not be short-circuited.

### The virtual filesystem

`expo-file-system` on web is a stub whose `documentDirectory`/`cacheDirectory` are `null` and
which has no methods. `fs.web.ts` reimplements the ~10 calls the app makes over OPFS, and
`public/fs-sw.js` serves those bytes back at `/_fs/...`.

The service worker matters: the app hands file URIs straight to `<Image>`, `manipulateAsync` and
the report renderer, all of which need something *fetchable*. Serving OPFS over a real URL is what
lets `image-paths.ts`'s relative-path rebasing work on web with no branch in it.

Import filesystem access from `@/lib/fs`, never from `expo-file-system` directly — the direct
import silently does nothing on web.

## Capture differs from native, deliberately

The native capture screen runs the detector on every camera frame (VisionCamera frame processors +
worklets). The web screen takes a **still** and lets the existing still pipeline do the work:
`classify.ts` runs the detector via `lesion-detector.ts` and falls back to full-frame + DoG zoom
refinement when no box is found.

That is not a web-only path — it is what a native capture does whenever the live detector doesn't
fire (~9.5% of stills with y11n_v1). **Triage answers are produced by the same code. Framing-UX
feedback from web does not transfer to the native capture experience.**

## Deploying

```bash
npx expo export -p web
npx eas deploy
```

- Set `EXPO_PUBLIC_API_BASE_URL` to the deployed backend; `localhost:8000` won't resolve for
  remote testers, and the backend needs CORS for the `.expo.app` origin.
- Serve **COOP `same-origin` + COEP `credentialless`** — `require-corp` blocks the Supabase
  clinic photos (see trap 4 above).
- `EXPO_PUBLIC_MAPTILER_KEY` must be set or the map falls back to the list.
- The API's `CORS_ORIGINS` must include the deployed web origin, or every request fails and the
  app shows "Can't reach the server". It lives in the Render dashboard, not the repo.
- `scripts/copy-litert-wasm.mjs` stages the LiteRT runtime into `public/litert/` (wired into
  `postinstall`). All four variants are copied; a client downloads exactly one (~9.6 MB).
- First load pulls ~36 MB of models plus that runtime. Budget for it on Philippine mobile.

## Known limits

- **`localStorage` is not the Keychain.** Auth tokens and the cached profile sit in plain text.
  Point the web build at throwaway accounts only, never production auth or real patient data.
- **One tab at a time.** wa-sqlite takes an exclusive OPFS access handle; a second tab on the same
  origin fails to open the database.
- The report is the browser's print dialog, not a generated PDF file, so there is no share sheet
  and the filename comes from the print dialog.
- No torch or pinch-zoom on the web capture screen.
