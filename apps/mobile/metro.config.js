// Metro for a pnpm workspace (M7.1b, ADR 0025).
//
// Expo SDK 57's default config already finds the workspace root, watches it, and follows pnpm's
// symlinks, so no hoisting is needed (docs/local-development.md, "Mobile apps"). What it cannot
// know is that this repo holds two Reacts, the web's and Expo's; `singletonReact` pins both
// `react` and `react-native` to this app's copy (packages/mobile-core/metro.cjs has the why).
const { getDefaultConfig } = require('expo/metro-config');
const { singletonReact } = require('@yayatoh/mobile-core/metro');

module.exports = singletonReact(getDefaultConfig(__dirname), __dirname);
