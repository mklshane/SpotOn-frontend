// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Bundle 3D model + TFLite files as assets so they can be require()'d.
// `wasm` is for the web build: expo-sqlite's web backend imports wa-sqlite.wasm, and
// LiteRT.js loads its runtime the same way. Harmless on native, which imports neither.
config.resolver.assetExts.push('glb', 'gltf', 'bin', 'tflite', 'wasm');

module.exports = config;
