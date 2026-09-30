import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand } from '@yayatoh/events';
import { type Ctx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  applyAccountEventCommand,
  closeDisputeTx,
  ledgerBalancesQuery,
  openDisputeTx,
  postOrganizerCollectedSaleTx,
  postRefundTx,
  postSaleTx,
  postTransferReversalTx,
  recordTransferCommand,
  releaseDueSettlementsCommand,
} from '@yayatoh/payments';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';

/**
 * Roadmap M1.6 acceptance: "ledger totals equal charges minus refunds, fees and transfers".
 * A seeded random life of an org — sales in both funds flows, organizer-collected sales, refunds
 * before and after payout, releases, transfers, transfer reversals, disputes won and lost — and
 * after every step the books must say:
 * - platform cash  = charges − refunds − transfers + reversals − open/lost disputes
 * - organizer's due = platform charges − fees − organizer shares refunded − transfers + reversals − disputes
 * - platform fees  = fees charged − fees refunded
 * - cash = organizer's due + platform fees, and every journal balances.
 */
let a: OrgFixture;
const events: { id: string; endsAt: Date }[] = [];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

beforeAll(async () => {
  ({ a } = await twoOrgs());
  for (const [i, end] of ['2027-01-15', '2027-02-15', '2027-03-15'].entries()) {
    const e = await executeCommand(
      createEventCommand,
      {
        name: `Identity ${i}`,
        timezone: 'UTC',
        startsAt: `${end}T18:00:00Z`,
        endsAt: `${end}T22:00:00Z`,
      },
      a.ctx(),
      ports,
    );
    events.push({ id: e.id, endsAt: e.endsAt });
  }
  // Payouts enabled, so released funds are transferred.
  // The fixture's payout account, enabled.
  const accountId = `fakeacct_${a.org.slug}`;
  await executeCommand(
    applyAccountEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_identity_${uuidv7()}`,
      type: 'account.updated',
      orgId: a.org.id,
      account: {
        accountId,
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        requirementsDue: [],
        country: 'US',
        defaultCurrency: 'usd',
      },
    },
    systemCtx(a.org.id),
    ports,
  );
});
afterAll(closePools);

const books = async () => {
  const bal = new Map(
    (await executeQuery(ledgerBalancesQuery, {}, systemCtx(a.org.id), ports))
      .filter((r) => r.currency === 'USD')
      .map((r) => [r.account, r.balanceMinor]),
  );
  const g = (k: string) => bal.get(k as never) ?? 0;
  return {
    cash: g('platform:stripe_cash'),
    due: -(g('org:payable_held') + g('org:payable_releasable') + g('org:reserve') + g('org:receivable')),
    fees: -(g('platform:platform_fee_deferred') + g('platform:platform_fee_revenue')),
  };
};

describe('ledger identity (M1.6e property test)', () => {
  it('over a seeded random life of sales, refunds, releases, transfers, reversals and disputes', async () => {
    const seed = 20260928;
    const next = rng(seed);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)] as T;
    const base = await books();
    const expected = { ...base };
    let now = new Date('2026-12-01T00:00:00Z');
    const ctx = (): Ctx => ({ ...systemCtx(a.org.id), now });
    const sales: {
      orderId: string;
      eventId: string;
      flow: 'platform_mor' | 'organizer_mor';
      left: number;
      feeLeft: number;
    }[] = [];
    const disputes: { providerDisputeId: string; amount: number }[] = [];
    const counts = new Map<string, number>();
    const did = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);

    for (let step = 0; step < 160; step++) {
      now = new Date(now.getTime() + Math.floor(next() * 3) * 86_400_000 + 3_600_000);
      const roll = next();
      if (roll < 0.35 || sales.length === 0) {
        const total = 500 + Math.floor(next() * 20_000);
        const fee = Math.floor(next() * Math.min(total, 1_500));
        const flow = next() < 0.7 ? 'platform_mor' : 'organizer_mor';
        const orderId = uuidv7();
        const eventId = pick(events).id;
        await withTenant(ctx(), (tx) =>
          postSaleTx(tx, ctx(), {
            orderId,
            eventId,
            fundsFlow: flow,
            totalMinor: total,
            feeMinor: fee,
            currency: 'USD',
          }),
        );
        sales.push({ orderId, eventId, flow, left: total, feeLeft: fee });
        if (flow === 'platform_mor') {
          expected.cash += total;
          expected.due += total - fee;
        } else expected.cash += fee;
        expected.fees += fee;
        did(`sale:${flow}`);
      } else if (roll < 0.42) {
        // Box office: the organizer holds the money; the fee becomes a receivable.
        const fee = 50 + Math.floor(next() * 400);
        await withTenant(ctx(), (tx) =>
          postOrganizerCollectedSaleTx(tx, ctx(), {
            orderId: uuidv7(),
            eventId: pick(events).id,
            totalMinor: fee * 10,
            feeMinor: fee,
            currency: 'USD',
          }),
        );
        expected.due -= fee;
        expected.fees += fee;
        did('organizer_collected');
      } else if (roll < 0.65) {
        const s = pick(sales.filter((x) => x.left > 0));
        if (!s) continue;
        const amount = 1 + Math.floor(next() * s.left);
        const feeBack =
          s.flow === 'organizer_mor'
            ? Math.min(amount, s.feeLeft)
            : Math.floor(next() * Math.min(amount, s.feeLeft + 1));
        const refundId = uuidv7();
        const { receivableMinor } = await withTenant(ctx(), (tx) =>
          postRefundTx(tx, ctx(), {
            refundId,
            orderId: s.orderId,
            eventId: s.eventId,
            fundsFlow: s.flow,
            amountMinor: amount,
            feeRefundedMinor: feeBack,
            currency: 'USD',
          }),
        );
        s.left -= amount;
        s.feeLeft -= feeBack;
        if (s.flow === 'platform_mor') {
          expected.cash -= amount;
          expected.due -= amount - feeBack;
        } else expected.cash -= feeBack;
        expected.fees -= feeBack;
        did(`refund:${s.flow}`);
        // Refunded after payout: an explicit reversal takes it back — or fails, leaving the receivable.
        if (receivableMinor > 0 && next() < 0.5) {
          await withTenant(ctx(), (tx) =>
            postTransferReversalTx(tx, ctx(), {
              refundId,
              orderId: s.orderId,
              eventId: s.eventId,
              amountMinor: receivableMinor,
              currency: 'USD',
              reversalId: `faketrr_${refundId}`,
            }),
          );
          expected.cash += receivableMinor;
          expected.due += receivableMinor;
          did('reversal');
        } else if (receivableMinor > 0) did('receivable');
      } else if (roll < 0.72) {
        const s = pick(sales.filter((x) => x.flow === 'platform_mor' && x.left > 0));
        if (!s) continue;
        const amount = 1 + Math.floor(next() * s.left);
        const providerDisputeId = `fakedp_${uuidv7()}`;
        await withTenant(ctx(), (tx) =>
          openDisputeTx(tx, ctx(), {
            orderId: s.orderId,
            eventId: s.eventId,
            fundsFlow: 'platform_mor',
            provider: 'fake',
            providerDisputeId,
            amountMinor: amount,
            currency: 'USD',
            reason: 'fraudulent',
            evidenceDueBy: null,
          }),
        );
        s.left -= amount;
        disputes.push({ providerDisputeId, amount });
        expected.cash -= amount;
        expected.due -= amount;
        did('dispute');
      } else if (roll < 0.78 && disputes.length) {
        const d = disputes.splice(Math.floor(next() * disputes.length), 1)[0];
        if (!d) continue;
        const outcome = next() < 0.5 ? 'won' : 'lost';
        await withTenant(ctx(), (tx) =>
          closeDisputeTx(tx, ctx(), { provider: 'fake', providerDisputeId: d.providerDisputeId, outcome }),
        );
        if (outcome === 'won') {
          expected.cash += d.amount;
          expected.due += d.amount;
        }
        did(`dispute_${outcome}`);
      } else {
        const { ready } = await executeCommand(releaseDueSettlementsCommand, {}, ctx(), ports);
        for (const r of ready) {
          const ok = next() < 0.85;
          await executeCommand(
            recordTransferCommand,
            {
              settlementId: r.settlementId,
              outcome: ok ? 'succeeded' : 'failed',
              transferId: `faketr_${r.settlementId}`,
            },
            ctx(),
            ports,
          );
          if (ok) {
            expected.cash -= r.amountMinor;
            expected.due -= r.amountMinor;
            did('transfer');
          }
        }
        did('release_run');
      }
      const got = await books();
      expect({ step, ...got }, `seed ${seed}, step ${step}`).toEqual({ step, ...expected });
      expect(got.cash).toBe(got.due + got.fees - (base.due + base.fees - base.cash));
    }
    const [sum] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ s: string; bad: number }>(sql`
        select coalesce(sum(amount_minor), 0)::text as s,
          (select count(*)::int from (select journal_id from payments.postings group by journal_id, currency having sum(amount_minor) <> 0) x) as bad
        from payments.postings`),
    );
    expect(sum).toEqual({ s: '0', bad: 0 });
    // The walk covered every kind of movement.
    for (const k of [
      'sale:platform_mor',
      'sale:organizer_mor',
      'organizer_collected',
      'refund:platform_mor',
      'refund:organizer_mor',
      'transfer',
      'reversal',
      'receivable',
      'dispute',
      'dispute_won',
      'dispute_lost',
    ])
      expect(counts.get(k) ?? 0, k).toBeGreaterThan(0);
  });
});
