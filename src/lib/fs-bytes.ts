/**
 * Whole-file binary read/write through the current expo-file-system `File` API.
 *
 * Kept out of lib/fs.ts on purpose: that module is the legacy API (base64 strings only), and the
 * Node test harnesses compile it standalone. Decoding base64 in JS costs ~1 s per 5 MB under
 * Hermes, which is what made a backup of a few dozen photos crawl. The web build resolves
 * fs-bytes.web.ts instead.
 */
import { File } from 'expo-file-system';

export async function readBytesAsync(uri: string): Promise<Uint8Array> {
  return await new File(uri).bytes();
}

/** Creates or replaces the file. The directory must already exist. */
export async function writeBytesAsync(uri: string, bytes: Uint8Array): Promise<void> {
  const file = new File(uri);
  if (!file.exists) file.create();
  file.write(bytes);
}
