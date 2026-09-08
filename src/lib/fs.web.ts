/**
 * Web implementation of the expo-file-system surface the app uses, backed by OPFS.
 *
 * expo-file-system ships nothing usable on web — both the legacy and current APIs are
 * `console.warn('expo-file-system is not supported on web')` stubs whose documentDirectory and
 * cacheDirectory are null. Everything the scan flow does with files (persisting a capture,
 * caching a downloaded model, writing a report PDF) would silently do nothing.
 *
 * The design constraint is that a URI must stay *renderable*: the app hands these strings to
 * <Image>, expo-image-manipulator and the report renderer. OPFS handles are not URLs, so bytes
 * live in OPFS while `public/fs-sw.js` serves them back at `/_fs/...`. Consumers therefore keep
 * treating a URI as an opaque fetchable string, exactly as on device, and image-paths.ts's
 * relative-path rebasing needs no web branch.
 *
 * Only the calls the app actually makes are implemented. Widen deliberately — a stub that
 * resolves to nothing is worse than a missing export, which at least fails the build.
 */

const PREFIX = '/_fs/';

/** Mirrors the native roots. Trailing slash matters: callers build paths by concatenation. */
export const documentDirectory = `${PREFIX}doc/`;
export const cacheDirectory = `${PREFIX}cache/`;

export type FileInfo =
  | { exists: false; uri: string; isDirectory: false }
  | { exists: true; uri: string; isDirectory: boolean; size: number; modificationTime: number };

/* ------------------------------------------------------------------ service worker ---- */

let swPromise: Promise<void> | null = null;

/**
 * Register the worker that serves /_fs/ and wait until it controls this page.
 *
 * Every write awaits this, which is what closes the registration race: a file can't be displayed
 * before it has been written, so by the time any /_fs/ URL is fetched the worker is live.
 */
export function ensureFsReady(): Promise<void> {
  if (!swPromise) {
    swPromise = (async () => {
      if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
        throw new Error('service workers unavailable — the web filesystem cannot serve files');
      }
      await navigator.serviceWorker.register('/fs-sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      // `ready` resolves once a worker is activated, but it may not yet be the *controller*
      // on the very first load. Without a controller our fetches bypass it and 404.
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
          // The worker claims clients on activate, so this is a backstop, not the usual path.
          setTimeout(resolve, 3000);
        });
      }
    })().catch((e) => {
      swPromise = null; // allow a retry
      throw e;
    });
  }
  return swPromise;
}

/* ------------------------------------------------------------------------- paths ---- */

/**
 * Strip a `file://` scheme if present.
 *
 * scratch-files.ts normalises every URI it handles to `file://...` before comparing it against
 * the roots, because on iOS the same path arrives both with and without the scheme. That
 * normalisation runs on web too, so our own `/_fs/...` paths reach us as `file:///_fs/...`.
 * Tolerating both is what keeps scratch cleanup working here instead of silently no-opping.
 */
function unscheme(uri: string): string {
  return uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
}

/** '/_fs/doc/screenings/a.jpg' -> ['doc','screenings','a.jpg']. Throws for foreign URIs. */
function segments(uri: string): string[] {
  const bare = unscheme(uri);
  const path = bare.startsWith(PREFIX) ? bare.slice(PREFIX.length) : null;
  if (path === null) throw new Error(`not a web-filesystem uri: ${uri}`);
  return decodeURIComponent(path).split('/').filter(Boolean);
}

function isOwned(uri: string): boolean {
  return unscheme(uri).startsWith(PREFIX);
}

async function root(): Promise<FileSystemDirectoryHandle> {
  return await navigator.storage.getDirectory();
}

async function dirFor(segs: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
  let dir = await root();
  for (const s of segs) dir = await dir.getDirectoryHandle(s, { create });
  return dir;
}

/** Resolve a file handle. `create` also creates missing parent directories. */
async function fileFor(uri: string, create: boolean): Promise<FileSystemFileHandle> {
  const segs = segments(uri);
  const name = segs.pop();
  if (!name) throw new Error(`uri has no filename: ${uri}`);
  const dir = await dirFor(segs, create);
  return await dir.getFileHandle(name, { create });
}

async function writeBlob(uri: string, blob: Blob): Promise<void> {
  await ensureFsReady();
  const fh = await fileFor(uri, true);
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
}

/**
 * Read any source the app might copy *from*: an /_fs/ path, a blob: URL from the camera canvas,
 * a data: URI, or an http(s) asset. fetch() handles all four — /_fs/ included, via the worker.
 */
async function fetchBlob(uri: string): Promise<Blob> {
  if (isOwned(uri)) await ensureFsReady();
  const res = await fetch(unscheme(uri));
  if (!res.ok) throw new Error(`could not read ${uri}: ${res.status}`);
  return await res.blob();
}

/* --------------------------------------------------------------------------- api ---- */

export async function getInfoAsync(uri: string): Promise<FileInfo> {
  try {
    if (!isOwned(uri)) {
      // A foreign URL (bundled asset, blob:). Existence is all report-assets.ts asks about.
      const res = await fetch(uri, { method: 'HEAD' });
      return res.ok
        ? { exists: true, uri, isDirectory: false, size: Number(res.headers.get('content-length') ?? 0), modificationTime: Date.now() / 1000 }
        : { exists: false, uri, isDirectory: false };
    }
    const fh = await fileFor(uri, false);
    const f = await fh.getFile();
    return { exists: true, uri, isDirectory: false, size: f.size, modificationTime: f.lastModified / 1000 };
  } catch {
    return { exists: false, uri, isDirectory: false };
  }
}

export async function readAsStringAsync(
  uri: string,
  options?: { encoding?: 'utf8' | 'base64' | string },
): Promise<string> {
  const blob = await fetchBlob(uri);
  if (options?.encoding === 'base64') {
    const buf = new Uint8Array(await blob.arrayBuffer());
    // Chunked to stay clear of the argument limit on multi-MB photos.
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK) {
      bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }
  return await blob.text();
}

export async function writeAsStringAsync(
  uri: string,
  contents: string,
  options?: { encoding?: 'utf8' | 'base64' | string },
): Promise<void> {
  let blob: Blob;
  if (options?.encoding === 'base64') {
    const bin = atob(contents);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    blob = new Blob([buf]);
  } else {
    blob = new Blob([contents], { type: 'text/plain' });
  }
  await writeBlob(uri, blob);
}

export async function downloadAsync(
  uri: string,
  fileUri: string,
): Promise<{ uri: string; status: number; headers: Record<string, string> }> {
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`download failed ${res.status}: ${uri}`);
  await writeBlob(fileUri, await res.blob());
  return { uri: fileUri, status: res.status, headers: {} };
}

export async function deleteAsync(uri: string, options?: { idempotent?: boolean }): Promise<void> {
  try {
    if (!isOwned(uri)) return; // never ours to delete
    const segs = segments(uri);
    const name = segs.pop();
    if (!name) return;
    const dir = await dirFor(segs, false);
    await dir.removeEntry(name, { recursive: true });
  } catch (e) {
    if (!options?.idempotent) throw e;
  }
}

export async function copyAsync({ from, to }: { from: string; to: string }): Promise<void> {
  await writeBlob(to, await fetchBlob(from));
}

export async function moveAsync({ from, to }: { from: string; to: string }): Promise<void> {
  await copyAsync({ from, to });
  await deleteAsync(from, { idempotent: true });
}

export async function makeDirectoryAsync(
  uri: string,
  _options?: { intermediates?: boolean },
): Promise<void> {
  await ensureFsReady();
  // Always intermediate-creating; the app only ever passes intermediates: true.
  await dirFor(segments(uri), true);
}

export async function readDirectoryAsync(uri: string): Promise<string[]> {
  const dir = await dirFor(segments(uri), false);
  const names: string[] = [];
  for await (const name of dir.keys()) names.push(name);
  return names;
}
