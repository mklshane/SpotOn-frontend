import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'steady-shot-'));
let passed = 0;
async function test(name, run) {
  await run();
  passed++;
  console.log(`  pass: ${name}`);
}

/**
 * Fake clock + gyro. `motion(t)` returns the rotation magnitude at time t; a sample is pushed
 * every 16 ms of simulated time, so the wait sees exactly what a 60 Hz gyro would deliver.
 */
function rig(p, motion, { startAt = 1000, sensor = true } = {}) {
  let clock = startAt;
  const tracker = p.makeSteadyTracker();
  let nextSample = startAt - 400;
  const feed = () => {
    while (sensor && nextSample <= clock) {
      tracker.push(motion(nextSample), 0, 0, nextSample);
      nextSample += 16;
    }
  };
  feed();
  return {
    tracker,
    opts: {
      now: () => clock,
      sleep: async (ms) => { clock += ms; feed(); },
    },
  };
}

try {
  execFileSync(join(ROOT, 'node_modules/.bin/tsc'), [
    'src/lib/steady-shot.ts', '--ignoreConfig', '--outDir', out,
    '--module', 'esnext', '--target', 'es2022', '--lib', 'es2022,dom', '--moduleResolution', 'bundler',
  ], { cwd: ROOT, stdio: 'inherit' });
  const p = await import(pathToFileURL(join(out, 'steady-shot.js')).href);

  await test('a still phone still waits out the hold window from the tap', async () => {
    const { tracker, opts } = rig(p, () => 0.01);
    const r = await p.waitForSteady(tracker, opts);
    assert.equal(r.reason, 'steady');
    assert.ok(r.waitedMs >= p.STEADY_HOLD_MS && r.waitedMs < p.STEADY_HOLD_MS + 20, String(r.waitedMs));
  });

  await test('constant shake hits the cap instead of blocking the shutter', async () => {
    const { tracker, opts } = rig(p, () => 1.0);
    const r = await p.waitForSteady(tracker, opts);
    assert.equal(r.reason, 'timeout');
    assert.equal(r.waitedMs, p.STEADY_MAX_WAIT_MS);
  });

  await test('tap jolt then settle: fires one hold window after motion stops', async () => {
    const { tracker, opts } = rig(p, (t) => (t < 1200 ? 0.8 : 0.03));
    const r = await p.waitForSteady(tracker, opts);
    assert.equal(r.reason, 'steady');
    assert.ok(r.waitedMs >= 200 + p.STEADY_HOLD_MS && r.waitedMs < 200 + p.STEADY_HOLD_MS + 40, String(r.waitedMs));
  });

  await test('a brief wobble mid-hold restarts the window', async () => {
    const { tracker, opts } = rig(p, (t) => (t >= 1050 && t < 1070 ? 0.5 : 0.02));
    const r = await p.waitForSteady(tracker, opts);
    assert.equal(r.reason, 'steady');
    assert.ok(r.waitedMs >= 70 + p.STEADY_HOLD_MS, String(r.waitedMs));
  });

  await test('notBefore holds the shot until a haptic buzz has ended', async () => {
    const { tracker, opts } = rig(p, () => 0.01);
    const r = await p.waitForSteady(tracker, { ...opts, notBefore: 1300 });
    assert.equal(r.reason, 'steady');
    assert.ok(r.waitedMs >= 300 + p.STEADY_HOLD_MS, String(r.waitedMs));
  });

  await test('notBefore never pushes past the cap', async () => {
    const { tracker, opts } = rig(p, () => 0.01);
    const r = await p.waitForSteady(tracker, { ...opts, notBefore: 99999 });
    assert.equal(r.reason, 'timeout');
    assert.equal(r.waitedMs, p.STEADY_MAX_WAIT_MS);
  });

  await test('no gyro data: skip the gate immediately', async () => {
    const { tracker, opts } = rig(p, () => 0, { sensor: false });
    const r = await p.waitForSteady(tracker, opts);
    assert.equal(r.reason, 'no-sensor');
    assert.equal(r.waitedMs, 0);
  });

  await test('NaN samples count as motion, not stillness', () => {
    const t = p.makeSteadyTracker();
    t.push(0, 0, 0, 0);
    t.push(NaN, 0, 0, 50);
    assert.equal(t.calmFor(100, 0), 0);
  });

  console.log(`steady-shot: ${passed} passed`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
