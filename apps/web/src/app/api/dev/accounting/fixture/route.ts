import type { TenantTx } from '@yayatoh/db';
import { addDays, dayIn } from '@yayatoh/integrations';
import { type Ctx, createCtx, executeCommand, uuidv7 } from '@yayatoh/kernel';
import { postJournalTx, postRefundTx, postSaleTx } from '@yayatoh/payments';
import { tenantCommand } from '@yayatoh/platform';
import { organizationDefaultsTx, resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';

/** `hh:00` on `day` in `timeZone`, as an instant. */
function wallTime(day: string, hh: number, timeZone: string): Date {
  const guess = new Date(`${day}T${String(hh).padStart(2, '0')}:00:00Z`);
  const local = new Date(guess.toLocaleString('en-US', { timeZone }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() - (local.getTime() - utc.getTime()));
}

/**
 * Books a fixture day (or a late refund on it) in the org's ledger with the real posting
 * functions, as of that day: what sales, refunds and a payout leave behind. Dev/CI only.
 */
const fixtureCommand = tenantCommand({
  name: 'dev.accountingFixture',
  input: z.object({ daysAgo: z.int().min(1).max(60), action: z.enum(['day', 'late_refund']) }),
  output: z.object({ day: z.string() }),
  entitlement: null,
  permission: 'platform:dev.accounting_fixture',
  handler: async ({ input, ctx, tx }) => {
    const orgId = ctx.orgId as string;
    const timeZone = (await organizationDefaultsTx(tx, orgId))?.timezone ?? 'UTC';
    const day = addDays(dayIn(ctx.now, timeZone), -input.daysAgo);
    const at = (hh: number): Ctx => ({ ...ctx, now: wallTime(day, hh, timeZone) });
    const eventId = uuidv7();
    const c = 'USD';
    const run = (hh: number, fn: (tx: TenantTx, ctx: Ctx) => Promise<unknown>) => fn(tx, at(hh));
    if (input.action === 'late_refund') {
      await run(16, (t, x) =>
        postRefundTx(t, x, {
          refundId: uuidv7(),
          orderId: uuidv7(),
          eventId,
          fundsFlow: 'organizer_mor',
          amountMinor: 1_500,
          feeRefundedMinor: 75,
          currency: c,
        }),
      );
      return { day };
    }
    const order = uuidv7();
    await run(9, (t, x) =>
      postSaleTx(t, x, {
        orderId: order,
        eventId,
        fundsFlow: 'platform_mor',
        totalMinor: 12_000,
        feeMinor: 600,
        currency: c,
      }),
    );
    await run(10, (t, x) =>
      postSaleTx(t, x, {
        orderId: uuidv7(),
        eventId,
        fundsFlow: 'organizer_mor',
        totalMinor: 8_000,
        feeMinor: 400,
        currency: c,
      }),
    );
    await run(11, (t, x) =>
      postRefundTx(t, x, {
        refundId: uuidv7(),
        orderId: order,
        eventId,
        fundsFlow: 'platform_mor',
        amountMinor: 2_000,
        feeRefundedMinor: 100,
        currency: c,
      }),
    );
    const settlement = uuidv7();
    await run(13, (t, x) =>
      postJournalTx(t, x, {
        key: `transfer:${settlement}`,
        kind: 'transfer',
        refType: 'settlement',
        refId: settlement,
        eventId,
        memo: { transferId: 'tr_dev_fixture' },
        postings: [
          { account: 'org:payable_releasable', amountMinor: 5_000, currency: c },
          { account: 'platform:stripe_cash', amountMinor: -5_000, currency: c },
        ],
      }),
    );
    return { day };
  },
  audit: (input, r) => ({
    action: 'dev.accounting_fixture',
    targetType: 'organization',
    targetId: null,
    data: { action: input.action, day: r.day },
  }),
});

/**
 * Dev/CI only (M6.5d): book an accounting fixture day `daysAgo` days back in an org's ledger
 * (`action=day`: two sales, a refund, a payout) or a late refund on it (`action=late_refund`),
 * so browser journeys can post a day and see it re-posted. 404 unless dev auth is on.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  const ctx = createCtx({ orgId: org.orgId, actor: { type: 'system', name: 'dev.accounting' } });
  const r = await executeCommand(
    fixtureCommand,
    {
      daysAgo: Number(form.get('daysAgo') ?? 3),
      action: form.get('action') === 'late_refund' ? 'late_refund' : 'day',
    },
    ctx,
    ports,
  );
  return NextResponse.json(r);
}
