import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

/**
 * Integration files share one database. The legacy-migrate files also share one migrated state
 * across files (m22c's V10 baseline is migrate.int's run on the same dump), and jobs that sweep
 * every org (the daily retention pass redacts old abandoned orders) legitimately change migrated
 * orgs. So those files run first and in a fixed order, whatever the result cache says; the rest
 * keep the default order.
 */
const LEGACY_FIRST = [
  'tools/legacy-migrate/tests/migrate.int.test.ts',
  'tools/legacy-migrate/tests/m22c.int.test.ts',
  'tools/legacy-migrate/tests/m22d.int.test.ts',
  // M2.5a: the reverse ETL and the rehearsal sell on migrated events and rerun the ELT on the same
  // dumps, so they also need the migrated orgs as the migration left them.
  'tools/legacy-migrate/tests/reverse.int.test.ts',
  'tools/cutover/tests/rehearse.int.test.ts',
];

class LegacyFirstSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const sorted = await super.sort(files);
    const rank = (f: TestSpecification) => LEGACY_FIRST.findIndex((p) => f.moduleId.endsWith(`/${p}`));
    // Within the project that has them, the listed files move to the front; everything else
    // keeps the base order.
    const out: TestSpecification[] = [];
    for (const f of sorted) {
      if (rank(f) >= 0) continue;
      const first = sorted
        .filter((x) => x.project.name === f.project.name && rank(x) >= 0 && !out.includes(x))
        .sort((a, b) => rank(a) - rank(b));
      out.push(...first, f);
    }
    for (const f of sorted) if (!out.includes(f)) out.push(f);
    return out;
  }
}

const shared = ['apps/*/src/**', 'apps/*/tests/**', 'packages/**/src/**', 'packages/**/tests/**', 'tools/**'];

export default defineConfig({
  test: {
    sequence: { sequencer: LegacyFirstSequencer },
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
