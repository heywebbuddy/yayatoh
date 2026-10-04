import { contactsWithConsentTx } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { marketingSuppressionsTx } from '@yayatoh/notifications';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { LIVE_STATUSES } from '../../domain/sync.ts';
import { fieldsHash } from '../../hash.ts';
import { connections, recordLinks } from '../../schema.ts';
import type { LocalRecord, Page } from '../../sdk/connector.ts';
import { SALESFORCE } from './objects.ts';

/**
 * Yayatoh's side of the Salesforce connector (M6.5b): who may be pushed and the record links the
 * connector reads to point a campaign member or an opportunity at the Salesforce records it
 * belongs to. **Consent:** a person is pushed only while their latest email marketing consent is
 * `granted` and their address isn't unsubscribed or suppressed; anything about them (their
 * campaign memberships) follows the same rule.
 */

export interface Link {
  readonly externalId: string;
  readonly localHash: string | null;
}

/** This connection's links of one object for these Yayatoh ids. */
export async function linksTx(
  tx: TenantTx,
  connectionId: string,
  objectType: string,
  localIds: readonly string[],
): Promise<Map<string, Link>> {
  const ids = [...new Set(localIds)];
  const out = new Map<string, Link>();
  for (let i = 0; i < ids.length; i += 1_000) {
    const part = ids.slice(i, i + 1_000);
    const rows = await tx
      .select({
        localId: recordLinks.localId,
        externalId: recordLinks.externalId,
        localHash: recordLinks.localHash,
      })
      .from(recordLinks)
      .where(
        and(
          eq(recordLinks.connectionId, connectionId),
          eq(recordLinks.objectType, objectType),
          inArray(recordLinks.localId, part),
        ),
      );
    for (const r of rows) out.set(r.localId, { externalId: r.externalId, localHash: r.localHash });
  }
  return out;
}

/**
 * The org's live Salesforce connection (one per org at most). A record read outside a page (a
 * retry from the errors inbox) uses it to find its links.
 */
export async function liveConnectionIdTx(tx: TenantTx): Promise<string | null> {
  const [row] = await tx
    .select({ id: connections.id })
    .from(connections)
    .where(and(eq(connections.connector, SALESFORCE), inArray(connections.status, [...LIVE_STATUSES])))
    .orderBy(desc(connections.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/** Of these contacts, the ones that may be pushed now (consent granted, not unsubscribed). */
export async function pushableContactsTx(tx: TenantTx, contactIds: readonly string[]) {
  const rows = await contactsWithConsentTx(tx, contactIds);
  const granted = [...rows.values()].filter((r) => r.consent === 'granted');
  const blocked = await marketingSuppressionsTx(
    tx,
    'email',
    granted.map((r) => r.email),
  );
  const out = new Map<string, (typeof granted)[number]>();
  for (const r of granted) if (!blocked.has(r.email.trim().toLowerCase())) out.set(r.id, r);
  return out;
}

const CHUNK = 500;

/**
 * A push page over a whole set (events, participation, sponsors), re-read on every pass: rows in
 * id order, each built into a local record (null: not pushable now), keeping only those whose
 * content differs from what was last sent. The cursor is `id:<last row looked at>`, and `wrap`
 * once the set is read to the end, so the next run starts over and catches rows that became
 * pushable later (a person who consented, a campaign that now exists).
 */
export async function passPage<R extends { readonly id: string }>(
  tx: TenantTx,
  cursor: string | null,
  limit: number,
  opts: {
    readonly connectionId: string;
    readonly objectType: string;
    readonly fetch: (afterId: string | null, n: number) => Promise<readonly R[]>;
    readonly build: (rows: readonly R[]) => Promise<readonly (LocalRecord | null)[]>;
  },
): Promise<Page<LocalRecord>> {
  let after = cursor?.startsWith('id:') ? cursor.slice(3) : null;
  const records: LocalRecord[] = [];
  for (;;) {
    const rows = await opts.fetch(after, CHUNK);
    if (rows.length === 0) return { records, cursor: 'wrap', hasMore: false };
    const built = await opts.build(rows);
    const links = await linksTx(
      tx,
      opts.connectionId,
      opts.objectType,
      built.flatMap((r) => (r ? [r.id] : [])),
    );
    for (let i = 0; i < rows.length; i++) {
      after = rows[i]?.id ?? after;
      const local = built[i];
      if (local && links.get(local.id)?.localHash !== fieldsHash(local.fields)) records.push(local);
      if (records.length >= limit) return { records, cursor: `id:${after}`, hasMore: true };
    }
    if (rows.length < CHUNK) return { records, cursor: 'wrap', hasMore: false };
  }
}
