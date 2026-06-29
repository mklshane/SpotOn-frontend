module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // VisionCamera frame processors run on react-native-worklets-core.
    // (babel-preset-expo already adds the Reanimated plugin and keeps it last.)
    plugins: ['react-native-worklets-core/plugin'],
  };
};
