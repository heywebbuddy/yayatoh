import type { TenantTx } from '@yayatoh/db';
import { ERASED_EMAIL, ERASED_NAME, tenantCommand } from '@yayatoh/platform';
import { and, inArray, lt, ne } from 'drizzle-orm';
import { z } from 'zod';
import { gifts } from './schema.ts';

/**
 * Days after which a gift that never got paid loses its donor: the same window as an abandoned
 * checkout (`privacy.retention` erases the buyer on the gift's order then, M1.14c).
 */
export const LAPSED_GIFT_DAYS = 30;

const DAY = 86_400_000;

/**
 * Erase the donor on failed and lapsed gifts started before `before`: name and email become the
 * erased placeholders; employer and the tribute go. Amounts, campaign and status stay (they never
 * counted toward any total). Paid gifts are untouched. Returns how many gifts were redacted.
 */
export async function redactLapsedGiftsTx(tx: TenantTx, before: Date, now: Date): Promise<number> {
  const rows = await tx
    .update(gifts)
    .set({
      donorName: ERASED_NAME,
      donorEmail: ERASED_EMAIL,
      employer: null,
      tributeKind: null,
      tributeName: null,
      tributeRecipient: null,
      tributeNote: null,
      updatedAt: now,
    })
    .where(
      and(
        inArray(gifts.status, ['failed', 'expired']),
        lt(gifts.createdAt, before),
        ne(gifts.donorEmail, ERASED_EMAIL),
      ),
    )
    .returning({ id: gifts.id });
  return rows.length;
}

/**
 * The donations part of the daily retention pass (the worker runs it per org as a system actor,
 * beside `privacy.retention`). Idempotent; audited with the count only.
 */
export const giftRetentionCommand = tenantCommand({
  name: 'donations.retention',
  category: 'delete',
  input: z.object({}),
  output: z.object({ lapsedGifts: z.int() }),
  entitlement: 'core',
  permission: 'platform:donations.retention',
  handler: async ({ ctx, tx }) => ({
    lapsedGifts: await redactLapsedGiftsTx(tx, new Date(ctx.now.getTime() - LAPSED_GIFT_DAYS * DAY), ctx.now),
  }),
  audit: (_input, r) => ({
    action: 'donations.retention',
    targetType: 'gift',
    targetId: null,
    data: { lapsedGifts: r?.lapsedGifts ?? 0 },
  }),
});
