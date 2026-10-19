/**
 * Web counterpart of io.ts: a browser download out, a file input in. There is no share sheet,
 * and a picked file arrives as a File (or a fetchable blob: URL).
 */
import * as DocumentPicker from 'expo-document-picker';

import { BackupError } from './core';

export async function saveBackupFile(bytes: Uint8Array, fileName: string): Promise<void> {
  try {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking synchronously can cancel the download in Safari.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (e) {
    throw new BackupError('io', 'The backup could not be saved.', e);
  }
}

export async function pickBackupFile(): Promise<Uint8Array | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: false });
  if (res.canceled || !res.assets?.[0]) return null;
  const asset = res.assets[0];
  try {
    const buf = asset.file ? await asset.file.arrayBuffer() : await (await fetch(asset.uri)).arrayBuffer();
    return new Uint8Array(buf);
  } catch (e) {
    throw new BackupError('io', 'The file could not be opened.', e);
  }
}
