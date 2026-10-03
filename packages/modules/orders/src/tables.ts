import { type TenantTx, withoutTenant, withTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import {
  addTableGuestTx,
  guestsByTicketTx,
  type TableSource,
  tablePartiesTx,
  tablePartyTx,
} from '@yayatoh/guests';
import { type Ctx, createCtx, DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import {
  defineSubscriber,
  type Notifier,
  signLinkToken,
  tenantCommand,
  tenantQuery,
} from '@yayatoh/platform';
import {
  recordTableLinkSentTx,
  reissueTicketTx,
  TABLE_NAMING_PURPOSE,
  tableSlotsTx,
  tableUnitContext,
  tableUnitsTx,
  tableUnitTx,
} from '@yayatoh/ticketing';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { hashManageToken } from './commands/checkout.ts';
import {
  guestFullName,
  mayResend,
  namingRefusal,
  pickSlot,
  REMINDER_GAP_MS,
  RESEND_GAP_MS,
  tableProgress,
} from './domain/tables.ts';
import { orders } from './schema.ts';

/**
 * M4.2b gala tables and sponsors. Buying a table ticket ("Table of 10") issues the table and its
 * guest slots (one ticket each) in the order's transaction (ticketing). Here the slots get their
 * guests: the buyer names them through the table's claim link (signed, one per table, resent on
 * request), the host names them by hand or sends a naming reminder. Naming a slot reissues its
 * ticket to the guest (the claim flow's `reissueTicketTx`: new code, the attendee follows) and
 * records them in the guests module as a guest of the table's party (the buyer's company or the
 * sponsor) holding that ticket, all in one transaction under the table's row lock — so however
 * many people name at once, a table never holds more guests than its slots.
 */

type Emit = (e: DomainEvent) => void;

const Name = z.string().trim().min(1).max(80);
const OptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((v) => (v ? v : null));

const SlotFields = z.object({
  tableUnitId: z.uuid(),
  /** The slot (ticket) to name; none = the first unnamed one. */
  ticketId: z.uuid().nullable().default(null),
  firstName: Name,
  lastName: OptionalText(80),
  /** Where the guest's ticket goes; none = it stays with the buyer, in the guest's name. */
  email: z
    .email()
    .max(254)
    .nullable()
    .default(null)
    .or(z.literal('').transform(() => null)),
  /** The table's party (company or sponsor) when it has none yet; defaults to the buyer's name. */
  company: OptionalText(120),
});

/** The table, locked, with its order and event; refuses when naming is closed. */
async function openTableTx(tx: TenantTx, ctx: Ctx, tableUnitId: string, eventId?: string) {
  const unit = await tableUnitTx(tx, tableUnitId, true);
  if (eventId && unit.eventId !== eventId) throw new DomainError('not_found', 'Table not found');
  const [order] = await tx.select().from(orders).where(eq(orders.id, unit.orderId));
  const event = await findEventTx(tx, unit.eventId);
  if (!order || !event) throw new DomainError('not_found', 'Table not found');
  const refusal = namingRefusal(order.status, event.endsAt, ctx.now);
  if (refusal)
    throw new DomainError('invalid_state', 'This table can no longer be named', { reason: refusal });
  return { unit, order, event };
}

/** Name one slot of a table (the shared core of the buyer's link and the host's console). */
async function nameSlotTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: Emit,
  input: z.infer<typeof SlotFields>,
  source: TableSource,
  eventId?: string,
) {
  const { unit, order } = await openTableTx(tx, ctx, input.tableUnitId, eventId);
  const slots = await tableSlotsTx(tx, [unit.id]);
  const named = new Set(
    (
      await guestsByTicketTx(
        tx,
        slots.map((s) => s.id),
      )
    ).map((g) => g.ticketId),
  );
  const ticketId = pickSlot(slots, named, input.ticketId);
  if (!ticketId)
    throw input.ticketId && slots.some((s) => s.id === input.ticketId)
      ? new DomainError('conflict', 'This seat already has a guest', { reason: 'slot_named' })
      : input.ticketId
        ? new DomainError('not_found', 'Seat not found')
        : new DomainError('invalid_state', 'Every seat at this table has a guest', { reason: 'table_full' });
  const slot = slots.find((s) => s.id === ticketId);
  if (!slot) throw new DomainError('not_found', 'Seat not found');
  const party = await tablePartyTx(tx, ctx, {
    eventId: unit.eventId,
    tableUnitId: unit.id,
    name: input.company ?? order.buyerName,
    source,
  });
  const name = guestFullName(input.firstName, input.lastName);
  const ticket = await reissueTicketTx(tx, ctx, ticketId, { name, email: input.email ?? order.buyerEmail });
  const guest = await addTableGuestTx(tx, ctx, {
    eventId: unit.eventId,
    partyId: party.id,
    ticketId,
    attendeeId: slot.attendeeId,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    source,
  });
  emit({
    type: 'table.slot_named',
    version: 1,
    aggregateType: 'table_unit',
    aggregateId: unit.id,
    payload: {
      orgId: requireOrg(ctx),
      eventId: unit.eventId,
      tableUnitId: unit.id,
      ticketId,
      guestId: guest.id,
    },
  });
  const after = tableProgress(slots.length, named.size + 1);
  return { ticketId, guestId: guest.id, rev: ticket.rev, ...after };
}

const NamedSlotDto = z.object({
  ticketId: z.uuid(),
  guestId: z.uuid(),
  rev: z.int(),
  named: z.int(),
  missing: z.int(),
});

/** Public (the table's claim link): the buyer names a guest. */
export const nameTableSlotCommand = tenantCommand({
  name: 'orders.nameTableSlot',
  input: SlotFields,
  output: NamedSlotDto,
  entitlement: 'ticketing',
  permission: 'public:claim',
  handler: ({ input, ctx, tx, emit }) => nameSlotTx(tx, ctx, emit, input, 'table_link'),
  audit: (input, r) => ({
    action: 'table.slot_named',
    targetType: 'table_unit',
    targetId: input.tableUnitId,
    data: { ticketId: r?.ticketId, via: 'link', email: input.email !== null },
  }),
});

/** The host names a guest at a purchased table by hand. */
export const hostNameTableSlotCommand = tenantCommand({
  name: 'orders.hostNameTableSlot',
  input: SlotFields.extend({ eventId: z.uuid() }),
  output: NamedSlotDto,
  entitlement: 'ticketing',
  permission: 'tables:write',
  handler: ({ input, ctx, tx, emit }) => nameSlotTx(tx, ctx, emit, input, 'manual', input.eventId),
  audit: (input, r) => ({
    action: 'table.slot_named',
    targetType: 'table_unit',
    targetId: input.tableUnitId,
    data: { eventId: input.eventId, ticketId: r?.ticketId, via: 'host', email: input.email !== null },
  }),
});

/** Public (the claim link): the buyer names (or renames) the table's party, their company or sponsor. */
export const setTableCompanyCommand = tenantCommand({
  name: 'orders.setTableCompany',
  input: z.object({ tableUnitId: z.uuid(), company: z.string().trim().min(1).max(120) }),
  output: z.object({ company: z.string() }),
  entitlement: 'ticketing',
  permission: 'public:claim',
  handler: async ({ input, ctx, tx }) => {
    const { unit } = await openTableTx(tx, ctx, input.tableUnitId);
    const party = await tablePartyTx(tx, ctx, {
      eventId: unit.eventId,
      tableUnitId: unit.id,
      name: input.company,
      source: 'table_link',
      rename: true,
    });
    return { company: party.name };
  },
  audit: (input) => ({ action: 'table.company_set', targetType: 'table_unit', targetId: input.tableUnitId }),
});

/** Public (the claim link): email the link to the buyer again (at most once a minute). */
export const resendTableLinkCommand = tenantCommand({
  name: 'orders.resendTableLink',
  input: z.object({ tableUnitId: z.uuid() }),
  output: z.object({ sent: z.boolean() }),
  entitlement: 'ticketing',
  permission: 'public:claim',
  handler: async ({ input, ctx, tx, emit }) => {
    const { unit } = await openTableTx(tx, ctx, input.tableUnitId);
    if (!mayResend(unit.lastLinkSentAt, ctx.now, RESEND_GAP_MS)) return { sent: false };
    await recordTableLinkSentTx(tx, ctx, unit.id, 'send');
    emit(linkRequested(requireOrg(ctx), unit, 'resend'));
    return { sent: true };
  },
  audit: (input, r) => ({
    action: 'table.link_resent',
    targetType: 'table_unit',
    targetId: input.tableUnitId,
    data: { sent: r?.sent ?? false },
  }),
});

/**
 * The host reminds buyers to name their guests: the chosen tables (or every table still missing
 * names). Each table is reminded at most once an hour; tables that are complete, closed or were
 * just reminded are skipped and counted.
 */
export const sendTableRemindersCommand = tenantCommand({
  name: 'orders.sendTableReminders',
  input: z.object({ eventId: z.uuid(), tableUnitIds: z.array(z.uuid()).max(500).nullable().default(null) }),
  output: z.object({ sent: z.int(), skipped: z.int() }),
  entitlement: 'ticketing',
  permission: 'tables:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const all = await tableUnitsTx(tx, { eventId: input.eventId });
    const chosen = input.tableUnitIds ? all.filter((u) => input.tableUnitIds?.includes(u.id)) : all;
    if (input.tableUnitIds && chosen.length !== new Set(input.tableUnitIds).size)
      throw new DomainError('not_found', 'Table not found');
    const slots = await tableSlotsTx(
      tx,
      chosen.map((u) => u.id),
    );
    const named = new Set(
      (
        await guestsByTicketTx(
          tx,
          slots.map((s) => s.id),
        )
      ).map((g) => g.ticketId),
    );
    const event = await findEventTx(tx, input.eventId);
    let sent = 0;
    for (const unit of chosen) {
      const mine = slots.filter((s) => s.tableUnitId === unit.id);
      const missing = mine.filter((s) => !named.has(s.id)).length;
      const [order] = await tx
        .select({ status: orders.status })
        .from(orders)
        .where(eq(orders.id, unit.orderId));
      const closed = !order || !event || namingRefusal(order.status, event.endsAt, ctx.now) !== null;
      if (missing === 0 || closed || !mayResend(unit.lastRemindedAt, ctx.now, REMINDER_GAP_MS)) continue;
      await recordTableLinkSentTx(tx, ctx, unit.id, 'reminder');
      emit(linkRequested(requireOrg(ctx), unit, 'reminder'));
      sent += 1;
    }
    return { sent, skipped: chosen.length - sent };
  },
  audit: (input, r) => ({
    action: 'table.reminders_sent',
    targetType: 'event',
    targetId: input.eventId,
    data: { sent: r?.sent ?? 0, skipped: r?.skipped ?? 0 },
  }),
});

const linkRequested = (
  orgId: string,
  unit: { id: string; eventId: string },
  kind: 'resend' | 'reminder',
) => ({
  type: 'table.naming_link_requested',
  version: 1,
  aggregateType: 'table_unit',
  aggregateId: unit.id,
  payload: { orgId, eventId: unit.eventId, tableUnitId: unit.id, kind },
});

/* --------------------------------------------------------------------------------- reads ---- */

export const HostedTableSlotDto = z.object({
  ticketId: z.uuid(),
  serial: z.int(),
  shortCode: z.string(),
  /** The guest holding the ticket (a ticket shows its guest), or null while unnamed. */
  guestId: z.uuid().nullable(),
  guestName: z.string().nullable(),
});

/** A purchased table for the host: buyer, party, size, named and missing seats, the slots. */
export const HostedTableDto = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  buyerName: z.string(),
  buyerEmail: z.string(),
  typeName: z.string(),
  unitNo: z.int(),
  size: z.int(),
  company: z.string().nullable(),
  named: z.int(),
  missing: z.int(),
  reminders: z.int(),
  lastRemindedAt: z.date().nullable(),
  slots: z.array(HostedTableSlotDto),
});
export type HostedTableDto = z.infer<typeof HostedTableDto>;

async function hostedTablesTx(tx: TenantTx, units: Awaited<ReturnType<typeof tableUnitsTx>>) {
  const slots = await tableSlotsTx(
    tx,
    units.map((u) => u.id),
  );
  const guests = new Map(
    (
      await guestsByTicketTx(
        tx,
        slots.map((s) => s.id),
      )
    ).map((g) => [g.ticketId, g]),
  );
  const parties = new Map(
    (
      await tablePartiesTx(
        tx,
        units.map((u) => u.id),
      )
    ).map((p) => [p.tableUnitId, p]),
  );
  const buyers = new Map<string, { buyerName: string; buyerEmail: string }>();
  for (const id of new Set(units.map((u) => u.orderId))) {
    const [o] = await tx
      .select({ buyerName: orders.buyerName, buyerEmail: orders.buyerEmail })
      .from(orders)
      .where(eq(orders.id, id));
    if (o) buyers.set(id, o);
  }
  return units.map((u) => {
    const mine = slots
      .filter((s) => s.tableUnitId === u.id)
      .map((s) => {
        const g = guests.get(s.id);
        return {
          ticketId: s.id,
          serial: s.serial,
          shortCode: s.shortCode,
          guestId: g?.id ?? null,
          guestName: g ? guestFullName(g.firstName ?? '', g.lastName) : null,
        };
      });
    const progress = tableProgress(mine.length, mine.filter((s) => s.guestId).length);
    return HostedTableDto.parse({
      ...u,
      ...(buyers.get(u.orderId) ?? { buyerName: '', buyerEmail: '' }),
      company: parties.get(u.id)?.name ?? null,
      ...progress,
      slots: mine,
    });
  });
}

/** The host's list of an event's purchased tables (Tables & Sponsors). */
export const hostedTablesQuery = tenantQuery({
  name: 'orders.hostedTables',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(HostedTableDto),
  entitlement: 'ticketing',
  permission: 'tables:read',
  handler: async ({ input, tx }) => hostedTablesTx(tx, await tableUnitsTx(tx, { eventId: input.eventId })),
});

/** What the claim link shows the buyer: their table, its party and the names so far. Never emails. */
export const PublicTableDto = z.object({
  id: z.uuid(),
  eventName: z.string(),
  eventSlug: z.string(),
  eventTimezone: z.string(),
  eventStartsAt: z.date(),
  typeName: z.string(),
  unitNo: z.int(),
  size: z.int(),
  buyerName: z.string(),
  company: z.string().nullable(),
  named: z.int(),
  missing: z.int(),
  /** Why naming is closed (not paid, the event is over), or null while open. */
  closed: z.enum(['not_paid', 'event_over']).nullable(),
  slots: z.array(z.object({ ticketId: z.uuid(), guestName: z.string().nullable() })),
});
export type PublicTableDto = z.infer<typeof PublicTableDto>;

export const publicTableQuery = tenantQuery({
  name: 'orders.publicTable',
  input: z.object({ tableUnitId: z.uuid() }),
  output: PublicTableDto,
  entitlement: 'ticketing',
  permission: 'public:claim',
  handler: async ({ input, ctx, tx }) => {
    const unit = await tableUnitTx(tx, input.tableUnitId);
    const [order] = await tx.select().from(orders).where(eq(orders.id, unit.orderId));
    const event = await findEventTx(tx, unit.eventId);
    if (!order || !event) throw new DomainError('not_found', 'Table not found');
    const [table] = await hostedTablesTx(tx, [unit]);
    if (!table) throw new DomainError('not_found', 'Table not found');
    return {
      ...table,
      eventName: event.name,
      eventSlug: event.slug,
      eventTimezone: event.timezone,
      eventStartsAt: event.startsAt,
      buyerName: order.buyerName,
      closed: namingRefusal(order.status, event.endsAt, ctx.now),
      slots: table.slots.map((s) => ({ ticketId: s.ticketId, guestName: s.guestName })),
    };
  },
});

/** The claim link's path for a table (`/tables/<id>~hmac`). */
export const tableNamingPath = (tableUnitId: string) =>
  `/tables/${signLinkToken(TABLE_NAMING_PURPOSE, tableUnitId)}`;

/** Resolve a claim link token to the table and its org (null for anything else). */
export const tableLinkContext = tableUnitContext;

/**
 * The buyer's order page (manage token): the tables of the order, each with its claim link and
 * how many seats are named. Server-side only.
 */
export async function orderTablesByManageToken(token: string) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return [];
  const refs = await withoutTenant((tx) =>
    tx.execute<{ org_id: string; order_id: string }>(
      sql`select org_id, order_id from orders.order_ref_by_token(${hashManageToken(token)})`,
    ),
  );
  const ref = refs[0];
  if (!ref) return [];
  const ctx = createCtx({ orgId: ref.org_id, actor: { type: 'system', name: 'orders.manage-link' } });
  return withTenant(ctx, async (tx) => {
    const tables = await hostedTablesTx(tx, await tableUnitsTx(tx, { orderId: ref.order_id }));
    return tables.map((t) => ({
      id: t.id,
      typeName: t.typeName,
      unitNo: t.unitNo,
      size: t.size,
      named: t.named,
      missing: t.missing,
      path: tableNamingPath(t.id),
    }));
  });
}

/* ---------------------------------------------------------------------------------- mail ---- */

const PaidPayload = z.object({ orgId: z.uuid(), orderId: z.uuid() });
const LinkPayload = z.object({
  orgId: z.uuid(),
  eventId: z.uuid(),
  tableUnitId: z.uuid(),
  kind: z.enum(['resend', 'reminder']),
});

/**
 * Emails a table's claim link to its buyer (outbox → worker): once per table when the order is
 * paid, again when the buyer asks for it (resend) or the host sends a naming reminder. The token
 * is derived from the table id here; events never carry it.
 */
export function tableNamingMailer(deps: { notifier: Notifier; appOrigin: string }) {
  return defineSubscriber({
    name: 'orders.table-naming-mailer',
    events: ['order.paid@1', 'table.naming_link_requested@1'],
    handle: async (tx, event) => {
      const paid = event.type === 'order.paid';
      const p = paid
        ? { ...PaidPayload.parse(event.payload), kind: 'paid' as const }
        : LinkPayload.parse(event.payload);
      const units =
        'orderId' in p
          ? await tableUnitsTx(tx, { orderId: p.orderId })
          : [await tableUnitTx(tx, p.tableUnitId)];
      if (units.length === 0) return;
      const ctx = createCtx({
        orgId: p.orgId,
        actor: { type: 'system', name: 'orders.table-naming-mailer' },
      });
      const tables = await hostedTablesTx(tx, units);
      for (const unit of units) {
        const table = tables.find((t) => t.id === unit.id);
        const [order] = await tx.select().from(orders).where(eq(orders.id, unit.orderId));
        const ev = await findEventTx(tx, unit.eventId);
        if (!table || !order || !ev) continue;
        // The first email counts as a send here; resends and reminders were counted by their command.
        const n = paid
          ? await recordTableLinkSentTx(tx, ctx, unit.id, 'send')
          : unit.linkSends + unit.reminders;
        await deps.notifier.enqueue(tx, {
          kind: 'orders.table-naming',
          to: { email: order.buyerEmail, name: order.buyerName, locale: order.locale, timeZone: ev.timezone },
          params: {
            url: `${deps.appOrigin}${tableNamingPath(unit.id)}`,
            name: order.buyerName,
            eventName: ev.name,
            tableName: table.typeName,
            size: table.size,
            missing: table.missing,
            reminder: p.kind === 'reminder' ? 1 : 0,
          },
          dedupeKey: `table-naming:${unit.id}:${p.kind}:${n}`,
          orderId: order.id,
          eventId: unit.eventId,
        });
      }
    },
  });
}
