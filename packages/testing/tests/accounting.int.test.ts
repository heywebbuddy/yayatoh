import { withTenant } from '@yayatoh/db';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { catchUpGifts, createCampaignCommand, giftPaymentInput, startGiftCommand } from '@yayatoh/donations';
import {
  accountingDetailQuery,
  addDays,
  chartOfAccounts,
  connectionDetailQuery,
  dayIn,
  disconnectCommand,
  FAKE_ACCESS_TOKEN,
  FAKE_REFRESH_TOKEN,
  type FakeBooksJournal,
  fakeIntegrations,
  journalKey,
  listErrorGroupsQuery,
  quickbooksConnector,
  quickbooksJournals,
  retryErrorsCommand,
  runSync,
  SYNC_ACTOR,
  saveAccountMapCommand,
  xeroJournals,
} from '@yayatoh/integrations';
import {
  type Ctx,
  createCtx,
  currencyExponent,
  DomainError,
  executeCommand,
  executeQuery,
  uuidv7,
} from '@yayatoh/kernel';
import { applyProviderEventCommand, attachPaymentCommand } from '@yayatoh/orders';
import {
  applyAccountEventCommand,
  fakePaymentProvider,
  type ProviderEvent,
  postJournalTx,
  postOrganizerCollectedSaleTx,
  postRefundTx,
  postSaleTx,
  signFakeWebhook,
} from '@yayatoh/payments';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { findCanaries } from '../src/canary/index.ts';
import {
  connectAccounting,
  fakeAccountMap,
  fakeAuth,
  type OrgFixture,
  ports,
  systemCtx,
  twoOrgs,
  userCtx,
} from '../src/index.ts';

/**
 * M6.5d accounting on real Postgres with the fake QuickBooks and Xero: a fixture day with sales,
 * fees, refunds, payouts and donations posts one journal equal to the ledger's memo entries to
 * the cent; a late refund re-posts the day once (reversal + next revision) and a re-run writes
 * nothing; outages retry with the same key; a revoked connection stops within one run; tokens never
 * leak; validation, permissions and tenant isolation.
 */

let admin: AdminSql;
let a: OrgFixture;
let b: OrgFixture;
let tz: string;
const deps = { auth: fakeAuth };
const SECRET = 'accounting-int-test-secret-0123456789abcdef';
const payments = fakePaymentProvider({ secret: SECRET, appOrigin: 'http://localhost:3000' });

// Everything logged during the runs is checked for the token canaries at the end.
const logged: string[] = [];
for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  // biome-ignore lint/suspicious/noConsole: the test captures every log line to check for token canaries
  const orig = console[level].bind(console);
  vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
    logged.push(
      args.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : JSON.stringify(x))).join(' '),
    );
    orig(...(args as []));
  });
}

beforeAll(async () => {
  admin = adminClient();
  ({ a, b } = await twoOrgs());
  const [row] = await admin`select timezone from tenancy.organizations where id = ${a.org.id}`;
  tz = String(row?.timezone);
  // The fixture connected QuickBooks already (one live connection per connector): end it here.
  for (const o of [a, b]) {
    const [c] = await admin`select id from integrations.connections
      where org_id = ${o.org.id} and connector = 'quickbooks' and status = 'active'`;
    if (c) await executeCommand(disconnectCommand, { connectionId: String(c.id) }, o.ctx(), ports);
  }
}, 240_000);
afterAll(async () => {
  await closePools();
  await admin.end();
});

/** An instant on `day` at `hh:mm` in the org's zone. */
function at(day: string, hh: number, mm = 0): Date {
  // Start from that wall time read as UTC and correct by the zone's offset at that instant.
  const guess = new Date(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);
  const local = new Date(guess.toLocaleString('en-US', { timeZone: tz }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() - (local.getTime() - utc.getTime()));
}

const today = () => dayIn(new Date(), tz);
const sysAt = (o: OrgFixture, now: Date): Ctx =>
  createCtx({ orgId: o.org.id, actor: { type: 'system', name: 'fixture' }, now });

/** The fake books of a connection. */
const books = (authConnectionId: string, connector: 'quickbooks' | 'xero' = 'quickbooks') => {
  const acc = fakeIntegrations.account(authConnectionId);
  if (!acc) throw new Error('no fake account');
  return connector === 'quickbooks' ? quickbooksJournals(acc) : xeroJournals(acc);
};
const forDay = (journals: readonly FakeBooksJournal[], day: string) => journals.filter((j) => j.day === day);

/** A journal's lines per account (minor units, debit positive). */
const byAccount = (j: FakeBooksJournal) => {
  const m = new Map<string, number>();
  for (const l of j.lines) m.set(l.accountId, (m.get(l.accountId) ?? 0) + l.amountMinor);
  return m;
};

const sync = (o: OrgFixture, connectionId: string, now = new Date()) =>
  runSync(o.org.id, connectionId, deps, ports, { now, force: true });

const detail = (o: OrgFixture, connectionId: string, ctx: Ctx = o.ctx()) =>
  executeQuery(accountingDetailQuery, { connectionId }, ctx, ports);

const journalRows = (o: OrgFixture, connectionId: string) =>
  admin`select day::text, currency, revision, kind, status, idempotency_key, external_id, debit_total_minor::int as debit
        from integrations.accounting_journals where org_id = ${o.org.id} and connection_id = ${connectionId}
        order by id`;

/**
 * What the ledger says for `day` in the org's zone, computed straight from the journals' memo
 * entries and the gifts (independently of the code under test).
 */
async function ledgerTruth(o: OrgFixture, day: string) {
  const rows = await admin`
    select j.kind, j.memo, (select min(currency) from payments.postings p where p.journal_id = j.id) as currency,
      coalesce((select sum(amount_minor) from payments.postings p where p.journal_id = j.id and p.account = 'org:payable_releasable'), 0)::bigint as releasable
    from payments.journal_entries j
    where j.org_id = ${o.org.id} and (j.occurred_at at time zone ${tz})::date = ${day}::date`;
  const t = { sales: 0, fees: 0, refunds: 0, payouts: 0, donations: 0 };
  for (const r of rows) {
    const memo = r.memo as Record<string, number>;
    if (r.kind === 'sale' || r.kind === 'organizer_collected_sale') {
      t.sales += Number(memo.grossMinor);
      t.fees += Number(memo.feeMinor);
    } else if (r.kind === 'refund') {
      t.refunds += Number(memo.amountMinor);
      t.fees -= Number(memo.feeRefundedMinor);
    } else if (r.kind === 'transfer') t.payouts += Number(r.releasable);
  }
  const [g] = await admin`
    select coalesce(sum(amount_minor + fee_cover_minor), 0)::bigint as donations from donations.gifts
    where org_id = ${o.org.id} and status = 'paid' and (paid_at at time zone ${tz})::date = ${day}::date`;
  const [gr] = await admin`
    select coalesce(sum(amount_minor), 0)::bigint as refunds from donations.gift_refunds
    where org_id = ${o.org.id} and (refunded_at at time zone ${tz})::date = ${day}::date`;
  t.donations = Number(g?.donations ?? 0);
  t.refunds += Number(gr?.refunds ?? 0);
  return t;
}

/** The journal's amount per category, through the fake QuickBooks mapping. */
function perCategory(j: FakeBooksJournal) {
  const map = fakeAccountMap('quickbooks');
  const lines = byAccount(j);
  return {
    sales: -(lines.get(map.sales.id) ?? 0),
    donations: -(lines.get(map.donations.id) ?? 0),
    refunds: lines.get(map.refunds.id) ?? 0,
    fees: lines.get(map.fees.id) ?? 0,
    payouts: lines.get(map.payouts.id) ?? 0,
    clearing: lines.get(map.clearing.id) ?? 0,
  };
}

const EVENT_ID = () => a.event.id;

/** One online gift paid on `paidAt` (the real flow, then its payment time moved to the fixture day). */
async function paidGift(o: OrgFixture, amountMinor: number, paidAt: Date) {
  await executeCommand(
    applyAccountEventCommand,
    {
      provider: 'fake',
      id: `evt_acct_acc_${o.org.id}`,
      type: 'account.updated',
      orgId: o.org.id,
      account: {
        accountId: `fakeacct_${o.org.slug}`,
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        requirementsDue: [],
        country: 'US',
        defaultCurrency: 'usd',
      },
    },
    systemCtx(o.org.id),
    ports,
  );
  const campaign = await executeCommand(
    createCampaignCommand,
    { eventId: o.event.id, name: `Books fund ${uuidv7().slice(-6)}`, goalMinor: 1_000_000 },
    o.ctx(),
    ports,
  );
  const donor = createCtx({ orgId: o.org.id, idempotencyKey: uuidv7() });
  const r = await executeCommand(
    startGiftCommand,
    {
      eventId: o.event.id,
      campaignId: campaign.id,
      amountMinor,
      donor: { name: 'Bea Booker', email: 'bea.booker@example.test' },
      displayAs: 'anonymous',
    },
    donor,
    ports,
  );
  const payment = await payments.createPayment(
    giftPaymentInput(o.org.id, r, { description: 'Gift', returnUrl: 'http://x/thanks' }),
  );
  await executeCommand(
    attachPaymentCommand,
    { orderId: r.orderId, provider: 'fake', providerPaymentId: payment.providerPaymentId },
    createCtx({ orgId: o.org.id, idempotencyKey: uuidv7() }),
    ports,
  );
  const { body, signature } = signFakeWebhook(SECRET, {
    type: 'payment.succeeded',
    providerPaymentId: payment.providerPaymentId,
    amountMinor: r.totalMinor,
    currency: r.currency,
    orgId: o.org.id,
    orderId: r.orderId,
    applicationFeeMinor: 0,
  });
  const event = (await payments.verifyWebhook(
    body,
    new Headers({ 'x-fake-signature': signature }),
  )) as ProviderEvent;
  await executeCommand(applyProviderEventCommand, event, systemCtx(o.org.id), ports);
  await catchUpGifts(o.org.id);
  const [gift] = await admin`
    update donations.gifts set paid_at = ${paidAt} where org_id = ${o.org.id} and order_id = ${r.orderId} and status = 'paid'
    returning id, (amount_minor + fee_cover_minor)::int as charged`;
  if (!gift) throw new Error('gift not paid');
  return { giftId: String(gift.id), orderId: r.orderId, charged: Number(gift.charged) };
}

/** A late adjustment on `day`: a refund of a sale of that day, booked (late) with that day's time. */
async function lateRefund(o: OrgFixture, day: string, amountMinor: number, feeRefundedMinor: number) {
  await withTenant(sysAt(o, at(day, 16)), (tx) =>
    postRefundTx(tx, sysAt(o, at(day, 16)), {
      refundId: uuidv7(),
      orderId: uuidv7(),
      eventId: EVENT_ID(),
      fundsFlow: 'organizer_mor',
      amountMinor,
      feeRefundedMinor,
      currency: 'USD',
    }),
  );
}

describe('daily summary journals (M6.5d, P6-6)', () => {
  let connectionId: string;
  let authConnectionId: string;
  let D: string;
  let next: string;

  it('a day’s journal equals the ledger memo entries to the cent', async () => {
    D = addDays(today(), -6);
    next = addDays(D, 1);
    const c = 'USD';
    const event = EVENT_ID();
    // The fixture day: sales under both funds flows and one collected by the organizer, refunds
    // (with and without fee back), a payout, an online gift and a gift refund; plus edge times.
    const post = async (
      when: Date,
      fn: (tx: Parameters<Parameters<typeof withTenant>[1]>[0], ctx: Ctx) => Promise<unknown>,
    ) => withTenant(sysAt(a, when), (tx) => fn(tx, sysAt(a, when)));
    await post(at(D, 0, 1), (tx, ctx) =>
      postSaleTx(tx, ctx, {
        orderId: uuidv7(),
        eventId: event,
        fundsFlow: 'platform_mor',
        totalMinor: 12_345,
        feeMinor: 617,
        currency: c,
      }),
    );
    await post(at(D, 9), (tx, ctx) =>
      postSaleTx(tx, ctx, {
        orderId: uuidv7(),
        eventId: event,
        fundsFlow: 'organizer_mor',
        totalMinor: 8_000,
        feeMinor: 400,
        currency: c,
      }),
    );
    await post(at(D, 10), (tx, ctx) =>
      postOrganizerCollectedSaleTx(tx, ctx, {
        orderId: uuidv7(),
        eventId: event,
        totalMinor: 5_000,
        feeMinor: 250,
        currency: c,
      }),
    );
    await post(at(D, 11), (tx, ctx) =>
      postRefundTx(tx, ctx, {
        refundId: uuidv7(),
        orderId: uuidv7(),
        eventId: event,
        fundsFlow: 'platform_mor',
        amountMinor: 2_345,
        feeRefundedMinor: 117,
        currency: c,
      }),
    );
    await post(at(D, 12), (tx, ctx) =>
      postRefundTx(tx, ctx, {
        refundId: uuidv7(),
        orderId: uuidv7(),
        eventId: event,
        fundsFlow: 'organizer_mor',
        amountMinor: 8_000,
        feeRefundedMinor: 400,
        currency: c,
      }),
    );
    // A payout (the settlement's transfer journal).
    await post(at(D, 13), (tx, ctx) => {
      const id = uuidv7();
      return postJournalTx(tx, ctx, {
        key: `transfer:${id}`,
        kind: 'transfer',
        refType: 'settlement',
        refId: id,
        eventId: event,
        memo: { transferId: 'tr_fixture' },
        postings: [
          { account: 'org:payable_releasable', amountMinor: 6_000, currency: c },
          { account: 'platform:stripe_cash', amountMinor: -6_000, currency: c },
        ],
      });
    });
    await post(at(D, 23, 59), (tx, ctx) =>
      postSaleTx(tx, ctx, {
        orderId: uuidv7(),
        eventId: event,
        fundsFlow: 'platform_mor',
        totalMinor: 999,
        feeMinor: 49,
        currency: c,
      }),
    );
    // Just after midnight: the next day's.
    await post(at(next, 0, 0), (tx, ctx) =>
      postSaleTx(tx, ctx, {
        orderId: uuidv7(),
        eventId: event,
        fundsFlow: 'platform_mor',
        totalMinor: 1_500,
        feeMinor: 75,
        currency: c,
      }),
    );
    // And the day before the first mapped day: never posted.
    await post(at(addDays(D, -1), 23, 59), (tx, ctx) =>
      postSaleTx(tx, ctx, {
        orderId: uuidv7(),
        eventId: event,
        fundsFlow: 'platform_mor',
        totalMinor: 777,
        feeMinor: 7,
        currency: c,
      }),
    );
    const gift = await paidGift(a, 10_000, at(D, 14));
    // A partial refund of the gift that day (as the refund flow and the gift refund subscriber leave it).
    const refundId = uuidv7();
    await admin`insert into orders.refunds (id, org_id, order_id, status, reason, amount_minor, currency, requested_by, completed_at)
                values (${refundId}, ${a.org.id}, ${gift.orderId}, 'succeeded', 'requested_by_customer', 1000, ${c}, 'fixture', ${at(D, 15)})`;
    await admin`insert into donations.gift_refunds (org_id, gift_id, refund_id, amount_minor, currency, refunded_at)
                values (${a.org.id}, ${gift.giftId}, ${refundId}, 1000, ${c}, ${at(D, 15)})`;

    ({ connectionId, authConnectionId } = await connectAccounting(a.ctx(), 'quickbooks'));
    // Before the accounts are mapped nothing is posted.
    await sync(a, connectionId);
    expect(books(authConnectionId)).toEqual([]);
    expect((await detail(a, connectionId)).map).toBeNull();

    const saved = await executeCommand(
      saveAccountMapCommand,
      { connectionId, accounts: fakeAccountMap('quickbooks'), startsOn: D },
      a.ctx(),
      ports,
    );
    expect(saved).toMatchObject({ version: 1, startsOn: D });
    const run = await sync(a, connectionId);
    expect(run.runStatus).toBe('succeeded');

    const truth = await ledgerTruth(a, D);
    expect(truth).toEqual({
      sales: 12_345 + 8_000 + 5_000 + 999,
      fees: 617 + 400 + 250 + 49 - 117 - 400,
      refunds: 2_345 + 8_000 + 1_000,
      payouts: 6_000,
      donations: gift.charged,
    });
    const [journal, ...others] = forDay(books(authConnectionId), D);
    expect(others).toEqual([]);
    if (!journal) throw new Error('no journal for the fixture day');
    const got = perCategory(journal);
    expect(got).toMatchObject({
      sales: truth.sales,
      donations: truth.donations,
      refunds: truth.refunds,
      fees: truth.fees,
      payouts: truth.payouts,
    });
    expect(got.clearing).toBe(truth.sales + truth.donations - truth.refunds - truth.fees - truth.payouts);
    expect(journal.lines.reduce((t, l) => t + l.amountMinor, 0)).toBe(0);
    expect(journal).toMatchObject({ currency: 'USD', reference: `YY-${D.replaceAll('-', '')}-USD-1` });
    // The provider got decimals: the fake parsed them back to the same minor units (no float drift).
    expect(currencyExponent('USD')).toBe(2);
    // The next day has its own journal; the day before the mapping's start has none.
    expect(forDay(books(authConnectionId), next)).toHaveLength(1);
    expect(perCategory(forDay(books(authConnectionId), next)[0] as FakeBooksJournal).sales).toBe(
      (await ledgerTruth(a, next)).sales,
    );
    expect(forDay(books(authConnectionId), addDays(D, -1))).toEqual([]);

    const rows = await journalRows(a, connectionId);
    const dayRow = rows.find((r) => r.day === D);
    expect(dayRow).toMatchObject({
      revision: 1,
      kind: 'journal',
      status: 'posted',
      external_id: journal.externalId,
      idempotency_key: journalKey(a.org.id, D, 'USD', 1, 'journal'),
    });
    const view = await detail(a, connectionId);
    expect(view.map?.version).toBe(1);
    expect(view.waiting).toBe(0);
    expect(view.journals.find((j) => j.day === D)).toMatchObject({
      status: 'posted',
      revision: 1,
      kind: 'journal',
    });
    const runs = (await executeQuery(connectionDetailQuery, { connectionId }, a.ctx(), ports)).runs;
    expect(runs[0]).toMatchObject({ status: 'succeeded', pushed: rows.length });
  });

  it('a re-run of the same day writes nothing new', async () => {
    const before = await journalRows(a, connectionId);
    const posted = books(authConnectionId).length;
    await sync(a, connectionId);
    await sync(a, connectionId);
    expect(await journalRows(a, connectionId)).toEqual(before);
    expect(books(authConnectionId)).toHaveLength(posted);
  });

  it('a late refund re-posts the affected day once: reversal, then the next revision', async () => {
    const posted = books(authConnectionId).length;
    const [first] = forDay(books(authConnectionId), D);
    await lateRefund(a, D, 2_500, 125);
    await sync(a, connectionId);
    const day = forDay(books(authConnectionId), D);
    expect(books(authConnectionId)).toHaveLength(posted + 2);
    expect(day).toHaveLength(3);
    const [, reversal, second] = day as [FakeBooksJournal, FakeBooksJournal, FakeBooksJournal];
    // The reversal undoes revision 1 exactly; revision 2 is the corrected day.
    expect(reversal.reference).toBe(`YY-${D.replaceAll('-', '')}-USD-1R`);
    expect([...byAccount(reversal)].map(([k, v]) => [k, -v])).toEqual([
      ...byAccount(first as FakeBooksJournal),
    ]);
    expect(second.reference).toBe(`YY-${D.replaceAll('-', '')}-USD-2`);
    const truth = await ledgerTruth(a, D);
    expect(perCategory(second)).toMatchObject({
      refunds: truth.refunds,
      fees: truth.fees,
      sales: truth.sales,
    });
    // Net in the books: exactly the corrected day.
    const net = new Map<string, number>();
    for (const j of day) for (const [k, v] of byAccount(j)) net.set(k, (net.get(k) ?? 0) + v);
    expect(net).toEqual(byAccount(second));
    const rows = (await journalRows(a, connectionId)).filter((r) => r.day === D);
    expect(rows.map((r) => [r.kind, r.revision, r.status])).toEqual([
      ['journal', 1, 'posted'],
      ['reversal', 1, 'posted'],
      ['journal', 2, 'posted'],
    ]);
    expect(rows[1]?.idempotency_key).toBe(journalKey(a.org.id, D, 'USD', 1, 'reversal'));
    // Once only: running again changes nothing.
    await sync(a, connectionId);
    expect(forDay(books(authConnectionId), D)).toHaveLength(3);
  });

  it('a mapping change applies to new postings and never re-posts a standing day', async () => {
    const posted = books(authConnectionId).length;
    const map = fakeAccountMap('quickbooks');
    await executeCommand(
      saveAccountMapCommand,
      { connectionId, accounts: { ...map, refunds: map.sales }, startsOn: D },
      a.ctx(),
      ports,
    );
    await sync(a, connectionId);
    expect(books(authConnectionId)).toHaveLength(posted);
    // The next change to the day uses version 2 (refunds into the sales account).
    await lateRefund(a, next, 100, 5);
    await sync(a, connectionId);
    const nextDay = forDay(books(authConnectionId), next);
    expect(nextDay).toHaveLength(3);
    expect(byAccount(nextDay[2] as FakeBooksJournal).has(map.refunds.id)).toBe(false);
    expect((await detail(a, connectionId)).map?.version).toBe(2);
  });

  it('a provider outage retries with the same key and lands once; the day waits meanwhile', async () => {
    const posted = books(authConnectionId).length;
    await lateRefund(a, D, 300, 15);
    fakeIntegrations.failNext(authConnectionId, 503);
    const r = await sync(a, connectionId);
    expect(r.runStatus).toBe('partial');
    expect(books(authConnectionId)).toHaveLength(posted);
    const failed = (await journalRows(a, connectionId)).filter((x) => x.status === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ kind: 'reversal', revision: 2 });
    const groups = await executeQuery(listErrorGroupsQuery, { status: 'open' }, a.ctx(), ports);
    const group = groups.find((g) => g.connectionId === connectionId && g.code === 'http_503');
    expect(group).toMatchObject({ step: 'push', count: 1 });
    const err = group?.errors.find((e) => e.objectType === 'journals');
    expect(err).toMatchObject({ direction: 'push', localId: expect.any(String) });
    // Another change while the outcome is unknown: nothing new is queued for that day.
    await lateRefund(a, D, 10, 1);
    const rowsBefore = await journalRows(a, connectionId);
    await sync(a, connectionId);
    expect(await journalRows(a, connectionId)).toEqual(rowsBefore);
    // Retry now (the inbox's Retry): the same key goes again and lands once, then the day catches up.
    await executeCommand(retryErrorsCommand, { errorIds: [err?.id as string] }, a.ctx(), ports);
    await sync(a, connectionId);
    await sync(a, connectionId);
    const day = forDay(books(authConnectionId), D);
    const refs = day.map((j) => j.reference);
    expect(new Set(refs).size).toBe(refs.length);
    const ref = (n: string) => `YY-${D.replaceAll('-', '')}-USD-${n}`;
    expect(refs.slice(-4)).toEqual([ref('2R'), ref('3'), ref('3R'), ref('4')]);
    const net = new Map<string, number>();
    for (const j of day) for (const [k, v] of byAccount(j)) net.set(k, (net.get(k) ?? 0) + v);
    const truth = await ledgerTruth(a, D);
    const map = fakeAccountMap('quickbooks');
    // The books net to the ledger's day (refunds now map to sales: version 2).
    expect((net.get(map.sales.id) ?? 0) * -1).toBe(truth.sales - truth.refunds);
    expect(net.get(map.fees.id)).toBe(truth.fees);
    expect((await detail(a, connectionId)).waiting).toBe(0);
  });

  it('the fake books post a requestid once (idempotency at the provider)', async () => {
    const acc = fakeIntegrations.account(authConnectionId);
    if (!acc || !quickbooksConnector.accounting) throw new Error('setup');
    const io = {
      client: fakeAuth.client({
        orgId: a.org.id,
        connectionId,
        providerConfigKey: 'quickbooks',
        authConnectionId,
      }),
      origin: 'x',
      now: new Date(),
    };
    const map = fakeAccountMap('quickbooks');
    const j = {
      day: today(),
      currency: 'USD',
      exponent: 2,
      reference: 'YY-TEST',
      memo: 'test',
      lines: [
        { accountId: map.clearing.id, accountCode: null, amountMinor: 101, description: 'x' },
        { accountId: map.sales.id, accountCode: null, amountMinor: -101, description: 'y' },
      ],
      idempotencyKey: `test-${uuidv7()}`,
    };
    const first = await quickbooksConnector.accounting.postJournal(io, j);
    const again = await quickbooksConnector.accounting.postJournal(io, j);
    expect(again).toEqual(first);
    expect(quickbooksJournals(acc).filter((x) => x.reference === 'YY-TEST')).toHaveLength(1);
    // An unbalanced journal is refused by the books (no silent posting).
    await expect(
      quickbooksConnector.accounting.postJournal(io, {
        ...j,
        idempotencyKey: `test-${uuidv7()}`,
        lines: [
          j.lines[0] as (typeof j.lines)[number],
          { ...(j.lines[1] as (typeof j.lines)[number]), amountMinor: -100 },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('the chart of accounts and the mapping', () => {
  it('lists the provider’s active accounts and validates a save', async () => {
    const { connectionId } = await connectAccounting(b.ctx(), 'quickbooks');
    const chart = await chartOfAccounts(b.ctx(), ports, fakeAuth, connectionId);
    expect(chart?.map((x) => x.name)).toContain('Yayatoh Clearing');
    expect(chart?.some((x) => x.name === 'Old Suspense')).toBe(false);
    const map = fakeAccountMap('quickbooks');
    const save = (input: Record<string, unknown>, ctx: Ctx = b.ctx()) =>
      executeCommand(
        saveAccountMapCommand,
        { connectionId, accounts: map, startsOn: today(), ...input },
        ctx,
        ports,
      );
    await expect(save({ accounts: { ...map, payouts: map.clearing } })).rejects.toMatchObject({
      code: 'validation_failed',
      details: { issues: [{ path: 'accounts.payouts', code: 'clearing_shared' }] },
    });
    await expect(save({ startsOn: addDays(today(), 1) })).rejects.toMatchObject({
      details: { issues: [{ path: 'startsOn', code: 'starts_in_future' }] },
    });
    await expect(save({ startsOn: addDays(today(), -400) })).rejects.toMatchObject({
      details: { issues: [{ path: 'startsOn', code: 'starts_too_early' }] },
    });
    await expect(save({ startsOn: 'yesterday' })).rejects.toMatchObject({ code: 'validation_failed' });
    // Viewers read nothing here and save nothing.
    const viewer = userCtx(b.viewerId, b.org.id);
    await expect(save({}, viewer)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(detail(b, connectionId, viewer)).rejects.toMatchObject({ code: 'forbidden' });
    expect(await save({})).toMatchObject({ version: 1 });
    // Another org cannot see or change it.
    await expect(detail(a, connectionId)).rejects.toMatchObject({ code: 'not_found' });
    await expect(save({}, a.ctx())).rejects.toMatchObject({ code: 'not_found' });
    // Not on a connection that is gone.
    await executeCommand(disconnectCommand, { connectionId }, b.ctx(), ports);
    await expect(save({})).rejects.toMatchObject({ code: 'invalid_state' });
    expect(await chartOfAccounts(b.ctx(), ports, fakeAuth, connectionId)).toBeNull();
  });

  it('the demo connector has no accounting', async () => {
    await expect(detail(a, await demoId(a))).rejects.toMatchObject({ code: 'not_found' });
  });
});

async function demoId(o: OrgFixture): Promise<string> {
  const [r] =
    await admin`select id from integrations.connections where org_id = ${o.org.id} and connector = 'demo' limit 1`;
  return String(r?.id);
}

describe('Xero', () => {
  it('posts base-currency days; another currency waits in the errors inbox', async () => {
    const { connectionId, authConnectionId } = await connectAccounting(b.ctx(), 'xero');
    const D = addDays(today(), -3);
    for (const currency of ['USD', 'EUR'])
      await withTenant(sysAt(b, at(D, 12)), (tx) =>
        postSaleTx(tx, sysAt(b, at(D, 12)), {
          orderId: uuidv7(),
          eventId: b.event.id,
          fundsFlow: 'platform_mor',
          totalMinor: 4_200,
          feeMinor: 210,
          currency,
        }),
      );
    await executeCommand(
      saveAccountMapCommand,
      { connectionId, accounts: fakeAccountMap('xero'), startsOn: D },
      b.ctx(),
      ports,
    );
    const r = await sync(b, connectionId);
    expect(r.runStatus).toBe('partial');
    const posted = forDay(books(authConnectionId, 'xero'), D);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ currency: 'USD' });
    const map = fakeAccountMap('xero');
    expect(byAccount(posted[0] as FakeBooksJournal).get(map.sales.id)).toBe(-(await xeroDaySales(b, D)));
    const rows = await journalRows(b, connectionId);
    expect(rows.find((x) => x.currency === 'EUR')).toMatchObject({ status: 'failed' });
    const groups = await executeQuery(listErrorGroupsQuery, { status: 'open' }, b.ctx(), ports);
    expect(groups.some((g) => g.connectionId === connectionId && g.code === 'currency_unsupported')).toBe(
      true,
    );
  });
});

async function xeroDaySales(o: OrgFixture, day: string) {
  const [r] = await admin`
    select coalesce(sum((j.memo->>'grossMinor')::bigint), 0)::int as s from payments.journal_entries j
    join lateral (select min(currency) c from payments.postings p where p.journal_id = j.id) p on true
    where j.org_id = ${o.org.id} and p.c = 'USD' and j.kind in ('sale', 'organizer_collected_sale')
      and (j.occurred_at at time zone ${tz})::date = ${day}::date`;
  return Number(r?.s ?? 0);
}

describe('revocation and secrets', () => {
  it('a revoked connection stops within one run', async () => {
    const { connectionId, authConnectionId } = await connectAccounting(b.ctx(), 'quickbooks');
    const D = addDays(today(), -2);
    await withTenant(sysAt(b, at(D, 9)), (tx) =>
      postSaleTx(tx, sysAt(b, at(D, 9)), {
        orderId: uuidv7(),
        eventId: b.event.id,
        fundsFlow: 'platform_mor',
        totalMinor: 3_000,
        feeMinor: 150,
        currency: 'USD',
      }),
    );
    await executeCommand(
      saveAccountMapCommand,
      { connectionId, accounts: fakeAccountMap('quickbooks'), startsOn: D },
      b.ctx(),
      ports,
    );
    // Refused mid-run: the run ends, the connection is revoked, nothing else is sent.
    fakeIntegrations.failNext(authConnectionId, 401);
    const r = await sync(b, connectionId);
    expect(r).toMatchObject({ runStatus: 'failed', connectionStatus: 'revoked' });
    expect(books(authConnectionId)).toEqual([]);
    const next = await sync(b, connectionId);
    expect(next.status).toBe('inactive');
    expect(books(authConnectionId)).toEqual([]);
    const c = (await executeQuery(connectionDetailQuery, { connectionId }, b.ctx(), ports)).connection;
    expect(c).toMatchObject({ status: 'revoked', revokeReason: 'provider' });

    // Revoked at the provider between runs: the next run stops at its auth check.
    const second = await connectAccounting(a.ctx(), 'xero');
    await executeCommand(
      saveAccountMapCommand,
      { connectionId: second.connectionId, accounts: fakeAccountMap('xero'), startsOn: addDays(today(), -6) },
      a.ctx(),
      ports,
    );
    fakeIntegrations.revokeAtProvider(second.authConnectionId);
    const r2 = await sync(a, second.connectionId);
    expect(r2).toMatchObject({ runStatus: 'failed', connectionStatus: 'revoked' });
    expect(books(second.authConnectionId, 'xero')).toEqual([]);
    expect(await journalRows(a, second.connectionId)).toEqual([]);
  });

  it('tokens never reach a row, an error, an audit entry, an event or a log', async () => {
    const dump = await admin.unsafe(
      `select to_jsonb(t)::text as row from integrations.accounting_journals t where org_id = any($1)
       union all select to_jsonb(t)::text from integrations.account_maps t where org_id = any($1)
       union all select to_jsonb(t)::text from integrations.sync_errors t where org_id = any($1)
       union all select to_jsonb(t)::text from integrations.sync_runs t where org_id = any($1)
       union all select to_jsonb(t)::text from platform.audit_events t where org_id = any($1)
       union all select to_jsonb(t)::text from platform.domain_events t where org_id = any($1)`,
      [[a.org.id, b.org.id]],
    );
    expect(dump.length).toBeGreaterThan(10);
    const everything = [...dump.map((d) => String(d.row)), ...logged].join('\n');
    expect(everything).toContain('integrations.accounting.prepare');
    for (const token of [FAKE_ACCESS_TOKEN, FAKE_REFRESH_TOKEN]) expect(everything).not.toContain(token);
    expect(findCanaries(everything).filter((h) => h.column.startsWith('integrations.oauth'))).toEqual([]);
  });

  it('the engine refuses a run for another org’s connection', async () => {
    const id = await demoId(a);
    const r = await runSync(b.org.id, id, deps, ports, { force: true }).catch((e: unknown) => e);
    expect(r).toBeInstanceOf(DomainError);
    expect(SYNC_ACTOR.type).toBe('system');
  });
});
