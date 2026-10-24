/**
 * Regression tests for the one-shot transport retry in src/api/client.ts.
 *
 * Pins the 2026-10-20 sign-up report: the first request after a quiet spell died on a stale
 * keep-alive socket ("Can't reach the server") and a second tap worked. GETs and opted-in POSTs
 * must resend once by themselves; other POSTs must not (they may already have taken effect).
 * Compiles the real module with the project's own tsc, like test-research-core.mjs.
 *
 * Run:  npm run test:api-retry
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'api-retry-'));
execFileSync(
  join(ROOT, 'node_modules/.bin/tsc'),
  ['src/api/client.ts', '--ignoreConfig', '--outDir', out, '--module', 'esnext', '--target', 'es2022', '--lib', 'es2022,dom', '--moduleResolution', 'bundler', '--types', 'node'],
  { cwd: ROOT, stdio: 'inherit' },
);
// client.ts imports ../config; give emitted relative imports a .js extension for node.
for (const dir of [out, join(out, 'api')]) {
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const p = join(dir, f);
    writeFileSync(p, readFileSync(p, 'utf8').replace(/from "(\.\.?\/[^"]+?)"/g, (m, s) => (s.endsWith('.js') ? m : `from "${s}.js"`)));
  }
}
const { api, ApiError } = await import(pathToFileURL(join(out, 'api', 'client.js')).href);

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) passed++;
  else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

/** fetch that fails the first `failures` calls with RN's transport TypeError, then answers. */
function flakyFetch(failCount, status = 200) {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls <= failCount) throw new TypeError('Network request failed');
    return new Response(JSON.stringify({ ok: true }), { status });
  };
  return () => calls;
}

let calls = flakyFetch(1);
check('GET recovers from one dropped socket', (await api.get('/health'))?.ok === true);
check('GET sent twice', calls() === 2, `calls=${calls()}`);

calls = flakyFetch(1);
check('opted-in POST recovers', (await api.post('/auth/login', {}, false, true))?.ok === true);
check('opted-in POST sent twice', calls() === 2, `calls=${calls()}`);

calls = flakyFetch(1);
let err = null;
try { await api.post('/auth/register', {}, false); } catch (e) { err = e; }
check('plain POST is not resent', err instanceof TypeError && calls() === 1, `calls=${calls()}`);

calls = flakyFetch(5);
err = null;
try { await api.get('/health'); } catch (e) { err = e; }
check('only one retry, then the error surfaces', err instanceof TypeError && calls() === 2, `calls=${calls()}`);

calls = flakyFetch(0, 500);
err = null;
try { await api.get('/health'); } catch (e) { err = e; }
check('an HTTP error is not retried', err instanceof ApiError && calls() === 1, `calls=${calls()}`);

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
