import { compileForOrgTx, segmentDefinitionTx } from '@yayatoh/audiences';
import { contactsConsentTx, type SegmentDefinition, segmentContactIdsTx } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { isDomainError } from '@yayatoh/kernel';
import { marketingSuppressionsTx } from '@yayatoh/notifications';
import { erasedAddressesTx, normalizeAddress } from '@yayatoh/platform';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { connections, recordLinks } from '../schema.ts';
import { type SubscriptionStatus, subscriptionStatus } from './consent.ts';

/**
 * Who may be pushed, read from the sources of truth inside the sync's tenant transaction (M6.4d):
 * the crm consent ledger, the marketing unsubscribe list and address suppressions
 * (notifications), and the platform's erased addresses. The same rules as a campaign's snapshot
 * (M3.6b): express consent only, suppressions win.
 */

export interface ContactState {
  readonly contactId: string;
  readonly email: string;
  readonly name: string | null;
  readonly company: string | null;
  readonly phone: string | null;
  /** The latest change to the contact or its consent (the pull's last-writer rule compares it). */
  readonly updatedAt: Date;
  readonly status: SubscriptionStatus;
}

export async function contactStatesTx(
  tx: TenantTx,
  contactIds: readonly string[],
): Promise<Map<string, ContactState>> {
  const rows = await contactsConsentTx(tx, [...new Set(contactIds)]);
  const emails = rows.map((r) => r.email);
  const blocked = await marketingSuppressionsTx(tx, 'email', emails);
  const erased = await erasedAddressesTx(tx, emails);
  const out = new Map<string, ContactState>();
  for (const r of rows) {
    const key = r.email.trim().toLowerCase();
    const e = erased.get(normalizeAddress(r.email));
    const reconsented = Boolean(e && r.consent === 'granted' && r.consentAt && r.consentAt > e.erasedAt);
    const status = subscriptionStatus({
      consent: r.consent,
      unsubscribed: blocked.get(key) === 'unsubscribed',
      suppressed: blocked.get(key) === 'suppressed',
      erased: Boolean(e) && !reconsented,
    });
    const updatedAt = r.consentAt && r.consentAt > r.updatedAt ? r.consentAt : r.updatedAt;
    out.set(r.contactId, {
      contactId: r.contactId,
      email: r.email,
      name: r.name,
      company: r.company,
      phone: r.phone,
      updatedAt,
      status,
    });
  }
  return out;
}

/** The org's live (pending, active or paused) connection of a connector, if any. */
export async function liveConnectionIdTx(tx: TenantTx, connector: string): Promise<string | null> {
  const [c] = await tx
    .select({ id: connections.id })
    .from(connections)
    .where(
      and(eq(connections.connector, connector), inArray(connections.status, ['pending', 'active', 'paused'])),
    )
    .limit(1);
  return c?.id ?? null;
}

/** Our ids linked for one object of a connection, after `afterId` in id order. */
export async function linkedLocalIdsAfterTx(
  tx: TenantTx,
  connectionId: string,
  objectType: string,
  afterId: string | null,
  limit: number,
): Promise<string[]> {
  const rows = await tx
    .select({ id: recordLinks.localId })
    .from(recordLinks)
    .where(
      and(
        eq(recordLinks.connectionId, connectionId),
        eq(recordLinks.objectType, objectType),
        afterId ? gt(recordLinks.localId, afterId) : undefined,
      ),
    )
    .orderBy(asc(recordLinks.localId))
    .limit(limit);
  return rows.map((r) => r.id);
}

/** Which of these ids are linked for one object of a connection. */
export async function linkedAmongTx(
  tx: TenantTx,
  connectionId: string,
  objectType: string,
  localIds: readonly string[],
): Promise<Set<string>> {
  if (localIds.length === 0) return new Set();
  const rows = await tx
    .select({ id: recordLinks.localId })
    .from(recordLinks)
    .where(
      and(
        eq(recordLinks.connectionId, connectionId),
        eq(recordLinks.objectType, objectType),
        inArray(recordLinks.localId, [...localIds]),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

/** "Everyone with email marketing consent": the audience when no segment is chosen. */
export const CONSENTED_EVERYONE: SegmentDefinition = {
  version: 1,
  root: { type: 'group', op: 'and', conditions: [{ type: 'consent', channel: 'email', granted: true }] },
};

/**
 * The audience's WHERE clause (over `crm.contacts c` and `crm.contact_profile pr`), or null when
 * its segment is gone (the push then sends no new subscribers; members already on the list stay).
 */
export async function audienceWhereTx(tx: TenantTx, orgId: string, segmentId: string | null) {
  let def: SegmentDefinition;
  try {
    def = segmentId ? await segmentDefinitionTx(tx, segmentId) : CONSENTED_EVERYONE;
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') return null;
    throw err;
  }
  return compileForOrgTx(tx, orgId, def, null);
}

/**
 * Audience members after `afterId` in id order who have email marketing consent on their profile
 * (the rest can never be pushed as subscribers; the exact rules run on each record after this).
 */
export async function audienceIdsAfterTx(
  tx: TenantTx,
  where: Awaited<ReturnType<typeof audienceWhereTx>>,
  afterId: string | null,
  limit: number,
): Promise<string[]> {
  if (!where) return [];
  const after = afterId ? sql` and c.id > ${afterId}::uuid` : sql``;
  return segmentContactIdsTx(tx, sql`(${where}) and pr.email_consent = 'granted'${after}`, limit);
}

/** Which of these contacts are in the audience. */
export async function inAudienceTx(
  tx: TenantTx,
  where: Awaited<ReturnType<typeof audienceWhereTx>>,
  contactIds: readonly string[],
): Promise<Set<string>> {
  if (!where || contactIds.length === 0) return new Set();
  const ids = sql`ARRAY[${sql.join(
    contactIds.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`;
  return new Set(await segmentContactIdsTx(tx, sql`(${where}) and c.id = any(${ids})`, contactIds.length));
}

/** Merge two id-ordered lists without duplicates, the first `limit`. */
export function mergeIds(a: readonly string[], b: readonly string[], limit: number): string[] {
  return [...new Set([...a, ...b])].sort().slice(0, limit);
}

/**
 * Link a pulled record before the engine reads it back (M6.4d): the push side's status depends on
 * whether the provider already has the person, and the engine stores the record's hash right
 * after `write`. Linking first makes that hash the one the push computes next, so a consent
 * change that came in is never sent back. The engine's own link upsert completes the row.
 */
export async function linkPulledTx(
  tx: TenantTx,
  orgId: string,
  input: {
    readonly connectionId: string;
    readonly objectType: string;
    readonly externalId: string;
    readonly localId: string;
    readonly remoteVersion: string;
    readonly now: Date;
  },
): Promise<void> {
  await tx
    .insert(recordLinks)
    .values({
      orgId,
      connectionId: input.connectionId,
      objectType: input.objectType,
      externalId: input.externalId,
      localId: input.localId,
      remoteVersion: input.remoteVersion,
      lastDirection: 'pull',
      lastSyncedAt: input.now,
    })
    .onConflictDoNothing();
}
