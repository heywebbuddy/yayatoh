// Restricted entry point: only packages/auth may import `@yayatoh/db/identity` (tools/check-modules).
// Better Auth's drizzle adapter needs a database handle for the global identity tables (schema
// `auth`). It runs as app_user with no tenant set, so tenant tables stay invisible to it.
import { pool } from './client.ts';

export function identityDatabase() {
  return pool('app').db;
}
