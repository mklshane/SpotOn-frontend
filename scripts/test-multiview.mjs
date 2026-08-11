/**
 * Dependency-free regression test for multi-image aggregation
 * (src/lib/classifier/aggregate-core.ts). Compiles the pure core with the project's own tsc, the
 * same way test-tps.mjs does — classify.ts itself require()s the bundled .tflite and cannot be
 * compiled standalone, which is exactly why the arithmetic lives in a separate import-free module.
 *
 * The load-bearing property here is that pooling happens in LOGIT space. MALIGNANT_THRESHOLD (0.50)
 * was calibrated on logit-mean output; averaging softmaxes is a different estimator that compresses
 * confidence toward 1/K and would silently invalidate it. That difference is invisible on identical
 * inputs — both rules are idempotent — so the tests below use genuinely DIFFERENT vectors, which is
 * the only way to tell them apart.
 *
 * Run:  npm run test:multiview
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'aggregate-core-'));
execFileSync(
  join(ROOT, 'node_modules/.bin/tsc'),
  ['src/lib/classifier/aggregate-core.ts', '--ignoreConfig', '--outDir', out, '--module', 'esnext', '--target', 'es2019', '--lib', 'es2019', '--moduleResolution', 'bundler'],
  { cwd: ROOT, stdio: 'inherit' },
);
const core = await import(pathToFileURL(join(out, 'aggregate-core.js')).href);
const { softmaxT, looksLikeProbabilities, meanLogits, detectDisagreementAmong, toLogitSpace } = core;

let pass = 0;
const fails = [];
const check = (name, cond) => (cond ? pass++ : fails.push(name));
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const vecNear = (a, b, eps = 1e-9) => a.length === b.length && a.every((v, i) => near(v, b[i], eps));

// CLASS_ORDER is ['BCC','BENIGN','MEL','OTHER','SCC'] — index 2 is MEL, 1 is BENIGN.
const MEL = 2;
const BENIGN = 1;

/* ------------------------------------------------------------------ softmax */
let p = softmaxT([1, 2, 3, 4, 5]);
check('softmax sums to 1', near(p.reduce((a, b) => a + b, 0), 1));
check('softmax is monotone in the logits', p[4] > p[3] && p[3] > p[2]);
check('softmax argmax is the max logit', p.indexOf(Math.max(...p)) === 4);

// Temperature must not move the argmax — that is the whole premise of post-hoc calibration.
const hot = softmaxT([3, 1, 4, 1, 5], 1);
const cold = softmaxT([3, 1, 4, 1, 5], 2.5);
check('temperature preserves argmax', hot.indexOf(Math.max(...hot)) === cold.indexOf(Math.max(...cold)));
check('temperature > 1 lowers confidence', Math.max(...cold) < Math.max(...hot));
check('T=1 is the identity', vecNear(softmaxT([1, 2, 3, 4, 5], 1), softmaxT([1, 2, 3, 4, 5])));

// Overflow safety: the shift-by-max must keep large logits finite.
check('softmax is stable on large logits', softmaxT([1000, 999, 998, 997, 996]).every(Number.isFinite));
check('softmax is stable on negative logits', softmaxT([-1000, -999, -998, -997, -996]).every(Number.isFinite));

// Never mutate the caller's array — classify.ts reuses the logit vector for the audit trail.
const original = [1, 2, 3, 4, 5];
softmaxT(original, 2);
check('softmax does not mutate its input', vecNear(original, [1, 2, 3, 4, 5]));

/* ------------------------------------------------------------------ looksLikeProbabilities */
check('detects a probability vector', looksLikeProbabilities([0.1, 0.2, 0.3, 0.15, 0.25]));
check('rejects raw logits', !looksLikeProbabilities([1, 2, 3, 4, 5]));
check('rejects negatives that happen to sum to 1', !looksLikeProbabilities([-0.5, 0.5, 0.5, 0.5, 0]));

/* ------------------------------------------------------------------ toLogitSpace
 * D8 bakes softmax into its graph, so classify.ts converts each view back to log space before
 * averaging. The property that has to hold is that this is EQUIVALENT to a raw-logit export —
 * otherwise swapping the model silently moves the operating point MALIGNANT_THRESHOLD sits on. */
const z1 = [2.0, -1.0, 3.5, 0.25, -0.75];
const z2 = [-0.5, 1.5, 0.0, 2.25, 1.0];

// softmax(log p) === p — the conversion loses nothing softmax can see.
check('log space round-trips through softmax', vecNear(softmaxT(toLogitSpace(softmaxT(z1))), softmaxT(z1), 1e-12));

// THE load-bearing one: averaging log-probs === averaging logits, because log softmax(z) differs
// from z by a class-independent constant that cancels in the final softmax.
check(
  'mean of log-probs === mean of logits (D8 path === D7 path)',
  vecNear(
    softmaxT(meanLogits([toLogitSpace(softmaxT(z1)), toLogitSpace(softmaxT(z2))])),
    softmaxT(meanLogits([z1, z2])),
    1e-12,
  ),
);

// The same must survive temperature, or CONFIDENCE_TEMPERATURE would mean something different
// on a softmax-baked export than on a raw-logit one.
check(
  'equivalence holds under temperature',
  vecNear(
    softmaxT(meanLogits([toLogitSpace(softmaxT(z1)), toLogitSpace(softmaxT(z2))]), 2.5),
    softmaxT(meanLogits([z1, z2]), 2.5),
    1e-12,
  ),
);

// And it must NOT equal the wrong estimator — averaging the probabilities directly. If these ever
// coincide the test above is vacuous.
const probMeanD8 = [softmaxT(z1), softmaxT(z2)]
  .reduce((a, v) => a.map((x, i) => x + v[i] / 2), [0, 0, 0, 0, 0]);
check(
  'log-space mean differs from probability mean',
  !vecNear(softmaxT(meanLogits([toLogitSpace(softmaxT(z1)), toLogitSpace(softmaxT(z2))])), probMeanD8, 1e-6),
);

// A class that underflows to exactly 0 must not poison the mean with -Infinity/NaN.
const withZero = toLogitSpace([0, 0.5, 0.5, 0, 0]);
check('zero probability stays finite', withZero.every(Number.isFinite));
check('zero probability softmaxes to ~0', softmaxT(withZero)[0] < 1e-9);
check(
  'a floored class does not NaN the mean',
  softmaxT(meanLogits([withZero, toLogitSpace(softmaxT(z1))])).every(Number.isFinite),
);

/* ------------------------------------------------------------------ meanLogits */
check('mean of one vector is that vector', vecNear(meanLogits([[1, 2, 3, 4, 5]]), [1, 2, 3, 4, 5]));
check('mean of two vectors', vecNear(meanLogits([[0, 0, 0, 0, 0], [2, 4, 6, 8, 10]]), [1, 2, 3, 4, 5]));
check(
  'identical vectors average to themselves',
  vecNear(meanLogits([[1, 2, 3, 4, 5], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5]]), [1, 2, 3, 4, 5]),
);
// A ragged or empty input means a caller bug; averaging over the wrong denominator would silently
// skew every downstream probability, so it must throw rather than guess.
let threw = false;
try { meanLogits([]); } catch { threw = true; }
check('empty input throws', threw);
threw = false;
try { meanLogits([[1, 2, 3, 4, 5], [1, 2, 3]]); } catch { threw = true; }
check('ragged input throws', threw);

/* ------------------------------------------------- THE property: logit space ≠ softmax space */
// Two images that disagree sharply. Logit-mean is a geometric mean in probability space, so it
// discounts a confidently-wrong view; arithmetic prob-mean does not. On these vectors the two rules
// produce materially different MEL mass — which is what makes the choice load-bearing.
const confidentMel = [0, 0, 6, 0, 0];
const mildBenign = [0, 1.2, 0, 0, 0];

const logitMean = softmaxT(meanLogits([confidentMel, mildBenign]));
const probMean = [softmaxT(confidentMel), softmaxT(mildBenign)]
  .reduce((acc, v) => acc.map((x, i) => x + v[i]), [0, 0, 0, 0, 0])
  .map((x) => x / 2);

check('logit-mean and prob-mean genuinely differ', !near(logitMean[MEL], probMean[MEL], 1e-3));
check('logit-mean still sums to 1', near(logitMean.reduce((a, b) => a + b, 0), 1));

// The precise identity behind "logit averaging is a geometric mean in probability space":
// softmax(mean(logits)) == normalize(elementwise geometric mean of the per-image softmaxes).
// This is the mathematical content of the choice, so pin it rather than a directional hunch.
{
  const pa = softmaxT(confidentMel);
  const pb = softmaxT(mildBenign);
  const geo = pa.map((v, i) => Math.sqrt(v * pb[i]));
  const total = geo.reduce((a, b) => a + b, 0);
  check('logit-mean == normalized geometric mean of probabilities',
    vecNear(logitMean, geo.map((v) => v / total), 1e-12));
}

// The consequence that matters clinically: the geometric mean suppresses any class that even ONE
// view confidently rejects, while the arithmetic mean lets a single confident view carry it. Here
// BENIGN is rated 0.45 by one image and ~0.002 by the other — prob-mean keeps it a live option,
// logit-mean does not. Which rule is right is a calibration question, and MALIGNANT_THRESHOLD was
// fitted under logit-mean, so that is the one that ships.
check('prob-mean keeps a class one view rejects', probMean[BENIGN] > 2 * logitMean[BENIGN]);
// And the number that actually reaches the user: on this pair the two rules disagree about MEL by
// ~24 points of confidence (0.81 vs 0.56). CS = W x confidence feeds the TPS, and the malignant
// score feeds the 0.50 gate, so a threshold fitted under one rule cannot be reused under the other.
check('the rules disagree on malignant confidence by >0.2', logitMean[MEL] - probMean[MEL] > 0.2);

// The N=1 invariant: with one image, pooling must be bit-identical to not pooling. This is what
// guarantees the shipped single-photo operating point is untouched by the multi-image feature.
const single = [0.4, 1.1, 2.2, 0.3, 0.9];
check('N=1 pooling is identity', vecNear(softmaxT(meanLogits([single])), softmaxT(single), 0));

// Repeating one image must not move the answer — catches double-counting and denominator bugs.
check(
  'the same image three times changes nothing',
  vecNear(softmaxT(meanLogits([single, single, single])), softmaxT(single), 1e-12),
);

// Order must not matter: pooling is a mean, not a fold with state.
check(
  'pooling is order-independent',
  vecNear(meanLogits([confidentMel, mildBenign]), meanLogits([mildBenign, confidentMel])),
);

// Pooling must stay inside the convex hull of its inputs — it reduces variance, never extrapolates.
const poolMel = softmaxT(meanLogits([confidentMel, mildBenign]))[MEL];
const loMel = Math.min(softmaxT(confidentMel)[MEL], softmaxT(mildBenign)[MEL]);
const hiMel = Math.max(softmaxT(confidentMel)[MEL], softmaxT(mildBenign)[MEL]);
check('pooled probability lies between the inputs', poolMel >= loMel && poolMel <= hiMel);

/* ------------------------------------------------------------------ disagreement */
const R = (topClass, topConfidence) => ({ topClass, topConfidence });
check('agreeing images do not flag', !detectDisagreementAmong([R('MEL', 0.9), R('MEL', 0.8)], 0.5));
check('confident disagreement flags', detectDisagreementAmong([R('MEL', 0.9), R('BENIGN', 0.7)], 0.5));

// The confidence gate is the whole point: two coin flips landing differently is the Safety Floor's
// job, and without this the check would fire on near-ties constantly.
check(
  'low-confidence disagreement does NOT flag',
  !detectDisagreementAmong([R('MEL', 0.31), R('BENIGN', 0.29)], 0.5),
);
check(
  'one confident + one unconfident does not flag',
  !detectDisagreementAmong([R('MEL', 0.9), R('BENIGN', 0.2)], 0.5),
);
check('a single image cannot disagree', !detectDisagreementAmong([R('MEL', 0.99)], 0.5));
check('excluded images are ignored', !detectDisagreementAmong([R('MEL', 0.9), R(null, null)], 0.5));
check('empty set does not flag', !detectDisagreementAmong([], 0.5));
check(
  'threshold is inclusive at the boundary',
  detectDisagreementAmong([R('MEL', 0.5), R('BENIGN', 0.5)], 0.5),
);
check(
  'three-way confident disagreement flags',
  detectDisagreementAmong([R('MEL', 0.6), R('BENIGN', 0.7), R('SCC', 0.8)], 0.5),
);

if (fails.length) {
  console.error(`\nmultiview: ${pass} passed, ${fails.length} FAILED`);
  for (const f of fails) console.error('  FAIL:', f);
  process.exit(1);
}
console.log(`multiview: ${pass} passed, 0 failed`);
