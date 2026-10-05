import { withTenant } from '@yayatoh/db';
import { adminClient, closePools } from '@yayatoh/db/testing';
import {
  catchUpReceipts,
  charityProfileQuery,
  clearFairValueCommand,
  createCampaignCommand,
  giftPaymentInput,
  publicTaxNotices,
  receiptByToken,
  receiptDocumentQuery,
  receiptIssuer,
  receiptsConsoleQuery,
  receiptsOfOrdersTx,
  receiptToken,
  rejectCharityCommand,
  type StartGiftResultDto,
  saveCharityProfileCommand,
  setFairValueCommand,
  startGiftCommand,
  statementByToken,
  statementMailer,
  statementsOfYearTx,
  statementToken,
  verifyCharityCommand,
  yearEndStatementsCommand,
} from '@yayatoh/donations';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { applyProviderEventCommand, attachPaymentCommand, startCheckoutCommand } from '@yayatoh/orders';
import { applyAccountEventCommand, fakePaymentProvider, signFakeWebhook } from '@yayatoh/payments';
import { catchUpSubscriber, memoryNotifier } from '@yayatoh/platform';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M4.8b charity profile and receipts (P4-11, P4-13): the profile and its staff verification
 * against the IRS list, fair-market values, receipts per payment (deductible = paid − FMV; "No
 * goods or services" for pure gifts; plain receipts for unverified orgs), the quid-pro-quo notice,
 * year-end statements that total exactly, receipts only to the donor, tenant isolation,
 * impersonation and the read-only freeze.
 */
let a: OrgFixture;
let b: OrgFixture;
const SECRET = 'receipts-int-test-secret-0123456789abcdef';
const provider = fakePaymentProvider({ secret: SECRET, appOrigin: 'http://localhost:3000' });
const ORIGIN = 'https://app.yayatoh.test';
const admin = adminClient();
const setFreeze = (value: unknown) =>
  admin`select platform.set_ops_flag('read_only_freeze', ${value === null ? null : JSON.stringify(value)}::text::jsonb, 'test', 'test:receipts')`;

const IRS = {
  ein: '23-4567891',
  name: 'HARBOR ARTS ALLIANCE',
  city: 'BOSTON',
  state: 'MA',
  subsection: '03',
  deductibility: '1',
  status: '01',
};

async function connect(o: OrgFixture) {
  await executeCommand(
    applyAccountEventCommand,
    {
      provider: 'fake',
      id: `evt_acct_receipts_${o.org.id}`,
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
}

/** A verified charity profile for `o` (a new version: save, then staff verify). */
async function verified(o: OrgFixture, legalName = 'Harbor Arts Alliance') {
  const p = await executeCommand(
    saveCharityProfileCommand,
    { legalName, ein: '234567891', exemptKind: '501c3', address: '1 Pier Way, Boston, MA' },
    o.ctx(),
    ports,
  );
  if (p.status === 'verified') return p;
  await executeCommand(verifyCharityCommand, { version: p.version, irs: IRS }, systemCtx(o.org.id), ports);
  return p;
}

/** A paid ticket order for `quantity` of a ticket type, as the provider's webhook leaves it. */
async function buyTickets(o: OrgFixture, ticketTypeId: string, email: string, quantity = 1) {
  const c = await executeCommand(
    startCheckoutCommand,
    { eventId: o.event.id, items: [{ ticketTypeId, quantity }], buyer: { email, name: 'Ada Lovelace' } },
    createCtx({ orgId: o.org.id }),
    ports,
  );
  const pi = `fakepi_rcpt_${c.order.id}`;
  await executeCommand(
    attachPaymentCommand,
    { orderId: c.order.id, provider: 'fake', providerPaymentId: pi },
    createCtx({ orgId: o.org.id }),
    ports,
  );
  await executeCommand(
    applyProviderEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_rcpt_${c.order.id}`,
      type: 'payment.succeeded',
      providerPaymentId: pi,
      amountMinor: c.order.totalMinor,
      currency: c.order.currency,
      orgId: o.org.id,
      orderId: c.order.id,
      applicationFeeMinor: c.order.feeMinor,
    },
    systemCtx(o.org.id),
    ports,
  );
  return c.order;
}

/** A paid gift (the giving page, then the fake provider's verified webhook). */
async function giveAndPay(o: OrgFixture, campaignId: string, amountMinor: number, email: string) {
  const r: StartGiftResultDto = await executeCommand(
    startGiftCommand,
    {
      eventId: o.event.id,
      campaignId,
      amountMinor,
      donor: { name: 'Grace Hopper', email },
      displayAs: 'anonymous',
    },
    createCtx({ orgId: o.org.id, idempotencyKey: uuidv7() }),
    ports,
  );
  const payment = await provider.createPayment(
    giftPaymentInput(o.org.id, r, { description: 'Gift', returnUrl: 'http://x/thanks' }),
  );
  await executeCommand(
    attachPaymentCommand,
    { orderId: r.orderId, provider: 'fake', providerPaymentId: payment.providerPaymentId },
    createCtx({ orgId: o.org.id }),
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
  const e = await provider.verifyWebhook(body, new Headers({ 'x-fake-signature': signature }));
  await executeCommand(applyProviderEventCommand, e, systemCtx(o.org.id), ports);
  return r;
}

const receiptOf = async (o: OrgFixture, orderId: string) => {
  const [r] = await withTenant(systemCtx(o.org.id), (tx) => receiptsOfOrdersTx(tx, [orderId]));
  return r ?? null;
};

let gala: { id: string };
let plainType: { id: string };
let campaignA: string;
let campaignB: string;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  await connect(a);
  await connect(b);
  gala = await executeCommand(
    createTicketTypeCommand,
    { eventId: a.event.id, name: 'Gala dinner', priceMinor: 50_000, quantityTotal: 50 },
    a.ctx(),
    ports,
  );
  plainType = await executeCommand(
    createTicketTypeCommand,
    { eventId: a.event.id, name: 'Cloakroom', priceMinor: 500, quantityTotal: 50 },
    a.ctx(),
    ports,
  );
  campaignA = (
    await executeCommand(
      createCampaignCommand,
      { eventId: a.event.id, name: 'Receipts Fund', goalMinor: 1_000_000 },
      a.ctx(),
      ports,
    )
  ).id;
  campaignB = (
    await executeCommand(
      createCampaignCommand,
      { eventId: b.event.id, name: 'Receipts Fund', goalMinor: 1_000_000 },
      b.ctx(),
      ports,
    )
  ).id;
});
afterEach(async () => {
  await setFreeze(null);
});
afterAll(async () => {
  await setFreeze(null);
  await admin.end();
  await closePools();
});

describe('the charity profile (M4.8b)', () => {
  it('validates the EIN and the fiscal sponsor; owners save, viewers cannot', async () => {
    const base = { legalName: 'Harbor Arts Alliance', ein: '234567891', exemptKind: '501c3' as const };
    await expect(
      executeCommand(saveCharityProfileCommand, { ...base, ein: '12345' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { field: 'ein' } });
    await expect(
      executeCommand(saveCharityProfileCommand, { ...base, ein: '00-1234567' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { field: 'ein' } });
    await expect(
      executeCommand(saveCharityProfileCommand, { ...base, exemptKind: 'fiscal_sponsor' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { field: 'sponsorName' } });
    await expect(
      executeCommand(
        saveCharityProfileCommand,
        { ...base, exemptKind: 'fiscal_sponsor', sponsorName: 'Good Cause', sponsorEin: 'nope' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { field: 'sponsorEin' } });
    await expect(
      executeCommand(saveCharityProfileCommand, base, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const saved = await executeCommand(saveCharityProfileCommand, base, a.ctx(), ports);
    expect(saved).toMatchObject({ ein: '23-4567891', status: 'pending', reviewNote: null });
    // The same details again change nothing; the viewer can read it.
    const again = await executeCommand(
      saveCharityProfileCommand,
      { ...base, ein: '23-4567891' },
      a.ctx(),
      ports,
    );
    expect(again.version).toBe(saved.version);
    expect(await executeQuery(charityProfileQuery, {}, userCtx(a.viewerId, a.org.id), ports)).toMatchObject({
      legalName: 'Harbor Arts Alliance',
      status: 'pending',
    });
  });

  it('only staff verify, the version they reviewed, an eligible record for the profile’s EIN', async () => {
    const p = await executeCommand(
      saveCharityProfileCommand,
      { legalName: 'Harbor Arts Alliance', ein: '23-4567891', exemptKind: '501c3' },
      a.ctx(),
      ports,
    );
    const staff = systemCtx(a.org.id);
    await expect(
      executeCommand(verifyCharityCommand, { version: p.version, irs: IRS }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(verifyCharityCommand, { version: p.version + 1, irs: IRS }, staff, ports),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'stale' } });
    await expect(
      executeCommand(
        verifyCharityCommand,
        { version: p.version, irs: { ...IRS, ein: '12-3456789' } },
        staff,
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'ein_mismatch' } });
    await expect(
      executeCommand(
        verifyCharityCommand,
        { version: p.version, irs: { ...IRS, subsection: '04' } },
        staff,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'not_501c3' } });
    await expect(
      executeCommand(
        verifyCharityCommand,
        { version: p.version, irs: { ...IRS, deductibility: '2' } },
        staff,
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'not_deductible' } });
    await executeCommand(
      verifyCharityCommand,
      { version: p.version, irs: IRS, note: 'EO BMF match' },
      staff,
      ports,
    );
    const v = await executeQuery(charityProfileQuery, {}, a.ctx(), ports);
    expect(v).toMatchObject({ status: 'verified', version: p.version });
    // Every staff action is audited, with the staff actor.
    const [audit] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ action: string }>(
        sql`select action from platform.audit_events where action = 'donations.charity.verify' order by created_at desc limit 1`,
      ),
    );
    expect(audit?.action).toBe('donations.charity.verify');
  });

  it('a change after verification goes back to review; a rejection carries its note to the org', async () => {
    await verified(a);
    const changed = await executeCommand(
      saveCharityProfileCommand,
      { legalName: 'Harbor Arts Alliance Inc', ein: '23-4567891', exemptKind: '501c3' },
      a.ctx(),
      ports,
    );
    expect(changed.status).toBe('pending');
    await executeCommand(
      rejectCharityCommand,
      { version: changed.version, note: 'The legal name does not match the IRS list.' },
      systemCtx(a.org.id),
      ports,
    );
    expect(await executeQuery(charityProfileQuery, {}, a.ctx(), ports)).toMatchObject({
      status: 'rejected',
      reviewNote: 'The legal name does not match the IRS list.',
    });
    await expect(
      executeCommand(
        rejectCharityCommand,
        { version: changed.version, note: 'x' },
        systemCtx(a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await verified(a);
  });
});

describe('fair-market values and the quid-pro-quo notice', () => {
  it('hosts set a value on their own event’s ticket types; viewers cannot', async () => {
    await expect(
      executeCommand(
        setFairValueCommand,
        { eventId: a.event.id, ticketTypeId: gala.id, fmvMinor: 15_000 },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        setFairValueCommand,
        { eventId: b.event.id, ticketTypeId: gala.id, fmvMinor: 15_000 },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(
        setFairValueCommand,
        { eventId: a.event.id, ticketTypeId: gala.id, fmvMinor: -1 },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await executeCommand(
      setFairValueCommand,
      {
        eventId: a.event.id,
        ticketTypeId: gala.id,
        fmvMinor: 15_000,
        description: 'Dinner and entertainment',
      },
      a.ctx(),
      ports,
    );
    const view = await executeQuery(receiptsConsoleQuery, { eventId: a.event.id }, a.ctx(), ports);
    expect(view.ticketTypes.find((t) => t.ticketTypeId === gala.id)).toMatchObject({
      priceMinor: 50_000,
      fmvMinor: 15_000,
      description: 'Dinner and entertainment',
    });
  });

  it('the ticket page shows "of your $500 payment, $350 is tax-deductible" for verified charities only', async () => {
    await verified(a);
    const notices = await publicTaxNotices(a.org.id, a.event.id);
    expect(notices.get(gala.id)).toEqual({
      priceMinor: 50_000,
      fmvMinor: 15_000,
      deductibleMinor: 35_000,
      currency: 'USD',
    });
    // $25 with a value: no notice (not over $75); a type without a value: none.
    expect(notices.has(plainType.id)).toBe(false);
    // An org whose profile is not verified shows none.
    await executeCommand(
      saveCharityProfileCommand,
      { legalName: 'Bravo Pending', ein: '34-5678912', exemptKind: '501c3' },
      b.ctx(),
      ports,
    );
    const tt = await executeCommand(
      createTicketTypeCommand,
      { eventId: b.event.id, name: 'Gala B', priceMinor: 50_000, quantityTotal: 10 },
      b.ctx(),
      ports,
    );
    await executeCommand(
      setFairValueCommand,
      { eventId: b.event.id, ticketTypeId: tt.id, fmvMinor: 15_000 },
      b.ctx(),
      ports,
    );
    expect((await publicTaxNotices(b.org.id, b.event.id)).size).toBe(0);
  });
});

describe('receipts (P4-11)', () => {
  const memo = memoryNotifier();
  const deps = { notifier: memo.notifier, appOrigin: ORIGIN };

  it('a $500 ticket with a $150 fair-market value gives a receipt with $350 deductible, mailed to the buyer only', async () => {
    await verified(a);
    const order = await buyTickets(a, gala.id, 'Ada@Example.test');
    await catchUpReceipts(a.org.id, deps);
    const r = await receiptOf(a, order.id);
    expect(r).toMatchObject({
      kind: 'ticket',
      deductible: true,
      amountMinor: 50_000,
      fmvMinor: 15_000,
      deductibleMinor: 35_000,
      charityName: 'Harbor Arts Alliance',
      charityEin: '23-4567891',
      donorEmail: 'ada@example.test',
      goods: '1 × Gala dinner (Dinner and entertainment)',
    });
    const sent = memo.sent.filter((s) => s.dedupeKey === `receipt:${r?.id}`);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.kind).toBe('donations.receipt');
    expect(sent[0]?.to.email).toBe('ada@example.test');
    expect(String(sent[0]?.params.body)).toContain('Tax-deductible amount: $350.00');
    expect(String(sent[0]?.params.url)).toBe(`${ORIGIN}/receipts/${a.org.id}/${receiptToken(r?.id ?? '')}`);
    // Replays issue nothing more: one receipt per order, one message per receipt.
    await catchUpSubscriber(receiptIssuer(deps), a.org.id);
    await withTenant(systemCtx(a.org.id), (tx) =>
      receiptIssuer(deps).handle(tx, {
        id: uuidv7(),
        orgId: a.org.id,
        type: 'order.paid',
        version: 1,
        aggregateType: 'order',
        aggregateId: order.id,
        payload: { orgId: a.org.id, orderId: order.id },
        occurredAt: new Date().toISOString(),
      } as never),
    );
    expect((await withTenant(systemCtx(a.org.id), (tx) => receiptsOfOrdersTx(tx, [order.id]))).length).toBe(
      1,
    );
  });

  it('a $100 gift with nothing in return says "No goods or services were provided"', async () => {
    const r = await giveAndPay(a, campaignA, 10_000, 'grace@example.test');
    await catchUpReceipts(a.org.id, deps);
    const receipt = await receiptOf(a, r.orderId);
    expect(receipt).toMatchObject({ kind: 'gift', deductible: true, amountMinor: 10_000, fmvMinor: 0 });
    expect(receipt?.deductibleMinor).toBe(10_000);
    const sent = memo.sent.find((s) => s.dedupeKey === `receipt:${receipt?.id}`);
    expect(String(sent?.params.body)).toContain(
      'No goods or services were provided in exchange for this contribution.',
    );
    // The donor's link opens this receipt in this org only.
    const doc = await receiptByToken(a.org.id, receiptToken(receipt?.id ?? ''));
    expect(doc?.doc.donorName).toBe('Grace Hopper');
    expect(await receiptByToken(b.org.id, receiptToken(receipt?.id ?? ''))).toBeNull();
    expect(await receiptByToken(a.org.id, `${receipt?.id}~forged`)).toBeNull();
    expect(await receiptByToken(a.org.id, statementToken(receipt?.id ?? ''))).toBeNull();
  });

  it('a ticket type without a fair-market value gets no receipt', async () => {
    const order = await buyTickets(a, plainType.id, 'nofmv@example.test');
    await catchUpReceipts(a.org.id, deps);
    expect(await receiptOf(a, order.id)).toBeNull();
  });

  it('an unverified org issues only "not tax-deductible" receipts', async () => {
    // b's profile is pending (saved above, never verified).
    const r = await giveAndPay(b, campaignB, 10_000, 'linus@example.test');
    await catchUpReceipts(b.org.id, deps);
    const receipt = await receiptOf(b, r.orderId);
    expect(receipt).toMatchObject({ deductible: false, deductibleMinor: 0, charityEin: null });
    const sent = memo.sent.find((s) => s.dedupeKey === `receipt:${receipt?.id}`);
    expect(sent?.params.deductible).toBe('no');
    expect(String(sent?.params.body)).toContain('This payment is not tax-deductible.');
    expect(String(sent?.params.body)).not.toContain('501(c)(3)');
  });

  it('isolation: one org never reads another’s receipts', async () => {
    const ra = await executeQuery(receiptsConsoleQuery, { eventId: a.event.id }, a.ctx(), ports);
    expect(ra.receipts.length).toBeGreaterThanOrEqual(2);
    const rb = await executeQuery(receiptsConsoleQuery, { eventId: b.event.id }, b.ctx(), ports);
    expect(rb.receipts.every((x) => !ra.receipts.some((y) => y.id === x.id))).toBe(true);
    const first = ra.receipts[0]?.id ?? '';
    await expect(
      executeQuery(receiptDocumentQuery, { receiptId: first }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect((await executeQuery(receiptDocumentQuery, { receiptId: first }, a.ctx(), ports)).id).toBe(first);
    await expect(
      executeQuery(receiptsConsoleQuery, { eventId: a.event.id }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('clearing a value stops receipts for that ticket type', async () => {
    const t = await executeCommand(
      createTicketTypeCommand,
      { eventId: a.event.id, name: 'Patron', priceMinor: 20_000, quantityTotal: 10 },
      a.ctx(),
      ports,
    );
    await executeCommand(
      setFairValueCommand,
      { eventId: a.event.id, ticketTypeId: t.id, fmvMinor: 0 },
      a.ctx(),
      ports,
    );
    await executeCommand(clearFairValueCommand, { eventId: a.event.id, ticketTypeId: t.id }, a.ctx(), ports);
    const order = await buyTickets(a, t.id, 'patron@example.test');
    await catchUpReceipts(a.org.id, deps);
    expect(await receiptOf(a, order.id)).toBeNull();
  });
});

describe('year-end statements (scheduled, org timezone)', () => {
  const memo = memoryNotifier();
  const deps = { notifier: memo.notifier, appOrigin: ORIGIN };

  it('one statement per donor that totals that year’s deductible receipts exactly; reruns issue nothing', async () => {
    await verified(a);
    // Three payments by one donor (two tickets, one gift) and one by another, all this year.
    const email = 'statement-donor@example.test';
    const o1 = await buyTickets(a, gala.id, email);
    const o2 = await buyTickets(a, gala.id, email, 2);
    const g = await giveAndPay(a, campaignA, 3_333, email);
    await catchUpReceipts(a.org.id, deps);
    const mine = await withTenant(systemCtx(a.org.id), (tx) =>
      receiptsOfOrdersTx(tx, [o1.id, o2.id, g.orderId]),
    );
    expect(mine.map((r) => r.deductibleMinor).sort((x, y) => x - y)).toEqual([3_333, 35_000, 70_000]);
    const year = mine[0]?.taxYear ?? 0;
    // Not before the year is over (in the org's timezone).
    await expect(
      executeCommand(yearEndStatementsCommand, { year }, systemCtx(a.org.id), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'year_open' } });
    // Members cannot run it.
    await expect(executeCommand(yearEndStatementsCommand, { year }, a.ctx(), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    const nextYear = createCtx({
      orgId: a.org.id,
      actor: { type: 'system', name: 'donations.year-end' },
      now: new Date(Date.UTC(year + 1, 0, 15, 12)),
    });
    const run = await executeCommand(yearEndStatementsCommand, {}, nextYear, ports);
    expect(run.year).toBe(year);
    expect(run.issued).toBeGreaterThanOrEqual(2);
    const statements = await withTenant(systemCtx(a.org.id), (tx) => statementsOfYearTx(tx, year));
    const s = statements.find((x) => x.donorEmail === email);
    expect(s).toMatchObject({
      receiptCount: 3,
      amountMinor: 50_000 + 100_000 + 3_333,
      fmvMinor: 15_000 + 30_000,
      deductibleMinor: 35_000 + 70_000 + 3_333,
      charityEin: '23-4567891',
    });
    expect(await executeCommand(yearEndStatementsCommand, {}, nextYear, ports)).toEqual({ year, issued: 0 });
    // The mailer sends it to the donor only, once; the link opens it with its lines.
    await catchUpSubscriber(statementMailer(deps), a.org.id);
    await catchUpSubscriber(statementMailer(deps), a.org.id);
    const sent = memo.sent.filter((x) => x.dedupeKey === `year-end-statement:${s?.id}`);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to.email).toBe(email);
    expect(String(sent[0]?.params.body)).toContain(`Total tax-deductible amount for ${year}: $1,083.33.`);
    const doc = await statementByToken(a.org.id, statementToken(s?.id ?? ''));
    expect(doc?.doc.lines.map((l) => l.deductibleMinor).reduce((x, y) => x + y, 0)).toBe(108_333);
    expect(await statementByToken(b.org.id, statementToken(s?.id ?? ''))).toBeNull();
  });
});

describe('impersonation and the read-only freeze', () => {
  it('staff acting as a member cannot verify a charity or write statements (platform only)', async () => {
    const acting = a.ctx({ impersonatedBy: { staffUserId: uuidv7(), impersonationId: uuidv7() } });
    await expect(
      executeCommand(verifyCharityCommand, { version: 1, irs: IRS }, acting, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(yearEndStatementsCommand, { year: 2020 }, acting, ports),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('the freeze refuses profile, value, review and statement writes; receipts of completed payments still issue', async () => {
    await setFreeze({ scope: 'orgs', orgIds: [a.org.id] });
    const refused = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: 'read_only_freeze' });
    await refused(
      executeCommand(
        saveCharityProfileCommand,
        { legalName: 'Frozen', ein: '23-4567891', exemptKind: '501c3' },
        a.ctx(),
        ports,
      ),
    );
    await refused(
      executeCommand(
        setFairValueCommand,
        { eventId: a.event.id, ticketTypeId: gala.id, fmvMinor: 1 },
        a.ctx(),
        ports,
      ),
    );
    await refused(executeCommand(verifyCharityCommand, { version: 1, irs: IRS }, systemCtx(a.org.id), ports));
    await refused(executeCommand(yearEndStatementsCommand, { year: 2020 }, systemCtx(a.org.id), ports));
    await setFreeze(null);
    // A payment the provider completes (allowed during a freeze) still gets its receipt.
    const order = await buyTickets(a, gala.id, 'frozen@example.test');
    await setFreeze({ scope: 'orgs', orgIds: [a.org.id] });
    await catchUpReceipts(a.org.id, { notifier: memoryNotifier().notifier, appOrigin: ORIGIN });
    expect(await receiptOf(a, order.id)).not.toBeNull();
    await setFreeze(null);
  });
});
