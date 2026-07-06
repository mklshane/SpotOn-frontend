const { withXcodeProject } = require("expo/config-plugins");

/**
 * Disables Xcode's User Script Sandboxing (ENABLE_USER_SCRIPT_SANDBOXING).
 *
 * Expo's react-native-xcode.sh writes the dev-server IP into ip.txt inside the
 * app bundle for physical-device Debug builds. Xcode 15+ sandboxes build-phase
 * scripts and denies that write ("Sandbox: bash deny file-write-data ... ip.txt"),
 * failing the build with exit code 65. Turning the flag off restores the write.
 *
 * Applied in prebuild so it survives `expo prebuild --clean`.
 */
module.exports = function withDisableScriptSandboxing(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const configurations = project.pbxXCBuildConfigurationSection();

    for (const key in configurations) {
      const buildSettings = configurations[key].buildSettings;
      if (buildSettings) {
        buildSettings.ENABLE_USER_SCRIPT_SANDBOXING = "NO";
      }
    }

    return config;
  });
};
