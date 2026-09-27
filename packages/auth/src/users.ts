import { identityDatabase } from '@yayatoh/db/identity';
import { inArray } from 'drizzle-orm';
import { users } from './schema.ts';

/** Allowlisted user fields for display (names in member lists). Never returns credentials. */
export interface UserSummary {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

export async function getUsersByIds(ids: readonly string[]): Promise<Map<string, UserSummary>> {
  if (ids.length === 0) return new Map();
  const rows = await identityDatabase()
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, [...ids]));
  return new Map(rows.map((r) => [r.id, r]));
}
