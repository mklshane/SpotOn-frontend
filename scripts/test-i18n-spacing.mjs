/**
 * Guards against the whitespace class introduced when JSX text was wrapped in `t(...)`.
 *
 * Wrapping `Checked on {date}` as `{t("Checked on")}{date}` is silently lossy: the space lived in
 * the JSX text node, not in the string, and `translate()` returns the source verbatim for English
 * so nothing ever puts it back. The result shipped to production as `Checked onSep 9, 2026`,
 * `52% match toa pattern` and `Aboutmelanoma` on the result screen alone.
 *
 * A `{t("…")}` immediately followed by `{` is flagged unless the key already ends in a space or
 * the next token is an explicit `{" "}`. Intentional exceptions are listed in ALLOW.
 *
 * Run:  npm run test:i18n-spacing
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SPACERS = ['{" "}', "{' '}"];

/** `file:line` sites where the join is deliberate. Keep this list short and explain each. */
const ALLOW = new Set([
  // "…pattern (MEL)" - no space wanted after an opening parenthesis.
  'src/app/scan/result.tsx:251',
]);

function walk(dir) {
  const out = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(rel));
    else if (e.name.endsWith('.tsx')) out.push(rel);
  }
  return out;
}

const CALL = /\{t\((["'])(.*?)\1(?:,[^)]*)?\)\}/g;
const findings = [];

for (const file of walk('src')) {
  const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(CALL)) {
      const key = m[2];
      const after = line.slice(m.index + m[0].length);
      if (!after.startsWith('{')) continue;
      if (/[  ]$/.test(key)) continue;
      if (SPACERS.some((s) => after.startsWith(s))) continue;
      const site = `${file}:${i + 1}`;
      if (ALLOW.has(site)) continue;
      findings.push({ site, key: key.slice(0, 48), next: after.slice(0, 28) });
    }
  });
}

if (findings.length) {
  console.error(`i18n spacing: ${findings.length} missing separator(s)\n`);
  for (const f of findings) {
    console.error(`  ${f.site}\n      {t("${f.key}")}${f.next}`);
  }
  console.error(
    '\nPut the space outside the call - {t("Checked on")} {date} - so the catalog key stays clean.',
  );
  process.exit(1);
}

console.log('i18n spacing: no missing separators after t() calls');
