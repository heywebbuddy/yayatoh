import { defineConfig } from 'vitest/config';

const shared = ['apps/*/src/**', 'apps/*/tests/**', 'packages/**/src/**', 'packages/**/tests/**', 'tools/**'];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: shared.map((g) => `${g}/*.test.{ts,tsx}`),
          exclude: ['**/*.int.test.{ts,tsx}', '**/node_modules/**', '**/canaries/**'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: shared.map((g) => `${g}/*.int.test.{ts,tsx}`),
          exclude: ['**/node_modules/**'],
          environment: 'node',
          globalSetup: ['packages/db/tests/global-setup.ts'],
          setupFiles: ['packages/db/tests/setup-env.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
