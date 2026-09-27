// Canary: writing as migrator (the legacy ELT's role) from a module must fail.
import { migratorSql } from '@yayatoh/db/migration';
export const sql = migratorSql;
