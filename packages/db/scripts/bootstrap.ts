import postgres from 'postgres';
import { bootstrapRoles } from '../src/bootstrap.ts';
import { databaseUrl } from '../src/env.ts';

// Local/CI/preview only. Role passwords are read from the role URLs in your (git-ignored) env.
const admin = postgres(databaseUrl('admin'), { max: 1, onnotice: () => {} });
const pw = (role: 'app' | 'migrator' | 'platformReader') =>
  decodeURIComponent(new URL(databaseUrl(role)).password);
const database = new URL(databaseUrl('app')).pathname.slice(1);
try {
  await bootstrapRoles(admin, database, {
    app: pw('app'),
    migrator: pw('migrator'),
    platformReader: pw('platformReader'),
  });
  console.info(`bootstrap: roles ready on ${database}`);
} finally {
  await admin.end();
}
