// jest-expo, like the apps (Vitest stays for the server and universal packages).
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest-setup.cjs'],
  // The provider tests render the whole core on a shared CI runner, which can pass Jest's 5 s default
  // (Wave 4 merge); 30 s, like the apps.
  testTimeout: 30_000,
  testMatch: ['<rootDir>/tests/**/*.test.{ts,tsx}'],
  transformIgnorePatterns: [
    'node_modules/(?!(\\.pnpm|(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|use-intl|@formatjs/.*|intl-messageformat|@noble/.*|@tanstack/.*))',
  ],
};
