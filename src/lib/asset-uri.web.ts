/**
 * Web asset resolution, via expo-asset.
 *
 * react-native-web's Image has no `resolveAssetSource`, so the native spelling throws. expo-asset
 * is already a dependency and works on both platforms; it returns the served URL Metro emitted
 * for the bundled file (e.g. /assets/assets/models/spoton_dfinal_fp32.<hash>.tflite).
 *
 * Deliberately NOT `downloadAsync()` like the native side: that URL is same-origin and LiteRT.js
 * fetches it directly, and there is no reason to copy 31 MB through OPFS when the browser can
 * stream and cache it from the server. Async only to match the native signature.
 */
import { Asset } from 'expo-asset';

export async function assetFileUri(mod: number): Promise<string> {
  return Asset.fromModule(mod).uri;
}
