import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  catchUpGifts,
  createCampaignCommand,
  createLevelCommand,
  deleteLevelCommand,
  donationsConsoleQuery,
  giftPaymentInput,
  giftReceipt,
  giftRetentionCommand,
  giftsExportBulk,
  processingFeeCover,
  publicGiving,
  type StartGiftResultDto,
  startGiftCommand,
  updateCampaignCommand,
} from '@yayatoh/donations';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { applyProviderEventCommand, attachPaymentCommand, expireOrdersCommand } from '@yayatoh/orders';
import {
  applyAccountEventCommand,
  fakePaymentProvider,
  type ProviderEvent,
  signFakeWebhook,
} from '@yayatoh/payments';
import { ERASED_EMAIL, ERASED_NAME } from '@yayatoh/platform';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, runBulk, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M4.8a donations: campaigns and levels, gifts as direct charges on the connected account with
 * application fee 0 (P4-9, P4-10), the fee cover, webhook replays, donor privacy (P4-13), the
 * CSV export, permissions and tenant isolation.
 */
let a: OrgFixture;
let b: OrgFixture;
let campaignId: string;
let levelId: string;
const SECRET = 'donations-int-test-secret-0123456789abcdef';
const provider = fakePaymentProvider({ secret: SECRET, appOrigin: 'http://localhost:3000' });
const acct = (o: OrgFixture) => `fakeacct_${o.org.slug}`;

/** The giving page's anonymous donor, with the form's Idempotency-Key. */
const donorCtx = (o: OrgFixture = a, key: string = uuidv7()): Ctx =>
  createCtx({ orgId: o.org.id, idempotencyKey: key });

const give = (input: Record<string, unknown>, ctx: Ctx = donorCtx()) =>
  executeCommand(
    startGiftCommand,
    {
      eventId: a.event.id,
      campaignId,
      donor: { name: 'Dana Q. Donor', email: 'Dana@Example.test' },
      displayAs: 'full_name',
      ...input,
    },
    ctx,
    ports,
  );

/** The web's payment step: the fake provider's payment, recorded on the order (5 more minutes). */
async function pay(o: OrgFixture, r: StartGiftResultDto) {
  const payment = await provider.createPayment(
    giftPaymentInput(o.org.id, r, { description: 'Gift', returnUrl: 'http://x/thanks' }),
  );
  await executeCommand(
    attachPaymentCommand,
    { orderId: r.orderId, provider: 'fake', providerPaymentId: payment.providerPaymentId },
    donorCtx(o),
    ports,
  );
  return payment;
}

/** What the fake provider's hosted page posts back, verified like the webhook route does. */
async function webhook(
  o: OrgFixture,
  r: StartGiftResultDto,
  type: 'payment.succeeded' | 'payment.failed' = 'payment.succeeded',
  id?: string,
) {
  const payment = await provider.createPayment(
    giftPaymentInput(o.org.id, r, { description: 'Gift', returnUrl: 'http://x/thanks' }),
  );
  const { body, signature } = signFakeWebhook(SECRET, {
    ...(id ? { id } : {}),
    type,
    providerPaymentId: payment.providerPaymentId,
    amountMinor: r.totalMinor,
    currency: r.currency,
    orgId: o.org.id,
    orderId: r.orderId,
    applicationFeeMinor: 0,
  });
  return (await provider.verifyWebhook(
    body,
    new Headers({ 'x-fake-signature': signature }),
  )) as ProviderEvent;
}

const apply = (o: OrgFixture, e: ProviderEvent) =>
  executeCommand(applyProviderEventCommand, e, systemCtx(o.org.id), ports);

const consoleOf = (o: OrgFixture = a, ctx: Ctx = o.ctx()) =>
  executeQuery(donationsConsoleQuery, { eventId: o.event.id }, ctx, ports);

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

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const c = await executeCommand(
    createCampaignCommand,
    {
      eventId: a.event.id,
      name: 'Scholarship Fund',
      description: 'Send a student to camp.',
      goalMinor: 2_500_000,
      minGiftMinor: 1_000,
      maxGiftMinor: 500_000,
    },
    a.ctx(),
    ports,
  );
  campaignId = c.id;
  levelId = (
    await executeCommand(
      createLevelCommand,
      {
        eventId: a.event.id,
        campaignId,
        name: 'Classroom',
        amountMinor: 100_000,
        description: 'Funds a classroom',
      },
      a.ctx(),
      ports,
    )
  ).id;
});
afterAll(closePools);

describe('campaigns and levels (M4.8a)', () => {
  it('validates goals, limits, names and amounts', async () => {
    const base = { eventId: a.event.id, name: 'Another', goalMinor: 1_000 };
    await expect(
      executeCommand(createCampaignCommand, { ...base, goalMinor: 0 }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(
        createCampaignCommand,
        { ...base, minGiftMinor: 5_000, maxGiftMinor: 1_000 },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'limits', field: 'maxGiftMinor' },
    });
    await expect(
      executeCommand(createCampaignCommand, { ...base, name: 'Scholarship Fund' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'conflict', details: { field: 'name' } });
    await expect(
      executeCommand(
        createLevelCommand,
        { eventId: a.event.id, campaignId, name: 'Same amount', amountMinor: 100_000 },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'amount_taken' } });
  });

  it('the campaign takes the event’s currency and default limits', async () => {
    const view = await consoleOf();
    const c = view.campaigns.find((x) => x.id === campaignId);
    expect(c).toMatchObject({
      name: 'Scholarship Fund',
      goalMinor: 2_500_000,
      currency: a.event.currency,
      status: 'open',
      levels: [{ id: levelId, name: 'Classroom', amountMinor: 100_000, description: 'Funds a classroom' }],
    });
    // The fixture's lapsed gift is not counted; its campaign keeps 0 raised.
    const fixture = view.campaigns.find((x) => x.name === 'Fixture Fund');
    expect(fixture).toMatchObject({
      raisedMinor: 0,
      giftCount: 0,
      minGiftMinor: 500,
      maxGiftMinor: 2_500_000,
    });
  });

  it('viewers read the tab but cannot change campaigns or levels', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    expect((await consoleOf(a, viewer)).campaigns.length).toBeGreaterThan(0);
    await expect(
      executeCommand(
        createCampaignCommand,
        { eventId: a.event.id, name: 'Nope', goalMinor: 1 },
        viewer,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(deleteLevelCommand, { eventId: a.event.id, levelId }, viewer, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('another org can neither see nor change this org’s campaign', async () => {
    await expect(
      executeQuery(donationsConsoleQuery, { eventId: a.event.id }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(
        createLevelCommand,
        { eventId: a.event.id, campaignId, name: 'Sneaky', amountMinor: 7_000 },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect((await consoleOf(b)).campaigns.map((c) => c.name)).toEqual(['Fixture Fund']);
  });
});

describe('gifts need a connected account (P4-9)', () => {
  it('an unconnected org refuses gifts and its public page is unavailable', async () => {
    await expect(give({ levelId })).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'not_connected' },
    });
    expect(await publicGiving(a.org.id, a.event.id)).toEqual({
      available: false,
      campaigns: [],
      processingFee: { percentBps: 290, fixedMinor: 30 },
    });
    expect((await consoleOf()).connected).toBe(false);
  });
});

describe('gifts on a connected org', () => {
  beforeAll(async () => {
    await connect(a);
  });

  it('a level gift with the fee cover charges exactly gift + cover on the connected account, fee 0', async () => {
    const r = await give({
      levelId,
      coverFee: true,
      displayAs: 'anonymous',
      employer: 'Acme Corp',
      tribute: { kind: 'memory', name: 'Grandpa Joe', recipient: 'The Joe family', note: 'With love.' },
    });
    const cover = processingFeeCover(100_000);
    expect(cover).toBe(3_018);
    expect(r).toMatchObject({
      amountMinor: 100_000,
      feeCoverMinor: cover,
      totalMinor: 100_000 + cover,
      currency: a.event.currency,
      buyerEmail: 'dana@example.test',
      payment: { fundsFlow: 'organizer_mor', connectedAccountId: acct(a), applicationFeeMinor: 0 },
    });
    // The fake provider's recorded charge: amount, connected account and application fee.
    const payment = await provider.createPayment(
      giftPaymentInput(a.org.id, r, { description: 'Gift', returnUrl: 'http://x/thanks' }),
    );
    const url = new URL(payment.redirectUrl);
    expect(url.searchParams.get('amount')).toBe(String(100_000 + cover));
    expect(url.searchParams.get('acct')).toBe(acct(a));
    expect(url.searchParams.get('fee')).toBe('0');
    // The order: a donation item, no ticket lines, no platform fee.
    const [order] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<
        Record<string, unknown>
      >(sql`select o.status, o.fee_minor::int as fee, o.total_minor::int as total,
        o.funds_flow, o.connected_account_id, o.created_via,
        (select count(*)::int from orders.order_items i where i.order_id = o.id) as items,
        (select amount_minor::int from orders.donation_items d where d.order_id = o.id) as gift,
        (select fee_cover_minor::int from orders.donation_items d where d.order_id = o.id) as cover
        from orders.orders o where o.id = ${r.orderId}`),
    );
    expect(order).toEqual({
      status: 'reserved',
      fee: 0,
      total: 100_000 + cover,
      funds_flow: 'organizer_mor',
      connected_account_id: acct(a),
      created_via: 'donation',
      items: 0,
      gift: 100_000,
      cover,
    });

    await pay(a, r);
    const e = await webhook(a, r);
    expect(await apply(a, e)).toEqual({ outcome: 'applied', status: 'paid' });
    await catchUpGifts(a.org.id);
    const view = await consoleOf();
    const c = view.campaigns.find((x) => x.id === campaignId);
    expect(c).toMatchObject({ raisedMinor: 100_000, giftCount: 1, feeCoverMinor: cover });
    expect(view.gifts).toEqual([
      expect.objectContaining({
        id: r.giftId,
        status: 'paid',
        shownName: null,
        levelName: 'Classroom',
        amountMinor: 100_000,
        tribute: { kind: 'memory', name: 'Grandpa Joe' },
      }),
    ]);
    // No tickets for a gift; the ledger has nothing for the platform (application fee 0).
    const [extra] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ tickets: number; journals: number }>(sql`select
        (select count(*)::int from ticketing.tickets where order_id = ${r.orderId}) as tickets,
        (select count(*)::int from payments.journal_entries where ref_id = ${r.orderId}) as journals`),
    );
    expect(extra).toEqual({ tickets: 0, journals: 0 });
    // The thank-you page: status and amount only.
    expect(await giftReceipt(a.org.id, a.event.id, r.giftToken)).toEqual({
      status: 'paid',
      campaignName: 'Scholarship Fund',
      amountMinor: 100_000,
      feeCoverMinor: cover,
      currency: a.event.currency,
    });
    expect(await giftReceipt(a.org.id, a.event.id, `${r.giftId}~forged`)).toBeNull();
    expect(await giftReceipt(b.org.id, a.event.id, r.giftToken)).toBeNull();
  });

  it('webhook replays and duplicate deliveries never count a gift twice', async () => {
    const r = await give({ amountMinor: 2_500, displayAs: 'first_name' });
    await pay(a, r);
    const e = await webhook(a, r);
    const before = (await consoleOf()).campaigns.find((x) => x.id === campaignId);
    expect(await apply(a, e)).toEqual({ outcome: 'applied', status: 'paid' });
    expect(await apply(a, e)).toEqual({ outcome: 'duplicate', status: 'unchanged' });
    // The same payment delivered again under another event id: the order is already paid.
    const again = await webhook(a, r, 'payment.succeeded', `fakeevt_again_${r.orderId}`);
    expect(await apply(a, again)).toEqual({ outcome: 'ignored', status: 'paid' });
    await catchUpGifts(a.org.id);
    await catchUpGifts(a.org.id);
    const after = (await consoleOf()).campaigns.find((x) => x.id === campaignId);
    expect(after?.giftCount).toBe((before?.giftCount ?? 0) + 1);
    expect(after?.raisedMinor).toBe((before?.raisedMinor ?? 0) + 2_500);
    expect((await consoleOf()).gifts.find((g) => g.id === r.giftId)?.shownName).toBe('Dana');
    // One donation_paid event for the order.
    const [n] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from platform.domain_events where type = 'order.donation_paid' and aggregate_id = ${r.orderId}`,
      ),
    );
    expect(n?.n).toBe(1);
  });

  it('own amounts stay within the campaign’s limits; a level or an amount, not both', async () => {
    await expect(give({ amountMinor: 999 })).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'amount_min', field: 'amount' },
    });
    await expect(give({ amountMinor: 500_001 })).rejects.toMatchObject({
      details: { reason: 'amount_max' },
    });
    await expect(give({ amountMinor: 5_000, levelId })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(give({})).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(give({ levelId: uuidv7() })).rejects.toMatchObject({ details: { reason: 'level' } });
    await expect(give({ amountMinor: 5_000, tribute: { kind: 'honor', name: '' } })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    // The cover is the server's: a form cannot set it.
    const r = await give({ amountMinor: 5_000, coverFee: false, feeCoverMinor: 1 });
    expect(r.feeCoverMinor).toBe(0);
    expect(r.totalMinor).toBe(5_000);
  });

  it('one Idempotency-Key is one gift; none is refused', async () => {
    const key = uuidv7();
    const one = await give({ amountMinor: 3_000 }, donorCtx(a, key));
    const two = await give({ amountMinor: 3_000 }, donorCtx(a, key));
    expect(two.giftId).toBe(one.giftId);
    expect(two.orderId).toBe(one.orderId);
    await expect(give({ amountMinor: 3_000 }, createCtx({ orgId: a.org.id }))).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('a closed campaign takes no gifts and leaves the public page', async () => {
    const c = await executeCommand(
      createCampaignCommand,
      { eventId: a.event.id, name: `Closing ${uuidv7().slice(-6)}`, goalMinor: 10_000 },
      a.ctx(),
      ports,
    );
    expect((await publicGiving(a.org.id, a.event.id)).campaigns.map((x) => x.id)).toContain(c.id);
    await executeCommand(
      updateCampaignCommand,
      {
        eventId: a.event.id,
        campaignId: c.id,
        name: 'Closed one',
        goalMinor: 10_000,
        minGiftMinor: 500,
        maxGiftMinor: 10_000,
        status: 'closed',
      },
      a.ctx(),
      ports,
    );
    await expect(give({ campaignId: c.id, amountMinor: 1_000 })).rejects.toMatchObject({
      details: { reason: 'campaign_closed' },
    });
    expect((await publicGiving(a.org.id, a.event.id)).campaigns.map((x) => x.id)).not.toContain(c.id);
  });

  it('failed and lapsed payments leave totals alone; a late payment still counts', async () => {
    const before = (await consoleOf()).campaigns.find((x) => x.id === campaignId);
    const failed = await give({ amountMinor: 4_000 });
    await pay(a, failed);
    expect(await apply(a, await webhook(a, failed, 'payment.failed'))).toMatchObject({
      status: 'payment_failed',
    });
    const lapsed = await give({ amountMinor: 6_000 });
    await pay(a, lapsed);
    await executeCommand(
      expireOrdersCommand,
      {},
      { ...systemCtx(a.org.id), now: new Date(Date.now() + 3_600_000) },
      ports,
    );
    await catchUpGifts(a.org.id);
    expect(await giftReceipt(a.org.id, a.event.id, failed.giftToken)).toMatchObject({ status: 'failed' });
    expect(await giftReceipt(a.org.id, a.event.id, lapsed.giftToken)).toMatchObject({ status: 'expired' });
    const mid = (await consoleOf()).campaigns.find((x) => x.id === campaignId);
    expect(mid?.raisedMinor).toBe(before?.raisedMinor);
    // The donor paid after the hold lapsed: a gift holds no stock, so it counts.
    expect(await apply(a, await webhook(a, lapsed))).toEqual({ outcome: 'applied', status: 'paid' });
    await catchUpGifts(a.org.id);
    expect(await giftReceipt(a.org.id, a.event.id, lapsed.giftToken)).toMatchObject({ status: 'paid' });
    const after = (await consoleOf()).campaigns.find((x) => x.id === campaignId);
    expect(after?.raisedMinor).toBe((before?.raisedMinor ?? 0) + 6_000);
  });

  it('the public payload never carries a donor, a tribute, an employer or a gift amount (P4-13)', async () => {
    const pub = await publicGiving(a.org.id, a.event.id);
    expect(pub.available).toBe(true);
    const text = JSON.stringify(pub);
    for (const secret of ['Dana', 'dana@example.test', 'Grandpa Joe', 'The Joe family', 'With love', 'Acme'])
      expect(text).not.toContain(secret);
    const c = pub.campaigns.find((x) => x.id === campaignId);
    expect(Object.keys(c ?? {}).sort()).toEqual(
      [
        'currency',
        'description',
        'giftCount',
        'goalMinor',
        'id',
        'levels',
        // M4.8f: the campaign's running challenge matches (terms and progress only).
        'matches',
        'maxGiftMinor',
        'minGiftMinor',
        'name',
        'raisedMinor',
      ].sort(),
    );
    // Org B's page shows nothing of org A (and B is not connected).
    expect(await publicGiving(b.org.id, a.event.id)).toMatchObject({ available: false, campaigns: [] });
  });

  it('another org cannot give to this org’s campaign through its own context', async () => {
    await connect(b);
    await expect(give({ levelId }, donorCtx(b))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('removing a level keeps its gifts', async () => {
    const extra = await executeCommand(
      createLevelCommand,
      { eventId: a.event.id, campaignId, name: 'Book', amountMinor: 2_000 },
      a.ctx(),
      ports,
    );
    const r = await give({ levelId: extra.id });
    await executeCommand(deleteLevelCommand, { eventId: a.event.id, levelId: extra.id }, a.ctx(), ports);
    const [row] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ level_id: string | null; org_id: string }>(
        sql`select level_id, org_id from donations.gifts where id = ${r.giftId}`,
      ),
    );
    expect(row).toEqual({ level_id: null, org_id: a.org.id });
  });
});

describe('gift CSV export', () => {
  const params = {
    headers: {
      date: 'Date',
      campaign: 'Campaign',
      level: 'Level',
      amount: 'Amount',
      feeCover: 'Fee covered',
      donor: 'Donor',
      email: 'Email',
      shownAs: 'Shown as',
      employer: 'Employer',
      tribute: 'Tribute',
      tributeName: 'Honoree',
      tributeRecipient: 'Notify',
      tributeNote: 'Note',
    },
    anonymous: 'Anonymous',
    tributes: { honor: 'In honor of', memory: 'In memory of' },
    locale: 'en',
  };
  const start = (ctx: Ctx) =>
    executeCommand(
      giftsExportBulk.start,
      { eventId: a.event.id, selection: { filter: {} }, params },
      ctx,
      ports,
    );

  it('needs a recent step-up and the export permission; impersonation is refused', async () => {
    await expect(start(a.ctx({ stepUpAt: null }))).rejects.toMatchObject({ code: 'step_up_required' });
    await expect(start(userCtx(a.viewerId, a.org.id))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      start(a.ctx({ impersonatedBy: { staffUserId: uuidv7(), impersonationId: uuidv7() } })),
    ).rejects.toMatchObject({ code: 'impersonation_blocked' });
  });

  it('lists paid gifts with the donor, how they appear, employer and tribute', async () => {
    const { operationId } = await start(a.ctx());
    await runBulk(a.org.id, operationId);
    const file = await executeQuery(giftsExportBulk.file, { operationId }, a.ctx(), ports);
    expect(file.name).toMatch(/^gifts-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = file.content.replace(/^﻿/, '').trim().split(/\r?\n/);
    expect(lines[0]).toBe(
      'Date,Campaign,Level,Amount,Fee covered,Donor,Email,Shown as,Employer,Tribute,Honoree,Notify,Note',
    );
    const anon = lines.find((l) => l.includes('Acme Corp'));
    expect(anon).toContain('Dana Q. Donor,dana@example.test,Anonymous,Acme Corp,In memory of,Grandpa Joe');
    expect(anon).toContain('Classroom');
    expect(lines.some((l) => l.includes(',Dana,'))).toBe(true);
    // Only paid gifts; never another org's.
    expect(file.content).not.toContain('Fixture Donor');
  });

  it('retention erases the donor of a gift left unpaid after 30 days; paid gifts keep theirs', async () => {
    const lapsed = await give({
      amountMinor: 2_500,
      employer: 'Lapsed Corp',
      tribute: { kind: 'honor', name: 'Aunt Lapsed', recipient: 'The Lapsed family', note: 'Never paid.' },
    });
    await pay(a, lapsed);
    await executeCommand(
      expireOrdersCommand,
      {},
      { ...systemCtx(a.org.id), now: new Date(Date.now() + 3_600_000) },
      ports,
    );
    await catchUpGifts(a.org.id);
    const paid = await give({ amountMinor: 3_500, employer: 'Paid Corp' });
    await pay(a, paid);
    await apply(a, await webhook(a, paid));
    await catchUpGifts(a.org.id);
    const row = async (orderId: string) =>
      (
        await withTenant(a.ctx(), (tx) =>
          tx.execute<Record<string, string | null>>(
            sql`select status, donor_name, donor_email, employer, tribute_kind, tribute_name, tribute_recipient,
              tribute_note, amount_minor::text as amount from donations.gifts where order_id = ${orderId}`,
          ),
        )
      )[0];
    const at = (days: number) => ({ ...systemCtx(a.org.id), now: new Date(Date.now() + days * 86_400_000) });
    // Members cannot run it: it is the platform's daily pass.
    await expect(executeCommand(giftRetentionCommand, {}, a.ctx(), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await executeCommand(giftRetentionCommand, {}, at(29), ports);
    expect(await row(lapsed.orderId)).toMatchObject({ status: 'expired', donor_name: 'Dana Q. Donor' });
    const r = await executeCommand(giftRetentionCommand, {}, at(31), ports);
    expect(r.lapsedGifts).toBeGreaterThanOrEqual(1);
    expect(await row(lapsed.orderId)).toEqual({
      status: 'expired',
      donor_name: ERASED_NAME,
      donor_email: ERASED_EMAIL,
      employer: null,
      tribute_kind: null,
      tribute_name: null,
      tribute_recipient: null,
      tribute_note: null,
      amount: '2500',
    });
    expect(await row(paid.orderId)).toMatchObject({
      status: 'paid',
      donor_name: 'Dana Q. Donor',
      employer: 'Paid Corp',
    });
    // Idempotent: nothing left to erase; the other org's lapsed gift is not this pass's.
    expect((await executeCommand(giftRetentionCommand, {}, at(31), ports)).lapsedGifts).toBe(0);
    const [other] = await withTenant(b.ctx(), (tx) =>
      tx.execute<{ donor_name: string }>(
        sql`select donor_name from donations.gifts where status = 'expired' limit 1`,
      ),
    );
    expect(other?.donor_name).toBe('Fixture Donor');
  });
});
