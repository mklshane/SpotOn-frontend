const { withAndroidManifest, withAppDelegate } = require("expo/config-plugins");

/**
 * Keeps screening photos and the local SQLite history out of OS cloud backups.
 *
 * SpotOn's privacy claim is that lesion photos never leave the device. Both platforms back app
 * data up to the user's cloud account by default, which would quietly break that:
 *   - Android: allowBackup="true" (template default) sends files/ and databases/ to Google Drive.
 *     expo-secure-store's backup rules only exclude its own key store, not the screenings.
 *   - iOS: Documents/ (screenings/ and SQLite/ both live there) is included in iCloud backup.
 *
 * Android: allowBackup="false" disables cloud backup + restore.
 * iOS: there is no Info.plist switch, so AppDelegate sets isExcludedFromBackup on Documents/ at
 * every launch (idempotent; the flag on a directory covers its contents).
 *
 * Trade-off: reinstalling or moving to a new phone does NOT restore scan history.
 *
 * Applied in prebuild so it survives `expo prebuild --clean`.
 */
const MARKER = "// SpotOn: exclude Documents/ from iCloud backup";

const SWIFT = `    ${MARKER} (plugins/withNoCloudBackup.js)
    if var docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try? docs.setResourceValues(values)
    }

`;

const ANCHOR = "    return super.application(application, didFinishLaunchingWithOptions: launchOptions)";

module.exports = function withNoCloudBackup(config) {
  config = withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application?.[0];
    if (app) app.$["android:allowBackup"] = "false";
    return config;
  });

  config = withAppDelegate(config, (config) => {
    const delegate = config.modResults;
    if (delegate.language !== "swift") {
      throw new Error("withNoCloudBackup: expected a Swift AppDelegate");
    }
    if (!delegate.contents.includes(MARKER)) {
      if (!delegate.contents.includes(ANCHOR)) {
        throw new Error("withNoCloudBackup: AppDelegate anchor not found; update ANCHOR");
      }
      delegate.contents = delegate.contents.replace(ANCHOR, SWIFT + ANCHOR);
    }
    return config;
  });

  return config;
};
