import { type TenantTx, withoutTenant } from '@yayatoh/db';
import { type Ctx, createCtx, DomainError } from '@yayatoh/kernel';
import { verifyLinkToken } from '@yayatoh/platform';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { tableUnits, tickets, ticketTypes } from './schema.ts';

/**
 * M4.2b gala tables, ticketing's side: a table ticket sold issues one `table_units` row and its
 * `size` tickets (the guest slots) in the order's transaction (`issueTicketsTx`). The module above
 * (orders) names the slots: it reissues a slot's ticket to the named guest (`reissueTicketTx`) and
 * records the guest in the guests module. These helpers read and lock the purchased tables.
 */

/** The purpose a table's claim link is signed for (`<table id>~hmac`). */
export const TABLE_NAMING_PURPOSE = 'table-naming';

export type TableUnitRow = typeof tableUnits.$inferSelect;

/** Resolve a table's claim link token to its table and org (before any tenant is known). */
export async function tableUnitContext(token: string): Promise<{ id: string; ctx: Ctx } | null> {
  const id = verifyLinkToken(TABLE_NAMING_PURPOSE, token);
  if (!id) return null;
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string }>(sql`select org_id from ticketing.table_unit_org(${id}::uuid)`),
  );
  const orgId = rows[0]?.org_id;
  return orgId ? { id, ctx: createCtx({ orgId }) } : null;
}

/** A purchased table with its ticket type's name (`forUpdate` serializes naming its slots). */
export async function tableUnitTx(tx: TenantTx, id: string, forUpdate = false) {
  const q = tx
    .select({ unit: tableUnits, typeName: ticketTypes.name })
    .from(tableUnits)
    .innerJoin(ticketTypes, eq(ticketTypes.id, tableUnits.ticketTypeId))
    .where(eq(tableUnits.id, id));
  const [row] = forUpdate ? await q.for('update', { of: tableUnits }) : await q;
  if (!row) throw new DomainError('not_found', 'Table not found');
  return { ...row.unit, typeName: row.typeName };
}

/** An event's purchased tables (or one order's), oldest first, with their ticket type's name. */
export async function tableUnitsTx(tx: TenantTx, where: { eventId: string } | { orderId: string }) {
  const rows = await tx
    .select({ unit: tableUnits, typeName: ticketTypes.name })
    .from(tableUnits)
    .innerJoin(ticketTypes, eq(ticketTypes.id, tableUnits.ticketTypeId))
    .where('eventId' in where ? eq(tableUnits.eventId, where.eventId) : eq(tableUnits.orderId, where.orderId))
    .orderBy(asc(tableUnits.createdAt), asc(tableUnits.unitNo), asc(tableUnits.id));
  return rows.map((r) => ({ ...r.unit, typeName: r.typeName }));
}

/**
 * The guest slots of purchased tables: their active tickets, in issue order. A voided ticket (a
 * refund) is no longer a slot.
 */
export async function tableSlotsTx(tx: TenantTx, unitIds: readonly string[]) {
  if (unitIds.length === 0) return [];
  const rows = await tx
    .select({
      id: tickets.id,
      tableUnitId: tickets.tableUnitId,
      serial: tickets.serial,
      shortCode: tickets.shortCode,
      holderName: tickets.holderName,
      holderEmail: tickets.holderEmail,
      attendeeId: tickets.attendeeId,
    })
    .from(tickets)
    .where(and(inArray(tickets.tableUnitId, [...unitIds]), eq(tickets.status, 'active')))
    .orderBy(asc(tickets.serial));
  return rows.map((r) => ({ ...r, tableUnitId: r.tableUnitId as string }));
}

/** Count one email that carried a table's claim link: a send (payment, resend) or a host reminder. */
export async function recordTableLinkSentTx(
  tx: TenantTx,
  ctx: Ctx,
  id: string,
  kind: 'send' | 'reminder',
): Promise<number> {
  const [row] = await tx
    .update(tableUnits)
    .set(
      kind === 'send'
        ? { linkSends: sql`${tableUnits.linkSends} + 1`, lastLinkSentAt: ctx.now, updatedAt: ctx.now }
        : { reminders: sql`${tableUnits.reminders} + 1`, lastRemindedAt: ctx.now, updatedAt: ctx.now },
    )
    .where(eq(tableUnits.id, id))
    .returning({ linkSends: tableUnits.linkSends, reminders: tableUnits.reminders });
  if (!row) throw new DomainError('not_found', 'Table not found');
  return row.linkSends + row.reminders;
}
