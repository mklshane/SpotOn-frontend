/**
 * Dependency-free regression test for the scan flow's decision logic
 * (src/lib/triage/scan-flow.ts). Compiles the pure core with the project's own tsc, the same way
 * test-tps.mjs does.
 *
 * These branches decide whether a photo is usable, whether the user is asked to retake, and where
 * they go next. Getting them wrong either wastes the user's effort (a retake prompt after all
 * eight questions) or, worse, reports a triage tier from a photo the model could not read — so
 * every path is enumerated here rather than checked by walking the app.
 *
 * Run:  npm run test:flow
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'scan-flow-'));
execFileSync(
  join(ROOT, 'node_modules/.bin/tsc'),
  ['src/lib/triage/scan-flow.ts', '--ignoreConfig', '--outDir', out, '--module', 'esnext', '--target', 'es2019', '--lib', 'es2019', '--moduleResolution', 'bundler'],
  { cwd: ROOT, stdio: 'inherit' },
);
const { decideQuality, nextStepAfterQuality, decideAnalysis } = await import(
  pathToFileURL(join(out, 'scan-flow.js')).href
);

let pass = 0;
const fails = [];
const check = (name, cond) => (cond ? pass++ : fails.push(name));

const READS = ['pending', 'ok', 'unreadable', 'timeout'];

/* ------------------------------------------------------------------ decideQuality */
const q = (iqaPass, read, checksSettled = true) => decideQuality({ iqaPass, read, checksSettled });

// A clean photo with a clean read advances. That is the common case and must stay fast.
check('good photo + good read passes', q(true, 'ok').pass && !q(true, 'ok').analyzing);

// THE fix: a low-confidence read blocks the auto-advance HERE, so the retake prompt lands next to
// the image checks instead of after the questionnaire.
check('good photo + unreadable does not pass', !q(true, 'unreadable').pass);
check('good photo + unreadable stops analyzing (shows the retake UI)', !q(true, 'unreadable').analyzing);

// A photo that already failed the image checks must NOT wait on inference — it is showing its
// retake UI either way, and waiting would only make a "no" slower.
for (const read of READS) {
  check(`failed IQA never waits on the read (${read})`, !q(false, read).analyzing);
  check(`failed IQA never passes (${read})`, !q(false, read).pass);
}

// A good photo waits while the read is pending, and only while it is pending.
check('good photo waits on a pending read', q(true, 'pending').analyzing);
check('good photo does not pass while pending', !q(true, 'pending').pass);

// A timed-out read counts as readable: we do not know, analysis.tsx still applies the Safety
// Floor, so the worst case degrades to the old behaviour rather than to a false verdict.
check('timeout counts as readable', q(true, 'timeout').pass);
check('timeout stops waiting', !q(true, 'timeout').analyzing);

// Nothing is decided before the image checks have settled.
check('unsettled checks keep analyzing', q(true, 'ok', false).analyzing);
check('unsettled checks keep analyzing even on failure', q(false, 'ok', false).analyzing);

/* ------------------------------------------------------------------ nextStepAfterQuality */
const step = (questionnaireComplete) => nextStepAfterQuality({ questionnaireComplete });

// One photo per pass, from either source, and no detour — the only remaining question is whether
// the questionnaire still needs asking.
check('unanswered → questionnaire', step(false).kind === 'questionnaire');
check('answered → analysis', step(true).kind === 'analysis');
// A Safety-Floor rescan and a follow-up with carried answers both arrive here already answered;
// sending them back through 8 questions would be pure friction.
check('routing never yields a review or crop detour', ['questionnaire', 'analysis'].includes(step(false).kind));

/* ------------------------------------------------------------------ decideAnalysis */
const a = (verdict, acceptedLowConfidence = false) => decideAnalysis({ verdict, acceptedLowConfidence });

check('ok → finalize without the floor', a('ok').kind === 'finalize' && a('ok').applyFloor === false);
check('first low-confidence strike → retake prompt', a('prompt-rescan').kind === 'prompt-retake');
check('second strike → finalize with the floor', a('apply-floor').kind === 'finalize' && a('apply-floor').applyFloor === true);

// The double-prompt guard: someone who already saw this warning on the quality screen and chose to
// continue must not be asked again after answering the questionnaire.
check('accepted low confidence → no second prompt', a('prompt-rescan', true).kind === 'finalize');
check('accepted low confidence still applies the floor', a('prompt-rescan', true).applyFloor === true);

// Acceptance must never downgrade a verdict: 'ok' stays floor-free, 'apply-floor' stays floored.
check('acceptance does not floor an ok result', a('ok', true).applyFloor === false);
check('acceptance does not change the second strike', a('apply-floor', true).applyFloor === true);

// Whatever happens, a non-ok verdict is never finalized WITHOUT the floor — that is the invariant
// that keeps an unreadable photo from being reported as a confident tier.
for (const v of ['prompt-rescan', 'apply-floor']) {
  for (const accepted of [true, false]) {
    const r = a(v, accepted);
    check(`never finalizes ${v} unfloored (accepted=${accepted})`, r.kind === 'prompt-retake' || r.applyFloor === true);
  }
}

if (fails.length) {
  console.error(`\nscan flow: ${pass} passed, ${fails.length} FAILED`);
  for (const f of fails) console.error('  FAIL:', f);
  process.exit(1);
}
console.log(`scan flow: ${pass} passed, 0 failed`);
