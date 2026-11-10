/**
 * Citation integrity for the result screen's "Why it could be either" card
 * (src/lib/triage/lookalike.ts). Every [k] marker in a pair's body must point at one of that pair's
 * sources, every source must be numbered by at least one marker, and every SourceId must exist in
 * src/data/learn-sources.ts with an https URL. Also checks the Tagalog copy keeps the same markers.
 *
 * Run:  npm run test:lookalike
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(join(ROOT, 'src/lib/triage/lookalike.ts'), 'utf8');
const sourcesTs = readFileSync(join(ROOT, 'src/data/learn-sources.ts'), 'utf8');
const fil = {
  ...JSON.parse(readFileSync(join(ROOT, 'src/lib/i18n/fil.json'), 'utf8')),
  ...JSON.parse(readFileSync(join(ROOT, 'src/lib/i18n/fil-additions.json'), 'utf8')),
};

let pass = 0;
const fails = [];
const check = (name, cond) => (cond ? pass++ : fails.push(name));
const markers = (s) => [...s.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));

const known = new Map(
  [...sourcesTs.matchAll(/^ {2}(\w+): \{\n(?:.*\n)*? {4}url: '([^']+)'/gm)].map((m) => [m[1], m[2]]),
);
const table = src.match(/LOOKALIKE_SOURCES[^=]*= \{([\s\S]*?)\n\};/)[1];
const pairs = Object.fromEntries(
  [...table.matchAll(/(\w+_\w+): \[([\s\S]*?)\]/g)].map((m) => [m[1], [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1])]),
);
const bodies = Object.fromEntries(
  [...src.matchAll(/case '(\w+_\w+)':\s*return t\(\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => [m[1], m[2]]),
);
const freeman = src.match(/FREEMAN_APPS: SourceId = '(\w+)'/)[1];

check('three pairs defined', Object.keys(pairs).length === 3 && Object.keys(bodies).length === 3);
for (const [pair, ids] of Object.entries(pairs)) {
  const body = bodies[pair];
  check(`${pair}: has a body`, typeof body === 'string');
  const used = new Set(markers(body));
  check(`${pair}: every marker points at a source`, [...used].every((k) => k >= 1 && k <= ids.length));
  check(`${pair}: every source is cited`, ids.every((_, i) => used.has(i + 1)));
  for (const id of [...ids, freeman]) {
    check(`${pair}: ${id} exists with an https URL`, /^https:\/\//.test(known.get(id) ?? ''));
  }
  const tl = fil[body];
  check(`${pair}: has Tagalog`, typeof tl === 'string');
  check(`${pair}: Tagalog keeps the same markers`, tl && markers(tl).join() === markers(body).join());
}
const closing = src.match(/lookalikeClosing[\s\S]*?t\(\s*'((?:[^'\\]|\\.)*)'/)[1];
check('closing cites {{n}}', closing.includes('[{{n}}]') && fil[closing]?.includes('[{{n}}]'));

if (fails.length) {
  console.error(`lookalike: ${pass} passed, ${fails.length} FAILED`);
  for (const f of fails) console.error('  FAIL:', f);
  process.exit(1);
}
console.log(`lookalike: ${pass} passed, 0 failed`);
