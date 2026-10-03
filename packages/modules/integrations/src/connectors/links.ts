import type { TenantTx } from '@yayatoh/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { connections, recordLinks } from '../schema.ts';

/**
 * The Yayatoh record a provider id was linked to by any connection of this connector in the org
 * (M6.4b): a re-import after a reconnect finds what the earlier connection wrote, so nothing is
 * imported twice. The current connection's link wins over older ones.
 */
export async function linkedLocalIdTx(
  tx: TenantTx,
  connector: string,
  objectType: string,
  externalId: string,
  preferConnectionId: string | null = null,
): Promise<string | null> {
  const [row] = await tx
    .select({ localId: recordLinks.localId })
    .from(recordLinks)
    .innerJoin(
      connections,
      and(eq(connections.orgId, recordLinks.orgId), eq(connections.id, recordLinks.connectionId)),
    )
    .where(
      and(
        eq(connections.connector, connector),
        eq(recordLinks.objectType, objectType),
        eq(recordLinks.externalId, externalId),
      ),
    )
    .orderBy(
      desc(
        sql`${recordLinks.connectionId} = ${preferConnectionId ?? '00000000-0000-0000-0000-000000000000'}::uuid`,
      ),
      desc(recordLinks.updatedAt),
    )
    .limit(1);
  return row?.localId ?? null;
}

/** How many provider records of each object this connector's connections linked in the org. */
export async function linkedCountsTx(tx: TenantTx, connector: string): Promise<Map<string, Set<string>>> {
  const rows = await tx
    .select({ objectType: recordLinks.objectType, externalId: recordLinks.externalId })
    .from(recordLinks)
    .innerJoin(
      connections,
      and(eq(connections.orgId, recordLinks.orgId), eq(connections.id, recordLinks.connectionId)),
    )
    .where(eq(connections.connector, connector));
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    const s = out.get(r.objectType) ?? new Set<string>();
    s.add(r.externalId);
    out.set(r.objectType, s);
  }
  return out;
}
