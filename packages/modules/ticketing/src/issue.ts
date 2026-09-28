import { cancelAttendeesTx, createAttendeesTx, reassignAttendeeTx } from '@yayatoh/attendees';
import { upsertContactTx } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import type { Ctx } from '@yayatoh/kernel';
import { DomainError, requireOrg, uuidv7 } from '@yayatoh/kernel';
import { keyVault, tenantQuery } from '@yayatoh/platform';
import {
  CODE_PREFIX,
  generateKeyPair,
  randomShortCode,
  signStatement,
  signTicketCode,
  verifyTicketCode,
} from '@yayatoh/ticket-crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { returnSoldTx } from './inventory.ts';
import { signingKeys, TICKET_STATUSES, ticketBarcodes, tickets, ticketTypes } from './schema.ts';

export interface IssueRequest {
  readonly orderId: string;
  readonly eventId: string;
  readonly items: readonly {
    readonly orderItemId: string;
    readonly ticketTypeId: string;
    readonly quantity: number;
  }[];
  readonly holder: { readonly name: string; readonly email: string };
  /** Multi-date events (M1.4b): the date every ticket of this request admits. */
  readonly occurrenceId?: string | null;
}

export interface IssuedTicket {
  readonly id: string;
  readonly ticketTypeId: string;
  readonly serial: number;
  readonly shortCode: string;
  readonly code: string;
}

/** The org's active signing key, creating the first one on demand. */
async function activeKey(tx: TenantTx, orgId: string): Promise<{ kid: number; privateKey: Uint8Array }> {
  // Serialize key creation per org.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ticketing.signing_key:' || ${orgId}))`);
  const [k] = await tx
    .select()
    .from(signingKeys)
    .where(eq(signingKeys.active, true))
    .orderBy(desc(signingKeys.kid))
    .limit(1);
  if (k) return { kid: k.kid, privateKey: await keyVault().decrypt(orgId, k.privateKeyCiphertext) };
  const pair = await generateKeyPair();
  const [created] = await tx
    .insert(signingKeys)
    .values({
      orgId,
      kid: 1,
      publicKey: Buffer.from(pair.publicKey).toString('base64'),
      privateKeyCiphertext: await keyVault().encrypt(orgId, pair.privateKey),
    })
    .returning();
  if (!created) throw new DomainError('internal');
  return { kid: created.kid, privateKey: pair.privateKey };
}

/** Insert with a fresh short code, retrying the (rare) per-org short-code collision. */
async function insertTicket(tx: TenantTx, values: Omit<typeof tickets.$inferInsert, 'shortCode'>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const [t] = await tx
      .insert(tickets)
      .values({ ...values, shortCode: randomShortCode() })
      .onConflictDoNothing({ target: [tickets.orgId, tickets.shortCode] })
      .returning();
    if (t) return t;
  }
  throw new DomainError('internal', 'Could not allocate a ticket short code');
}

/**
 * Issue tickets for a paid order inside the caller's transaction: per-event serials, a short
 * code, and an Ed25519-signed yy1 barcode each. A second issue for the same order is refused.
 */
export async function issueTicketsTx(tx: TenantTx, ctx: Ctx, req: IssueRequest): Promise<IssuedTicket[]> {
  const orgId = requireOrg(ctx);
  const existing = await tx
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.orderId, req.orderId))
    .limit(1);
  if (existing.length) throw new DomainError('conflict', 'Tickets already issued for this order');
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ticketing.serial:' || ${req.eventId}))`);
  const [{ max } = { max: 0 }] = await tx
    .select({ max: sql<number>`coalesce(max(${tickets.serial}), 0)::int` })
    .from(tickets)
    .where(and(eq(tickets.eventId, req.eventId)));
  const key = await activeKey(tx, orgId);
  // The holder is an org contact; each ticket gets its own attendee (roadmap §4.4).
  const contact = await upsertContactTx(tx, ctx, {
    email: req.holder.email,
    name: req.holder.name,
    source: 'ticket',
  });
  const units = req.items.flatMap((item) =>
    Array.from({ length: item.quantity }, () => ({ ...item, id: uuidv7() })),
  );
  const attendeeRows = await createAttendeesTx(
    tx,
    ctx,
    units.map((u) => ({
      eventId: req.eventId,
      contactId: contact.id,
      source: 'ticket' as const,
      ticketId: u.id,
      name: req.holder.name,
      email: req.holder.email,
    })),
  );
  const attendeeFor = new Map(attendeeRows.map((a) => [a.ticketId, a.id]));
  let serial = max;
  const out: IssuedTicket[] = [];
  for (const unit of units) {
    serial += 1;
    const t = await insertTicket(tx, {
      id: unit.id,
      orgId,
      eventId: req.eventId,
      ticketTypeId: unit.ticketTypeId,
      orderId: req.orderId,
      orderItemId: unit.orderItemId,
      serial,
      holderName: req.holder.name,
      holderEmail: req.holder.email,
      attendeeId: attendeeFor.get(unit.id) ?? null,
      occurrenceId: req.occurrenceId ?? null,
    });
    const code = await signTicketCode({ kid: key.kid, ticketId: t.id, rev: t.rev }, key.privateKey);
    await tx
      .insert(ticketBarcodes)
      .values({ orgId, ticketId: t.id, format: 'yy1', payload: code, rev: t.rev });
    out.push({ id: t.id, ticketTypeId: t.ticketTypeId, serial, shortCode: t.shortCode, code });
  }
  return out;
}

/** Tickets of an order with their active barcode (for the buyer's order page). */
export async function ticketsForOrderTx(tx: TenantTx, orderId: string) {
  return tx
    .select({
      id: tickets.id,
      ticketTypeId: tickets.ticketTypeId,
      orderItemId: tickets.orderItemId,
      seatLabel: tickets.seatLabel,
      occurrenceId: tickets.occurrenceId,
      serial: tickets.serial,
      shortCode: tickets.shortCode,
      status: tickets.status,
      holderName: tickets.holderName,
      holderEmail: tickets.holderEmail,
      code: ticketBarcodes.payload,
    })
    .from(tickets)
    .innerJoin(
      ticketBarcodes,
      and(
        eq(ticketBarcodes.ticketId, tickets.id),
        // The signed yy1 code: a migrated ticket also keeps its legacy QR payload (scan-only).
        eq(ticketBarcodes.format, 'yy1'),
        eq(ticketBarcodes.active, true),
        eq(ticketBarcodes.rev, tickets.rev),
      ),
    )
    .where(eq(tickets.orderId, orderId))
    .orderBy(tickets.serial);
}

/**
 * Sign a small statement for offline scanners with the org's active ticket key (the checkpoint
 * scope in a manifest, M1.9d). Scanners verify it with the manifest's public keys.
 */
export async function signForScannersTx(
  tx: TenantTx,
  orgId: string,
  tag: string,
  message: string,
): Promise<string> {
  const key = await activeKey(tx, orgId);
  return signStatement(tag, message, key.kid, key.privateKey);
}

/** Public keys for scanners of this org (manifest header, M1.9). */
export async function publicKeysTx(tx: TenantTx): Promise<Map<number, Uint8Array>> {
  const rows = await tx.select({ kid: signingKeys.kid, publicKey: signingKeys.publicKey }).from(signingKeys);
  return new Map(rows.map((r) => [r.kid, new Uint8Array(Buffer.from(r.publicKey, 'base64'))]));
}

/** Ticket summaries for organizer views (the attendee list shows the pass and the short code). */
export const ticketSummariesQuery = tenantQuery({
  name: 'ticketing.ticketSummaries',
  input: z.object({ ticketIds: z.array(z.uuid()).max(500) }),
  output: z.array(
    z.object({
      id: z.uuid(),
      ticketTypeName: z.string(),
      serial: z.int(),
      shortCode: z.string(),
      status: z.enum(TICKET_STATUSES),
      occurrenceId: z.uuid().nullable(),
    }),
  ),
  entitlement: 'ticketing',
  permission: 'events:read',
  handler: ({ input, tx }) => ticketSummariesTx(tx, input.ticketIds),
});

/** Type name, serial, short code and status for tickets (lists and exports). */
export async function ticketSummariesTx(tx: TenantTx, ticketIds: readonly string[]) {
  if (ticketIds.length === 0) return [];
  const rows = await tx
    .select({
      id: tickets.id,
      ticketTypeName: ticketTypes.name,
      serial: tickets.serial,
      shortCode: tickets.shortCode,
      status: tickets.status,
      /** The date the ticket is for (multi-date events; M1.7g seats resolve per date). */
      occurrenceId: tickets.occurrenceId,
    })
    .from(tickets)
    .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
    .where(inArray(tickets.id, [...ticketIds]));
  return rows.map((r) => ({ ...r, status: r.status as (typeof TICKET_STATUSES)[number] }));
}

/**
 * Tickets a typed or scanned code points at (the command palette): a short code, or a yy1 code
 * that verifies with this org's keys. Anything else finds nothing.
 */
export const findTicketsByCodeQuery = tenantQuery({
  name: 'ticketing.findByCode',
  input: z.object({ code: z.string().trim().min(1).max(400) }),
  output: z.array(
    z.object({ id: z.uuid(), eventId: z.uuid(), shortCode: z.string(), holderName: z.string() }),
  ),
  entitlement: 'ticketing',
  permission: 'attendees:read',
  handler: async ({ input, tx }) => {
    const code = input.code.toUpperCase();
    let where: ReturnType<typeof eq> | null = null;
    if (code.startsWith(CODE_PREFIX)) {
      const v = await verifyTicketCode(code, await publicKeysTx(tx));
      if (v.ok) where = eq(tickets.id, v.ticketId);
    } else if (/^[2-9A-HJKMNP-TV-Z]{8}$/.test(code)) {
      where = eq(tickets.shortCode, code);
    }
    if (!where) return [];
    return tx
      .select({
        id: tickets.id,
        eventId: tickets.eventId,
        shortCode: tickets.shortCode,
        holderName: tickets.holderName,
      })
      .from(tickets)
      .where(where)
      .limit(5);
  },
});

export interface ScannableTicket {
  readonly id: string;
  readonly eventId: string;
  readonly status: (typeof TICKET_STATUSES)[number];
  readonly rev: number;
  readonly serial: number;
  readonly ticketTypeId: string;
  readonly shortCode: string;
  readonly holderName: string;
  readonly typeName: string;
  readonly accessDates: readonly { readonly date: string; readonly name: string }[];
  /** Multi-date events: the date this ticket admits, or null (every date). */
  readonly occurrenceId: string | null;
}

/** A ticket for the check-in engine, by id (from a verified code) or by its short code. */
export async function ticketForScanTx(
  tx: TenantTx,
  by: { readonly id: string } | { readonly shortCode: string },
): Promise<ScannableTicket | null> {
  const [row] = await tx
    .select({
      id: tickets.id,
      eventId: tickets.eventId,
      status: tickets.status,
      rev: tickets.rev,
      serial: tickets.serial,
      ticketTypeId: tickets.ticketTypeId,
      shortCode: tickets.shortCode,
      holderName: tickets.holderName,
      typeName: ticketTypes.name,
      accessDates: ticketTypes.accessDates,
      occurrenceId: tickets.occurrenceId,
    })
    .from(tickets)
    .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
    .where('id' in by ? eq(tickets.id, by.id) : eq(tickets.shortCode, by.shortCode.trim().toUpperCase()));
  return row ? { ...row, status: row.status as ScannableTicket['status'] } : null;
}

/**
 * Legacy QR codes (roadmap §7.5): the old apps encoded the booking's `order_number`, raw or inside a
 * JSON object. Returns the payload to look up, or null when the text cannot be one.
 */
export function legacyQrPayload(raw: string): string | null {
  const text = raw.trim();
  if (text.startsWith('{')) {
    try {
      const v = (JSON.parse(text) as Record<string, unknown>).order_number;
      return typeof v === 'string' || typeof v === 'number' ? legacyQrPayload(String(v)) : null;
    } catch {
      return null;
    }
  }
  return /^[0-9A-Za-z_-]{6,64}$/.test(text) ? text : null;
}

/** The ticket a migrated legacy QR payload still admits (its active `legacy_eventmie` barcode). */
export async function ticketForLegacyCodeTx(tx: TenantTx, raw: string): Promise<ScannableTicket | null> {
  const payload = legacyQrPayload(raw);
  if (!payload) return null;
  const [b] = await tx
    .select({ ticketId: ticketBarcodes.ticketId })
    .from(ticketBarcodes)
    .where(
      and(
        eq(ticketBarcodes.format, 'legacy_eventmie'),
        eq(ticketBarcodes.payload, payload),
        eq(ticketBarcodes.active, true),
      ),
    );
  return b ? ticketForScanTx(tx, { id: b.ticketId }) : null;
}

/** Ids of an event's ticket types (checkpoint zones list the ones allowed in). */
export async function eventTicketTypeIdsTx(tx: TenantTx, eventId: string): Promise<Set<string>> {
  const rows = await tx
    .select({ id: ticketTypes.id })
    .from(ticketTypes)
    .where(eq(ticketTypes.eventId, eventId));
  return new Set(rows.map((r) => r.id));
}

/**
 * Hand a ticket to a new holder: rev + 1 with a freshly signed code (every older code for it
 * now scans as invalid) and a new short code (the old printed one stops working too); the
 * holder fields and the ticket's attendee move to the new person.
 */
export async function reissueTicketTx(
  tx: TenantTx,
  ctx: Ctx,
  ticketId: string,
  holder: { name: string; email: string },
): Promise<{ id: string; rev: number; shortCode: string; code: string }> {
  const orgId = requireOrg(ctx);
  const [t] = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).for('update');
  if (!t) throw new DomainError('not_found', 'Ticket not found');
  if (t.status !== 'active') throw new DomainError('invalid_state', 'This ticket is no longer valid');
  const rev = t.rev + 1;
  const key = await activeKey(tx, orgId);
  const code = await signTicketCode({ kid: key.kid, ticketId: t.id, rev }, key.privateKey);
  await tx
    .update(ticketBarcodes)
    .set({ active: false, updatedAt: ctx.now })
    .where(and(eq(ticketBarcodes.ticketId, t.id), eq(ticketBarcodes.active, true)));
  await tx.insert(ticketBarcodes).values({ orgId, ticketId: t.id, format: 'yy1', payload: code, rev });
  // The short code printed under the old QR must stop working too: a new one goes with the new rev.
  let shortCode: string | null = null;
  for (let attempt = 0; attempt < 5 && !shortCode; attempt++) {
    const candidate = randomShortCode();
    const [taken] = await tx.select({ id: tickets.id }).from(tickets).where(eq(tickets.shortCode, candidate));
    if (!taken) shortCode = candidate;
  }
  if (!shortCode) throw new DomainError('internal', 'Could not allocate a ticket short code');
  await tx
    .update(tickets)
    .set({ rev, shortCode, holderName: holder.name, holderEmail: holder.email, updatedAt: ctx.now })
    .where(eq(tickets.id, t.id));
  const contact = await upsertContactTx(tx, ctx, {
    email: holder.email,
    name: holder.name,
    source: 'ticket',
  });
  if (t.attendeeId)
    await reassignAttendeeTx(tx, ctx, t.attendeeId, {
      contactId: contact.id,
      name: holder.name,
      email: holder.email,
    });
  return { id: t.id, rev, shortCode, code };
}

/** Tickets issued (and not void) for an event: the check-in progress denominator. */
export async function activeTicketCountTx(tx: TenantTx, eventId: string): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(tickets)
    .where(and(eq(tickets.eventId, eventId), eq(tickets.status, 'active')));
  return r?.n ?? 0;
}

export interface ManifestTicket {
  readonly id: string;
  readonly shortCode: string;
  readonly rev: number;
  readonly status: (typeof TICKET_STATUSES)[number];
  readonly ticketTypeId: string;
  readonly typeName: string;
  readonly accessDates: readonly { readonly date: string; readonly name: string }[];
  readonly occurrenceId: string | null;
  readonly holderName: string;
  readonly holderEmail: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Active legacy QR payloads of a migrated ticket (M2.2c). */
  readonly legacyCodes: readonly string[];
}

/**
 * One page of an event's tickets for scanner manifests, in (updated_at, id) order after the
 * cursor. Voided and reissued tickets come back with their new status/rev when they change.
 */
export async function manifestTicketsTx(
  tx: TenantTx,
  eventId: string,
  after: { readonly updatedAt: Date; readonly id: string } | null,
  limit: number,
): Promise<ManifestTicket[]> {
  const rows = await tx
    .select({
      id: tickets.id,
      shortCode: tickets.shortCode,
      rev: tickets.rev,
      status: tickets.status,
      ticketTypeId: tickets.ticketTypeId,
      typeName: ticketTypes.name,
      accessDates: ticketTypes.accessDates,
      occurrenceId: tickets.occurrenceId,
      holderName: tickets.holderName,
      holderEmail: tickets.holderEmail,
      createdAt: tickets.createdAt,
      updatedAt: tickets.updatedAt,
      legacyCodes: sql<
        string[]
      >`coalesce((select array_agg(b.payload order by b.payload) from ${ticketBarcodes} b
        where b.org_id = ${tickets.orgId} and b.ticket_id = ${tickets.id} and b.format = 'legacy_eventmie' and b.active), '{}')`,
    })
    .from(tickets)
    .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
    .where(
      and(
        eq(tickets.eventId, eventId),
        after
          ? // Millisecond precision: cursors travel as JS dates, Postgres keeps microseconds.
            sql`(date_trunc('milliseconds', ${tickets.updatedAt}), ${tickets.id}) > (${after.updatedAt.toISOString()}::timestamptz, ${after.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(sql`date_trunc('milliseconds', ${tickets.updatedAt})`, tickets.id)
    .limit(limit);
  return rows.map((r) => ({ ...r, status: r.status as ManifestTicket['status'] }));
}

/**
 * Void active tickets of one order (refund or cancellation): scanners reject them from the next
 * manifest, their attendees are cancelled and the places return to sale. Returns what was voided;
 * tickets already void or of another order are skipped.
 */
export async function voidTicketsTx(
  tx: TenantTx,
  ctx: Ctx,
  req: { orderId: string; ticketIds: readonly string[]; reason: string },
): Promise<{ id: string; ticketTypeId: string; orderItemId: string; attendeeId: string | null }[]> {
  if (req.ticketIds.length === 0) return [];
  const rows = await tx
    .update(tickets)
    .set({ status: 'void', voidReason: req.reason, updatedAt: ctx.now })
    .where(
      and(
        eq(tickets.orderId, req.orderId),
        eq(tickets.status, 'active'),
        inArray(tickets.id, [...req.ticketIds]),
      ),
    )
    .returning({
      id: tickets.id,
      ticketTypeId: tickets.ticketTypeId,
      orderItemId: tickets.orderItemId,
      attendeeId: tickets.attendeeId,
    });
  await cancelAttendeesTx(
    tx,
    ctx,
    rows.flatMap((r) => (r.attendeeId ? [r.attendeeId] : [])),
  );
  const perType = new Map<string, number>();
  for (const r of rows) perType.set(r.ticketTypeId, (perType.get(r.ticketTypeId) ?? 0) + 1);
  await returnSoldTx(
    tx,
    [...perType].map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity })),
  );
  return rows.map(({ id, ticketTypeId, orderItemId, attendeeId }) => ({
    id,
    ticketTypeId,
    orderItemId,
    attendeeId,
  }));
}

/** Seated checkout: record each ticket's seat (it is printed on the ticket and the PDF). */
export async function assignTicketSeatsTx(
  tx: TenantTx,
  ctx: Ctx,
  seats: readonly { ticketId: string; seatLabel: string }[],
): Promise<void> {
  for (const s of seats)
    await tx
      .update(tickets)
      .set({ seatLabel: s.seatLabel, updatedAt: ctx.now })
      .where(eq(tickets.id, s.ticketId));
}
