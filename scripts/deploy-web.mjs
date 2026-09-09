/**
 * Build and deploy the web replica to Vercel in one step.
 *
 * Two wrinkles this exists to hide:
 *
 * 1. We deploy `dist/`, not the project root. Running `vercel` at the root would upload the
 *    source — and the eight git-tracked .tflite models are ~188 MB, over Vercel Hobby's 100 MB
 *    upload cap. `dist/` is ~72 MB and fits.
 * 2. `expo export` wipes `dist/`, taking the Vercel project link with it. Deploying from an
 *    unlinked `dist/` would create a NEW project named "dist" instead of updating spoton-dlsl.
 *    So the link is kept at <root>/.vercel/project.json and copied back in after every export.
 *
 * Usage:  npm run deploy:web            (production — updates https://spoton-dlsl.vercel.app)
 *         npm run deploy:web -- --preview   (preview URL, does not touch the live alias)
 *
 * The CLI version is PINNED. Left unpinned, `npx vercel` silently pulled a newer release
 * mid-session and stopped to ask "Ok to proceed? (y)", which a non-interactive script cannot
 * answer — the export had already run by then, so the failure looked like a deploy bug.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const link = join(root, '.vercel', 'project.json');
const preview = process.argv.includes('--preview');
const VERCEL = 'vercel@59.13.1';
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

if (!existsSync(link)) {
  console.error('No .vercel/project.json — run `npx vercel link` once, or copy the link file in.');
  process.exit(1);
}

// Check auth BEFORE the export, so a lapsed session costs a second instead of a full bundle.
// Sessions are short-lived (~8 h) and the original project was created from an anonymous
// `--temporary` deploy, which expires and then fails with a bare "Not authorized".
try {
  const who = execFileSync('npx', ['--yes', VERCEL, 'whoami'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  console.log(`▸ Vercel account: ${who.trim().split('\n').pop()}`);
} catch {
  console.error(
    '\nNot signed in to Vercel — the session has expired.\n' +
      `Run:  npx ${VERCEL} login\n` +
      'then re-run npm run deploy:web. (Sessions last about 8 hours.)\n',
  );
  process.exit(1);
}

console.log('\n▸ Exporting web build…');
run('npx', ['expo', 'export', '-p', 'web'], root);

// Restore the project link that the export just deleted.
mkdirSync(join(dist, '.vercel'), { recursive: true });
cpSync(link, join(dist, '.vercel', 'project.json'));

console.log(`\n▸ Deploying to Vercel (${preview ? 'preview' : 'production'})…`);
run('npx', ['--yes', VERCEL, 'deploy', '--yes', ...(preview ? [] : ['--prod'])], dist);
