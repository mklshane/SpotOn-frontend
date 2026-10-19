/**
 * Regression tests for the research-sharing rules (src/lib/research-core.ts): what may leave the
 * phone, when, and what happens after the server answers.
 *
 * These are the privacy-relevant decisions - a regression here either uploads something the
 * consent copy promised would never leave the device, or uploads without consent - so they are
 * pinned against the API contract (SpotOn-backend routers/research.py) rather than left to tsc.
 * Compiles the real module with the project's own tsc, like test-tps.mjs.
 *
 * Run:  npm run test:research
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'research-core-'));
execFileSync(
  join(ROOT, 'node_modules/.bin/tsc'),
  ['src/lib/research-core.ts', '--ignoreConfig', '--outDir', out, '--module', 'esnext', '--target', 'es2022', '--lib', 'es2022', '--moduleResolution', 'bundler'],
  { cwd: ROOT, stdio: 'inherit' },
);
// The only import is type-only, so the emitted file stands alone; fix the extension just in case.
const js = join(out, 'research-core.js');
writeFileSync(js, readFileSync(js, 'utf8').replace(/from "(\.\.?\/[^"]+?)"/g, (m, s) => (s.endsWith('.js') ? m : `from "${s}.js"`)));
const R = await import(pathToFileURL(js).href);

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) passed++;
  else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- consent gating
const V = R.RESEARCH_CONSENT_VERSION;
check('version is the contract version', V === '2026-10-v1');
const on = { research_sharing_enabled: true, research_consent: true, research_consent_version: V };
check('canShare: flag + consent + current version', R.canShareResearch(on));
check('canShare: null user', !R.canShareResearch(null));
check('canShare: profile cached from an old server (fields missing)', !R.canShareResearch({ id: 'u' }));
check('canShare: flag off', !R.canShareResearch({ ...on, research_sharing_enabled: false }));
check('canShare: consent off', !R.canShareResearch({ ...on, research_consent: false }));
check('canShare: consent to an older version', !R.canShareResearch({ ...on, research_consent_version: '2025-01-v0' }));

check('ask: flag off never asks', !R.shouldAskResearch({ research_sharing_enabled: false }, null));
check('ask: missing fields never ask', !R.shouldAskResearch({}, null));
check('ask: never answered', R.shouldAskResearch({ research_sharing_enabled: true, research_consent: false, research_consent_version: null }, null));
check('ask: "Not now" for this version is remembered', !R.shouldAskResearch({ research_sharing_enabled: true }, V));
check('ask: "Not now" for an older version re-asks', R.shouldAskResearch({ research_sharing_enabled: true }, '2025-01-v0'));
check('ask: answered this version on the server (either way)', !R.shouldAskResearch({ research_sharing_enabled: true, research_consent: false, research_consent_version: V }, null));
check('ask: consented to an older version re-asks', R.shouldAskResearch({ ...on, research_consent_version: 'old' }, null));

// ---------------------------------------------------------------- age band (DOB never sent)
const now = new Date('2026-10-19T12:00:00Z');
const cases = [
  ['2008-10-20', null], // 17, birthday tomorrow
  ['2008-10-19', '18-29'],
  ['1997-10-19', '18-29'], // 29 exactly
  ['1996-10-19', '30-39'],
  ['1996-10-20', '18-29'], // 29, turns 30 tomorrow
  ['1987-01-01', '30-39'],
  ['1986-10-19', '40-49'],
  ['1970-05-05', '50-59'],
  ['1960-12-31', '60-69'],
  ['1956-10-19', '70+'],
  ['1930-01-01', '70+'],
  [null, null], ['', null], ['not a date', null], ['1990-13-01', null],
];
for (const [dob, band] of cases) {
  const got = R.ageBand(dob, now);
  check(`ageBand(${dob})`, got === band, `got ${got}, want ${band}`);
}

check('capturedMonth', R.capturedMonth('2026-10-19T23:59:00Z') === '2026-10');
check('capturedMonth pads', R.capturedMonth('2026-03-01T00:00:00Z') === '2026-03');
check('capturedMonth junk', R.capturedMonth('nope') === null);

// ---------------------------------------------------------------- regions
const fil = { 'Head / Face': 'Ulo / Mukha', Chest: 'Dibdib', 'Back of head': 'Likod ng ulo' };
const toFil = (en) => fil[en] ?? en;
check('region: english passes through', R.englishRegion('Chest', toFil) === 'Chest');
check('region: filipino maps back', R.englishRegion('Dibdib', toFil) === 'Chest');
check('region: unknown is null', R.englishRegion('Somewhere', toFil) === null);
check('region: missing is null', R.englishRegion(null, toFil) === null);
check('region: face blocked (english)', R.isBlockedRegion(R.englishRegion('Head / Face', toFil)));
check('region: face blocked (filipino)', R.isBlockedRegion(R.englishRegion('Ulo / Mukha', toFil)));
check('region: scalp blocked', R.isBlockedRegion(R.englishRegion('Likod ng ulo', toFil)));
check('region: chest allowed', !R.isBlockedRegion('Chest'));
check('region: unknown allowed (sent as null)', !R.isBlockedRegion(null));
check('region list has every body-regions.ts label (24)', R.RESEARCH_REGIONS.length === 24);
// Every literal label in body-regions.ts must be in the research vocabulary, so a new region can't
// silently arrive at the server as null or dodge the head/face guard.
const regionSrc = readFileSync(join(ROOT, 'src/lib/body-regions.ts'), 'utf8');
const literal = [...regionSrc.matchAll(/t\('([^']+)'\)/g)].map((m) => m[1]);
const templated = [...regionSrc.matchAll(/t\(`\$\{(?:armSide|legSide)\} ([^`]+)`\)/g)].flatMap((m) => [`Left ${m[1]}`, `Right ${m[1]}`]);
const produced = [...new Set([...literal, ...templated])];
check('body-regions.ts labels all known', produced.length >= 20 && produced.every((r) => R.RESEARCH_REGIONS.includes(r)),
  produced.filter((r) => !R.RESEARCH_REGIONS.includes(r)).join(', '));

// ---------------------------------------------------------------- skin gate
check('gate: face 0.3 skipped', R.skinGateSkipReason({ skin: 0.7, face: 0.3 }) === 'face');
check('gate: face 0.29 passes', R.skinGateSkipReason({ skin: 0.7, face: 0.29 }) === null);
check('gate: skin 0.49 skipped', R.skinGateSkipReason({ skin: 0.49, face: 0 }) === 'not-skin');
check('gate: skin 0.5 passes', R.skinGateSkipReason({ skin: 0.5, face: 0 }) === null);
check('gate: NaN fails closed', R.skinGateSkipReason({ skin: NaN, face: 0 }) !== null);

// ---------------------------------------------------------------- server outcomes
const outcomes = { 201: 'sent', 200: 'sent', 403: 'consent', 409: 'consent', 413: 'failed', 415: 'failed',
  422: 'failed', 400: 'failed', 404: 'failed', 0: 'offline', 401: 'retry', 408: 'retry', 429: 'retry', 500: 'retry', 503: 'retry' };
for (const [status, want] of Object.entries(outcomes)) {
  check(`status ${status} -> ${want}`, R.classifyUploadStatus(Number(status)) === want);
}
check('retry backoff grows', R.retryDelayMs(1) < R.retryDelayMs(2) && R.retryDelayMs(2) < R.retryDelayMs(4));
check('retry backoff capped', R.retryDelayMs(50) === 30 * 60_000);
check('max attempts is 10', R.MAX_UPLOAD_ATTEMPTS === 10);

// ---------------------------------------------------------------- meta (allow-list)
const probs = { MEL: 0.1, BCC: 0.2, SCC: 0.05, OTHER: 0.05, BENIGN: 0.6, EXTRA: 0.9 };
const source = {
  id: 'scan-1760870400000',
  createdAt: '2026-10-19T08:30:00.000Z',
  region: 'Chest',
  answers: { evolution: 'yes', larger_7mm: 'no', ugly_duckling: 'unsure', bogus_q: 'yes', rough_scaly: 'maybe' },
  probs,
  topClass: 'BENIGN',
  tier: 'low',
  modelVersion: 'D_final',
};
const user = {
  id: 'user-uuid', email: 'a@b.c', full_name: 'Juan Dela Cruz', phone: '+639170000000',
  date_of_birth: '1990-06-15', sex: 'male', fitzpatrick_skin_type: 4, avatar_url: 'x',
};
const meta = R.buildSampleMeta(source, user, now);
check('meta: exact key set', eq(Object.keys(meta).sort(), [
  'age_band', 'answers', 'body_region', 'captured_month', 'client_sample_id', 'consent_version',
  'fitzpatrick', 'model_version', 'probs', 'sex', 'tier', 'top_class',
].sort()), Object.keys(meta).join(','));
const serialized = JSON.stringify(meta);
for (const leak of ['Juan', 'a@b.c', '+63917', '1990-06-15', 'user-uuid', '08:30', '2026-10-19']) {
  check(`meta: does not contain ${leak}`, !serialized.includes(leak));
}
check('meta: age band', meta.age_band === '30-39');
check('meta: month only', meta.captured_month === '2026-10');
check('meta: client id is the screening id', meta.client_sample_id === source.id);
check('meta: consent version', meta.consent_version === V);
check('meta: probs exactly the 5 classes', eq(Object.keys(meta.probs).sort(), ['BCC', 'BENIGN', 'MEL', 'OTHER', 'SCC']));
check('meta: answers filtered to known ids + values', eq(meta.answers, { evolution: 'yes', larger_7mm: 'no', ugly_duckling: 'unsure' }));
check('meta: fitzpatrick', meta.fitzpatrick === 4);
check('meta: sex', meta.sex === 'male');
check('meta: region', meta.body_region === 'Chest');
check('meta: missing class prob -> null', R.buildSampleMeta({ ...source, probs: { MEL: 1 } }, user, now) === null);
check('meta: bad tier -> null', R.buildSampleMeta({ ...source, tier: 'urgent' }, user, now) === null);
check('meta: bad top class -> null', R.buildSampleMeta({ ...source, topClass: 'NEVUS' }, user, now) === null);
check('meta: unknown region -> null field', R.buildSampleMeta({ ...source, region: 'Elsewhere' }, user, now).body_region === null);
check('meta: unknown sex -> null', R.buildSampleMeta(source, { ...user, sex: 'robot' }, now).sex === null);
check('meta: fitz out of range -> null', R.buildSampleMeta(source, { ...user, fitzpatrick_skin_type: 7 }, now).fitzpatrick === null);
check('meta: no profile demographics -> nulls', (() => {
  const m = R.buildSampleMeta(source, {}, now);
  return m.age_band === null && m.sex === null && m.fitzpatrick === null;
})());
check('meta: probs clamped', R.buildSampleMeta({ ...source, probs: { ...probs, MEL: 1.2 } }, user, now).probs.MEL === 1);

console.log(`\nresearch-core: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
