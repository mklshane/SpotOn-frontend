/**
 * Regression test for src/lib/directory-core.ts - phone splitting, URL normalisation and the
 * Manila-time "open now" logic behind the clinic and doctor pages. Cases are taken from real
 * listings in the synced directory.
 *
 * Run:  npm run test:directory
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'directory-core-'));
execFileSync(
  join(ROOT, 'node_modules/.bin/tsc'),
  ['src/lib/directory-core.ts', '--ignoreConfig', '--outDir', out, '--module', 'esnext', '--target', 'es2022', '--lib', 'es2022,dom', '--moduleResolution', 'bundler'],
  { cwd: ROOT, stdio: 'inherit' },
);
const { splitPhones, toDialable, normalizeUrl, parseHHMM, openStatusAt, haversineMeters } = await import(
  pathToFileURL(join(out, 'directory-core.js')).href
);

let passed = 0;
let failed = 0;
function check(name, ok) {
  if (ok) passed++;
  else {
    failed++;
    console.log('  FAIL', name);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- phones ----
check('mobile → +63', toDialable('0917 872 0874') === '+639178720874');
check('landline area code → +63', toDialable('(02) 8894 3952') === '+63288943952');
check('provincial landline → +63', toDialable('(035) 225 6716') === '+63352256716');
check('already +63 kept', toDialable('+63 917 123 4567') === '+639171234567');
check('63 prefix gets +', toDialable('639171234567') === '+639171234567');
check('7-digit local left as-is', toDialable('7982572') === '7982572');
check('too short rejected', toDialable('12345') === null);
check(
  'comma list splits into three',
  eq(splitPhones('0917-547-7622, 7982572, 0976 002 1552').map((p) => p.dial), ['+639175477622', '7982572', '+639760021552']),
);
check(
  'slash list splits',
  eq(splitPhones('(02) 8123-4567 / 0917 123 4567').map((p) => p.dial), ['+63281234567', '+639171234567']),
);
check('"or" splits', splitPhones('0917 123 4567 or 0918 765 4321').length === 2);
check('extension dropped', eq(splitPhones('(02) 8123-4567 loc. 120').map((p) => p.dial), ['+63281234567']));
check('display keeps formatting', splitPhones('(0977) 855-5769, (02) 7900-1316')[0].display === '(0977) 855-5769');
check('duplicates collapse', splitPhones('0917 123 4567, 09171234567').length === 1);
check('empty → []', eq(splitPhones(null), []) && eq(splitPhones('  '), []));

// ---- urls ----
check('https kept', normalizeUrl('https://skinstation.ph/appointments') === 'https://skinstation.ph/appointments');
check('missing scheme gets https', normalizeUrl('www.clinic.ph') === 'https://www.clinic.ph/');
check('facebook path gets https', normalizeUrl('facebook.com/someclinic') === 'https://facebook.com/someclinic');
check('mailto rejected', normalizeUrl('mailto:a@b.com') === null);
check('javascript rejected', normalizeUrl('javascript:alert(1)') === null);
check('spaces rejected', normalizeUrl('not a url') === null);
check('no dot rejected', normalizeUrl('localhost') === null);
check('empty rejected', normalizeUrl('') === null && normalizeUrl(null) === null);

// ---- hours ----
check('HH:MM parses', parseHHMM('09:30') === 570);
check('H:MM parses', parseHHMM('9:00') === 540);
check('12h text rejected', parseHHMM('9:00 AM') === null);
check('garbage rejected', parseHHMM('25:00') === null && parseHHMM('') === null);

// Manila is UTC+8 with no DST. 2026-10-05 is a Monday.
const manila = (iso) => new Date(`${iso}+08:00`);
const wk = { open: '09:00', close: '17:00' };
const we = { open: '10:00', close: '14:00' };
check('weekday open', eq(openStatusAt(wk, we, manila('2026-10-05T10:00:00')), { open: true, changesAt: '17:00' }));
check('weekday before open', eq(openStatusAt(wk, we, manila('2026-10-05T08:00:00')), { open: false, changesAt: '09:00' }));
check('weekday after close', eq(openStatusAt(wk, we, manila('2026-10-05T17:00:00')), { open: false, changesAt: null }));
check('saturday uses weekend hours', openStatusAt(wk, we, manila('2026-10-10T15:00:00')).open === false);
check('no weekend hours → unknown', openStatusAt(wk, null, manila('2026-10-11T11:00:00')).open === null);
check('24h (open === close)', openStatusAt({ open: '00:00', close: '00:00' }, null, manila('2026-10-05T03:00:00')).open === true);
const night = { open: '20:00', close: '02:00' };
check('overnight evening open', openStatusAt(night, night, manila('2026-10-05T23:00:00')).open === true);
check('overnight tail carries into next day', eq(openStatusAt(night, null, manila('2026-10-10T01:00:00')), { open: true, changesAt: '02:00' }));
check('overnight after tail closed', openStatusAt(night, night, manila('2026-10-06T03:00:00')).open === false);
check('invalid hours → unknown', openStatusAt({ open: '9:00 AM', close: '5:00 PM' }, null, manila('2026-10-05T10:00:00')).open === null);
// Device time zone must not matter: 10:00 Manila is 02:00 UTC / previous evening in the Americas.
check('evaluated in Manila regardless of device zone', openStatusAt(wk, we, new Date('2026-10-05T02:00:00Z')).open === true);

// ---- distance ----
const d = haversineMeters(14.5995, 120.9842, 14.6760, 121.0437); // Manila → Quezon City ≈ 10.6 km
check('haversine ≈ 10.6 km', d > 10_000 && d < 11_200);

console.log(`directory core: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
