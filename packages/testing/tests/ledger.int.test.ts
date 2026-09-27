import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { ledgerBalancesQuery, postJournalTx, postSaleTx } from '@yayatoh/payments';
import { addMemberCommand } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;

/** Deterministic PRNG (mulberry32) so a failing case can be replayed from its seed. */
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

/** Drizzle wraps database errors ("Failed query …"); the reason is in the cause. */
async function rejectsWith(p: Promise<unknown>, re: RegExp) {
  const err = await p.then(
    () => null,
    (e: unknown) => e as { message?: string; cause?: { message?: string } },
  );
  expect(err).not.toBeNull();
  expect(`${err?.message} ${err?.cause?.message ?? ''}`).toMatch(re);
}

const balances = async (o: OrgFixture) =>
  new Map(
    (await executeQuery(ledgerBalancesQuery, {}, systemCtx(o.org.id), ports)).map((r) => [
      `${r.account}:${r.currency}`,
      r.balanceMinor,
    ]),
  );

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

describe('ledger (M1.6a)', () => {
  it('a paid order posts one balanced sale journal, in the same transaction', async () => {
    const [row] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number; total: string }>(sql`
        select count(distinct j.id)::int as n, coalesce(sum(p.amount_minor), 0)::text as total
        from payments.journal_entries j join payments.postings p on p.journal_id = j.id
        where j.kind = 'sale'`),
    );
    expect(row?.n).toBe(1);
    expect(row?.total).toBe('0');
    // Cash equals everything owed to the organizer and the platform's fee (all other accounts).
    const bal = await balances(a);
    const cash = bal.get('platform:stripe_cash:USD') ?? 0;
    const others = [...bal].filter(([k]) => k.endsWith(':USD') && k !== 'platform:stripe_cash:USD');
    expect(cash > 0).toBe(true);
    expect(cash).toBe(-others.reduce((n, [, v]) => n + v, 0));
  });

  it('property: over random sales in both funds flows, cash = organizer payables + platform fees', async () => {
    const seed = 20260927;
    const next = rng(seed);
    const before = await balances(b);
    let cash = 0;
    let held = 0;
    let deferred = 0;
    let revenue = 0;
    await withTenant(systemCtx(b.org.id), async (tx) => {
      for (let i = 0; i < 60; i++) {
        const total = Math.floor(next() * 50_000);
        const fee = Math.min(total, Math.floor(next() * 3_000));
        const flow = next() < 0.5 ? 'platform_mor' : 'organizer_mor';
        const orderId = uuidv7();
        await postSaleTx(tx, systemCtx(b.org.id), {
          orderId,
          eventId: b.event.id,
          fundsFlow: flow,
          totalMinor: total,
          feeMinor: fee,
          currency: 'USD',
        });
        // A replay (webhook retry) never posts twice.
        const again = await postSaleTx(tx, systemCtx(b.org.id), {
          orderId,
          eventId: b.event.id,
          fundsFlow: flow,
          totalMinor: total,
          feeMinor: fee,
          currency: 'USD',
        });
        if (again) expect(again.created).toBe(false);
        if (total === 0) continue;
        if (flow === 'platform_mor') {
          cash += total;
          held -= total - fee;
          deferred -= fee;
        } else {
          cash += fee;
          revenue -= fee;
        }
      }
    });
    const after = await balances(b);
    const delta = (k: string) => (after.get(k) ?? 0) - (before.get(k) ?? 0);
    expect({
      cash: delta('platform:stripe_cash:USD'),
      held: delta('org:payable_held:USD'),
      deferred: delta('platform:platform_fee_deferred:USD'),
      revenue: delta('platform:platform_fee_revenue:USD'),
    }).toEqual({ cash, held, deferred, revenue });
    const [sum] = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ s: string }>(sql`select coalesce(sum(amount_minor), 0)::text as s from payments.postings`),
    );
    expect(sum?.s).toBe('0');
  });

  it('refuses unbalanced journals, another org, and direct writes; entries are immutable', async () => {
    const ctx = systemCtx(a.org.id);
    await rejectsWith(
      withTenant(ctx, (tx) =>
        postJournalTx(tx, ctx, {
          key: `bad-${uuidv7()}`,
          kind: 'test',
          refType: 'order',
          refId: uuidv7(),
          postings: [
            { account: 'platform:stripe_cash', amountMinor: 100, currency: 'USD' },
            { account: 'org:payable_held', amountMinor: -99, currency: 'USD' },
          ],
        }),
      ),
      /unbalanced/,
    );
    // Posting for org B while in org A's context.
    await rejectsWith(
      withTenant(ctx, (tx) =>
        postJournalTx(tx, systemCtx(b.org.id), {
          key: `x-${uuidv7()}`,
          kind: 'test',
          refType: 'order',
          refId: uuidv7(),
          postings: [
            { account: 'platform:stripe_cash', amountMinor: 1, currency: 'USD' },
            { account: 'org:payable_held', amountMinor: -1, currency: 'USD' },
          ],
        }),
      ),
      /org mismatch/,
    );
    for (const stmt of [
      sql`insert into payments.journal_entries (org_id, idempotency_key, kind, ref_type, ref_id, occurred_at) values (${a.org.id}, 'direct', 'x', 'order', ${uuidv7()}, now())`,
      sql`update payments.postings set amount_minor = amount_minor + 1`,
      sql`delete from payments.postings`,
      sql`delete from payments.journal_entries`,
    ])
      await rejectsWith(
        withTenant(ctx, (tx) => tx.execute(stmt)),
        /permission denied/,
      );
  });

  it('balances are for finance, owners and staff only, and never cross orgs', async () => {
    await expect(
      executeQuery(ledgerBalancesQuery, {}, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const financeId = uuidv7();
    await executeCommand(addMemberCommand, { userId: financeId, role: 'finance' }, a.ctx(), ports);
    const seen = await executeQuery(ledgerBalancesQuery, {}, userCtx(financeId, a.org.id), ports);
    expect(seen.length).toBeGreaterThan(0);
    // Org A's balances are unaffected by the 60 sales posted for org B.
    const [aJournals] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from payments.journal_entries where kind = 'sale'`,
      ),
    );
    expect(aJournals?.n).toBe(1);
  });
});
