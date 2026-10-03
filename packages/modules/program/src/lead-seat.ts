import type { TenantTx } from '@yayatoh/db';
import { portalAccountsTx } from '@yayatoh/events';
import type { Ctx } from '@yayatoh/kernel';
import { eq, inArray } from 'drizzle-orm';
import { type LeadSeatStanding, leadSeatStanding } from './domain/lead-seat.ts';
import { leadLicenseUseTx } from './lead-licenses.ts';
import { exhibitors } from './schema.ts';
import { leadLicenses } from './schema-sponsors.ts';

/**
 * M5.6b lead capture asks program whether a signed-in exhibitor person holds a lead license that
 * is within the exhibitor's allowance (included + packages + bought). Seats of revoked people
 * don't count, as in M5.4b.
 */
export async function leadSeatStandingTx(
  tx: TenantTx,
  ctx: Ctx,
  eventId: string,
  exhibitorId: string,
  accountId: string,
): Promise<{ standing: LeadSeatStanding; allowance: number; used: number }> {
  const live = new Set(
    (await portalAccountsTx(tx, eventId, 'exhibitor', ctx.now))
      .filter((a) => a.subjectId === exhibitorId && (a.status === 'invited' || a.status === 'active'))
      .map((a) => a.id),
  );
  const seats = (
    await tx
      .select({ id: leadLicenses.id, accountId: leadLicenses.accountId, createdAt: leadLicenses.createdAt })
      .from(leadLicenses)
      .where(eq(leadLicenses.exhibitorId, exhibitorId))
  ).filter((s) => live.has(s.accountId));
  const use = await leadLicenseUseTx(tx, ctx, eventId, exhibitorId);
  return {
    standing: leadSeatStanding(seats, accountId, use.allowance),
    allowance: use.allowance,
    used: use.used,
  };
}

/** M5.6b "who scanned me": exhibitor names by id (names are public on the exhibitor map). */
export async function exhibitorNamesTx(tx: TenantTx, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ id: exhibitors.id, name: exhibitors.name })
    .from(exhibitors)
    .where(inArray(exhibitors.id, [...ids]));
  return new Map(rows.map((r) => [r.id, r.name]));
}
