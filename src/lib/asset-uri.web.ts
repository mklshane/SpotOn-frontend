/**
 * Web asset resolution, via expo-asset.
 *
 * react-native-web's Image has no `resolveAssetSource`, so the native spelling throws. expo-asset
 * is already a dependency and works on both platforms; it returns the served URL Metro emitted
 * for the bundled file (e.g. /assets/assets/models/spoton_d13_fp32.<hash>.tflite).
 *
 * That URL is relative and same-origin, so the loaders' `startsWith('http')` dev-download branch
 * is skipped and LiteRT.js fetches it directly — which is what we want: no reason to copy 31 MB
 * through OPFS when the browser can stream and cache it from the server.
 */
import { Asset } from 'expo-asset';

export function assetUri(mod: number): string {
  return Asset.fromModule(mod).uri;
}
