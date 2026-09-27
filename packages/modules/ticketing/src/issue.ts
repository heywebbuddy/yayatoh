import type { TenantTx } from '@yayatoh/db';
import type { Ctx } from '@yayatoh/kernel';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { keyVault } from '@yayatoh/platform';
import { generateKeyPair, randomShortCode, signTicketCode } from '@yayatoh/ticket-crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { signingKeys, ticketBarcodes, tickets } from './schema.ts';

export interface IssueRequest {
  readonly orderId: string;
  readonly eventId: string;
  readonly items: readonly {
    readonly orderItemId: string;
    readonly ticketTypeId: string;
    readonly quantity: number;
  }[];
  readonly holder: { readonly name: string; readonly email: string };
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
  let serial = max;
  const out: IssuedTicket[] = [];
  for (const item of req.items) {
    for (let n = 0; n < item.quantity; n++) {
      serial += 1;
      const t = await insertTicket(tx, {
        orgId,
        eventId: req.eventId,
        ticketTypeId: item.ticketTypeId,
        orderId: req.orderId,
        orderItemId: item.orderItemId,
        serial,
        holderName: req.holder.name,
        holderEmail: req.holder.email,
      });
      const code = await signTicketCode({ kid: key.kid, ticketId: t.id, rev: t.rev }, key.privateKey);
      await tx
        .insert(ticketBarcodes)
        .values({ orgId, ticketId: t.id, format: 'yy1', payload: code, rev: t.rev });
      out.push({ id: t.id, ticketTypeId: t.ticketTypeId, serial, shortCode: t.shortCode, code });
    }
  }
  return out;
}

/** Tickets of an order with their active barcode (for the buyer's order page). */
export async function ticketsForOrderTx(tx: TenantTx, orderId: string) {
  return tx
    .select({
      id: tickets.id,
      ticketTypeId: tickets.ticketTypeId,
      serial: tickets.serial,
      shortCode: tickets.shortCode,
      status: tickets.status,
      holderName: tickets.holderName,
      code: ticketBarcodes.payload,
    })
    .from(tickets)
    .innerJoin(
      ticketBarcodes,
      and(
        eq(ticketBarcodes.ticketId, tickets.id),
        eq(ticketBarcodes.active, true),
        eq(ticketBarcodes.rev, tickets.rev),
      ),
    )
    .where(eq(tickets.orderId, orderId))
    .orderBy(tickets.serial);
}

/** Public keys for scanners of this org (manifest header, M1.9). */
export async function publicKeysTx(tx: TenantTx): Promise<Map<number, Uint8Array>> {
  const rows = await tx.select({ kid: signingKeys.kid, publicKey: signingKeys.publicKey }).from(signingKeys);
  return new Map(rows.map((r) => [r.kid, new Uint8Array(Buffer.from(r.publicKey, 'base64'))]));
}
