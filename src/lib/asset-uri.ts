/**
 * Resolve a `require()`d bundled asset to a URI a NATIVE loader can actually open.
 *
 * WHY THIS IS NOT `Image.resolveAssetSource`. That call returns whatever the platform's own
 * asset system understands, and on Android that is not a URL at all:
 *
 *   dev (Metro attached)   http://<host>:8081/assets/...tflite?platform=android&hash=...
 *   iOS release            file:///.../SpotOn.app/assets/models/<name>.tflite
 *   ANDROID release        models_lesion_det_y11n_v1_float16     <- a bare res/raw identifier
 *
 * The Android string has no scheme because Metro copies non-drawable assets into `res/raw` and
 * RN addresses them by resource id (AssetSourceResolver.resourceIdentifierWithoutScale). Handing
 * it to react-native-fast-tflite fails: its Android HybridAssetLoader does `URL(path).readBytes()`,
 * and `java.net.URL` throws MalformedURLException on a schemeless string. So every model load died
 * on Android release builds - the detector never loaded, and the live green box never appeared -
 * while iOS, which gets a real file:// URL, was fine. The `startsWith('http')` branch the loaders
 * used to carry only covered dev; it could not see this.
 *
 * expo-asset is the piece that knows all three spellings: its Android module resolves a
 * schemeless identifier through `resources.getIdentifier(name, "raw", ...)`, short-circuits
 * file:// URLs untouched (so iOS release behaviour is unchanged), and downloads http ones into
 * the cache keyed by Metro's MD5 - which also replaces the loaders' hand-rolled dev download and
 * stops it re-fetching 31 MB on every launch.
 */
import { Asset } from 'expo-asset';

export async function assetFileUri(mod: number): Promise<string> {
  const asset = Asset.fromModule(mod);
  if (asset.localUri) return asset.localUri;
  await asset.downloadAsync();
  return asset.localUri ?? asset.uri;
}
