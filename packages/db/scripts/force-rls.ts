import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { MIGRATIONS_FOLDER } from '../src/migrate.ts';
import { forceRowLevelSecurity } from '../src/rls-migration.ts';

let changed = 0;
for (const file of readdirSync(MIGRATIONS_FOLDER).filter((f) => f.endsWith('.sql'))) {
  const path = `${MIGRATIONS_FOLDER}/${file}`;
  const before = readFileSync(path, 'utf8');
  const after = forceRowLevelSecurity(before);
  if (after !== before) {
    writeFileSync(path, after);
    changed += 1;
  }
}
console.info(`force-rls: updated ${changed} migration file(s)`);
