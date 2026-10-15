// jest-expo for the app's component tests (Vitest stays for the server and universal packages).
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: [
    '<rootDir>/../../packages/mobile-core/jest-setup.cjs',
    '<rootDir>/tests/setup-tickets.ts',
  ],
  // A screen's first render loads the whole app's router and catalogs: on a shared CI runner that
  // alone can pass Jest's 5 s default (Wave 3 merge), so tests get 30 s.
  testTimeout: 30_000,
  testMatch: ['<rootDir>/tests/**/*.test.{ts,tsx}'],
  // pnpm keeps packages under node_modules/.pnpm/<name>@<version>/node_modules/<name>. Workspace
  // packages (@yayatoh/*) are symlinks to source outside node_modules, so Babel transforms them.
  // use-intl and its formatjs dependencies, and Expo Router's navigation helper, ship ES modules.
  transformIgnorePatterns: [
    'node_modules/(?!(\\.pnpm|(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|use-intl|@formatjs/.*|intl-messageformat|@noble/.*|@tanstack/.*|standard-navigation))',
  ],
};
