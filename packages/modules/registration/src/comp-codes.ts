import { randomInt } from 'node:crypto';
import type { TenantTx } from '@yayatoh/db';
import { createCtx, type Ctx, DomainError } from '@yayatoh/kernel';
import { defineSubscriber, type Subscriber, tenantQuery } from '@yayatoh/platform';
import {
  activeGrantOfSponsorTx,
  attachCompCodeTx,
  grantCompStateTx,
  sponsorPrincipalTx,
} from '@yayatoh/program';
import {
  CreatePromoCodeInput,
  createPromoCodeCommand,
  listPromoCodesQuery,
  setPromoCodeActiveCommand,
} from '@yayatoh/ticketing';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { admissionItems, typeItems } from './schema.ts';

/**
 * M5.4b comp registrations: a sponsor package's `compRegistrations` become one registration code
 * for the sponsor's guests — a ticketing promo code of 100 % off, usable that many times, limited
 * to the event's admission passes (add-ons are still paid). Guests type it in the registration
 * page's code box. Made when the package activates (`program.sponsor_package.activated@1`) and
 * switched off when it is cancelled (`…cancelled@1`); program keeps the code on the grant.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const compCode = () =>
  `COMP-${Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`;
export const isCompCode = (code: string) => /^COMP-[A-Z0-9]{8}$/.test(code.trim().toUpperCase());

const Payload = z.object({
  grantId: z.uuid(),
  eventId: z.uuid(),
  compRegistrations: z.int(),
  compPromoCodeId: z.uuid().nullable().optional(),
});

/** The event's admission passes (every live admission cell's ticket type). */
async function admissionPassesTx(tx: TenantTx, eventId: string): Promise<string[]> {
  const rows = await tx
    .select({ ticketTypeId: typeItems.ticketTypeId })
    .from(typeItems)
    .innerJoin(admissionItems, eq(admissionItems.id, typeItems.admissionItemId))
    .where(
      and(eq(typeItems.eventId, eventId), eq(admissionItems.kind, 'admission'), isNull(typeItems.archivedAt)),
    );
  return [...new Set(rows.map((r) => r.ticketTypeId))];
}

type Args = { input: unknown; ctx: Ctx; tx: TenantTx };
const run = <T>(handler: unknown, args: Args) =>
  (handler as (a: Args & { emit: () => void; requireStepUp: () => void }) => Promise<T>)({
    ...args,
    emit: () => undefined,
    requireStepUp: () => undefined,
  });

/** Make (once) the comp code of an active grant. Exported for the subscriber and tests. */
export async function makeCompCodeTx(tx: TenantTx, ctx: Ctx, grantId: string): Promise<string | null> {
  const g = await grantCompStateTx(tx, grantId);
  if (!g || g.status !== 'active' || g.compCode || g.compRegistrations === 0) return g?.compCode ?? null;
  const passes = await admissionPassesTx(tx, g.eventId);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = compCode();
    try {
      const promo = await run<{ id: string; code: string }>(createPromoCodeCommand.handler, {
        input: CreatePromoCodeInput.parse({
          eventId: g.eventId,
          code,
          kind: 'percent',
          percentBps: 10_000,
          ticketTypeIds: passes,
          maxRedemptions: g.compRegistrations,
        }),
        ctx,
        tx,
      });
      await attachCompCodeTx(tx, grantId, { promoCodeId: promo.id, code: promo.code });
      return promo.code;
    } catch (err) {
      // A code collision (one in 32^8) tries another; anything else is a real failure.
      if (!(err instanceof DomainError && err.code === 'conflict')) throw err;
    }
  }
  throw new DomainError('internal', 'Could not make a comp code');
}

export function sponsorCompCodes(): Subscriber {
  return defineSubscriber({
    name: 'registration.sponsor-comp-codes',
    events: ['program.sponsor_package.activated@1', 'program.sponsor_package.cancelled@1'],
    handle: async (tx, event) => {
      const ctx = createCtx({
        orgId: event.orgId,
        actor: { type: 'system', name: 'registration.sponsor-comp-codes' },
      });
      const p = Payload.parse(event.payload);
      if (event.type === 'program.sponsor_package.activated') {
        await makeCompCodeTx(tx, ctx, p.grantId);
        return;
      }
      // Cancelled: close its code (the grant row still names it, even if made after the event).
      const g = await grantCompStateTx(tx, p.grantId);
      const promoId = g?.compPromoCodeId ?? p.compPromoCodeId ?? null;
      if (promoId)
        await run(setPromoCodeActiveCommand.handler, {
          input: { promoCodeId: promoId, active: false },
          ctx,
          tx,
        });
    },
  });
}

/** How many of the signed-in sponsor's comp registrations are used (portal). */
export const sponsorCompUsageQuery = tenantQuery({
  name: 'registration.sponsorCompUsage',
  input: z.object({}),
  output: z.object({ code: z.string().nullable(), allowance: z.int(), used: z.int() }),
  entitlement: 'sponsors',
  permission: 'portal:sponsor_contact',
  handler: async ({ ctx, tx }) => {
    const { principal } = await sponsorPrincipalTx(tx, ctx);
    const g = await activeGrantOfSponsorTx(tx, principal.subjectId);
    if (!g) return { code: null, allowance: 0, used: 0 };
    const codes = await run<{ id: string; redeemedCount: number }[]>(listPromoCodesQuery.handler, {
      input: { eventId: principal.eventId },
      ctx,
      tx,
    });
    const promo = codes.find((c) => c.id === g.compPromoCodeId);
    return { code: g.compCode, allowance: g.compRegistrations, used: promo?.redeemedCount ?? 0 };
  },
});
