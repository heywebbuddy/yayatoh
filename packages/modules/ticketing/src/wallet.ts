import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, requireOrg } from '@yayatoh/kernel';
import { defineSubscriber, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
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
}

export interface FakeWalletPush {
  readonly op: 'upsert' | 'void';
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
