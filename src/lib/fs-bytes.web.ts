/** Web counterpart of fs-bytes.ts, over the OPFS store in fs.web.ts. */
import { fetchBlob, writeBlob } from './fs.web';

export async function readBytesAsync(uri: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetchBlob(uri)).arrayBuffer());
}

export async function writeBytesAsync(uri: string, bytes: Uint8Array): Promise<void> {
  await writeBlob(uri, new Blob([bytes as BlobPart]));
}
