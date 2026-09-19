/**
 * Dependency-free regression test for the scan flow's decision logic
 * (src/lib/triage/scan-flow.ts). Compiles the pure core with the project's own tsc, the same way
 * test-tps.mjs does.
 *
 * These branches decide whether a photo is usable, whether the user is asked to retake, and where
 * they go next. Getting them wrong either wastes the user's effort (a retake prompt after all
 * eight questions) or, worse, reports a triage tier from a photo the model could not read - so
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
  ['src/lib/triage/scan-flow.ts', '--ignoreConfig', '--outDir', out, '--module', 'esnext', '--target', 'es2022', '--lib', 'es2022', '--moduleResolution', 'bundler'],
  { cwd: ROOT, stdio: 'inherit' },
);
const { decideIqa, decideQuality, nextStepAfterQuality, decideAnalysis, skinGateVerdict } = await import(
  pathToFileURL(join(out, 'scan-flow.js')).href
);

let pass = 0;
const fails = [];
const check = (name, cond) => (cond ? pass++ : fails.push(name));

const READS = ['pending', 'ok', 'unreadable', 'timeout'];

/* ---------------------------------------------------------------------- decideIqa */
// Every term is a veto and no term waives another. This is the function three separate reported
// failures came back to, so each veto gets its own case.
const ok = {
  error: false, brightnessOk: true, sharpOk: true, skinOk: true, presenceOk: true, skinGate: 'skin',
};
const iqa = (over = {}) => decideIqa({ ...ok, ...over });

check('iqa: everything good passes', iqa().pass && iqa().lesionRowOk);
check('iqa: error blocks', !iqa({ error: true }).pass);
check('iqa: darkness blocks', !iqa({ brightnessOk: false }).pass);
check('iqa: blur blocks', !iqa({ sharpOk: false }).pass);

// The lesion ROW is a conjunction: a lesion cannot be in a frame that is not skin, and a green
// tick on a photo of a street is a false statement rather than a mis-tuned threshold.
check('iqa: not skin fails the lesion ROW, not just the pass', !iqa({ skinOk: false }).lesionRowOk);
check('iqa: no presence fails the lesion row', !iqa({ presenceOk: false }).lesionRowOk);
// The learned skin gate replaced the detector veto (2026-09-19). Every non-'skin' verdict blocks the
// row - including 'failed', because could-not-check is not a pass (2026-09-17).
check('iqa: skin gate says not skin -> lesion row fails', !iqa({ skinGate: 'not_skin' }).lesionRowOk);
check('iqa: skin gate says face -> lesion row fails (the selfie)', !iqa({ skinGate: 'face' }).lesionRowOk);
check('iqa: skin gate failed/timed out -> lesion row fails', !iqa({ skinGate: 'failed' }).lesionRowOk);

// The verdict mapping. Face wins over "not enough skin": a selfie's fix is "move closer".
const v = (skin, notSkin, face) => skinGateVerdict({ skin, notSkin, face });
check('skin verdict: confident skin', v(0.95, 0.03, 0.02) === 'skin');
check('skin verdict: confident not skin', v(0.05, 0.93, 0.02) === 'not_skin');
check('skin verdict: face', v(0.1, 0.02, 0.88) === 'face');
check('skin verdict: face beats not-skin', v(0.3, 0.2, 0.5) === 'face');
check('skin verdict: undecided below the skin bar is not skin', v(0.45, 0.3, 0.25) === 'not_skin');

// No term may be waived by another - the 2026-08 bug was `skin` being waived when the detector
// fired and presence passed, which is near-constant-true on an arbitrary photograph.
check(
  'iqa: the skin gate saying skin does NOT waive the colour skin check',
  !iqa({ skinOk: false, skinGate: 'skin', presenceOk: true }).pass,
);
check(
  'iqa: presence does NOT waive the skin gate',
  !iqa({ presenceOk: true, skinGate: 'face' }).pass,
);
check(
  'iqa: the skin gate does NOT waive presence (bare skin still needs a spot)',
  !iqa({ presenceOk: false, skinGate: 'skin' }).pass,
);

/* ------------------------------------------------------------------ decideQuality */
const q = (iqaPass, read, checksSettled = true) => decideQuality({ iqaPass, read, checksSettled });

// A clean photo with a clean read advances. That is the common case and must stay fast.
check('good photo + good read passes', q(true, 'ok').pass && !q(true, 'ok').analyzing);

// THE fix: a low-confidence read blocks the auto-advance HERE, so the retake prompt lands next to
// the image checks instead of after the questionnaire.
check('good photo + unreadable does not pass', !q(true, 'unreadable').pass);
check('good photo + unreadable stops analyzing (shows the retake UI)', !q(true, 'unreadable').analyzing);

// A photo that already failed the image checks must NOT wait on inference - it is showing its
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

// One photo per pass, from either source, and no detour - the only remaining question is whether
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

// Whatever happens, a non-ok verdict is never finalized WITHOUT the floor - that is the invariant
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
