# Android capture performance

## Changes and build requirements

Android camera analysis uses `STRATEGY_KEEP_ONLY_LATEST` through the versioned
VisionCamera 4.7.3 patch. Slow analysis can discard intermediate frames without
blocking the preview. The interpreter remains serialized on the existing frame
processor runtime. The resize-plugin 3.2.0 patch removes its verbose processing
logs from native release builds (`NDEBUG`). `npm install`/`npm ci` apply both through
the existing `postinstall` command. They require a **native rebuild**, not a Metro
reload or an OTA JavaScript update.

Android detection starts at 6 Hz, caps at 12 Hz, and adapts to the entire processing
pass, including skin inference. It reserves at least as much idle time as the most
recent processing duration, with an average-cost floor and gradual recovery. There
is no forced minimum detection frequency. Camera resolution, model inputs, confidence
thresholds, and iOS scheduling are unchanged.

Android drops results aged one second or more. A watchdog clears old boxes and crop
metadata even when no new results arrive (checked every 100 ms). Capture checks
freshness again before taking a photo and snapshots the crop metadata before image
manipulation. The shutter acknowledges the tap immediately and waits up to two
seconds for active inference to finish. It never calls `takePhoto` while that pass
is still busy.

## Builds and a USB test phone

Enable Android Developer options and USB debugging, connect with a data-capable
USB cable, unlock the phone, and authorize the Mac's debugging key. macOS does not
require an extra USB driver. Check the connection with `adb devices -l`.
[Android device setup](https://developer.android.com/studio/run/device)

From `SpotOn-frontend/android`, build locally:

```sh
./gradlew :app:assembleDebug :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
```

Use the ABI reported by `adb shell getprop ro.product.cpu.abi` for a different
device architecture. Outputs are `app/build/outputs/apk/debug/app-debug.apk` and
`app/build/outputs/apk/release/app-release.apk`. The local release build uses this
project's configured local signing key; it is for testing, not store distribution.

```sh
adb install -r app/build/outputs/apk/release/app-release.apk
```

A debug/development build also needs Metro. From the frontend directory:

```sh
npx expo start --dev-client --localhost
adb reverse tcp:8081 tcp:8081
```

Debug and release builds share an application ID. If installation reports a signing
conflict with an existing EAS APK, do not uninstall automatically: uninstalling can
erase local screening data. Resolve the signing/build choice with the device owner.

## Internal diagnostics

The existing HUD is enabled in development. For an internal Android release build,
explicitly set `EXPO_PUBLIC_CAPTURE_PERF=1` when bundling/building; leave it unset for
normal production. For example:

```sh
EXPO_PUBLIC_CAPTURE_PERF=1 ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --rerun-tasks
```

The HUD reports preprocessing, lesion inference, skin inference, total processing,
completed detection rate, requested scheduling interval, last delivered result age,
and JS/UI frame rates. The interval is **not preview FPS**. Result age is measured at
delivery from the beginning of processing; it includes the JS bridge delay. Tier
overrides remain development-only. Do the final smoothness check with diagnostics
disabled, since measurement itself adds work.

## Acceptance protocol

Use the same lighting, scene, camera, zoom, battery/thermal conditions, and build
for each guide-off/on pair. Test a low-, mid-, and high-performance physical Android
phone in both development and release; include the originally affected phone when
available. Record model, Android version, ABI, and build.

1. Warm up the camera, then run five minutes with the guide off and five minutes
   with it on, moving the camera and exercising zoom. Repeat in reverse order to
   expose heating effects. Record preview delivery separately from detection and
   JS/UI frame rate using a system trace of camera/SurfaceView buffer presentation,
   or external high-frame-rate footage if the device cannot expose that trace.
   A UI FPS counter alone does not prove that fresh camera frames are displayed.
2. Acceptance target: guide-on preview delivery stays within 10% of the same phone's
   guide-off baseline, with responsive controls and no sustained freezes. Record
   median/p95 processing duration, detection frequency, and shutter response.
3. Check rear/front cameras, mirroring, zoom, torch, guide toggles, background/resume,
   navigation away/back, and repeated capture-to-crop. The saved photo and crop box
   must match the preview. Remove the target and confirm that stale boxes disappear
   and stale metadata is not forwarded to the crop screen.
4. Check skin close-ups, whole faces, and non-skin scenes. Preserve existing rejection
   behavior. On a slower phone the guide may update less often; manual capture must
   remain available. Capture during inference, including a pass exceeding 500 ms,
   and verify immediate shutter feedback and success when the pass ends within two
   seconds. A longer pass must produce a retry error rather than overlapping capture.
5. Open the 3D body screen before/after capture. Smoke-test the same capture flow on
   a physical iPhone; no iOS recalibration is part of this change.

## Automated checks

```sh
npm run test:android-capture
npm run test:capture
npm run test:smoothing
npm run test:worklets
npm run test:flow
npx tsc --noEmit
npx eslint src/app/scan/capture.tsx src/components/scan/perf-hud.tsx src/lib/android-capture-policy.ts scripts/test-android-capture.mjs
```

The Android suite covers scheduler start/cap/backoff/recovery, session reset,
freshness, paused-result rejection, capture wait/timeout, the platform branch, and
native patch presence. These checks do not establish real-device performance.
