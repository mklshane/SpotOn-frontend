/**
 * Back up / restore - the device half: reading the account's rows and photos, and writing a
 * restore back. The file format, encryption and the rules for re-owning rows live in core.ts.
 */
import Constants from 'expo-constants';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync, getRandomBytes } from 'expo-crypto';

import { getDb, isDatabaseEphemeral, SCHEMA_VERSION, withDbTransaction } from '@/data/db';
import { toDisplayUri } from '@/data/image-paths';
import { accountStorageKey } from '@/lib/account-scope';
import * as FileSystem from '@/lib/fs';
import { readBytesAsync, writeBytesAsync } from '@/lib/fs-bytes';

import {
  BACKUP_EXTENSION,
  BACKUP_FORMAT,
  BACKUP_PREF_KEYS,
  BackupError,
  insertStatement,
  open,
  packArchive,
  photosToBackUp,
  planRestore,
  seal,
  unpackArchive,
  type BackupCipher,
  type BackupContents,
  type BackupManifest,
  type BackupRow,
  type RestoreColumns,
} from './core';

export { BackupError } from './core';
export type { BackupManifest } from './core';

/** AES-256-GCM in native code (WebCrypto on web) - ~100x faster than the same cipher in Hermes. */
const nativeCipher: BackupCipher = {
  random: getRandomBytes,
  async encrypt(key, nonce, plain, aad) {
    const sealed = await aesEncryptAsync(plain, await AESEncryptionKey.import(key), {
      nonce: { bytes: nonce },
      tagLength: 16,
      additionalData: aad,
    });
    return await sealed.ciphertext({ includeTag: true });
  },
  async decrypt(key, nonce, sealed, aad) {
    return await aesDecryptAsync(AESSealedData.fromParts(nonce, sealed, 16), await AESEncryptionKey.import(key), {
      additionalData: aad,
    });
  },
};

/** Phase timings in dev builds, so a slow device run shows where the time went (Metro log). */
function timer(label: string) {
  const start = Date.now();
  let last = start;
  return (phase: string) => {
    if (!__DEV__) return;
    const now = Date.now();
    console.log(`[backup] ${label} ${phase}: ${now - last} ms (total ${now - start} ms)`);
    last = now;
  };
}

/** Everything this account has that a backup would carry. Zero means there is nothing to save. */
export async function countBackupItems(userId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM screenings WHERE user_id = ?)
          + (SELECT COUNT(*) FROM lesions WHERE user_id = ?)
          + (SELECT COUNT(*) FROM saved_items WHERE user_id = ?) AS n`,
    [userId, userId, userId],
  );
  return row?.n ?? 0;
}

/** Build the encrypted backup for one account. Only that account's rows ever leave the database. */
export async function buildBackup(
  user: { id: string; email?: string | null },
  password: string,
  onProgress?: (p: number) => void,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const lap = timer('export');
  const db = await getDb();
  const screenings = await db.getAllAsync<BackupRow>('SELECT * FROM screenings WHERE user_id = ?', user.id);
  const lesions = await db.getAllAsync<BackupRow>('SELECT * FROM lesions WHERE user_id = ?', user.id);
  const savedItems = await db.getAllAsync<BackupRow>('SELECT * FROM saved_items WHERE user_id = ?', user.id);
  if (screenings.length + lesions.length + savedItems.length === 0) {
    throw new BackupError('empty', 'There is nothing to back up yet.');
  }

  const prefs: Record<string, string> = {};
  for (const key of BACKUP_PREF_KEYS) {
    const row = await db.getFirstAsync<{ value: string | null }>(
      'SELECT value FROM sync_meta WHERE key = ?',
      accountStorageKey(user.id, key),
    );
    if (row?.value != null) prefs[key] = row.value;
  }

  // A photo that is already gone (cleared storage, an old cache-path fallback) is skipped rather
  // than failing the whole backup - the row still restores, just without that image.
  const photos = new Map<string, Uint8Array>();
  for (const [name, stored] of photosToBackUp(screenings)) {
    try {
      photos.set(name, await readBytesAsync(toDisplayUri(stored)));
    } catch (e) {
      console.warn('[backup] photo missing, skipped', name, e);
    }
  }

  lap(`read ${screenings.length} rows + ${photos.size} photos`);

  const exportedAt = new Date().toISOString();
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    appVersion: Constants.expoConfig?.version ?? 'unknown',
    exportedAt,
    sourceAccountId: user.id,
    sourceEmail: user.email ?? null,
    counts: {
      screenings: screenings.length,
      lesions: lesions.length,
      savedItems: savedItems.length,
      photos: photos.size,
    },
  };
  const archive = packArchive({ manifest, data: { screenings, lesions, savedItems, prefs }, photos });
  lap(`pack ${(archive.length / 1e6).toFixed(1)} MB`);
  const bytes = await seal(archive, password, nativeCipher, onProgress);
  lap('key + encrypt');
  return { bytes, fileName: `SpotOn-Backup-${exportedAt.slice(0, 10)}.${BACKUP_EXTENSION}` };
}

/** Decrypt and validate a backup file, without touching the database. */
export async function readBackup(
  file: Uint8Array,
  password: string,
  onProgress?: (p: number) => void,
): Promise<BackupContents> {
  const lap = timer('import');
  const archive = await open(file, password, nativeCipher, onProgress);
  lap(`key + decrypt ${(file.length / 1e6).toFixed(1)} MB`);
  return unpackArchive(archive, SCHEMA_VERSION);
}

export type RestoreResult = {
  added: { screenings: number; lesions: number; savedItems: number };
  skipped: { screenings: number; lesions: number };
};

async function tableColumns(table: string): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return new Set(rows.map((r) => r.name));
}

/**
 * Add a backup's history to `userId`. Merges: nothing already on this phone is changed.
 *
 * Photos are written first and the rows second, in one transaction - so a row never points at a
 * photo that isn't there, and if the transaction fails the photos written for it are removed.
 */
export async function restoreBackup(contents: BackupContents, userId: string): Promise<RestoreResult> {
  if (isDatabaseEphemeral()) {
    throw new BackupError('ephemeral_db', 'This browser cannot store history, so a restore would be lost.');
  }
  const db = await getDb();
  const columns: RestoreColumns = {
    screenings: await tableColumns('screenings'),
    lesions: await tableColumns('lesions'),
    saved_items: await tableColumns('saved_items'),
  };
  const ids = async (table: string) =>
    new Set((await db.getAllAsync<{ id: string }>(`SELECT id FROM ${table}`)).map((r) => r.id));
  const plan = planRestore(contents, userId, columns, {
    screeningIds: await ids('screenings'),
    lesionIds: await ids('lesions'),
  });

  const docDir = FileSystem.documentDirectory ?? '';
  const written: string[] = [];
  try {
    if (plan.photos.size) {
      const dir = `${docDir}screenings/${encodeURIComponent(userId)}/`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    }
    for (const [name, rel] of plan.photos) {
      const dest = `${docDir}${rel}`;
      await writeBytesAsync(dest, contents.photos.get(name)!);
      written.push(dest);
    }

    let savedAdded = 0;
    await withDbTransaction(async () => {
      for (const row of plan.lesions) {
        const { sql, params } = insertStatement('lesions', row);
        await db.runAsync(sql, params as (string | number | null)[]);
      }
      for (const row of plan.screenings) {
        const { sql, params } = insertStatement('screenings', row);
        await db.runAsync(sql, params as (string | number | null)[]);
      }
      for (const row of plan.savedItems) {
        const { sql, params } = insertStatement('saved_items', row);
        const res = await db.runAsync(sql, params as (string | number | null)[]);
        savedAdded += res.changes;
      }
      for (const [key, value] of plan.prefs) {
        await db.runAsync(
          'INSERT OR IGNORE INTO sync_meta (key, value) VALUES (?, ?)',
          accountStorageKey(userId, key),
          value,
        );
      }
    });

    return {
      added: { screenings: plan.screenings.length, lesions: plan.lesions.length, savedItems: savedAdded },
      skipped: plan.skipped,
    };
  } catch (e) {
    for (const uri of written) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    throw e instanceof BackupError ? e : new BackupError('io', 'The backup could not be restored.', e);
  }
}
