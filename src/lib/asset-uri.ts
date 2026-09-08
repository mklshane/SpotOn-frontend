/**
 * Resolve a `require()`d bundled asset to a URI.
 *
 * Native keeps `Image.resolveAssetSource`, which is what the model loaders have always used:
 * an http URL from Metro in dev, a local file path in a release build — a distinction
 * lesion-model.ts and classifier-model.ts both branch on.
 *
 * react-native-web does NOT implement `resolveAssetSource`, so calling it there throws
 * "resolveAssetSource is not a function" and every model load fails. See asset-uri.web.ts.
 */
import { Image } from 'react-native';

export function assetUri(mod: number): string {
  return Image.resolveAssetSource(mod).uri;
}
