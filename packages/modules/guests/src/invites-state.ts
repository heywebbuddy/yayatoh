import type { TenantTx } from '@yayatoh/db';
import { type Ctx, requireOrg } from '@yayatoh/kernel';
import { and, eq, inArray } from 'drizzle-orm';
import { partyInvites } from './schema.ts';

/**
 * Party invitation preferences (M4.1f), shared by the collector (the language the guest used)
 * and the invitation commands. Kept apart so `collector.ts` and `invites.ts` don't import each
 * other.
 */

const LOCALE = /^[a-z]{2}(-[A-Z]{2})?$/;

/** Set a party's invitation language (made on first use). */
export async function setPartyLocaleTx(
  tx: TenantTx,
  ctx: Ctx,
  eventId: string,
  partyId: string,
  locale: string,
) {
  const value = LOCALE.test(locale) ? locale : 'en';
  await tx
    .insert(partyInvites)
    .values({ orgId: requireOrg(ctx), eventId, partyId, locale: value })
    .onConflictDoUpdate({
      target: [partyInvites.orgId, partyInvites.partyId],
      set: { locale: value, updatedAt: ctx.now },
    });
}

/** The invitation language of some parties (absent: the caller's default). */
export async function partyLocalesTx(
  tx: TenantTx,
  eventId: string,
  partyIds: readonly string[],
): Promise<Map<string, string>> {
  if (partyIds.length === 0) return new Map();
  const rows = await tx
    .select({ partyId: partyInvites.partyId, locale: partyInvites.locale })
    .from(partyInvites)
    .where(and(eq(partyInvites.eventId, eventId), inArray(partyInvites.partyId, [...partyIds])));
  return new Map(rows.map((r) => [r.partyId, r.locale]));
}
