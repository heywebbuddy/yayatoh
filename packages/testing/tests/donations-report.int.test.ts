import { parseXlsx } from '@yayatoh/csv';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  applyCardSetupCommand,
  armLevelCommand,
  assignPaddleCommand,
  attachCardSetupCommand,
  catchUpGiftRefunds,
  catchUpGifts,
  closeCallCommand,
  closePledgesCommand,
  collectPledges,
  confirmEntriesCommand,
  createCampaignCommand,
  createLevelCommand,
  createMatchCommand,
  type DonorExportParams,
  donationReconciliationQuery,
  donationReportQuery,
  donationsConsoleQuery,
  donorCsvExportBulk,
  donorXlsxExportBulk,
  donorXlsxFile,
  giftPaymentInput,
  matchesQuery,
  pledgeOutcomesSubscriber,
  reconcileEventDonations,
  recordDonationReconciliationCommand,
  recordPaddlesCommand,
  recordPledgePaymentCommand,
  resolveDonationReconItemCommand,
  type StartGiftResultDto,
  startCardSetupCommand,
  startGiftCommand,
  writeOffPledgeCommand,
} from '@yayatoh/donations';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { rsvpLinkToken } from '@yayatoh/guests';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  refundAtProvider,
  startCheckoutCommand,
  startRefundCommand,
} from '@yayatoh/orders';
import {
  applyAccountEventCommand,
  type FakeCardStore,
  fakePaymentProvider,
  fakeProcessingFee,
  memoEntriesTx,
  memoryBalanceStore,
  type ProviderEvent,
  type SetupEvent,
  signFakeSetupWebhook,
  signFakeWebhook,
} from '@yayatoh/payments';
import { catchUpSubscriber } from '@yayatoh/platform';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, runBulk, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M4.8g reporting, exports and reconciliation. A fixture gala with every way money arrives —
 * online and QR gifts (one with the fee covered, one anonymous, one partly refunded), a paddle
 * pledge charged to a saved card, one paid by check, one written off, one still open, a donation
 * ticket and a 1:1 match — whose report totals must equal the ledger's memo entries and the
 * connected account's balance transactions to the cent; donor CRM exports (CSV and Excel) that
 * never carry another org's donors; and reconciliation differences and payouts like M1.6e.
 */
const SECRET = 'donations-report-int-secret-0123456789abcdef';
const APP = 'http://localhost:3000';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let a: OrgFixture;
let b: OrgFixture;
/** Each org's own gala (the fixture event already carries the fixture's donations). */
const galas = new Map<string, string>();
const evt = (o: OrgFixture) => galas.get(o.org.id) ?? '';
const store = memoryBalanceStore();
const cards: FakeCardStore = { charges: new Map(), declinedOnce: new Set() };
let clock: Date | null = null;
const provider = fakePaymentProvider({
  secret: SECRET,
  appOrigin: APP,
  store,
  cards,
  now: () => clock ?? new Date(),
});
const acct = (o: OrgFixture) => `fakeacct_${o.org.slug}`;
const q = <T extends Record<string, unknown>>(o: OrgFixture, query: ReturnType<typeof sql>) =>
  withTenant(systemCtx(o.org.id), (tx) => tx.execute<T>(query));
const guestCtx = (o: OrgFixture): Ctx => createCtx({ orgId: o.org.id, idempotencyKey: uuidv7() });

async function connect(o: OrgFixture) {
  await executeCommand(
    applyAccountEventCommand,
    {
      provider: 'fake',
      id: `evt_acct_${o.org.id}`,
      type: 'account.updated',
      orgId: o.org.id,
      account: {
        accountId: acct(o),
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

async function newGala(o: OrgFixture) {
  const e = await executeCommand(
    createEventCommand,
    {
      name: `Report Gala ${uuidv7().slice(-4)}`,
      profile: 'gala',
      timezone: 'America/Chicago',
      startsAt: '2026-11-20T00:00:00Z',
      endsAt: '2026-11-20T05:00:00Z',
    },
    o.ctx(),
    ports,
  );
  await executeCommand(
    createTicketTypeCommand,
    { eventId: e.id, name: 'Gala seat', priceMinor: 0, quantityTotal: 50 },
    o.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, o.ctx(), ports);
  galas.set(o.org.id, e.id);
}

async function campaignOf(o: OrgFixture, name: string) {
  const c = await executeCommand(
    createCampaignCommand,
    { eventId: evt(o), name, goalMinor: 10_000_000, minGiftMinor: 100, maxGiftMinor: 5_000_000 },
    o.ctx(),
    ports,
  );
  const level = async (n: string, amountMinor: number) =>
    (
      await executeCommand(
        createLevelCommand,
        { eventId: evt(o), campaignId: c.id, name: n, amountMinor },
        o.ctx(),
        ports,
      )
    ).id;
  return { id: c.id, gold: await level('Gold', 100_000), silver: await level('Silver', 25_000) };
}

/** A gift on the giving page, paid on the fake provider's page (a direct charge on the account). */
async function gift(
  o: OrgFixture,
  campaignId: string,
  input: Record<string, unknown>,
  opts: { onAccount?: boolean } = {},
) {
  const r: StartGiftResultDto = await executeCommand(
    startGiftCommand,
    { eventId: evt(o), campaignId, displayAs: 'full_name', ...input },
    guestCtx(o),
    ports,
  );
  const payment = await provider.createPayment(
    giftPaymentInput(o.org.id, r, { description: 'Gift', returnUrl: `${APP}/t` }),
  );
  await executeCommand(
    attachPaymentCommand,
    { orderId: r.orderId, provider: 'fake', providerPaymentId: payment.providerPaymentId },
    guestCtx(o),
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
    ...(opts.onAccount === false ? {} : { connectedAccountId: acct(o) }),
  });
  const e = (await provider.verifyWebhook(
    body,
    new Headers({ 'x-fake-signature': signature }),
  )) as ProviderEvent;
  await executeCommand(applyProviderEventCommand, e, systemCtx(o.org.id), ports);
  await catchUpGifts(o.org.id);
  return r;
}

async function party(o: OrgFixture, name: string) {
  const linkId = uuidv7();
  const partyId = await withTenant(systemCtx(o.org.id), async (tx) => {
    const [p] = await tx.execute<{ id: string }>(
      sql`insert into guests.parties (org_id, event_id, name) values (${o.org.id}, ${evt(o)}, ${name}) returning id`,
    );
    await tx.execute(sql`insert into guests.guests (org_id, event_id, party_id, first_name, last_name, is_primary)
      values (${o.org.id}, ${evt(o)}, ${p?.id}, ${name}, 'Donor', true)`);
    await tx.execute(sql`insert into guests.party_rsvp (org_id, event_id, party_id, link_id, link_expires_at)
      values (${o.org.id}, ${evt(o)}, ${p?.id}, ${linkId}, now() + interval '400 days')`);
    return p?.id ?? '';
  });
  const paddle = await executeCommand(assignPaddleCommand, { eventId: evt(o), partyId }, o.ctx(), ports);
  return { partyId, paddle: paddle.number, token: rsvpLinkToken(linkId) };
}

async function pledge(o: OrgFixture, campaignId: string, levelId: string, paddles: number[]) {
  const call = await executeCommand(
    armLevelCommand,
    { eventId: evt(o), campaignId, levelId },
    o.ctx(),
    ports,
  );
  await executeCommand(
    recordPaddlesCommand,
    {
      eventId: evt(o),
      entries: paddles.map((paddle) => ({
        clientId: uuidv7(),
        callId: call.id,
        paddle,
        recordedAt: new Date(),
      })),
    },
    o.ctx(),
    ports,
  );
  await executeCommand(closeCallCommand, { eventId: evt(o), callId: call.id }, o.ctx(), ports);
  await executeCommand(confirmEntriesCommand, { eventId: evt(o), callId: call.id }, o.ctx(), ports);
}

async function saveCard(o: OrgFixture, rsvpToken: string) {
  const started = await executeCommand(
    startCardSetupCommand,
    {
      eventId: evt(o),
      name: 'Rivera Donor',
      email: 'rivera@example.test',
      consent: true,
      source: 'table',
      rsvpToken,
      locale: 'en',
    },
    guestCtx(o),
    ports,
  );
  const setup = await provider.createCardSetup({
    ...started.setup,
    description: 'Gala',
    returnUrl: `${APP}/back`,
  });
  await executeCommand(
    attachCardSetupCommand,
    { cardId: started.cardId, provider: 'fake', providerSetupId: setup.providerSetupId },
    guestCtx(o),
    ports,
  );
  const { body, signature } = signFakeSetupWebhook(SECRET, {
    orgId: o.org.id,
    reference: started.cardId,
    providerSetupId: setup.providerSetupId,
    connectedAccountId: started.setup.connectedAccountId,
    email: started.setup.email,
    outcome: 'succeeded',
    card: '4242',
  });
  const event = (await provider.verifyWebhook(
    body,
    new Headers({ 'x-fake-signature': signature }),
  )) as SetupEvent;
  await executeCommand(applyCardSetupCommand, event, systemCtx(o.org.id), ports);
}

/** The database's own message, under the query wrapper's. */
const dbError = (re: RegExp) => (e: unknown) =>
  re.test(String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message));

const pledgeIdOf = async (o: OrgFixture, partyId: string) =>
  (await q<{ id: string }>(o, sql`select id from donations.pledges where party_id = ${partyId}`))[0]?.id ??
  '';

const report = (o: OrgFixture = a, ctx: Ctx = o.ctx()) =>
  executeQuery(donationReportQuery, { eventId: evt(o) }, ctx, ports);
const usd = async (o: OrgFixture = a) => {
  const t = (await report(o)).totals.find((x) => x.currency === 'USD');
  if (!t) throw new Error('no USD totals');
  return t;
};

const LABELS: DonorExportParams['labels'] = {
  headers: {
    date: 'Date',
    firstName: 'First name',
    lastName: 'Last name',
    donor: 'Donor',
    email: 'Email',
    anonymous: 'Anonymous',
    amount: 'Amount',
    gift: 'Gift',
    feeCover: 'Fee covered',
    refunded: 'Refunded',
    currency: 'Currency',
    campaign: 'Campaign',
    level: 'Level',
    source: 'Source',
    method: 'Method',
    employer: 'Employer',
    tribute: 'Tribute',
    paddle: 'Paddle',
    reference: 'Reference',
  },
  yes: 'Yes',
  no: 'No',
  sources: { online: 'Online', qr: 'QR code', paddle: 'Paddle raise', ticket: 'Ticket donation' },
  methods: {
    card: 'Card',
    check: 'Check',
    wire: 'Wire',
    stock: 'Stock',
    daf: 'DAF',
    cash: 'Cash',
    other: 'Other',
  },
};

let campaign: { id: string; gold: string; silver: string };
let g1: StartGiftResultDto;
let g2: StartGiftResultDto;
let g3: StartGiftResultDto;
let cover = 0;
let refundId = '';

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  await connect(a);
  await connect(b);
  await newGala(a);
  await newGala(b);
  campaign = await campaignOf(a, 'Report Fund');
  // A 1:1 match over the next hours (its matched amount is reported per match).
  await executeCommand(
    createMatchCommand,
    {
      eventId: evt(a),
      campaignId: campaign.id,
      sponsorName: 'Harbor Bank',
      sponsorEmail: 'giving@harbor.test',
      publicName: 'Harbor Bank',
      ratioPercent: 100,
      capMinor: 2_500_000,
      startsAt: new Date(Date.now() - HOUR),
      endsAt: new Date(Date.now() + HOUR),
    },
    a.ctx(),
    ports,
  );
  // Online gifts: Gold with the fee covered; an anonymous QR gift naming an employer; one refunded in part.
  g1 = await gift(a, campaign.id, {
    levelId: campaign.gold,
    coverFee: true,
    donor: { name: 'Ada Lovelace', email: 'ada@example.test' },
  });
  cover = g1.totalMinor - 100_000;
  g2 = await gift(a, campaign.id, {
    amountMinor: 50_000,
    displayAs: 'anonymous',
    employer: 'Acme Corp',
    source: 'qr',
    donor: { name: 'Ben Quiet', email: 'ben@example.test' },
  });
  g3 = await gift(a, campaign.id, {
    amountMinor: 20_000,
    tribute: { kind: 'memory', name: 'Grandma Lu' },
    donor: { name: 'Cleo Park', email: 'cleo@example.test' },
  });
  const started = await executeCommand(
    startRefundCommand,
    { orderId: g3.orderId, amountMinor: 5_000, reason: 'requested_by_customer' },
    a.ctx({ idempotencyKey: uuidv7() }),
    ports,
  );
  refundId = started.refundId;
  await refundAtProvider(started, a.ctx(), ports, provider);
  await catchUpGiftRefunds(a.org.id);

  // The paddle raise: Rivera (saved card) and Okafor raise Gold, Nakamura and Lee raise Silver.
  const rivera = await party(a, 'Rivera');
  const okafor = await party(a, 'Okafor');
  const nakamura = await party(a, 'Nakamura');
  const lee = await party(a, 'Lee');
  await saveCard(a, rivera.token);
  await pledge(a, campaign.id, campaign.gold, [rivera.paddle, okafor.paddle]);
  await pledge(a, campaign.id, campaign.silver, [nakamura.paddle, lee.paddle]);
  // Nakamura pays by check before the night is closed.
  await executeCommand(
    recordPledgePaymentCommand,
    {
      eventId: evt(a),
      pledgeId: await pledgeIdOf(a, nakamura.partyId),
      method: 'check',
      reference: '#1042',
      receivedOn: '2026-01-02',
      note: 'Mailed',
    },
    a.ctx({ idempotencyKey: uuidv7() }),
    ports,
  );
  const { chargeAt } = await executeCommand(closePledgesCommand, { eventId: evt(a) }, a.ctx(), ports);
  await executeCommand(
    writeOffPledgeCommand,
    { eventId: evt(a), pledgeId: await pledgeIdOf(a, lee.partyId), note: 'Moved away' },
    a.ctx(),
    ports,
  );
  // The next morning Rivera's card is charged exactly the pledge.
  await collectPledges(a.org.id, { provider, ports }, { now: chargeAt as Date });
  await catchUpSubscriber(pledgeOutcomesSubscriber, a.org.id);
  await catchUpGifts(a.org.id);

  // A "pay what you want" supporter ticket (a ticket donation) bought at checkout.
  const supporter = await executeCommand(
    createTicketTypeCommand,
    { eventId: evt(a), name: 'Supporter', priceMinor: 1000, isDonation: true, quantityTotal: 100 },
    a.ctx(),
    ports,
  );
  const checkout = await executeCommand(
    startCheckoutCommand,
    {
      eventId: evt(a),
      items: [{ ticketTypeId: supporter.id, quantity: 1, amountMinor: 5_000 }],
      buyer: { email: 'dee@example.test', name: 'Dee Supporter' },
    },
    guestCtx(a),
    ports,
  );
  await executeCommand(
    attachPaymentCommand,
    { orderId: checkout.order.id, provider: 'fake', providerPaymentId: `fakepi_t_${checkout.order.id}` },
    guestCtx(a),
    ports,
  );
  await executeCommand(
    applyProviderEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_t_${checkout.order.id}`,
      type: 'payment.succeeded',
      providerPaymentId: `fakepi_t_${checkout.order.id}`,
      amountMinor: checkout.order.totalMinor,
      currency: checkout.order.currency,
      orgId: a.org.id,
      orderId: checkout.order.id,
    },
    systemCtx(a.org.id),
    ports,
  );

  // The other org's gala has its own donor.
  const theirs = await campaignOf(b, 'Their Fund');
  await gift(b, theirs.id, { amountMinor: 7_000, donor: { name: 'Zed Other', email: 'zed@other-org.test' } });
}, 240_000);
afterAll(closePools);

describe('the report (M4.8g)', () => {
  it('totals per currency: received online, offline and by ticket; pledged vs collected vs written off', async () => {
    const t = await usd();
    const onlineNet = 100_000 + cover + 50_000 + (20_000 - 5_000) + 100_000;
    expect(t).toMatchObject({
      onlineNetMinor: onlineNet,
      offlineMinor: 25_000,
      ticketMinor: 5_000,
      raisedMinor: onlineNet + 25_000 + 5_000,
      feeCoverMinor: cover,
      refundedMinor: 5_000,
      pledgedMinor: 250_000,
      pledgeCollectedMinor: 125_000,
      writtenOffMinor: 25_000,
      pledgeOpenMinor: 100_000,
    });
    const r = await report();
    expect(r.pledges).toEqual([
      {
        currency: 'USD',
        count: 4,
        pledgedMinor: 250_000,
        cardMinor: 100_000,
        linkMinor: 0,
        offlineMinor: 25_000,
        writtenOffMinor: 25_000,
        openMinor: 100_000,
      },
    ]);
  });

  it('the campaign’s raised total nets refunds too (the giving page and the screen read it)', async () => {
    const view = await executeQuery(donationsConsoleQuery, { eventId: evt(a) }, a.ctx(), ports);
    const c = view.campaigns.find((x) => x.id === campaign.id);
    // Gifts less the $50 refund, the card-paid pledge, and the pledge paid by check.
    expect(c).toMatchObject({
      raisedMinor: 100_000 + 50_000 + 15_000 + 100_000 + 25_000,
      feeCoverMinor: cover,
    });
  });

  it('acceptance: the totals equal the ledger memo entries and the provider’s balance transactions to the cent', async () => {
    const t = await usd();
    // The ledger: one memo per paid gift (its gross) and per refund (negative); no postings.
    const memos = await withTenant(systemCtx(a.org.id), (tx) => memoEntriesTx(tx, evt(a)));
    const memoSum = memos.filter((m) => m.currency === 'USD').reduce((n, m) => n + m.amountMinor, 0);
    expect(memoSum).toBe(t.onlineNetMinor);
    expect(t.ledgerMinor).toBe(t.onlineNetMinor);
    expect(memos.map((m) => m.kind).sort()).toEqual([
      'donation_memo',
      'donation_memo',
      'donation_memo',
      'donation_memo',
      'donation_refund_memo',
    ]);
    // The provider: the connected account's charges and refunds for these orders.
    const listed =
      (await provider.listConnectedBalanceTransactions({
        connectedAccountId: acct(a),
        from: new Date(Date.now() - 30 * DAY),
        to: new Date(Date.now() + 30 * DAY),
      })) ?? [];
    const providerSum = listed.reduce((n, x) => n + x.amountMinor, 0);
    expect(providerSum).toBe(t.onlineNetMinor);
    // Before the first reconciliation the report has no provider figure; after it, the same cents.
    expect(t.providerMinor).toBeNull();
    const run = await reconcileEventDonations(provider, evt(a), a.ctx(), ports);
    expect(run).toMatchObject({ ledgerCount: 5, providerCount: 5, itemCount: 0 });
    const after = await usd();
    expect(after.providerMinor).toBe(t.onlineNetMinor);
    expect(after.providerFeeMinor).toBe(listed.reduce((n, x) => n + x.feeMinor, 0));
    expect(after.providerFeeMinor).toBe(
      fakeProcessingFee(g1.totalMinor) +
        fakeProcessingFee(50_000) +
        fakeProcessingFee(20_000) +
        fakeProcessingFee(100_000),
    );
  });

  it('per source, per level, per match and per donor', async () => {
    const r = await report();
    expect(r.bySource).toEqual([
      { source: 'online', currency: 'USD', count: 2, netMinor: 100_000 + cover + 15_000 },
      { source: 'qr', currency: 'USD', count: 1, netMinor: 50_000 },
      { source: 'paddle', currency: 'USD', count: 2, netMinor: 125_000 },
      { source: 'ticket', currency: 'USD', count: 1, netMinor: 5_000 },
    ]);
    const gold = r.byLevel.find((l) => l.levelId === campaign.gold);
    expect(gold).toMatchObject({
      name: 'Gold',
      giftCount: 1,
      giftNetMinor: 100_000 + cover,
      pledgeCount: 2,
      pledgedMinor: 200_000,
    });
    const silver = r.byLevel.find((l) => l.levelId === campaign.silver);
    expect(silver).toMatchObject({ giftCount: 0, pledgeCount: 2, pledgedMinor: 50_000 });
    // Own amounts (no level) come last.
    expect(r.byLevel.at(-1)).toMatchObject({ levelId: null, giftCount: 2, giftNetMinor: 65_000 });
    // The match: what the matches page says it came to.
    const m = (await executeQuery(matchesQuery, { eventId: evt(a) }, a.ctx(), ports)).matches[0];
    expect(r.byMatch).toEqual([
      expect.objectContaining({
        sponsorName: 'Harbor Bank',
        status: 'active',
        matchedMinor: m?.matchedMinor,
        campaignName: 'Report Fund',
      }),
    ]);
    expect(m?.matchedMinor).toBeGreaterThan(0);
    // Donors, largest first; the anonymous donor is flagged (the host still sees who gave).
    expect(r.byDonor[0]).toMatchObject({ name: 'Ada Lovelace', netMinor: 100_000 + cover });
    expect(r.byDonor.find((d) => d.email === 'ben@example.test')).toMatchObject({
      anonymous: true,
      netMinor: 50_000,
    });
    expect(r.byDonor.find((d) => d.email === 'dee@example.test')).toMatchObject({
      netMinor: 5_000,
      anonymous: false,
    });
    expect(r.donorsTruncated).toBe(false);
  });

  it('finance roles and co-hosts only: a viewer is refused; another org sees only its own', async () => {
    await expect(report(a, userCtx(a.viewerId, a.org.id))).rejects.toMatchObject({ code: 'forbidden' });
    const theirs = await report(b);
    expect(theirs.byDonor.map((d) => d.email)).toEqual(['zed@other-org.test']);
    // b cannot read a's event.
    await expect(
      executeQuery(donationReportQuery, { eventId: evt(a) }, b.ctx(), ports),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('donor CRM exports (M4.8g)', () => {
  const start = (bulk: typeof donorCsvExportBulk, layout: DonorExportParams['layout'], ctx: Ctx = a.ctx()) =>
    executeCommand(
      bulk.start,
      { eventId: evt(a), selection: { filter: {} }, params: { layout, labels: LABELS } },
      ctx,
      ports,
    );

  it('need a recent step-up and finance access', async () => {
    await expect(start(donorCsvExportBulk, 'generic', a.ctx({ stepUpAt: null }))).rejects.toMatchObject({
      code: 'step_up_required',
    });
    await expect(start(donorCsvExportBulk, 'generic', userCtx(a.viewerId, a.org.id))).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('CSV, generic layout: one row per gift, offline payment and donation ticket; the anonymous flag kept; never another org’s donors', async () => {
    const { operationId } = await start(donorCsvExportBulk, 'generic');
    await runBulk(a.org.id, operationId);
    const file = await executeQuery(donorCsvExportBulk.file, { operationId }, a.ctx(), ports);
    expect(file.name).toMatch(/^donations-generic-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(file.contentType).toBe('text/csv; charset=utf-8');
    const lines = file.content.replace(/^﻿/, '').trim().split(/\r?\n/);
    expect(lines[0]).toBe(
      'Date,Donor,Email,Anonymous,Amount,Gift,Fee covered,Refunded,Currency,Campaign,Level,Source,Method,Employer,Tribute,Paddle,Reference',
    );
    expect(lines).toHaveLength(7);
    const row = (email: string) => lines.find((l) => l.includes(email)) ?? '';
    expect(row('ada@example.test')).toContain(
      `,Ada Lovelace,ada@example.test,No,${((100_000 + cover) / 100).toFixed(2)},1000.00,`,
    );
    expect(row('ben@example.test')).toMatch(
      /,Ben Quiet,ben@example\.test,Yes,500\.00,500\.00,0\.00,0\.00,USD,Report Fund,,QR code,Card,Acme Corp,,,/,
    );
    expect(row('cleo@example.test')).toContain(
      ',150.00,200.00,0.00,50.00,USD,Report Fund,,Online,Card,,Grandma Lu,',
    );
    expect(row('rivera@example.test')).toMatch(/,Paddle raise,Card,,,\d+,/);
    expect(lines.some((l) => l.includes(',Paddle raise,Check,'))).toBe(true);
    expect(row('dee@example.test')).toContain(
      ',Dee Supporter,dee@example.test,No,50.00,50.00,0.00,0.00,USD,,Supporter,Ticket donation,Card,',
    );
    // Written-off and open pledges are not money received; the other org's donor never appears.
    expect(file.content).not.toContain('zed@other-org.test');
    expect(file.content).not.toContain('Zed Other');
  });

  it('CSV, Salesforce NPSP layout: the CRM’s own field names, split names, TRUE/FALSE anonymous', async () => {
    const { operationId } = await start(donorCsvExportBulk, 'salesforce_npsp');
    await runBulk(a.org.id, operationId);
    const file = await executeQuery(donorCsvExportBulk.file, { operationId }, a.ctx(), ports);
    const lines = file.content.replace(/^﻿/, '').trim().split(/\r?\n/);
    expect(lines[0]).toBe(
      'Contact1 First Name,Contact1 Last Name,Contact1 Personal Email,Donation Amount,Donation Date,Donation Campaign Name,Payment Method,Donation Description,Anonymous,Contact1 Employer,Honoree Name,Donation Import Reference',
    );
    expect(lines.find((l) => l.includes('ben@example.test'))).toMatch(
      /^Ben,Quiet,ben@example\.test,500\.00,\d{4}-\d{2}-\d{2},Report Fund,Credit Card,,TRUE,Acme Corp,,/,
    );
  });

  it('Excel: the same rows in a workbook, amounts as numbers; never another org’s donors', async () => {
    const { operationId } = await start(donorXlsxExportBulk, 'bloomerang');
    await runBulk(a.org.id, operationId);
    const file = await executeQuery(donorXlsxExportBulk.file, { operationId }, a.ctx(), ports);
    expect(file.name).toMatch(/^donations-bloomerang-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const book = parseXlsx(donorXlsxFile(file.content));
    expect(book.sheets).toEqual(['Donations']);
    expect(book.headers).toEqual([
      'First Name',
      'Last Name',
      'Email',
      'Date',
      'Amount',
      'Method',
      'Campaign',
      'Appeal',
      'Note',
      'Is Anonymous',
      'Tribute',
      'Transaction Reference',
    ]);
    expect(book.rows).toHaveLength(6);
    expect(book.rows.find((r) => r[2] === 'ben@example.test')?.slice(4, 10)).toEqual([
      '500',
      'Credit Card',
      'Report Fund',
      'QR code',
      '',
      'TRUE',
    ]);
    expect(JSON.stringify(book.rows)).not.toContain('other-org');
  });
});

describe('reconciliation (M4.8g, like M1.6e)', () => {
  const recon = (ctx: Ctx = a.ctx()) =>
    executeQuery(donationReconciliationQuery, { eventId: evt(a) }, ctx, ports);

  it('lists a missing provider charge and an amount mismatch, keeps a resolution, clears what agrees again', async () => {
    // A gift whose charge the provider never reported (the webhook did not name the account).
    const g4 = await gift(
      a,
      campaign.id,
      { amountMinor: 3_000, donor: { name: 'Eve Late', email: 'eve@example.test' } },
      { onAccount: false },
    );
    // The provider saw a different amount for g2's charge (an extra movement on its reference).
    store.addConnected?.(acct(a), {
      id: `fakebt_drift_${g2.orderId}`,
      kind: 'charge',
      amountMinor: 100,
      feeMinor: 0,
      netMinor: 100,
      currency: 'USD',
      occurredAt: new Date(),
      reference: `order:${g2.orderId}`,
    });
    const run = await reconcileEventDonations(provider, evt(a), a.ctx(), ports);
    expect(run).toMatchObject({ itemCount: 2, opened: 2 });
    const v = await recon();
    expect(
      v.items.map((i) => [i.kind, i.reference, i.ledgerMinor, i.providerMinor, i.differenceMinor, i.status]),
    ).toEqual(
      expect.arrayContaining([
        ['missing_at_provider', `order:${g4.orderId}`, 3_000, 0, -3_000, 'open'],
        ['amount_mismatch', `order:${g2.orderId}`, 50_000, 50_100, 100, 'open'],
      ]),
    );
    // The report's check shows the same difference.
    const t = await usd();
    expect((t.providerMinor ?? 0) - t.ledgerMinor).toBe(100 - 3_000);

    // Finance resolves the mismatch with a note; a viewer cannot; a short note is refused.
    const mismatch = v.items.find((i) => i.kind === 'amount_mismatch');
    await expect(
      executeCommand(
        resolveDonationReconItemCommand,
        { eventId: evt(a), itemId: mismatch?.id ?? '', note: 'Bank fee' },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        resolveDonationReconItemCommand,
        { eventId: evt(a), itemId: mismatch?.id ?? '', note: 'x' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await executeCommand(
      resolveDonationReconItemCommand,
      { eventId: evt(a), itemId: mismatch?.id ?? '', note: 'Provider adjustment, confirmed with Stripe' },
      a.ctx(),
      ports,
    );
    await expect(
      executeCommand(
        resolveDonationReconItemCommand,
        { eventId: evt(a), itemId: mismatch?.id ?? '', note: 'again' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state' });

    // The provider's charge for g4 turns up: the next run clears it; the resolution stays.
    store.addConnected?.(acct(a), {
      id: `fakebt_late_${g4.orderId}`,
      kind: 'charge',
      amountMinor: 3_000,
      feeMinor: fakeProcessingFee(3_000),
      netMinor: 3_000 - fakeProcessingFee(3_000),
      currency: 'USD',
      occurredAt: new Date(),
      reference: `order:${g4.orderId}`,
    });
    const again = await reconcileEventDonations(provider, evt(a), a.ctx(), ports);
    expect(again).toMatchObject({ itemCount: 1, opened: 0, cleared: 1 });
    const w = await recon();
    expect(w.items.map((i) => [i.reference, i.status])).toEqual([
      [`order:${g2.orderId}`, 'resolved'],
      [`order:${g4.orderId}`, 'cleared'],
    ]);
    expect(w.items[0]?.resolutionNote).toBe('Provider adjustment, confirmed with Stripe');
  });

  it('shows the payouts that carried the event’s gifts and what is not paid out yet', async () => {
    const before = await recon();
    expect(before.payouts).toEqual([]);
    expect(before.lastRun?.totals[0]?.unpaidOutCount).toBeGreaterThan(0);
    // Three days later the fake's daily payouts have been made and have arrived.
    clock = new Date(Date.now() + 3 * DAY);
    try {
      await reconcileEventDonations(provider, evt(a), a.ctx(), ports);
    } finally {
      clock = null;
    }
    const v = await recon();
    expect(v.payouts.length).toBeGreaterThanOrEqual(1);
    const listed =
      (await provider.listConnectedBalanceTransactions({
        connectedAccountId: acct(a),
        from: new Date(Date.now() - 30 * DAY),
        to: new Date(Date.now() + 30 * DAY),
      })) ?? [];
    const ours = listed.filter((x) => x.reference !== null);
    const net = ours.reduce((n, x) => n + x.netMinor, 0);
    expect(v.payouts.reduce((n, p) => n + p.donationNetMinor, 0)).toBe(net);
    expect(v.payouts.every((p) => p.status === 'paid' && /^\d{4}-\d{2}-\d{2}$/.test(p.arrivalDate))).toBe(
      true,
    );
    expect(v.lastRun?.totals[0]).toMatchObject({ unpaidOutMinor: 0, unpaidOutCount: 0 });
  });

  it('finance only; refuses another org’s event; ledger and provider data never cross orgs', async () => {
    await expect(
      reconcileEventDonations(provider, evt(a), userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(recon(userCtx(a.viewerId, a.org.id))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        recordDonationReconciliationCommand,
        { eventId: evt(a), provider: 'fake', movements: [], payouts: [] },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    // b's own reconciliation sees only b's gift, even though a's movements are listed too.
    const run = await reconcileEventDonations(provider, evt(b), b.ctx(), ports);
    expect(run).toMatchObject({ ledgerCount: 1, providerCount: 1, itemCount: 0 });
  });

  it('memo entries are written only through payments.post_memo, which takes memo kinds only', async () => {
    await expect(
      withTenant(systemCtx(a.org.id), (tx) =>
        tx.execute(
          sql`select * from payments.post_memo(${a.org.id}, 'x:1', 'sale', 'order', ${uuidv7()}, now(), '{}'::jsonb, ${evt(a)})`,
        ),
      ),
    ).rejects.toSatisfy(dbError(/not a memo kind/));
    await expect(
      withTenant(systemCtx(a.org.id), (tx) =>
        tx.execute(
          sql`select * from payments.post_memo(${b.org.id}, 'x:2', 'donation_memo', 'order', ${uuidv7()}, now(), '{}'::jsonb, ${evt(a)})`,
        ),
      ),
    ).rejects.toSatisfy(dbError(/org mismatch/));
    // A replayed memo (the same key) is not written twice.
    const [n] = await q<{ n: number }>(
      a,
      sql`select count(*)::int as n from payments.journal_entries where idempotency_key = ${`donation:${g1.orderId}`}`,
    );
    expect(n?.n).toBe(1);
    expect(refundId).not.toBe('');
  });
});
