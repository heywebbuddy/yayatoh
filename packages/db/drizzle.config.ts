import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` only. Never `drizzle-kit push` (denied in .claude/settings.json).
export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/schema.ts',
    '../auth/src/schema.ts',
    '../platform/src/**/schema.ts',
    '../modules/*/src/schema.ts',
    '../modules/*/src/schema-*.ts',
  ],
  out: './drizzle',
  entities: { roles: false },
  strict: true,
  verbose: true,
});
