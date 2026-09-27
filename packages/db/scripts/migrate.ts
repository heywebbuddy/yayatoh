import { databaseUrl } from '../src/env.ts';
import { runMigrations } from '../src/migrate.ts';

await runMigrations(databaseUrl('migrator'));
console.info('migrate: done');
