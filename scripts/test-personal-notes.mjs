/**
 * Rules for the result screen's "For you" notes (src/lib/triage/personal-notes-core.ts).
 *
 * Pins: each rule's trigger, the priority order, the MAX_NOTES cap, graceful handling of a profile
 * with nothing filled in, and that the same scan yields different notes for different accounts.
 * The module never returns a tier, so it cannot change one - checked structurally below.
 *
 * Run:  npm run test:personal-notes
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'personal-notes-'));
execFileSync(
  join(ROOT, 'node_modules/.bin/tsc'),
  ['src/lib/triage/personal-notes-core.ts', '--ignoreConfig', '--outDir', out, '--module', 'esnext', '--target', 'es2022', '--lib', 'es2022', '--moduleResolution', 'bundler'],
  { cwd: ROOT, stdio: 'inherit' },
);
const { selectPersonalNotes, ageAt, MAX_NOTES, NOTE_PRIORITY } = await import(
  pathToFileURL(join(out, 'personal-notes-core.js')).href
);

let pass = 0;
const fails = [];
const check = (name, cond) => (cond ? pass++ : fails.push(name));
const AT = '2026-11-10T08:00:00.000Z';
const base = { tier: 'moderate', region: 'Chest', at: AT };
const ids = (input) => selectPersonalNotes({ ...base, ...input }).map((n) => n.id);
const has = (input, id) => ids(input).includes(id);

// Empty profile: no crash, no notes from a neutral site.
check('empty profile -> no notes', ids({}).length === 0);
check('null everything -> no notes', ids({ region: null, dateOfBirth: null, fitzpatrick: null, trend: null, uvIndex: null }).length === 0);

// Age
check('ageAt before birthday', ageAt('1976-12-01', AT) === 49);
check('ageAt on/after birthday', ageAt('1976-11-10', AT) === 50);
check('ageAt bad input', ageAt('not-a-date', AT) === null && ageAt(null, AT) === null);
check('age 50 -> age_50', has({ dateOfBirth: '1976-11-10' }, 'age_50'));
check('age 49 -> no age_50', !has({ dateOfBirth: '1976-12-01' }, 'age_50'));
check('age 17 -> age_minor', has({ dateOfBirth: '2009-12-01' }, 'age_minor'));
check('age 18 -> no age_minor', !has({ dateOfBirth: '2008-11-10' }, 'age_minor'));

// Risk factors: only an explicit yes / true counts.
check('personal yes', has({ personalHistory: 'yes' }, 'history_personal'));
check('personal unsure -> none', !has({ personalHistory: 'unsure' }, 'history_personal'));
check('family yes', has({ familyHistory: 'yes' }, 'history_family'));
check('sun true', has({ highSunExposure: true }, 'sun_exposure'));
check('sun false -> none', !has({ highSunExposure: false }, 'sun_exposure'));

// Body site (stored English labels from body-regions.ts)
check('hand -> acral', has({ region: 'Left hand' }, 'site_acral'));
check('foot -> acral', has({ region: 'Right foot' }, 'site_acral'));
check('forearm is not acral', !has({ region: 'Left forearm' }, 'site_acral'));
check('face -> head', has({ region: 'Head / Face' }, 'site_head'));
check('nape -> head + back', has({ region: 'Nape' }, 'site_head') && has({ region: 'Nape' }, 'site_back'));
check('mid back -> back', has({ region: 'Mid back' }, 'site_back'));
check('chest -> no site note', ids({ region: 'Chest' }).length === 0);

// Skin type
check('fitz 4 -> dark', has({ fitzpatrick: 4 }, 'skin_dark'));
check('fitz 3 -> light', has({ fitzpatrick: 3 }, 'skin_light'));
check('fitz 4 on a hand -> acral replaces dark', has({ fitzpatrick: 4, region: 'Left hand' }, 'site_acral') && !has({ fitzpatrick: 4, region: 'Left hand' }, 'skin_dark'));
check('fitz out of range ignored', ids({ fitzpatrick: 9 }).length === 0 && ids({ fitzpatrick: 0 }).length === 0);

// UV: low tier only, >= 6
check('low tier UV 6 -> uv_high', has({ tier: 'low', uvIndex: 6 }, 'uv_high'));
check('low tier UV 5 -> none', !has({ tier: 'low', uvIndex: 5 }, 'uv_high'));
check('moderate tier UV 11 -> none', !has({ tier: 'moderate', uvIndex: 11 }, 'uv_high'));
check('uv param rounded', selectPersonalNotes({ ...base, tier: 'low', uvIndex: 7.6 })[0].params.uv === 8);

// Trend
const prev = { count: 2, previousAt: '2026-10-01T00:00:00.000Z', answerWorsened: false, modelChanged: false };
check('tier rose -> worse', has({ trend: { ...prev, previousTier: 'low' } }, 'trend_worse'));
check('worse carries since date', selectPersonalNotes({ ...base, trend: { ...prev, previousTier: 'low' } })[0].params.since === prev.previousAt);
check('answer worsened -> worse', has({ trend: { ...prev, previousTier: 'moderate', answerWorsened: true } }, 'trend_worse'));
check('same tier -> stable', has({ trend: { ...prev, previousTier: 'moderate' } }, 'trend_stable'));
check('tier fell -> neither', !has({ trend: { ...prev, previousTier: 'high' } }, 'trend_worse') && !has({ trend: { ...prev, previousTier: 'high' } }, 'trend_stable'));
check('tier rose across model swap -> not worse', !has({ trend: { ...prev, previousTier: 'low', modelChanged: true } }, 'trend_worse'));
check('model swap + worse answers -> worse', has({ trend: { ...prev, previousTier: 'low', modelChanged: true, answerWorsened: true } }, 'trend_worse'));
check('single screening -> no trend', ids({ trend: { ...prev, count: 1, previousTier: 'low' } }).length === 0);

// Order and cap
const everything = {
  tier: 'low', region: 'Left hand', dateOfBirth: '1960-01-01', fitzpatrick: 3,
  personalHistory: 'yes', familyHistory: 'yes', highSunExposure: true, uvIndex: 10,
  trend: { ...prev, previousTier: 'low', answerWorsened: true },
};
const all = ids(everything);
check(`capped at ${MAX_NOTES}`, all.length === MAX_NOTES);
check('trend first', all[0] === 'trend_worse');
check('history next', all[1] === 'history_personal' && all[2] === 'history_family');
check('follows NOTE_PRIORITY', all.every((id, i) => i === 0 || NOTE_PRIORITY.indexOf(id) > NOTE_PRIORITY.indexOf(all[i - 1])));

// The output never carries a tier, so the notes cannot alter urgency.
check('no tier in output', selectPersonalNotes(everything).every((n) => !('tier' in n) && Object.keys(n).every((k) => k === 'id' || k === 'params')));

// The panelist's question: same scan, different accounts -> different notes.
const scan = { tier: 'moderate', region: 'Left foot', at: AT };
const a = selectPersonalNotes({ ...scan, dateOfBirth: '2004-03-01', fitzpatrick: 4 }).map((n) => n.id).join();
const b = selectPersonalNotes({ ...scan, dateOfBirth: '1966-03-01', fitzpatrick: 3, familyHistory: 'yes', highSunExposure: true }).map((n) => n.id).join();
check('two accounts differ', a !== b && a.length > 0 && b.length > 0);

if (fails.length) {
  console.error(`personal-notes: ${fails.length} failed, ${pass} passed`);
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`personal-notes: all ${pass} checks passed`);
