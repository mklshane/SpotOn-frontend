/**
 * Dependency-free regression test for the Screening Summary Report template
 * (src/lib/report/report-html.ts + summary-report.ts). Compiles the pure modules with the
 * project's own tsc, renders every tier, and asserts the invariants that matter for a
 * clinical artifact: it is offline, it escapes user input, and it carries all eight
 * questionnaire rows.
 *
 * Also writes each rendered page to a temp dir so the layout can be eyeballed in a browser
 * without a simulator — that is the fast loop for iterating on the print CSS. To check the
 * one-page budget (the report must never paginate), print one of them headlessly:
 *
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     --headless --no-pdf-header-footer --print-to-pdf=/tmp/r.pdf file://<the .html>
 *
 * Run:  npm run test:report
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'spoton-report-'));

// CommonJS output: the modules import each other by extensionless relative specifier, which
// node's ESM loader rejects but its CJS loader resolves.
execFileSync(
  join(ROOT, 'node_modules/.bin/tsc'),
  [
    'src/lib/report/report-html.ts',
    'src/lib/report/summary-report.ts',
    '--ignoreConfig',
    '--noCheck',
    '--outDir',
    out,
    '--module',
    'nodenext',
    '--target',
    'es2019',
    '--lib',
    'es2019',
    '--moduleResolution',
    'nodenext',
  ],
  { cwd: ROOT, stdio: 'inherit' },
);

const require = createRequire(import.meta.url);
const { buildReportHtml, assertNoRemoteRefs } = require(join(out, 'report/report-html.js'));
const { buildReportModel } = require(join(out, 'report/summary-report.js'));

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------- fixtures

const PROFILE = {
  id: 'u1',
  email: 'juan@example.com',
  phone: '0912-345-6789',
  full_name: 'Juan dela Cruz',
  date_of_birth: '1985-03-14',
  sex: 'male',
  fitzpatrick_skin_type: 4,
  is_active: true,
  is_verified: true,
  consent_data_privacy: true,
  consent_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const ALL_QUESTION_IDS = [
  'evolution',
  'bleeding_nonhealing',
  'irregular_border',
  'spontaneous_bleeding',
  'rough_scaly',
  'larger_7mm',
  'ugly_duckling',
  'persistent_2mo',
];

function answers(spec) {
  return Object.fromEntries(ALL_QUESTION_IDS.map((id, i) => [id, spec[i] ?? 'no']));
}

function record({
  topClass = 'MEL',
  confidence = 0.874,
  answerSpec = ['yes', 'yes', 'yes', 'yes', 'no', 'yes', 'yes', 'yes'],
  tier = 'critical',
  imageUri = 'file:///tmp/lesion.jpg',
  tps = 7.2,
} = {}) {
  const probs = { BCC: 0.02, BENIGN: 0.03, MEL: confidence, OTHER: 0.02, SCC: 0.03 };
  return {
    id: 'scan-1',
    createdAt: '2026-05-13T01:42:00.000Z', // 09:42 PHT
    mark: { point: [0, 0, 0], region: 'Left upper back', view: 'back' },
    imageUri,
    source: 'camera',
    questionnaire: { answers: answers(answerSpec), completedAt: '2026-05-13T01:40:00.000Z' },
    classification: {
      probs,
      topClass,
      topConfidence: confidence,
      attempt: 1,
      modelVersion: 'test',
      inputSize: 260,
      normalization: 'imagenet',
      temperature: 1,
      inferenceMs: 0,
      scaleUnstable: false,
      refined: false,
      detectorUsed: true,
    },
    triage: {
      classWeight: 5,
      topConfidence: confidence,
      cs: 4.37,
      symptomScoreRaw: 10,
      symptomScore: 2.73,
      tps,
      tier,
      safetyFloorApplied: false,
      confidenceQualifier: false,
      malignantScore: 0.92,
      malignantGateApplied: false,
    },
  };
}

const PHOTO = { wordmark: 'data:image/png;base64,AAA/BBB+CCC=', photo: 'data:image/jpeg;base64,//9k=' };
const NO_ASSETS = { wordmark: null, photo: null };
const MULTI = {
  ...PHOTO,
  extraPhotos: ['data:image/jpeg;base64,//4A=', 'data:image/jpeg;base64,//4B='],
};

// ---------------------------------------------------------------- cases

const CASES = [
  { name: 'critical', model: buildReportModel(record(), PROFILE), assets: PHOTO },
  {
    name: 'high',
    model: buildReportModel(record({ tier: 'high', confidence: 0.71, tps: 5.1 }), PROFILE),
    assets: PHOTO,
  },
  {
    name: 'moderate',
    model: buildReportModel(
      record({
        tier: 'moderate',
        topClass: 'BCC',
        confidence: 0.62,
        tps: 3.4,
        answerSpec: ['yes', 'no', 'unsure', 'no', 'no', 'yes', 'no', 'unsure'],
      }),
      PROFILE,
    ),
    assets: PHOTO,
  },
  {
    name: 'low',
    model: buildReportModel(
      record({
        tier: 'low',
        topClass: 'BENIGN',
        confidence: 0.93,
        tps: 0.6,
        answerSpec: ['no', 'no', 'no', 'no', 'no', 'no', 'no', 'no'],
      }),
      PROFILE,
    ),
    assets: PHOTO,
  },
  {
    name: 'no-profile-no-photo',
    model: buildReportModel(record({ imageUri: '' }), null),
    assets: NO_ASSETS,
  },
  {
    // Worst case for the one-page budget: every answer is the longest word ("Unsure"), so the
    // response column is at its widest and the most question rows wrap to two lines.
    name: 'all-unsure',
    model: buildReportModel(
      record({ tier: 'high', answerSpec: Array(8).fill('unsure'), tps: 4.9 }),
      PROFILE,
    ),
    assets: PHOTO,
  },
];

console.log('\nScreening Summary Report — template checks\n');

for (const c of CASES) {
  const html = buildReportHtml(c.model, c.assets);
  const file = join(out, `report-${c.name}.html`);
  writeFileSync(file, html);
  console.log(`${c.name}  →  ${file}`);

  const rows = html.match(/<tr[^>]*><td class="q">/g) ?? [];
  check(`${c.name}: 8 symptom rows`, rows.length === 8, `got ${rows.length}`);
  check(`${c.name}: single <tbody>`, (html.match(/<tbody>/g) ?? []).length === 1);
  check(`${c.name}: no remote references`, safe(() => assertNoRemoteRefs(html)));
  check(`${c.name}: styles inlined`, html.includes('-webkit-print-color-adjust: exact'));
}

// Placeholder handling
{
  const html = buildReportHtml(CASES[4].model, NO_ASSETS);
  check('missing photo renders a placeholder', html.includes('photoMissing'));
  check('missing photo emits no <img', !html.includes('<img class="photo"'));
  check('missing profile renders em dashes', (html.match(/—/g) ?? []).length >= 4);
}


// Additional views — the multi-photo strip must be strictly additive: absent for one photo,
// present and captioned for several, and never able to reach the network.
{
  const single = buildReportHtml(CASES[0].model, PHOTO);
  check('single photo emits no additional-views block', !single.includes('class="views"'));
  // Match the ELEMENT, not the class name — `.viewThumb` is always present in the stylesheet.
  check('single photo emits no view thumbnails', !single.includes('<img class="viewThumb"'));

  const multi = buildReportHtml(CASES[0].model, MULTI);
  check('extra photos render the additional-views block', multi.includes('class="views"'));
  check('one thumbnail per extra photo', (multi.match(/class="viewThumb"/g) ?? []).length === 2);
  check('extra photos are inlined as data URIs', multi.includes('data:image/jpeg;base64,//4A='));
  // The caption is load-bearing: the classifier reads the primary photo only, and a clinician
  // must not infer that these views contributed to the number printed above them.
  check('strip states the views are not classified', multi.includes('not used for classification'));
  // The primary photo keeps its full-size slot; the extras never replace it.
  check('primary photo still renders at full size', multi.includes('<img class="photo"'));
  check('additional views survive the offline guarantee', (() => {
    try { assertNoRemoteRefs(multi); return true; } catch { return false; }
  })());

  // An empty array is the same as no array — a screening whose extra photos all failed to load
  // must not print an empty captioned box.
  const emptyExtras = buildReportHtml(CASES[0].model, { ...PHOTO, extraPhotos: [] });
  check('empty extraPhotos renders nothing', !emptyExtras.includes('class="views"'));

  // Extras with no primary: the placeholder still shows, and the strip still renders.
  const noPrimary = buildReportHtml(CASES[0].model, { ...NO_ASSETS, extraPhotos: MULTI.extraPhotos });
  check('missing primary still shows the placeholder', noPrimary.includes('photoMissing'));
  check('missing primary does not suppress the extras', noPrimary.includes('viewThumb'));
}

// Answer styling
{
  const html = buildReportHtml(CASES[2].model, PHOTO);
  check('unsure answers get their own class', html.includes('class="a aUnsure"'));
  check('no answers mute the row', html.includes('<tr class="rNo">'));
}
{
  const html = buildReportHtml(CASES[0].model, PHOTO);
  check('yes answers get their own class', html.includes('class="a aYes"'));
}

// Urgency wording follows the app, not a clinical relabel
{
  const html = buildReportHtml(CASES[0].model, PHOTO);
  check('critical prints as PRIORITY', html.includes('>PRIORITY<'));
  check('critical does not print CRITICAL', !html.includes('CRITICAL'));
}

// Classification line uses the disease name plus the class code
{
  const html = buildReportHtml(CASES[0].model, PHOTO);
  check('classification reads "Melanoma (MEL)"', html.includes('Melanoma (MEL)'));
  check('confidence carries one decimal', html.includes('87.4%'));
  check('date/time in PHT', html.includes('May 13, 2026') && html.includes('09:42 AM PHT'));
}

// Escaping
{
  const model = buildReportModel(record(), {
    ...PROFILE,
    full_name: '<script>alert(1)</script>',
    phone: '0912 & 3456 "x"',
  });
  const html = buildReportHtml(model, PHOTO);
  check('script tags are escaped', !html.includes('<script'));
  check('ampersands are escaped', html.includes('0912 &amp; 3456'));
}

// The offline assertion actually fires
{
  check(
    'assertNoRemoteRefs rejects an https reference',
    !safe(() => assertNoRemoteRefs('<img src="https://cdn.example.com/x.png">')),
  );
  check(
    'assertNoRemoteRefs rejects a protocol-relative reference',
    !safe(() => assertNoRemoteRefs('<link href="//fonts.googleapis.com/css">')),
  );
  check(
    'assertNoRemoteRefs tolerates base64 slashes',
    safe(() => assertNoRemoteRefs('<img src="data:image/jpeg;base64,//9j/4AAQSkZJRg==">')),
  );
}

function safe(fn) {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}

console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures} check(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
