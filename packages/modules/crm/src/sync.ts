import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { eq, sql } from 'drizzle-orm';
import { normalizeEmail } from './contacts.ts';
import { contacts } from './schema.ts';

/**
 * Contacts for integration syncs (M6.4a): the push side reads what changed since a keyset cursor,
 * the pull side writes a contact from a connected provider. Merged-away contacts never sync.
 */

export interface ContactSyncRow {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly updatedAt: Date;
  /** The keyset position after this row (`<update time with microseconds>|<id>`). */
  readonly cursor: string;
}

type Raw = { id: string; email: string; name: string | null; updated_at: Date | string; pos: string };
const row = (r: Raw): ContactSyncRow => ({
  id: r.id,
  email: r.email,
  name: r.name,
  updatedAt: new Date(r.updated_at),
  cursor: `${r.pos}|${r.id}`,
});
const POS = sql`to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Contacts changed after `cursor` (from `ContactSyncRow.cursor`; null: from the start), oldest first. */
export async function contactsChangedSinceTx(
  tx: TenantTx,
  cursor: string | null,
  limit: number,
): Promise<ContactSyncRow[]> {
  const m = cursor ? /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)\|([0-9a-f-]{36})$/.exec(cursor) : null;
  const after = m ? sql`and (updated_at, id) > (${m[1]}::timestamptz, ${m[2]}::uuid)` : sql``;
  const rows = await tx.execute<Raw>(sql`
    select id, email, name, updated_at, ${POS} as pos from crm.contacts
    where merged_into is null ${after}
    order by updated_at, id
    limit ${Math.max(1, Math.min(limit, 500))}`);
  return rows.map(row);
}

/** One contact for a sync (null when unknown or merged away). */
export async function contactSyncRowTx(tx: TenantTx, contactId: string): Promise<ContactSyncRow | null> {
  const [r] = await tx.execute<Raw>(sql`
    select id, email, name, updated_at, ${POS} as pos from crm.contacts
    where id = ${contactId} and merged_into is null`);
  return r ? row(r) : null;
}

/**
 * Write a contact a provider sent (the email is the key). A provided name replaces ours (the sync's
 * last-writer rule decided it is newer); an empty one keeps ours. New contacts are `import`ed.
 * Returns the contact's id.
 */
export async function writeSyncedContactTx(
  tx: TenantTx,
  ctx: Ctx,
  input: { readonly contactId: string | null; readonly email: string; readonly name: string | null },
): Promise<string> {
  const orgId = requireOrg(ctx);
  const emailNorm = normalizeEmail(input.email);
  if (input.contactId) {
    const [own] = await tx
      .select({ id: contacts.id, emailNorm: contacts.emailNorm, name: contacts.name })
      .from(contacts)
      .where(eq(contacts.id, input.contactId));
    // Same person: update in place, and only when something changed (no needless write).
    if (own && own.emailNorm === emailNorm) {
      if (input.name && input.name !== own.name)
        await tx
          .update(contacts)
          .set({ name: input.name, updatedAt: ctx.now })
          .where(eq(contacts.id, own.id));
      return own.id;
    }
  }
  const [existing] = await tx
    .select({ id: contacts.id, name: contacts.name })
    .from(contacts)
    .where(eq(contacts.emailNorm, emailNorm));
  if (existing) {
    if (input.name && input.name !== existing.name)
      await tx
        .update(contacts)
        .set({ name: input.name, updatedAt: ctx.now })
        .where(eq(contacts.id, existing.id));
    return existing.id;
  }
  const [created] = await tx
    .insert(contacts)
    .values({ orgId, email: input.email.trim(), emailNorm, name: input.name, source: 'import' })
    .onConflictDoNothing()
    .returning({ id: contacts.id });
  if (created) return created.id;
  const [raced] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.emailNorm, emailNorm));
  if (!raced) throw new DomainError('internal');
  return raced.id;
}
