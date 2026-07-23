/**
 * Dependency-free regression test for the Triage Priority Score engine
 * (src/lib/triage/tps-core.ts). Compiles the pure core with the project's own tsc,
 * then pins every constant, boundary, and manuscript test vector (UT-04) against the
 * physician-validated spec (SpotOn_TPS_Specifications, 2026-06-06).
 *
 * Run:  npm run test:tps
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'tps-core-'));
execFileSync(
  join(ROOT, 'node_modules/.bin/tsc'),
  ['src/lib/triage/tps-core.ts', '--ignoreConfig', '--outDir', out, '--module', 'esnext', '--target', 'es2019', '--lib', 'es2019', '--moduleResolution', 'bundler'],
  { cwd: ROOT, stdio: 'inherit' },
);
const core = await import(pathToFileURL(join(out, 'tps-core.js')).href);
const {
  CLASS_WEIGHTS,
  MAJOR_QUESTIONS,
  MINOR_QUESTIONS,
  MAJOR_SCORE,
  MINOR_SCORE,
  SS_RAW_MAX,
  SS_SCALE,
  SAFETY_FLOOR_CONFIDENCE,
  computeSymptomScore,
  computeCS,
  computeTPS,
  assignTier,
  evaluateSafetyFloor,
  applySafetyFloor,
  computeTriage,
  pickTopClass,
  computeMalignantScore,
  evaluateMalignantGate,
} = core;

let pass = 0;
const fails = [];
const check = (name, cond) => (cond ? pass++ : fails.push(name));
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const ALL = [...MAJOR_QUESTIONS, ...MINOR_QUESTIONS];
const answersOf = (fn) => Object.fromEntries(ALL.map((q, i) => [q, fn(q, i)]));
const allNo = answersOf(() => 'no');
const allYes = answersOf(() => 'yes');
const allUnsure = answersOf(() => 'unsure');

// ---- Constants pinned to the spec ----
check('weights: MEL 5', CLASS_WEIGHTS.MEL === 5);
check('weights: SCC 4', CLASS_WEIGHTS.SCC === 4);
check('weights: BCC 3', CLASS_WEIGHTS.BCC === 3);
check('weights: OTHER 2', CLASS_WEIGHTS.OTHER === 2);
check('weights: BENIGN 0', CLASS_WEIGHTS.BENIGN === 0);
check('3 major questions', MAJOR_QUESTIONS.length === 3);
check('5 minor questions', MINOR_QUESTIONS.length === 5);
check('major scoring 2/0.5/0', MAJOR_SCORE.yes === 2 && MAJOR_SCORE.unsure === 0.5 && MAJOR_SCORE.no === 0);
check('minor scoring 1/0/0', MINOR_SCORE.yes === 1 && MINOR_SCORE.unsure === 0 && MINOR_SCORE.no === 0);
check('SS raw max 11', SS_RAW_MAX === 11);
check('SS scale 3', SS_SCALE === 3);
check('safety floor 40%', SAFETY_FLOOR_CONFIDENCE === 0.4);

// ---- UT-04 manuscript vectors ----
// 1. MEL @ 0.91, no symptoms → CS 4.55, TPS 4.55, High
let r = computeTriage('MEL', 0.91, allNo);
check('UT-04a: CS 4.55', close(r.cs, 4.55));
check('UT-04a: SS 0', r.symptomScore === 0 && r.symptomScoreRaw === 0);
check('UT-04a: TPS 4.55', close(r.tps, 4.55));
check('UT-04a: tier High', r.tier === 'high');
// 2. BENIGN @ 0.85, no symptoms → CS 0, TPS 0, Low
r = computeTriage('BENIGN', 0.85, allNo);
check('UT-04b: CS 0', r.cs === 0);
check('UT-04b: TPS 0', r.tps === 0);
check('UT-04b: tier Low', r.tier === 'low');
// 3. Any class @ 0.35 → safety-floor pathway
check('UT-04c: 0.35 attempt1 → prompt-rescan', evaluateSafetyFloor(0.35, 1) === 'prompt-rescan');
check('UT-04c: 0.35 attempt2 → apply-floor', evaluateSafetyFloor(0.35, 2) === 'apply-floor');
r = computeTriage('BENIGN', 0.35, allNo, { applyFloor: true });
check('UT-04c: floored tier Moderate', r.tier === 'moderate');
check('UT-04c: safetyFloorApplied', r.safetyFloorApplied === true);
check('UT-04c: confidenceQualifier', r.confidenceQualifier === true);

// ---- Safety floor boundary ----
check('conf exactly 0.40 → ok', evaluateSafetyFloor(0.4, 1) === 'ok');
check('conf 0.399 → prompt-rescan', evaluateSafetyFloor(0.399, 1) === 'prompt-rescan');
check('high conf → ok on attempt 2', evaluateSafetyFloor(0.9, 2) === 'ok');

// Floor preserves computed components (audit) and only overrides tier/flags.
const before = computeTriage('MEL', 0.38, allYes); // CS 1.9 + SS 3 = 4.9 → high
check('pre-floor: computed high', before.tier === 'high' && close(before.tps, 4.9));
const floored = applySafetyFloor(before);
check('floor: tier moderate', floored.tier === 'moderate');
check('floor: components unchanged', close(floored.tps, 4.9) && close(floored.cs, 1.9));

// ---- Symptom scoring ----
r = computeSymptomScore(allYes);
check('all-yes raw 11', r.raw === 11);
check('all-yes scaled 3.00', close(r.scaled, 3));
r = computeSymptomScore(allUnsure);
check('all-unsure raw 1.5', r.raw === 1.5);
check('all-unsure scaled ≈0.4091', close(r.scaled, 0.4091, 1e-4));
r = computeSymptomScore(allNo);
check('all-no raw 0', r.raw === 0 && r.scaled === 0);

// Per-question increments: each major yes +2 / unsure +0.5; each minor yes +1 / unsure 0.
for (const q of MAJOR_QUESTIONS) {
  check(`major ${q}: yes +2`, computeSymptomScore({ ...allNo, [q]: 'yes' }).raw === 2);
  check(`major ${q}: unsure +0.5`, computeSymptomScore({ ...allNo, [q]: 'unsure' }).raw === 0.5);
}
for (const q of MINOR_QUESTIONS) {
  check(`minor ${q}: yes +1`, computeSymptomScore({ ...allNo, [q]: 'yes' }).raw === 1);
  check(`minor ${q}: unsure +0`, computeSymptomScore({ ...allNo, [q]: 'unsure' }).raw === 0);
}

// Exhaustive 3^8 property check: raw ∈ [0,11], scaled = raw/11*3 (4dp), monotone bounds.
{
  const answers = ['yes', 'no', 'unsure'];
  let ok = true;
  const combos = 3 ** ALL.length;
  for (let n = 0; n < combos; n++) {
    let x = n;
    const a = {};
    for (const q of ALL) {
      a[q] = answers[x % 3];
      x = (x / 3) | 0;
    }
    const { raw, scaled } = computeSymptomScore(a);
    if (raw < 0 || raw > 11 || !close(scaled, Math.round((raw / 11) * 3 * 1e4) / 1e4)) {
      ok = false;
      break;
    }
  }
  check(`exhaustive ${combos} combos: raw∈[0,11], scaled=raw/11*3`, ok);
}

// ---- Tier boundaries (half-open, 4dp pre-rounding) ----
check('tier 0 → low', assignTier(0) === 'low');
check('tier 1.99 → low', assignTier(1.99) === 'low');
check('tier 2.00 → moderate', assignTier(2.0) === 'moderate');
check('tier 3.9999 → moderate', assignTier(3.9999) === 'moderate');
check('tier 4.00 → high', assignTier(4.0) === 'high');
check('tier 5.9999 → high', assignTier(5.9999) === 'high');
check('tier 6.00 → critical', assignTier(6.0) === 'critical');
check('tier 8.00 → critical', assignTier(8.0) === 'critical');
// Float noise directly at a boundary must round up, not fall through.
check('tier 1.9999999999 → moderate (4dp rule)', assignTier(1.9999999999) === 'moderate');
check('tier 5.99994 → high (rounds to 5.9999)', assignTier(5.99994) === 'high');

// ---- Composite clinical sanity vectors ----
// BENIGN 1.0 + all-yes symptoms → TPS 3.00 Moderate (symptoms alone can't exceed Moderate).
r = computeTriage('BENIGN', 1.0, allYes);
check('benign+max-symptoms: TPS 3.00', close(r.tps, 3));
check('benign+max-symptoms: Moderate', r.tier === 'moderate');
// MEL 1.0 + all-yes → 8.00 Critical (range max).
r = computeTriage('MEL', 1.0, allYes);
check('range max: TPS 8.00', close(r.tps, 8));
check('range max: Critical', r.tier === 'critical');
// MEL 0.45 + no symptoms → CS 2.25 Moderate (spec's own example).
r = computeTriage('MEL', 0.45, allNo);
check('MEL@0.45: CS 2.25 Moderate', close(r.cs, 2.25) && r.tier === 'moderate');
// SCC 0.85 + one major yes → 3.4 + 0.5455 ≈ 3.95 Moderate; +one minor → crosses to High.
r = computeTriage('SCC', 0.85, { ...allNo, [MAJOR_QUESTIONS[0]]: 'yes' });
check('SCC@0.85 +1 major ≈3.95 Moderate', close(r.tps, 3.9455, 1e-3) && r.tier === 'moderate');
r = computeTriage('SCC', 0.85, { ...allNo, [MAJOR_QUESTIONS[0]]: 'yes', [MINOR_QUESTIONS[0]]: 'yes' });
check('SCC@0.85 +major+minor ≈4.22 High', close(r.tps, 4.2182, 1e-3) && r.tier === 'high');

// ---- Input validation ----
const throws = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};
check('conf -0.1 throws', throws(() => computeCS('MEL', -0.1)));
check('conf 1.1 throws', throws(() => computeCS('MEL', 1.1)));
check('conf NaN throws', throws(() => computeCS('MEL', NaN)));
check('missing answer throws', throws(() => computeSymptomScore({ ...allNo, evolution: undefined })));
check('invalid answer throws', throws(() => computeSymptomScore({ ...allNo, evolution: 'maybe' })));

// ---- pickTopClass ----
let p = pickTopClass({ MEL: 0.1, SCC: 0.2, BCC: 0.15, OTHER: 0.05, BENIGN: 0.5 });
check('top pick: BENIGN 0.5', p.topClass === 'BENIGN' && close(p.topConfidence, 0.5));
p = pickTopClass({ MEL: 0.4, SCC: 0.4, BCC: 0.1, OTHER: 0.05, BENIGN: 0.05 });
check('tie-break: MEL over SCC (higher weight)', p.topClass === 'MEL');
check('invalid prob throws', throws(() => pickTopClass({ MEL: NaN, SCC: 0, BCC: 0, OTHER: 0, BENIGN: 0 })));

// ---- computeTPS rounding ----
check('computeTPS rounds to 4dp', computeTPS(1.00005, 1.00005) === 2.0001);

// ---- Malignant Gate ----
// The threshold itself lives in classifier/model-config.ts (a model property, not a clinical
// constant), so these vectors pin the *mechanism* against an explicit threshold argument.
// THR below is an arbitrary fixed value for testing — deliberately NOT the shipping constant, so
// re-tuning the model can never silently change what these assertions mean.
const THR = 0.3454;
const spread = { BENIGN: 0.45, BCC: 0.25, MEL: 0.15, SCC: 0.05, OTHER: 0.1 };

check('malignant score sums MEL+SCC+BCC', close(computeMalignantScore(spread), 0.45));
check('malignant score ignores BENIGN/OTHER', close(computeMalignantScore({ ...spread, BENIGN: 0, OTHER: 0 }), 0.45));
check('malignant score rounds to 4dp', computeMalignantScore({ MEL: 0.100005, SCC: 0.1, BCC: 0.1, OTHER: 0, BENIGN: 0 }) === 0.3);
check('invalid prob throws', throws(() => computeMalignantScore({ MEL: NaN, SCC: 0, BCC: 0, OTHER: 0, BENIGN: 0 })));

check('gate fires at threshold (inclusive)', evaluateMalignantGate(THR, THR) === true);
check('gate silent just below', evaluateMalignantGate(0.3453, THR) === false);
check('gate score out of range throws', throws(() => evaluateMalignantGate(1.5, THR)));
check('gate NaN score throws', throws(() => evaluateMalignantGate(NaN, THR)));

// The motivating case: argmax says BENIGN (CS 0 → low), but 45% of the mass is malignant.
r = computeTriage('BENIGN', 0.45, allNo, { malignantScore: 0.45, malignantThreshold: THR });
check('gate floors low → moderate', r.tier === 'moderate' && r.malignantGateApplied === true);
check('gate preserves TPS arithmetic', close(r.cs, 0) && close(r.tps, 0));
check('gate records the score', close(r.malignantScore, 0.45));

// Below threshold: untouched.
r = computeTriage('BENIGN', 0.9, allNo, { malignantScore: 0.1, malignantThreshold: THR });
check('gate silent below threshold', r.tier === 'low' && r.malignantGateApplied === false);

// Never pulls a higher tier down, and never claims credit it did not earn.
r = computeTriage('MEL', 0.95, allYes, { malignantScore: 0.95, malignantThreshold: THR });
check('gate never lowers a critical', r.tier === 'critical' && r.malignantGateApplied === false);
r = computeTriage('OTHER', 0.9, allNo, { malignantScore: 0.5, malignantThreshold: THR }); // CS 1.8 → low
check('gate floors OTHER-argmax low → moderate', r.tier === 'moderate' && r.malignantGateApplied === true);

// Omitting the gate inputs must leave the physician-validated path bit-for-bit unchanged.
const ungated = computeTriage('BENIGN', 0.45, allNo);
check('gate opt-out: tier unchanged', ungated.tier === 'low' && ungated.malignantGateApplied === false);
check('gate opt-out: score defaults to 0', ungated.malignantScore === 0);

// Interaction with the Safety Floor: both floor to Moderate, flags stay independently truthful.
r = computeTriage('BENIGN', 0.35, allNo, { applyFloor: true, malignantScore: 0.5, malignantThreshold: THR });
check('gate + safety floor: moderate', r.tier === 'moderate');
check('gate + safety floor: both flagged', r.malignantGateApplied === true && r.safetyFloorApplied === true);

if (fails.length) {
  console.error(`\ntps core: ${pass} passed, ${fails.length} FAILED`);
  for (const f of fails) console.error('  FAIL:', f);
  process.exit(1);
}
console.log(`tps core: ${pass} passed, 0 failed`);
