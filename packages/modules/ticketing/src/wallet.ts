import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, requireOrg } from '@yayatoh/kernel';
import { defineSubscriber, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { tickets, walletPasses } from './schema.ts';

/**
 * The wallet pass provider port (M3.10c). Apple Wallet and Google Wallet need the owner's
 * developer accounts (owner inbox), so dev and CI use the fake adapter, which records what it
 * was told. A push is idempotent per serial and state.
 */
export interface WalletPassProvider {
  readonly name: 'fake' | 'apple' | 'google';
  /** Issue or update the pass for a ticket's current code (the holder's device refreshes it). */
  upsertPass(input: {
    serial: string;
    ticketId: string;
    rev: number;
    holderName: string;
    eventName: string;
  }): Promise<{ ok: boolean }>;
  /** Void a pass (its barcode no longer admits; the device shows it as expired). */
  voidPass(input: { serial: string }): Promise<{ ok: boolean }>;
  /**
   * M7.2b: where the holder adds the pass to their wallet app (an Apple `.pkpass` download, a
   * Google "Save to Wallet" link). Null when the provider cannot make one for that wallet.
   */
  passLink(input: { platform: WalletPlatform; serial: string }): Promise<{ url: string } | null>;
}

export const WALLET_PLATFORMS = ['apple', 'google'] as const;
export type WalletPlatform = (typeof WALLET_PLATFORMS)[number];

export interface FakeWalletPush {
  readonly op: 'upsert' | 'void' | 'link';
  readonly serial: string;
  readonly holderName?: string;
}

/** The fake adapter: keeps the pushes in memory (tests read them). */
export function fakeWalletPassProvider(log: FakeWalletPush[] = []): WalletPassProvider & {
  readonly pushes: FakeWalletPush[];
} {
  return {
    name: 'fake',
    pushes: log,
    async upsertPass(input) {
      log.push({ op: 'upsert', serial: input.serial, holderName: input.holderName });
      return { ok: true };
    },
    async voidPass(input) {
      log.push({ op: 'void', serial: input.serial });
      return { ok: true };
    },
    async passLink(input) {
      log.push({ op: 'link', serial: input.serial });
      return { url: `https://wallet.fake.yayatoh.test/${input.platform}/${input.serial}` };
    },
  };
}

export const walletSerial = (ticketId: string, rev: number) => `yy-${ticketId}-${rev}`;

/**
 * A ticket changed hands (M3.10c transfer claim): every live pass of it is voided and a pass for
 * the new holder and code revision is recorded, in the claim's transaction. The provider hears of
 * both after commit (`walletPassSync`).
 */
export async function rotateWalletPassTx(
  tx: TenantTx,
  ctx: Ctx,
  ticket: { id: string; rev: number; holderName: string },
): Promise<void> {
  await tx
    .update(walletPasses)
    .set({ status: 'voided', voidedAt: ctx.now, pushedAt: null, updatedAt: ctx.now })
    .where(and(eq(walletPasses.ticketId, ticket.id), eq(walletPasses.status, 'active')));
  await tx
    .insert(walletPasses)
    .values({
      orgId: requireOrg(ctx),
      ticketId: ticket.id,
      rev: ticket.rev,
      serial: walletSerial(ticket.id, ticket.rev),
      holderName: ticket.holderName,
    })
    .onConflictDoNothing();
}

/** What the provider needs to issue the pass of a ticket a person holds (M7.2b). */
export interface HolderWalletPass {
  readonly id: string;
  readonly serial: string;
  readonly ticketId: string;
  readonly rev: number;
  readonly holderName: string;
  readonly eventName: string;
  /** Whether the provider has already been told about this pass. */
  readonly pushed: boolean;
}

/**
 * The live wallet pass of a ticket the person holds, made on first use. A ticket whose code was
 * reissued (a transfer, a re-send with a new code) gets a new pass for its current revision and
 * the old one is voided, as in a transfer claim. Null when the ticket is not an active ticket held
 * by this address.
 */
export async function holderWalletPassTx(
  tx: TenantTx,
  ctx: Ctx,
  emailNorm: string,
  ticketId: string,
): Promise<HolderWalletPass | null> {
  const [t] = await tx
    .select({
      id: tickets.id,
      rev: tickets.rev,
      holderName: tickets.holderName,
      eventId: tickets.eventId,
    })
    .from(tickets)
    .where(
      and(
        eq(tickets.id, ticketId),
        eq(tickets.status, 'active'),
        eq(sql`lower(${tickets.holderEmail})`, emailNorm),
      ),
    )
    .for('update');
  if (!t) return null;
  const find = () =>
    tx
      .select()
      .from(walletPasses)
      .where(and(eq(walletPasses.ticketId, t.id), eq(walletPasses.status, 'active')));
  let [pass] = await find();
  if (!pass || pass.rev !== t.rev) {
    await rotateWalletPassTx(tx, ctx, { id: t.id, rev: t.rev, holderName: t.holderName });
    [pass] = await find();
  }
  if (!pass) return null;
  const ev = await findEventTx(tx, t.eventId);
  return {
    id: pass.id,
    serial: pass.serial,
    ticketId: t.id,
    rev: pass.rev,
    holderName: pass.holderName,
    eventName: ev?.name ?? '',
    pushed: pass.pushedAt !== null,
  };
}

/** The provider was told about these passes. */
export async function markWalletPassesPushedTx(tx: TenantTx, ids: readonly string[], now: Date) {
  if (ids.length === 0) return;
  await tx
    .update(walletPasses)
    .set({ pushedAt: now, updatedAt: now })
    .where(inArray(walletPasses.id, [...ids]));
}

const TransferredPayload = z.object({ orgId: z.uuid(), ticketId: z.uuid(), eventId: z.uuid() });

/** Tells the pass provider about a transfer: void the old holder's passes, issue the new one. */
export function walletPassSync(deps: { provider: WalletPassProvider }) {
  return defineSubscriber({
    name: 'ticketing.wallet-pass-sync',
    events: ['ticket.transferred@1'],
    handle: async (tx, event) => {
      const p = TransferredPayload.parse(event.payload);
      const ev = await findEventTx(tx, p.eventId);
      const due = await tx
        .select()
        .from(walletPasses)
        .where(and(eq(walletPasses.ticketId, p.ticketId), isNull(walletPasses.pushedAt)))
        .orderBy(asc(walletPasses.rev));
      const pushed: string[] = [];
      for (const pass of due) {
        const r =
          pass.status === 'voided'
            ? await deps.provider.voidPass({ serial: pass.serial })
            : await deps.provider.upsertPass({
                serial: pass.serial,
                ticketId: pass.ticketId,
                rev: pass.rev,
                holderName: pass.holderName,
                eventName: ev?.name ?? '',
              });
        if (r.ok) pushed.push(pass.id);
      }
      if (pushed.length)
        await tx.update(walletPasses).set({ pushedAt: new Date() }).where(inArray(walletPasses.id, pushed));
    },
  });
}

export const WalletPassDto = z.object({
  ticketId: z.uuid(),
  rev: z.int(),
  status: z.enum(['active', 'voided']),
  pushed: z.boolean(),
});

/** The wallet passes of an order's tickets (order page: which pass is live, and whether it was pushed). */
export const orderWalletPassesQuery = tenantQuery({
  name: 'ticketing.orderWalletPasses',
  input: z.object({ orderId: z.uuid() }),
  output: z.array(WalletPassDto),
  entitlement: 'ticketing',
  permission: 'orders:read',
  handler: async ({ input, tx }) =>
    (
      await tx
        .select({ p: walletPasses })
        .from(walletPasses)
        .innerJoin(tickets, eq(tickets.id, walletPasses.ticketId))
        .where(eq(tickets.orderId, input.orderId))
        .orderBy(asc(walletPasses.createdAt))
        .limit(500)
    ).map(({ p }) => ({
      ticketId: p.ticketId,
      rev: p.rev,
      status: p.status as 'active' | 'voided',
      pushed: p.pushedAt !== null,
    })),
});
