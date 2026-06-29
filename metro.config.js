// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Bundle 3D model files as assets so they can be require()'d.
config.resolver.assetExts.push('glb', 'gltf', 'bin');

module.exports = config;
