import * as FileSystem from 'expo-file-system/legacy';

/**
 * Scratch photo cleanup.
 *
 * Every capture attempt writes three JPEGs the user never sees again: the raw sensor still
 * (VisionCamera → the container's tmp/), the upright/resized copy and the square crop (both
 * expo-image-manipulator → Caches/ImageManipulator/). Gallery picks add a fourth in
 * Caches/ImagePicker/. Only the crop is ever copied somewhere permanent — scan-history's
 * persistImage puts that one under documentDirectory/screenings/ — so the rest are dead the
 * moment the next stage exists. Nothing used to unlink them: screening-repo's deleteImageFiles
 * only fires when the user deletes a saved screening, which leaves every abandoned or retaken
 * scan on disk forever at ~4-8 MB a go.
 *
 * Two mechanisms, because one isn't enough: `discardScratch` unlinks eagerly at each hand-off
 * (the common path), and `sweepScratchFiles` catches what early returns and crashes leave behind.
 */

/** How stale a scratch file must be before the startup sweep will remove it. */
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Kept regardless of age. In dev, Metro serves the models over http and the loaders
 * (classifier-model.ts, lesion-model.ts) cache ~35 MB of .tflite here under fixed names — bounded,
 * not accumulating, and re-downloading it on every launch would cost more than the space.
 */
const KEEP = /\.tflite$/i;

/**
 * Scratch subdirectories of the cache dir, swept by age like the top level. Deliberately an
 * allowlist: expo-image and expo-asset keep their own caches as siblings, and those are theirs
 * to evict, not ours.
 */
const SCRATCH_SUBDIRS = ['ImageManipulator', 'ImagePicker'];

/**
 * The container's tmp/, where VisionCamera writes stills (FileManager.temporaryDirectory).
 * expo-file-system doesn't expose it, so derive it from documentDirectory —
 * `<container>/Documents/` and `<container>/tmp/` are siblings. Returns null when the path
 * doesn't have the iOS shape, so a failed derivation can never alias documentDirectory itself.
 */
function tmpDirectory(): string | null {
  const docs = FileSystem.documentDirectory;
  if (!docs) return null;
  const tmp = docs.replace(/Documents\/$/, 'tmp/');
  return tmp === docs ? null : tmp;
}

/** Roots we may delete from. documentDirectory is absent by design: screenings/ lives there. */
function scratchRoots(): string[] {
  return [FileSystem.cacheDirectory, tmpDirectory()].filter((d): d is string => !!d);
}

/**
 * One spelling per file. Callers hand us URIs from three libraries with three conventions:
 * VisionCamera reports a bare resolved path, and on iOS /var is a symlink to /private/var, so the
 * same file reaches us as both file:///var/... and file:///private/var/....
 */
function normalize(uri: string): string {
  const withScheme = uri.startsWith('file://') ? uri : `file://${uri}`;
  return withScheme.replace(/^file:\/\/\/private\//, 'file:///');
}

function isScratch(uri: string): boolean {
  return scratchRoots().some((root) => uri.startsWith(normalize(root)));
}

/**
 * Best-effort unlink of files that are provably ours and provably disposable. Anything outside
 * the scratch roots is ignored rather than deleted — a photo-library asset or a persisted
 * screening must survive being passed here by mistake. Never throws: losing a temp file is not
 * worth failing a capture over.
 */
export async function discardScratch(...uris: (string | null | undefined)[]): Promise<void> {
  for (const raw of uris) {
    if (!raw) continue;
    const uri = normalize(raw);
    if (!isScratch(uri)) continue;
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch (e) {
      console.warn('[scratch] could not remove', uri, e);
    }
  }
}

/** Age-sweep the loose files directly under `dir`. Subdirectories are left alone. */
async function sweepDir(dir: string, cutoffSec: number): Promise<number> {
  let names: string[];
  try {
    names = await FileSystem.readDirectoryAsync(dir);
  } catch {
    return 0; // not created yet on a fresh install, or not ours to read
  }
  let freed = 0;
  for (const name of names) {
    if (KEEP.test(name)) continue;
    try {
      const info = await FileSystem.getInfoAsync(`${dir}${name}`);
      if (!info.exists || info.isDirectory) continue;
      // modificationTime is seconds since epoch, not ms.
      if (info.modificationTime > cutoffSec) continue;
      await FileSystem.deleteAsync(info.uri, { idempotent: true });
      freed += info.size;
    } catch {
      // Raced with another writer, or a file we don't own. Skipping is always safe.
    }
  }
  return freed;
}

/**
 * Remove scratch photos older than `maxAgeMs` from the cache and tmp roots. Call once on app
 * start; it's the backstop for scans abandoned mid-flow, where no hand-off ever ran. The age
 * floor keeps it off files a capture in progress still needs. Returns bytes reclaimed.
 */
export async function sweepScratchFiles({ maxAgeMs = DEFAULT_MAX_AGE_MS } = {}): Promise<number> {
  const cutoffSec = (Date.now() - maxAgeMs) / 1000;
  const roots = scratchRoots();
  const cache = FileSystem.cacheDirectory;
  const dirs = [...roots, ...(cache ? SCRATCH_SUBDIRS.map((d) => `${cache}${d}/`) : [])];

  let freed = 0;
  for (const dir of dirs) freed += await sweepDir(dir, cutoffSec);
  return freed;
}
