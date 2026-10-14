// jest-expo for the app's component tests (Vitest stays for the server and universal packages).
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/../../packages/mobile-core/jest-setup.cjs'],
  testMatch: ['<rootDir>/tests/**/*.test.{ts,tsx}'],
  // pnpm keeps packages under node_modules/.pnpm/<name>@<version>/node_modules/<name>. Workspace
  // packages (@yayatoh/*) are symlinks to source outside node_modules, so Babel transforms them.
  // use-intl and its formatjs dependencies ship ES modules.
  transformIgnorePatterns: [
    'node_modules/(?!(\\.pnpm|(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|use-intl|@formatjs/.*|intl-messageformat|@noble/.*|@tanstack/.*))',
  ],
};
