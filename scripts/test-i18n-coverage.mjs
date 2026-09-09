/**
 * Every `t("…")` key in src/ must have a Filipino translation.
 *
 * A missing key is silent: translate() returns the English source verbatim, so an untranslated
 * string renders as English inside an otherwise Tagalog screen and nothing warns. That is how
 * the register/complete-profile validation errors ended up mixed-language in production.
 *
 * Only literal `t("…")` call sites are checked. Strings routed through a variable - the
 * form-validation messages, translated at the display site by TextField/DateField/Accordion -
 * are listed in INDIRECT so they are covered too.
 *
 * Run:  npm run test:i18n-coverage
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const catalog = { ...read('src/lib/i18n/fil.json'), ...read('src/lib/i18n/fil-additions.json') };

// Mirrors canonical() in src/lib/i18n/core.ts.
const canonical = (s) => s.replace(/&apos;/g, "'").replace(/\s+/g, ' ').trim();
const normalized = new Map(Object.entries(catalog).map(([k, v]) => [canonical(k), v]));
const has = (k) => Object.hasOwn(catalog, k) || normalized.has(canonical(k));

/** Messages that reach t() as a variable, so the literal never appears at a call site. */
const INDIRECT = [
  'Full name is required.', 'Enter your full name.',
  'Email address is required.', 'Enter a valid email address.',
  'Password is required.', 'Use at least 8 characters.',
  'Phone number is required.', 'Enter all 10 digits after +63.',
  'Enter a valid PH mobile number.',
  'Please confirm you are 18 or older.',
  'Please accept the Terms and Privacy Policy to continue.',
  'Enter a valid date of birth.', 'Please select one.', 'Please enter your name.',
];

const walk = (dir) =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : [],
  );

const missing = new Map();
for (const file of walk('src')) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  for (const m of src.matchAll(/\bt\(\s*(["'])((?:\\.|(?!\1).)*)\1/g)) {
    const key = m[2].replace(/\\"/g, '"').replace(/\\'/g, "'");
    if (!/[a-z]/.test(key) || has(key)) continue;
    if (!missing.has(key)) missing.set(key, file);
  }
}
for (const key of INDIRECT) if (!has(key)) missing.set(key, 'src/lib/form-validation.ts (indirect)');

if (missing.size) {
  console.error(`i18n coverage: ${missing.size} key(s) with no Filipino translation\n`);
  for (const [key, file] of [...missing].sort((a, b) => a[1].localeCompare(b[1]))) {
    console.error(`  ${file}\n      ${JSON.stringify(key)}`);
  }
  console.error('\nAdd them to src/lib/i18n/fil-additions.json.');
  process.exit(1);
}

console.log(
  `i18n coverage: every t() key is translated (${Object.keys(catalog).length} catalog entries)`,
);
