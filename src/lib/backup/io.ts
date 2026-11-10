/**
 * Getting a backup file off the phone and back on. Native: the share sheet out (Save to Files,
 * Drive, AirDrop...) and the document picker in. The web build resolves io.web.ts instead.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';

import * as FileSystem from '@/lib/fs';
import { readBytesAsync, writeBytesAsync } from '@/lib/fs-bytes';

import { BackupError } from './core';

/** Hand the file to the OS share sheet. Resolves when the sheet closes; the temp copy is removed. */
export async function saveBackupFile(bytes: Uint8Array, fileName: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new BackupError('sharing_unavailable', 'Sharing is not available on this device.');
  }
  // A readable name matters: on Android the receiving app shows the on-disk file name.
  const uri = `${FileSystem.cacheDirectory}${fileName}`;
  try {
    await writeBytesAsync(uri, bytes);
    await Sharing.shareAsync(uri, {
      mimeType: 'application/octet-stream',
      UTI: 'public.data',
      dialogTitle: 'SpotOn backup',
    });
  } catch (e) {
    throw new BackupError('io', 'The backup could not be saved.', e);
  } finally {
    // The share target has its own copy by now.
    void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
}

/** Let the user pick a backup file. Null when they cancel. */
export async function pickBackupFile(): Promise<Uint8Array | null> {
  const res = await DocumentPicker.getDocumentAsync({
    // .spoton has no registered type, so filtering by one would grey the file out.
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets?.[0]) return null;
  const { uri } = res.assets[0];
  try {
    return await readBytesAsync(uri);
  } catch (e) {
    throw new BackupError('io', 'The file could not be opened.', e);
  } finally {
    void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
}
