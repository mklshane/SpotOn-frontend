import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parse } = require('@babel/parser');
const traverseModule = require('@babel/traverse');
const traverse = traverseModule.default ?? traverseModule;
const ROOT = new URL('..', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'android-capture-'));
let passed = 0;
async function test(name, run) {
  await run();
  passed++;
  console.log(`  pass: ${name}`);
}

try {
  execFileSync(join(ROOT, 'node_modules/.bin/tsc'), [
    'src/lib/android-capture-policy.ts', '--ignoreConfig', '--outDir', out,
    '--module', 'esnext', '--target', 'es2022', '--lib', 'es2022,dom', '--moduleResolution', 'bundler',
  ], { cwd: ROOT, stdio: 'inherit' });
  const p = await import(pathToFileURL(join(out, 'android-capture-policy.js')).href);

  await test('starts at 6 Hz; pause/busy gates do not consume a scheduling slot', () => {
    const state = p.initialAndroidSchedule(1);
    assert.equal(state.intervalMs, 1000 / 6);
    assert.equal(p.androidDetectionDue(state, 100, false, false), true);
    assert.equal(p.androidDetectionDue(state, 100, true, false), false);
    assert.equal(p.androidDetectionDue(state, 100, false, true), false);
    assert.equal(state.lastStartedAt, null);
    const started = { ...state, lastStartedAt: 100 };
    assert.equal(p.androidDetectionDue(started, 266, false, false), false);
    assert.equal(p.androidDetectionDue(started, 267, false, false), true);
  });

  await test('fast device gradually reaches 12 Hz and never exceeds it', () => {
    let state = p.initialAndroidSchedule(1);
    for (let i = 0; i < 100; i++) {
      const previous = state;
      state = p.completeAndroidDetection(state, 1, 20);
      assert.ok(state.intervalMs >= 1000 / 12);
      assert.ok(state.intervalMs >= previous.intervalMs * 0.9);
      assert.ok(state.intervalMs >= p.ANDROID_DUTY_FACTOR * state.meanMs);
    }
    assert.equal(state.intervalMs, 1000 / 12);
  });

  await test('slow inference and skin processing back off immediately without a forced minimum FPS', () => {
    const state = p.completeAndroidDetection(p.initialAndroidSchedule(1), 1, 350);
    assert.equal(state.intervalMs, 350 * p.ANDROID_DUTY_FACTOR);
    const slower = p.completeAndroidDetection(state, 1, 1400);
    assert.equal(slower.intervalMs, 1400 * p.ANDROID_DUTY_FACTOR);
    const recovered = p.completeAndroidDetection(slower, 1, 20);
    assert.equal(recovered.intervalMs, 1400 * p.ANDROID_DUTY_FACTOR * 0.9);
    // Vivo V2248 regression: a 1.2 s pass must not idle another 1.2 s before the next one.
    assert.ok(p.completeAndroidDetection(p.initialAndroidSchedule(1), 1, 1200).intervalMs <= 1500);
  });

  await test('thermal slowdown then recovery respects average cost and gradual recovery', () => {
    let state = p.initialAndroidSchedule(4);
    let now = 100;
    for (const cost of [...Array(30).fill(25), ...Array(30).fill(300), ...Array(50).fill(30)]) {
      assert.ok(p.androidDetectionDue(state, now, false, false));
      state = { ...state, lastStartedAt: now };
      state = p.completeAndroidDetection(state, 4, cost);
      assert.ok(state.intervalMs >= p.ANDROID_DUTY_FACTOR * cost);
      assert.ok(state.intervalMs >= p.ANDROID_DUTY_FACTOR * state.meanMs);
      assert.equal(p.androidDetectionDue(state, now + state.intervalMs - 1, false, false), false);
      now += Math.ceil(state.intervalMs);
    }
    assert.ok(state.intervalMs < 100);
  });

  await test('session reset discards old completion and starts promptly at 6 Hz', () => {
    const reset = p.initialAndroidSchedule(8);
    assert.strictEqual(p.completeAndroidDetection(reset, 7, 900), reset);
    assert.equal(reset.intervalMs, 1000 / 6);
    assert.ok(p.androidDetectionDue(reset, 10_000, false, false));
    for (const invalid of [NaN, Infinity, -10]) {
      assert.strictEqual(p.completeAndroidDetection(reset, 8, invalid), reset);
    }
  });

  await test('freshness includes inference and JS delivery; expiry needs no new detection', () => {
    assert.equal(p.isFreshAndroidResult(null, 1000), false);
    assert.equal(p.isFreshAndroidResult(100, 99), false);
    assert.equal(p.isFreshAndroidResult(100, 1099), true);
    assert.equal(p.isFreshAndroidResult(100, 1100), false);
    assert.equal(p.acceptsAndroidResult(3, 3, 100, 700, false), true);
    assert.equal(p.acceptsAndroidResult(3, 3, 100, 1101, false), false);
    assert.equal(p.acceptsAndroidResult(3, 2, 100, 700, false), false);
    assert.equal(p.acceptsAndroidResult(3, 3, 100, 700, true), false);
    // The same timestamp expires for the watchdog and capture metadata, even if no batch arrives.
    const acceptedAt = 100;
    assert.equal(p.isFreshAndroidResult(acceptedAt, 1200), false);
  });

  await test('box validity outlasts the tracker miss grace at the live cadence', () => {
    // Full-speed passes keep the original 1 s watchdog.
    assert.equal(p.androidResultMaxAgeMs(1000 / 12), 1000);
    assert.equal(p.androidResultMaxAgeMs(NaN), 1000);
    assert.equal(p.androidResultMaxAgeMs(0), 1000);
    // Galaxy A42 regression: at 600 ms passes, one miss (~1.2 s since the last hit) cleared the box.
    const maxAge = p.androidResultMaxAgeMs(600);
    assert.equal(maxAge, 4 * 600 + 250);
    assert.equal(p.isFreshAndroidResult(0, 1200, maxAge), true);
    assert.equal(p.isFreshAndroidResult(0, 3 * 600 + 100, maxAge), true); // three misses retained
    assert.equal(p.acceptsAndroidResult(3, 3, 0, 1200, false, maxAge), true);
    // A stalled detector still expires, and very slow phones are capped.
    assert.equal(p.isFreshAndroidResult(0, maxAge, maxAge), false);
    assert.equal(p.androidResultMaxAgeMs(5000), 4000);
  });

  await test('lesion auto-focus: settles first, once per spot, throttled, yields to a tap', () => {
    const s0 = p.initialAutoFocusState;
    assert.equal(p.nextAutoFocus(s0, 1000, 0.5, 0.5, 1), null); // box still settling
    const s1 = p.nextAutoFocus(s0, 1000, 0.5, 0.5, 2);
    assert.ok(s1);
    assert.equal(p.nextAutoFocus(s1, 5000, 0.52, 0.5, 9), null); // same spot: no refocus
    assert.equal(p.nextAutoFocus(s1, 1200, 0.8, 0.5, 9), null); // moved, but throttled
    assert.ok(p.nextAutoFocus(s1, 2600, 0.8, 0.5, 9)); // moved and past the throttle
    const tapped = p.userFocused(s1, 3000);
    assert.equal(p.nextAutoFocus(tapped, 5900, 0.1, 0.1, 9), null); // the user's tap wins
    assert.ok(p.nextAutoFocus(tapped, 6000, 0.1, 0.1, 9));
    // A new target focuses immediately; a pending tap hold survives the reset.
    const reset = p.resetAutoFocus(tapped);
    assert.equal(reset.lastAt, null);
    assert.equal(reset.userUntil, tapped.userUntil);
  });

  await test('capture waits for the existing pass; no sleep when already idle', async () => {
    let now = 0;
    let sleeps = 0;
    const sleep = async (ms) => { now += ms; sleeps++; };
    await p.waitForCaptureIdle(() => false, p.ANDROID_CAPTURE_WAIT_MS, () => now, sleep);
    assert.equal(sleeps, 0);
    await p.waitForCaptureIdle(() => now < 720, p.ANDROID_CAPTURE_WAIT_MS, () => now, sleep);
    assert.equal(now, 720); // Previously failed at 500 ms on a slow Android device.
  });

  await test('capture times out at two seconds without proceeding to takePhoto', async () => {
    let now = 0;
    let photographed = false;
    await assert.rejects(async () => {
      await p.waitForCaptureIdle(() => true, p.ANDROID_CAPTURE_WAIT_MS,
        () => now, async (ms) => { now += ms; });
      photographed = true;
    }, /Detector did not become idle/);
    assert.equal(now, 2000);
    assert.equal(photographed, false);
  });

  await test('iOS frame limiter remains separate; Android scheduler covers the whole pass', () => {
    const source = readFileSync(join(ROOT, 'src/app/scan/capture.tsx'), 'utf8');
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    let platformBranch = false;
    let measuredFinally = false;
    traverse(ast, {
      IfStatement(path) {
        if (path.node.test.type !== 'Identifier' || path.node.test.name !== 'ANDROID_CAPTURE') return;
        const alternate = path.node.alternate;
        if (!alternate) return;
        const ios = source.slice(alternate.start, alternate.end);
        if (!ios.includes('runAtTargetFps(targetFps, detect)')) return;
        const android = source.slice(path.node.consequent.start, path.node.consequent.end);
        assert.ok(android.includes('androidDetectionDue('));
        assert.ok(android.includes('detect()'));
        platformBranch = true;
      },
      TryStatement(path) {
        if (!path.node.finalizer) return;
        const finalizer = source.slice(path.node.finalizer.start, path.node.finalizer.end);
        if (!finalizer.includes('completeAndroidDetection(')) return;
        const body = source.slice(path.node.block.start, path.node.block.end);
        assert.ok(body.includes('boxedSkin.unbox().runSync'));
        assert.ok(finalizer.includes('inferenceBusySV.value = false'));
        measuredFinally = true;
      },
    });
    assert.ok(platformBranch);
    assert.ok(measuredFinally);
    // Full-quality stills on Android only; iOS keeps the 'balanced' it shipped with.
    // Zero-shutter-lag on both platforms; 'quality' cost 1.8-2.5 s per tap on Android.
    assert.ok(source.includes('photoQualityBalance="balanced"'));
    // No format: 12 MP forces CameraX stream sharing on LIMITED devices and misaligns the box.
    assert.ok(!/\bformat=\{/.test(source), 'capture must stay format-unconstrained');
    // Guide toggle must not detach the Android frame processor (that rebinds CameraX: black flash).
    assert.ok(source.includes('frameProcessor={(ANDROID_CAPTURE || guide) && isFocused ? frameProcessor : undefined}'));
    assert.ok(source.includes('capturePausedSV.value || !guideSV.value) return;'));
    // Auto-focus is Android-gated and never fires while a capture owns the camera.
    assert.ok(source.includes('if (ANDROID_CAPTURE && canFocusRef.current && !captureInFlightRef.current)'));
    // Capture must pause new work before waiting, and cannot bypass the idle check.
    const shoot = source.slice(source.indexOf('async function shoot()'));
    assert.ok(shoot.indexOf('capturePausedSV.value = true') < shoot.indexOf('await waitForCaptureIdle'));
    assert.ok(shoot.indexOf('if (ANDROID_CAPTURE) setBusy(true)') < shoot.indexOf('await waitForCaptureIdle'));
    assert.ok(shoot.indexOf('await waitForCaptureIdle') < shoot.indexOf('await cam.takePhoto'));
    assert.ok(shoot.indexOf('const androidCaptureBox') < shoot.indexOf('await cam.takePhoto'));
  });

  await test('installed Android native fixes match their persistent patches', () => {
    const camera = readFileSync(join(ROOT, 'node_modules/react-native-vision-camera/android/src/main/java/com/mrousavy/camera/core/CameraSession+Configuration.kt'), 'utf8');
    assert.ok(camera.includes('analysis.setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)'));
    assert.ok(!camera.includes('STRATEGY_BLOCK_PRODUCER'));
    const resize = readFileSync(join(ROOT, 'node_modules/vision-camera-resize-plugin/android/src/main/cpp/ResizePlugin.cpp'), 'utf8');
    let debugOnly = false;
    for (const line of resize.split('\n')) {
      if (line === '#ifndef NDEBUG') debugOnly = true;
      if (line === '#endif') debugOnly = false;
      if (line.includes('__android_log_')) assert.ok(debugOnly, line);
    }
    // Per-stage size-keyed buffer caches: alternating skin/detector sizes must not reallocate.
    for (const stage of ['_crop', '_mirror', '_rotated', '_scale', '_customFormat', '_customType']) {
      assert.ok(resize.includes(`${stage}Buffer = cachedBuffer(${stage}Cache,`), stage);
    }
    const resizeKt = readFileSync(join(ROOT, 'node_modules/vision-camera-resize-plugin/android/src/main/java/com/visioncameraresizeplugin/ResizePlugin.kt'), 'utf8');
    assert.ok(!/^\s*Log\.i\(TAG/m.test(resizeKt), 'per-call Kotlin logs must be guarded');
    execFileSync('git', ['apply', '--reverse', '--check',
      'patches/react-native-vision-camera+4.7.3.patch',
      'patches/vision-camera-resize-plugin+3.2.0.patch',
    ], { cwd: ROOT, stdio: 'pipe' });
  });
  console.log(`android capture: ${passed} passed, 0 failed`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
