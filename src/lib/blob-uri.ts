/**
 * Release a blob: URL created by the web image pipeline.
 *
 * expo-image-manipulator's web implementation ends every operation with
 * `URL.createObjectURL(blob)` (ImageManipulatorImageRef.web.ts / ImageManipulatorContext.web.ts)
 * and never revokes it. The classifier calls manipulateAsync several times per photo and only
 * ever reads `.base64`, so each classification stranded multiple full-size JPEG blobs for the
 * lifetime of the page. On a desktop that is invisible; on iOS Safari, where the tab is already
 * carrying a ~30 MB fp32 model plus the detector, it is a plausible route to the memory ceiling
 * behind "We couldn't analyze this photo".
 *
 * No-op on native (file:// paths, and no URL.revokeObjectURL) and for anything that is not a
 * blob: URL, so it is safe to call unconditionally in shared code.
 */
export function releaseBlobUri(uri: string | null | undefined): void {
  if (!uri || !uri.startsWith('blob:')) return;
  try {
    URL.revokeObjectURL(uri);
  } catch {
    // No URL global, or already revoked — nothing to reclaim either way.
  }
}
