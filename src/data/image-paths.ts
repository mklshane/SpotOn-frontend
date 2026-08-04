/**
 * Screening photo paths, stored RELATIVE to the document directory.
 *
 * iOS re-maps an app's data container to a fresh UUID on every install. The *contents* are
 * migrated, but `FileSystem.documentDirectory` changes, so an absolute
 * `file:///var/mobile/Containers/Data/Application/<UUID>/Documents/screenings/scan-1.jpg`
 * written before a reinstall points at nothing afterwards. SQLite is immune (it opens by name and
 * resolves the container at runtime) — which is exactly why history rows survived a reinstall with
 * every metric intact while all their thumbnails went blank: the paths baked into those rows had
 * gone stale, though the JPEGs were still on disk under the new container.
 *
 * Conversion happens ONLY at the SQLite boundary — toRecord() on read, insertScreening() on write.
 * Every in-memory ScreeningRecord therefore still carries a directly-renderable absolute URI, and
 * no UI, report, or PDF code needs to know this module exists.
 */
import * as FileSystem from "expo-file-system/legacy";

/** The one directory we own, under documentDirectory. Mirrors SCREENINGS_DIR in scan-history.tsx. */
const OWNED_DIR = "screenings/";

function docDir(): string {
  const dir = FileSystem.documentDirectory ?? "";
  return dir && !dir.endsWith("/") ? `${dir}/` : dir;
}

/**
 * The `screenings/<file>` portion of a URI we own, or null for anything else.
 *
 * Accepts all three forms a URI can arrive in: already-relative (the stored form), absolute under
 * the current container (a fresh capture), and absolute under a *stale* container (a row written
 * before the last reinstall) — the last is what makes reads self-healing.
 *
 * Anything else is not ours: a cache URI kept because the copy in persistImage() failed, or the
 * bundled asset dev-tools seeds. Rebasing one of those would invent a path that holds no file.
 */
function ownedRelative(uri: string): string | null {
  if (!uri) return null;
  const doc = docDir();
  let rel: string | null;
  if (uri.startsWith(OWNED_DIR)) {
    rel = uri;
  } else if (doc && uri.startsWith(doc)) {
    rel = uri.slice(doc.length);
  } else {
    const i = uri.lastIndexOf(`/${OWNED_DIR}`);
    rel = i === -1 ? null : uri.slice(i + 1);
  }
  if (rel === null || !rel.startsWith(OWNED_DIR)) return null;
  // Exactly one segment below screenings/. This is a shape test, not a provenance test — a foreign
  // file at <anything>/screenings/x.jpg would be claimed. Nothing produces one today: persistImage()
  // is the only writer under screenings/ and its failure fallback yields tmp/ImagePicker paths. A
  // caller that starts storing third-party paths needs a tighter test than this.
  const name = rel.slice(OWNED_DIR.length);
  return name && !name.includes("/") ? rel : null;
}

/** DB form: relative for files we own, untouched for anything else. */
export function toStoredUri(uri: string): string {
  return ownedRelative(uri) ?? uri;
}

/** Renderable form: rebased onto the CURRENT container, so pre-reinstall rows heal on read. */
export function toDisplayUri(stored: string): string {
  const rel = ownedRelative(stored);
  return rel ? `${docDir()}${rel}` : stored;
}
