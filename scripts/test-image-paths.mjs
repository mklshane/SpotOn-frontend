/**
 * Regression test for screening photo path storage (src/data/image-paths.ts).
 *
 * The bug this guards: iOS re-maps the data container to a new UUID on every install, so the
 * absolute file:// URIs the app used to store in `screenings.image_uri` stopped resolving after a
 * reinstall — history rows survived intact while every thumbnail rendered blank against JPEGs that
 * were still on disk. The fix stores paths relative to documentDirectory and rebases them on read,
 * so the property that actually matters is: **a URI written under one container must still resolve
 * after documentDirectory changes.** That is what the container-change cases below pin.
 *
 * Compiles the real module with the project's own tsc (never a retyped copy), swapping only the
 * expo-file-system import for a stub whose documentDirectory is settable.
 *
 * Run:  npm run test:image-paths
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'image-paths-'));

execFileSync(
  join(ROOT, 'node_modules/.bin/tsc'),
  ['src/data/image-paths.ts', '--ignoreConfig', '--outDir', out, '--module', 'esnext', '--target', 'es2019', '--lib', 'es2019', '--moduleResolution', 'bundler'],
  { cwd: ROOT, stdio: 'inherit' },
);

// The one dependency is expo-file-system/legacy, which cannot load outside a native runtime.
// Point the compiled import at a stub exporting a live, settable documentDirectory binding.
writeFileSync(
  join(out, 'fs-stub.js'),
  `export let documentDirectory = '';\nexport function setDocDir(d) { documentDirectory = d; }\n`,
);
const js = join(out, 'image-paths.js');
const compiled = readFileSync(js, 'utf8');
if (!compiled.includes('expo-file-system/legacy')) {
  console.error('FATAL: compiled image-paths.js no longer imports expo-file-system/legacy — the');
  console.error('stub swap below is stale and the test would silently exercise nothing.');
  process.exit(1);
}
writeFileSync(js, compiled.replace(/["']expo-file-system\/legacy["']/, "'./fs-stub.js'"));

const { toStoredUri, toDisplayUri } = await import(pathToFileURL(js).href);
const { setDocDir } = await import(pathToFileURL(join(out, 'fs-stub.js')).href);

let passed = 0;
const failures = [];
function eq(name, actual, expected) {
  if (actual === expected) {
    passed++;
  } else {
    failures.push(`${name}\n      expected: ${expected}\n      actual:   ${actual}`);
    console.log(`  FAIL ${name}\n      expected: ${expected}\n      actual:   ${actual}`);
  }
}

const CONTAINER_A = 'file:///var/mobile/Containers/Data/Application/AAAAAAAA-1111/Documents/';
const CONTAINER_B = 'file:///var/mobile/Containers/Data/Application/BBBBBBBB-2222/Documents/';
const ANDROID = 'file:///data/user/0/com.mklshane.SpotOn/files/';

// ---------------------------------------------------------------- write side
setDocDir(CONTAINER_A);
eq(
  'a fresh capture is stored relative',
  toStoredUri(`${CONTAINER_A}screenings/scan-1.jpg`),
  'screenings/scan-1.jpg',
);
eq('storing an already-relative path is a no-op', toStoredUri('screenings/scan-1.jpg'), 'screenings/scan-1.jpg');
eq(
  'a cache URI kept after a failed copy is stored untouched',
  toStoredUri('file:///var/mobile/Containers/Data/Application/AAAAAAAA-1111/tmp/ImagePicker/x.jpg'),
  'file:///var/mobile/Containers/Data/Application/AAAAAAAA-1111/tmp/ImagePicker/x.jpg',
);
eq('a bundled dev asset is stored untouched', toStoredUri('asset:///lesion.jpg'), 'asset:///lesion.jpg');
eq('empty stays empty', toStoredUri(''), '');

// ---------------------------------------------------------------- read side
eq(
  'a relative path resolves against the live container',
  toDisplayUri('screenings/scan-1.jpg'),
  `${CONTAINER_A}screenings/scan-1.jpg`,
);
eq(
  'an absolute path in the CURRENT container is returned as-is',
  toDisplayUri(`${CONTAINER_A}screenings/scan-1.jpg`),
  `${CONTAINER_A}screenings/scan-1.jpg`,
);
eq('a foreign URI is returned as-is', toDisplayUri('https://example.com/a.jpg'), 'https://example.com/a.jpg');
eq('empty stays empty', toDisplayUri(''), '');

// ------------------------------------------------- THE REGRESSION: container change
// Everything below simulates the reinstall that blanked 231 thumbnails: rows written under
// container A, read back under container B.
setDocDir(CONTAINER_B);
eq(
  'a relative path follows the app to a new container',
  toDisplayUri('screenings/scan-1.jpg'),
  `${CONTAINER_B}screenings/scan-1.jpg`,
);
eq(
  'a STALE absolute path heals on read (pre-v14 rows, images_json blobs)',
  toDisplayUri(`${CONTAINER_A}screenings/scan-1.jpg`),
  `${CONTAINER_B}screenings/scan-1.jpg`,
);
eq(
  'a stale absolute path is re-stored relative',
  toStoredUri(`${CONTAINER_A}screenings/scan-1.jpg`),
  'screenings/scan-1.jpg',
);
eq(
  'healing survives repeated container changes',
  toDisplayUri(toDisplayUri(`${CONTAINER_A}screenings/scan-1.jpg`)),
  `${CONTAINER_B}screenings/scan-1.jpg`,
);

// ---------------------------------------------------------------- round trips
for (const uri of [
  `${CONTAINER_A}screenings/scan-1.jpg`,
  `${CONTAINER_B}screenings/scan-1.jpg`,
  'screenings/scan-1.jpg',
  'https://example.com/a.jpg',
  '',
]) {
  eq(`round trip is stable: ${uri || '(empty)'}`, toStoredUri(toDisplayUri(uri)), toStoredUri(uri));
  eq(`store is idempotent: ${uri || '(empty)'}`, toStoredUri(toStoredUri(uri)), toStoredUri(uri));
}

// ---------------------------------------------------------------- not ours
// Rebasing a path we do not own would invent a location that holds no file, turning a working URI
// into a broken one. Ownership is "exactly one segment below screenings/", so a deeper path or a
// bare directory is left alone. NOTE this is a shape test, not a provenance test: a foreign file
// at <anything>/screenings/x.jpg would be claimed. Nothing produces one — persistImage() is the
// only writer under screenings/, and its failure fallback yields tmp/ImagePicker paths — but if a
// future caller stores third-party paths, tighten ownership here before it does.
eq(
  'a nested path below screenings/ is not claimed',
  toDisplayUri(`${CONTAINER_A}screenings/sub/scan-1.jpg`),
  `${CONTAINER_A}screenings/sub/scan-1.jpg`,
);
eq(
  'the bare screenings/ directory is not claimed',
  toDisplayUri('file:///var/mobile/Media/DCIM/screenings/'),
  'file:///var/mobile/Media/DCIM/screenings/',
);

// ---------------------------------------------------------------- platform shapes
setDocDir(ANDROID);
eq(
  'Android document directories work the same way',
  toDisplayUri('screenings/scan-1.jpg'),
  `${ANDROID}screenings/scan-1.jpg`,
);
eq(
  'an iOS path read on Android still rebases',
  toDisplayUri(`${CONTAINER_A}screenings/scan-1.jpg`),
  `${ANDROID}screenings/scan-1.jpg`,
);

setDocDir(CONTAINER_A.slice(0, -1)); // no trailing slash
eq(
  'a documentDirectory without a trailing slash is normalized',
  toDisplayUri('screenings/scan-1.jpg'),
  `${CONTAINER_A}screenings/scan-1.jpg`,
);

setDocDir(''); // FileSystem.documentDirectory is null on web
eq('with no document directory a relative path is left alone', toDisplayUri('screenings/scan-1.jpg'), 'screenings/scan-1.jpg');

console.log(`\nimage-paths: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
