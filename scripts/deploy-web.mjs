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
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const link = join(root, '.vercel', 'project.json');
const preview = process.argv.includes('--preview');
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

if (!existsSync(link)) {
  console.error('No .vercel/project.json — run `npx vercel link` once, or copy the link file in.');
  process.exit(1);
}

console.log('\n▸ Exporting web build…');
run('npx', ['expo', 'export', '-p', 'web'], root);

// Restore the project link that the export just deleted.
mkdirSync(join(dist, '.vercel'), { recursive: true });
cpSync(link, join(dist, '.vercel', 'project.json'));

console.log(`\n▸ Deploying to Vercel (${preview ? 'preview' : 'production'})…`);
run('npx', ['vercel', 'deploy', '--yes', ...(preview ? [] : ['--prod'])], dist);
