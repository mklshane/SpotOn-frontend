/**
 * Back up / restore - the platform-free half.
 *
 * Screening history lives only on this device (data/sync.ts downloads the directory, nothing
 * else), so uninstalling the app or deleting the account loses it for good. A backup file is the
 * user's only way to carry it to a new phone or a new account.
 *
 * The file holds skin photos and health answers, and the share sheet will happily drop it into
 * Drive, email or a chat. So it is always encrypted with a password only the user knows:
 *
 *   "SPOTONBK" | version (1 byte) | header length (uint32 BE) | header JSON | ciphertext
 *
 * The header carries the KDF parameters, salt and nonce, and is bound to the ciphertext as
 * associated data, so editing it fails authentication just like a wrong password does. Inside the
 * ciphertext: index length (uint32 BE) | index JSON (manifest, rows, photo sizes) | photo bytes.
 *
 * Speed is the design constraint - Hermes interprets JS, and a first version that did everything
 * in JS (base64 photo reads, a zip with its CRC, ChaCha) took ~40 s on a phone. So every bulk step
 * is native: photos move as raw bytes (lib/fs readBytesAsync), AES-256-GCM runs in expo-crypto
 * (passed in as `BackupCipher`), and the container is a plain concatenation - GCM already
 * authenticates every byte, so a zip's CRC would only cost time. The one JS step left is scrypt,
 * which has to be slow on purpose; see KDF.
 *
 * No Expo or React Native imports - scripts/test-backup.mjs compiles and runs this file in Node.
 */
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { strFromU8, strToU8 } from 'fflate';

export const BACKUP_FORMAT = 1;
export const BACKUP_EXTENSION = 'spoton';
export const MIN_BACKUP_PASSWORD = 8;

const MAGIC = strToU8('SPOTONBK');
const ENVELOPE_VERSION = 1;

/**
 * scrypt cost - the only deliberately slow step, and pure JS (no native scrypt is installed).
 * 2^14 x 8 (16 MB) is scrypt's own "interactive" setting; measured under Hermes it is ~2.4 s on
 * an M-series Mac, against ~5 s for 2^15, which a phone stretched to 12 s. Stored in every
 * file's header, so it can change without breaking old backups.
 */
const KDF = { N: 2 ** 14, r: 8, p: 1 } as const;

/**
 * How long scrypt runs between yields. noble's default (10 ms) yields via setTimeout, which React
 * Native rounds up to a frame - so most of the wall time was spent waiting, not hashing. The
 * spinner is native and keeps turning; 100 ms still updates the % text ten times a second.
 */
const KDF_TICK_MS = 100;

/** Keys of per-account preferences worth carrying over (product tour / scan-tip progress). */
export const BACKUP_PREF_KEYS = ['product_tour_status', 'scan_tips_seen'] as const;

/** AES-256-GCM, supplied by the caller: expo-crypto in the app, noble in the Node tests. */
export type BackupCipher = {
  random(n: number): Uint8Array;
  /** Returns ciphertext with the 16-byte tag appended. */
  encrypt(key: Uint8Array, nonce: Uint8Array, plain: Uint8Array, aad: Uint8Array): Promise<Uint8Array>;
  /** Must reject when the tag does not verify. */
  decrypt(key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array, aad: Uint8Array): Promise<Uint8Array>;
};

export type BackupErrorCode =
  | 'bad_file'
  | 'wrong_password'
  | 'newer_version'
  | 'empty'
  | 'ephemeral_db'
  | 'sharing_unavailable'
  | 'io';

export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'BackupError';
  }
}

export type BackupRow = Record<string, unknown>;

export type BackupData = {
  lesions: BackupRow[];
  screenings: BackupRow[];
  savedItems: BackupRow[];
  /** Unscoped key (one of BACKUP_PREF_KEYS) -> stored value. */
  prefs: Record<string, string>;
};

export type BackupCounts = { screenings: number; lesions: number; savedItems: number; photos: number };

export type BackupManifest = {
  format: number;
  /** db.ts SCHEMA_VERSION of the exporting app. Newer than ours means we can't read every column. */
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  sourceAccountId: string;
  sourceEmail: string | null;
  counts: BackupCounts;
};

export type BackupContents = {
  manifest: BackupManifest;
  data: BackupData;
  /** File name (e.g. `scan-123.jpg`) -> JPEG bytes. */
  photos: Map<string, Uint8Array>;
};

/* ------------------------------------------------------------------ photo paths ---- */

const OWNED = 'screenings/';

/**
 * The file name of a photo we own, or null.
 *
 * Stored paths are `screenings/<file>` (pre-account layout) or `screenings/<userId>/<file>`, and
 * rows from before v14 may still hold an absolute path under a stale container. Anything else -
 * a cache path kept because persistImage() failed - was never ours and is not backed up.
 */
export function photoFileName(uri: unknown): string | null {
  if (typeof uri !== 'string' || !uri) return null;
  let rel: string;
  if (uri.startsWith(OWNED)) rel = uri;
  else {
    const i = uri.lastIndexOf(`/${OWNED}`);
    if (i === -1) return null;
    rel = uri.slice(i + 1);
  }
  const parts = rel.slice(OWNED.length).split('/');
  if (parts.length < 1 || parts.length > 2 || !parts.every(Boolean)) return null;
  const name = parts[parts.length - 1];
  // The name becomes an archive entry and a path segment on restore - never let it climb out.
  return /^[\w.-]+$/.test(name) && name !== '.' && name !== '..' ? name : null;
}

function screeningImageUris(row: BackupRow): string[] {
  const uris: string[] = [];
  if (typeof row.image_uri === 'string') uris.push(row.image_uri);
  const images = parseJson<{ uri?: unknown }[]>(row.images_json);
  if (Array.isArray(images)) {
    for (const img of images) if (img && typeof img.uri === 'string') uris.push(img.uri);
  }
  return uris;
}

/** Every photo a set of screening rows points at: file name -> the stored uri to read it from. */
export function photosToBackUp(screenings: BackupRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of screenings) {
    for (const uri of screeningImageUris(row)) {
      const name = photoFileName(uri);
      if (name && !out.has(name)) out.set(name, uri);
    }
  }
  return out;
}

/** Where a restored photo lives, relative to the document directory (scan-history screeningsDir). */
export function restoredPhotoPath(userId: string, name: string): string {
  return `${OWNED}${encodeURIComponent(userId)}/${name}`;
}

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ archive ---- */

type ArchiveIndex = { manifest: BackupManifest; data: BackupData; photos: [name: string, size: number][] };

/** index length (uint32 BE) | index JSON | each photo's bytes, in index order. */
export function packArchive(contents: BackupContents): Uint8Array {
  const sizes: [string, number][] = [...contents.photos].map(([name, b]) => [name, b.length]);
  const index = strToU8(JSON.stringify({ manifest: contents.manifest, data: contents.data, photos: sizes }));
  const out = new Uint8Array(4 + index.length + sizes.reduce((n, [, len]) => n + len, 0));
  new DataView(out.buffer).setUint32(0, index.length);
  out.set(index, 4);
  let at = 4 + index.length;
  for (const bytes of contents.photos.values()) {
    out.set(bytes, at);
    at += bytes.length;
  }
  return out;
}

export function unpackArchive(archive: Uint8Array, currentSchemaVersion: number): BackupContents {
  const indexLen = archive.length >= 4
    ? new DataView(archive.buffer, archive.byteOffset, 4).getUint32(0)
    : -1;
  const index = indexLen >= 0 && 4 + indexLen <= archive.length
    ? parseJson<ArchiveIndex>(strFromU8(archive.subarray(4, 4 + indexLen)))
    : null;
  const manifest = index?.manifest;
  const data = index?.data;
  if (!manifest || !data || typeof manifest.format !== 'number' || !Array.isArray(index.photos)) {
    throw new BackupError('bad_file', 'The backup is missing its contents.');
  }
  if (manifest.format > BACKUP_FORMAT || manifest.schemaVersion > currentSchemaVersion) {
    throw new BackupError('newer_version', 'This backup was made by a newer version of SpotOn.');
  }
  if (
    !Array.isArray(data.screenings) ||
    !Array.isArray(data.lesions) ||
    !Array.isArray(data.savedItems) ||
    ![...data.screenings, ...data.lesions].every((r) => r && typeof r.id === 'string')
  ) {
    throw new BackupError('bad_file', 'The backup contents are malformed.');
  }
  const photos = new Map<string, Uint8Array>();
  let at = 4 + indexLen;
  for (const [name, size] of index.photos) {
    if (!Number.isInteger(size) || size < 0 || at + size > archive.length) {
      throw new BackupError('bad_file', 'The backup photos are truncated.');
    }
    // subarray, not slice: no copy. The name check keeps a crafted file from writing outside
    // the photos folder on restore.
    if (photoFileName(`${OWNED}${name}`) === name) photos.set(name, archive.subarray(at, at + size));
    at += size;
  }
  return { manifest, data: { ...data, prefs: data.prefs ?? {} }, photos };
}

/* ------------------------------------------------------------------ encryption ---- */

type EnvelopeHeader = {
  kdf: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
  cipher: 'aes-256-gcm';
  nonce: string;
};

function deriveKey(password: string, h: EnvelopeHeader, onProgress?: (p: number) => void) {
  return scryptAsync(password.normalize('NFKC'), hexToBytes(h.salt), {
    N: h.N,
    r: h.r,
    p: h.p,
    dkLen: 32,
    asyncTick: KDF_TICK_MS,
    onProgress,
  });
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Encrypt `plain` with a password. */
export async function seal(
  plain: Uint8Array,
  password: string,
  cipher: BackupCipher,
  onProgress?: (p: number) => void,
): Promise<Uint8Array> {
  const header: EnvelopeHeader = {
    kdf: 'scrypt',
    ...KDF,
    salt: bytesToHex(cipher.random(16)),
    cipher: 'aes-256-gcm',
    nonce: bytesToHex(cipher.random(12)),
  };
  const key = await deriveKey(password, header, onProgress);
  const headerBytes = strToU8(JSON.stringify(header));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, headerBytes.length);
  const prefix = concat(MAGIC, Uint8Array.of(ENVELOPE_VERSION), len, headerBytes);
  const sealed = await cipher.encrypt(key, hexToBytes(header.nonce), plain, prefix);
  return concat(prefix, sealed);
}

/** Decrypt a sealed file. A wrong password and an edited file are indistinguishable by design. */
export async function open(
  file: Uint8Array,
  password: string,
  cipher: BackupCipher,
  onProgress?: (p: number) => void,
): Promise<Uint8Array> {
  const fixed = MAGIC.length + 1 + 4;
  if (file.length < fixed || !MAGIC.every((b, i) => file[i] === b)) {
    throw new BackupError('bad_file', 'This is not a SpotOn backup file.');
  }
  if (file[MAGIC.length] > ENVELOPE_VERSION) {
    throw new BackupError('newer_version', 'This backup was made by a newer version of SpotOn.');
  }
  const headerLen = new DataView(file.buffer, file.byteOffset + MAGIC.length + 1, 4).getUint32(0);
  if (headerLen > 4096 || fixed + headerLen > file.length) {
    throw new BackupError('bad_file', 'The backup header is damaged.');
  }
  const header = parseJson<EnvelopeHeader>(strFromU8(file.subarray(fixed, fixed + headerLen)));
  if (
    !header ||
    header.kdf !== 'scrypt' ||
    header.cipher !== 'aes-256-gcm' ||
    !(header.N >= 2 ** 10 && header.N <= 2 ** 20) ||
    !(header.r >= 1 && header.r <= 16) ||
    !(header.p >= 1 && header.p <= 4) ||
    typeof header.salt !== 'string' ||
    typeof header.nonce !== 'string'
  ) {
    throw new BackupError('bad_file', 'The backup header is damaged.');
  }
  let key: Uint8Array;
  let nonce: Uint8Array;
  try {
    nonce = hexToBytes(header.nonce);
    key = await deriveKey(password, header, onProgress);
  } catch (e) {
    throw new BackupError('bad_file', 'The backup header is damaged.', e);
  }
  try {
    return await cipher.decrypt(key, nonce, file.subarray(fixed + headerLen), file.subarray(0, fixed + headerLen));
  } catch (e) {
    throw new BackupError('wrong_password', 'Wrong password, or the file is damaged.', e);
  }
}

/* ------------------------------------------------------------------ restore ---- */

export type RestoreColumns = { screenings: Set<string>; lesions: Set<string>; saved_items: Set<string> };

export type RestorePlan = {
  lesions: BackupRow[];
  screenings: BackupRow[];
  savedItems: BackupRow[];
  /** Photo file name -> destination path relative to the document directory. */
  photos: Map<string, string>;
  prefs: [key: string, value: string][];
  /** Rows already on this phone (same id), kept as they are. */
  skipped: { screenings: number; lesions: number };
};

/** Keep only columns this schema has - older backups simply lack the newer ones (all defaulted). */
function pick(row: BackupRow, columns: Set<string>): BackupRow {
  const out: BackupRow = {};
  for (const [k, v] of Object.entries(row)) if (columns.has(k)) out[k] = v;
  return out;
}

/**
 * Turn backup rows into rows for `targetUserId`.
 *
 * Restoring into a different account (the "I deleted my account and signed up again" case) is
 * allowed after a warning in the UI, so every row is re-owned and every photo path re-pointed at
 * the target account's folder. Rows whose id already exists on this phone are left alone, which
 * makes restoring the same file twice harmless. Research-queue state is cleared: whatever was
 * shared already reached the server, and a restored scan must never be uploaded again.
 */
export function planRestore(
  contents: BackupContents,
  targetUserId: string,
  columns: RestoreColumns,
  existing: { screeningIds: Set<string>; lesionIds: Set<string> },
): RestorePlan {
  const photos = new Map<string, string>();
  const repoint = (uri: unknown): unknown => {
    const name = photoFileName(uri);
    if (!name || !contents.photos.has(name)) return uri;
    const dest = restoredPhotoPath(targetUserId, name);
    photos.set(name, dest);
    return dest;
  };

  const screenings: BackupRow[] = [];
  let skippedScreenings = 0;
  for (const raw of contents.data.screenings) {
    if (existing.screeningIds.has(raw.id as string)) {
      skippedScreenings++;
      continue;
    }
    const row = pick(raw, columns.screenings);
    row.user_id = targetUserId;
    row.image_uri = repoint(row.image_uri);
    const images = parseJson<Record<string, unknown>[]>(row.images_json);
    if (Array.isArray(images)) {
      row.images_json = JSON.stringify(images.map((img) => ({ ...img, uri: repoint(img?.uri) })));
    }
    if (columns.screenings.has('research_status')) {
      row.research_status = null;
      row.research_shared_at = null;
      row.research_attempts = 0;
    }
    screenings.push(row);
  }

  const lesions: BackupRow[] = [];
  let skippedLesions = 0;
  for (const raw of contents.data.lesions) {
    if (existing.lesionIds.has(raw.id as string)) {
      skippedLesions++;
      continue;
    }
    lesions.push({ ...pick(raw, columns.lesions), user_id: targetUserId });
  }

  const savedItems = contents.data.savedItems
    .filter((r) => typeof r.kind === 'string' && typeof r.item_id === 'string')
    .map((r) => ({ ...pick(r, columns.saved_items), user_id: targetUserId }));

  const prefs = Object.entries(contents.data.prefs).filter(
    (e): e is [string, string] =>
      (BACKUP_PREF_KEYS as readonly string[]).includes(e[0]) && typeof e[1] === 'string',
  );

  return {
    lesions,
    screenings,
    savedItems,
    photos,
    prefs,
    skipped: { screenings: skippedScreenings, lesions: skippedLesions },
  };
}

/** `INSERT OR IGNORE` for one planned row. Column names come from the live schema, never the file. */
export function insertStatement(table: string, row: BackupRow): { sql: string; params: unknown[] } {
  const cols = Object.keys(row);
  return {
    sql: `INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    params: cols.map((c) => bindable(row[c])),
  };
}

/** SQLite takes text, numbers and NULL. A file that smuggles in anything else gets NULL. */
function bindable(v: unknown): string | number | null {
  if (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return null;
}
