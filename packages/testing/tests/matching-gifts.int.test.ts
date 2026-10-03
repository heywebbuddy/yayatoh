import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  armLevelCommand,
  cancelMatchCommand,
  catchUpGiftRefunds,
  catchUpGifts,
  closeCallCommand,
  closeMatchCommand,
  confirmEntriesCommand,
  createCampaignCommand,
  createMatchCommand,
  employerExportBulk,
  giftPaymentInput,
  giftRefundsSubscriber,
  matchesQuery,
  paddleConsoleQuery,
  publicGiving,
  recordPaddlesCommand,
  type StartGiftResultDto,
  startGiftCommand,
  voidEntryCommand,
} from '@yayatoh/donations';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  completeRefundCommand,
  startRefundCommand,
} from '@yayatoh/orders';
import {
  applyAccountEventCommand,
  fakePaymentProvider,
  type ProviderEvent,
  signFakeWebhook,
} from '@yayatoh/payments';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, runBulk, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M4.8f matching gifts: a challenge match (sponsor, window, ratio, cap) computed from confirmed
 * gifts (paid online gifts less refunds, confirmed paddle pledges), the sponsor's own pledge at
 * close, refunds bringing it down, the employer matching list, permissions and tenant isolation.
 */
let a: OrgFixture;
let b: OrgFixture;
let campaignId: string;
let otherCampaignId: string;
const SECRET = 'matching-int-test-secret-0123456789abcdef';
const provider = fakePaymentProvider({ secret: SECRET, appOrigin: 'http://localhost:3000' });
const HOUR = 3_600_000;
const CAP = 2_500_000; // $25,000.00

const donorCtx = (o: OrgFixture = a): Ctx => createCtx({ orgId: o.org.id, idempotencyKey: uuidv7() });

/** A paid online gift (the fake provider's hosted page posts back; the outcome is caught up). */
async function paidGift(amountMinor: number, extra: Record<string, unknown> = {}, campaign = campaignId) {
  const r: StartGiftResultDto = await executeCommand(
    startGiftCommand,
    {
      eventId: a.event.id,
      campaignId: campaign,
      amountMinor,
      donor: { name: 'Maya Giver', email: 'maya@example.test' },
      displayAs: 'full_name',
      ...extra,
    },
    donorCtx(),
    ports,
  );
  const payment = await provider.createPayment(
    giftPaymentInput(a.org.id, r, { description: 'Gift', returnUrl: 'http://x/thanks' }),
  );
  await executeCommand(
    attachPaymentCommand,
    { orderId: r.orderId, provider: 'fake', providerPaymentId: payment.providerPaymentId },
    donorCtx(),
    ports,
  );
  const { body, signature } = signFakeWebhook(SECRET, {
    type: 'payment.succeeded',
    providerPaymentId: payment.providerPaymentId,
    amountMinor: r.totalMinor,
    currency: r.currency,
    orgId: a.org.id,
    orderId: r.orderId,
    applicationFeeMinor: 0,
  });
  const e = (await provider.verifyWebhook(body, new Headers({ 'x-fake-signature': signature }))) as ProviderEvent;
  await executeCommand(applyProviderEventCommand, e, systemCtx(a.org.id), ports);
  await catchUpGifts(a.org.id);
  return r;
}

/** The host refunds part or all of a gift's order; the provider confirms; the subscriber records it. */
async function refund(orderId: string, amountMinor: number) {
  const r = await executeCommand(
    startRefundCommand,
    { orderId, amountMinor, reason: 'requested_by_customer' },
    a.ctx({ idempotencyKey: uuidv7() }),
    ports,
  );
  await executeCommand(
    completeRefundCommand,
    { refundId: r.refundId, outcome: 'succeeded', providerRefundId: `fakere_${r.refundId}` },
    a.ctx(),
    ports,
  );
  await catchUpGiftRefunds(a.org.id);
  return r.refundId;
}

const view = (o: OrgFixture = a, ctx: Ctx = o.ctx()) =>
  executeQuery(matchesQuery, { eventId: o.event.id }, ctx, ports);
const matchOf = async (id: string) => {
  const m = (await view()).matches.find((x) => x.id === id);
  if (!m) throw new Error('match not found');
  return m;
};

const newMatch = (input: Record<string, unknown> = {}, ctx: Ctx = a.ctx()) =>
  executeCommand(
    createMatchCommand,
    {
      eventId: a.event.id,
      campaignId,
      sponsorName: 'Harbor Bank',
      sponsorEmail: ' Giving@HarborBank.test ',
      publicName: 'Harbor Bank',
      ratioPercent: 100,
      capMinor: CAP,
      startsAt: new Date(Date.now() - HOUR),
      endsAt: new Date(Date.now() + HOUR),
      ...input,
    },
    ctx,
    ports,
  );

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  await executeCommand(
    applyAccountEventCommand,
    {
      provider: 'fake',
      id: `evt_acct_${a.org.id}`,
      type: 'account.updated',
      orgId: a.org.id,
      account: {
        accountId: `fakeacct_${a.org.slug}`,
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
  const create = (name: string) =>
    executeCommand(
      createCampaignCommand,
      { eventId: a.event.id, name, goalMinor: 10_000_000, minGiftMinor: 100, maxGiftMinor: 1_000_000 },
      a.ctx(),
      ports,
    );
  campaignId = (await create('Challenge Fund')).id;
  otherCampaignId = (await create('Unmatched Fund')).id;
});
afterAll(closePools);

describe('creating a match (M4.8f)', () => {
  it('validates the campaign, the window, the ratio and the cap', async () => {
    await expect(newMatch({ campaignId: uuidv7() })).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'campaign', field: 'campaignId' },
    });
    const at = new Date(Date.now() + HOUR);
    await expect(newMatch({ startsAt: at, endsAt: at })).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'window', field: 'endsAt' },
    });
    await expect(newMatch({ ratioPercent: 0 })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(newMatch({ capMinor: 99 })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(newMatch({ sponsorName: '  ' })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(newMatch({ sponsorEmail: 'not-an-email' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    // Another org's campaign is not this event's.
    const theirs = (await executeQuery(paddleConsoleQuery, { eventId: b.event.id }, b.ctx(), ports))
      .campaigns[0];
    await expect(newMatch({ campaignId: theirs?.id })).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('viewers see matches but cannot create, cancel or close them; other orgs see nothing', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    await expect(newMatch({}, viewer)).rejects.toMatchObject({ code: 'forbidden' });
    const m = await newMatch({ sponsorName: 'Viewer Test', capMinor: 10_000 });
    expect((await view(a, viewer)).matches.some((x) => x.id === m.id)).toBe(true);
    for (const cmd of [cancelMatchCommand, closeMatchCommand])
      await expect(
        executeCommand(cmd, { eventId: a.event.id, matchId: m.id }, viewer, ports),
      ).rejects.toMatchObject({ code: 'forbidden' });
    // Org B can neither read nor act on org A's match.
    await expect(view(a, b.ctx())).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(closeMatchCommand, { eventId: b.event.id, matchId: m.id }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    const theirs = await withTenant(b.ctx(), (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from donations.matches where id = ${m.id}`),
    );
    expect(theirs[0]?.n).toBe(0);
    await executeCommand(cancelMatchCommand, { eventId: a.event.id, matchId: m.id }, a.ctx(), ports);
  });
});

describe('a 1:1 match capped at $25,000', () => {
  let matchId: string;
  const orders: string[] = [];

  it('doubles confirmed gifts in the window and stops at the cap exactly', async () => {
    matchId = (await newMatch()).id;
    const created = await matchOf(matchId);
    expect(created).toMatchObject({
      sponsorEmail: 'giving@harborbank.test',
      status: 'active',
      phase: 'live',
      currency: 'USD',
      matchedMinor: 0,
      remainingMinor: CAP,
    });
    for (const amount of [1_000_000, 1_000_000, 499_999]) orders.push((await paidGift(amount)).orderId);
    expect(await matchOf(matchId)).toMatchObject({
      eligibleMinor: 2_499_999,
      giftCount: 3,
      matchedMinor: 2_499_999,
      remainingMinor: 1,
    });
    // A gift to another campaign never counts.
    await paidGift(5_000, {}, otherCampaignId);
    expect((await matchOf(matchId)).matchedMinor).toBe(2_499_999);
    orders.push((await paidGift(10_000)).orderId);
    expect(await matchOf(matchId)).toMatchObject({ matchedMinor: CAP, remainingMinor: 0 });
    orders.push((await paidGift(500_000, { coverFee: true })).orderId);
    const m = await matchOf(matchId);
    expect(m).toMatchObject({ eligibleMinor: 3_009_999, giftCount: 5, matchedMinor: CAP });
  });

  it('the console and the giving page show it (public: terms and progress, no sponsor contact)', async () => {
    const live = await executeQuery(paddleConsoleQuery, { eventId: a.event.id }, a.ctx(), ports);
    expect(live.matches.find((m) => m.id === matchId)).toMatchObject({
      publicName: 'Harbor Bank',
      ratioPercent: 100,
      capMinor: CAP,
      matchedMinor: CAP,
      phase: 'live',
    });
    const page = await publicGiving(a.org.id, a.event.id);
    const campaign = page.campaigns.find((c) => c.id === campaignId);
    expect(campaign?.matches.map((m) => m.id)).toContain(matchId);
    expect(page.campaigns.find((c) => c.id === otherCampaignId)?.matches).toEqual([]);
    expect(JSON.stringify(page)).not.toMatch(/harborbank\.test|sponsorEmail|sponsorName/);
  });

  it('a refunded gift reduces the match', async () => {
    const [first] = orders;
    if (!first) throw new Error('no order');
    await refund(first, 1_000_000);
    expect(await matchOf(matchId)).toMatchObject({
      eligibleMinor: 2_009_999,
      giftCount: 4,
      matchedMinor: 2_009_999,
      remainingMinor: 490_001,
    });
  });

  it('a refund takes the covered fee first, then the gift', async () => {
    const covered = orders[4];
    if (!covered) throw new Error('no order');
    const [row] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ cover: number }>(
        sql`select fee_cover_minor::int as cover from donations.gifts where order_id = ${covered}`,
      ),
    );
    const cover = row?.cover ?? 0;
    expect(cover).toBeGreaterThan(0);
    await refund(covered, cover);
    expect((await matchOf(matchId)).matchedMinor).toBe(2_009_999);
    await refund(covered, 9_999);
    expect((await matchOf(matchId)).matchedMinor).toBe(2_000_000);
  });

  it('closing records the sponsor’s own pledge for what the match came to', async () => {
    const r = await executeCommand(closeMatchCommand, { eventId: a.event.id, matchId }, a.ctx(), ports);
    expect(r.matchedMinor).toBe(2_000_000);
    expect(r.pledgeId).toBeTruthy();
    const m = await matchOf(matchId);
    expect(m).toMatchObject({
      status: 'closed',
      matchedMinor: 2_000_000,
      pledge: { id: r.pledgeId, amountMinor: 2_000_000, status: 'confirmed' },
    });
    const [p] = await withTenant(a.ctx(), (tx) =>
      tx.execute<Record<string, unknown>>(
        sql`select source, match_id, call_id, entry_id, paddle_number, amount_minor::int as amount, currency, status
          from donations.pledges where id = ${r.pledgeId}`,
      ),
    );
    expect(p).toMatchObject({
      source: 'match',
      match_id: matchId,
      call_id: null,
      entry_id: null,
      paddle_number: null,
      amount: 2_000_000,
      currency: 'USD',
      status: 'confirmed',
    });
    // The console's totals count the sponsor's pledge; a closed match is no longer live there.
    const live = await executeQuery(paddleConsoleQuery, { eventId: a.event.id }, a.ctx(), ports);
    expect(live.matches.some((x) => x.id === matchId)).toBe(false);
    expect(live.totals.pledgedMinor).toBeGreaterThanOrEqual(2_000_000);
    // Closing twice is refused; so is cancelling a closed match.
    for (const cmd of [closeMatchCommand, cancelMatchCommand])
      await expect(
        executeCommand(cmd, { eventId: a.event.id, matchId }, a.ctx(), ports),
      ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'match_closed' } });
  });

  it('gifts after the close never raise it; a later refund brings the sponsor’s pledge down', async () => {
    await paidGift(100_000);
    expect((await matchOf(matchId)).pledge?.amountMinor).toBe(2_000_000);
    const second = orders[1];
    if (!second) throw new Error('no order');
    const refundId = await refund(second, 400_000);
    expect((await matchOf(matchId)).pledge).toMatchObject({ amountMinor: 1_600_000, status: 'confirmed' });
    // A replayed refund event counts once.
    await withTenant(systemCtx(a.org.id), (tx) =>
      giftRefundsSubscriber.handle(tx, {
        id: uuidv7(),
        type: 'order.refunded',
        version: 1,
        aggregateType: 'order',
        aggregateId: second,
        occurredAt: new Date().toISOString(),
        payload: { orgId: a.org.id, orderId: second, refundId, amountMinor: 400_000, currency: 'USD' },
      } as never),
    );
    expect((await matchOf(matchId)).pledge?.amountMinor).toBe(1_600_000);
  });

  it('refunding everything it matched cancels the sponsor’s pledge', async () => {
    const left = [orders[1], orders[2], orders[3], orders[4]];
    const amounts = [600_000, 499_999, 10_000, 490_001];
    for (const [i, o] of left.entries()) if (o) await refund(o, amounts[i] ?? 0);
    expect((await matchOf(matchId)).pledge).toMatchObject({ status: 'cancelled' });
    expect((await matchOf(matchId)).matchedMinor).toBe(0);
  });
});

describe('windows, ratios and paddle pledges', () => {
  it('a match before its window cannot close; one whose window passed matched nothing', async () => {
    const later = await newMatch({
      startsAt: new Date(Date.now() + 2 * HOUR),
      endsAt: new Date(Date.now() + 3 * HOUR),
    });
    expect((await matchOf(later.id)).phase).toBe('scheduled');
    await expect(
      executeCommand(closeMatchCommand, { eventId: a.event.id, matchId: later.id }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'not_started' } });
    await executeCommand(cancelMatchCommand, { eventId: a.event.id, matchId: later.id }, a.ctx(), ports);
    expect((await matchOf(later.id)).status).toBe('cancelled');

    const past = await newMatch({
      startsAt: new Date(Date.now() - 48 * HOUR),
      endsAt: new Date(Date.now() - 24 * HOUR),
    });
    expect(await matchOf(past.id)).toMatchObject({ phase: 'ended', matchedMinor: 0 });
    const r = await executeCommand(closeMatchCommand, { eventId: a.event.id, matchId: past.id }, a.ctx(), ports);
    expect(r).toMatchObject({ matchedMinor: 0, pledgeId: null });
    expect((await matchOf(past.id)).pledge).toBeNull();
  });

  it('a 2:1 match triples gifts up to its cap', async () => {
    // The unmatched fund already has a $50.00 gift from earlier in this window.
    const m = await newMatch({ ratioPercent: 200, capMinor: 50_000, campaignId: otherCampaignId });
    expect(await matchOf(m.id)).toMatchObject({ eligibleMinor: 5_000, matchedMinor: 10_000 });
    await paidGift(10_000, {}, otherCampaignId);
    expect(await matchOf(m.id)).toMatchObject({
      eligibleMinor: 15_000,
      matchedMinor: 30_000,
      remainingMinor: 10_000,
    });
    await paidGift(20_000, {}, otherCampaignId);
    expect((await matchOf(m.id)).matchedMinor).toBe(50_000);
    await executeCommand(cancelMatchCommand, { eventId: a.event.id, matchId: m.id }, a.ctx(), ports);
  });

  it('confirmed paddle pledges count; voiding one brings a closed match’s pledge down', async () => {
    const consoleView = await executeQuery(paddleConsoleQuery, { eventId: a.event.id }, a.ctx(), ports);
    const fixture = consoleView.campaigns.find((c) => c.name === 'Fixture Fund');
    const level = fixture?.levels[0];
    if (!fixture || !level) throw new Error('fixture campaign');
    // From now: the fixture's own paddle pledge (confirmed when the fixture was made) stays outside.
    const m = await newMatch({ campaignId: fixture.id, startsAt: new Date() });
    const call = await executeCommand(
      armLevelCommand,
      { eventId: a.event.id, campaignId: fixture.id, levelId: level.id },
      a.ctx(),
      ports,
    );
    const rec = await executeCommand(
      recordPaddlesCommand,
      { eventId: a.event.id, entries: [{ clientId: uuidv7(), callId: call.id, paddle: 1, recordedAt: new Date() }] },
      a.ctx(),
      ports,
    );
    expect(rec.results[0]?.outcome.status).toBe('recorded');
    // A recorded paddle is not a confirmed gift until the recorder confirms it.
    expect((await matchOf(m.id)).matchedMinor).toBe(0);
    await executeCommand(closeCallCommand, { eventId: a.event.id, callId: call.id }, a.ctx(), ports);
    await executeCommand(confirmEntriesCommand, { eventId: a.event.id, callId: call.id }, a.ctx(), ports);
    expect((await matchOf(m.id)).matchedMinor).toBe(level.amountMinor);
    const closed = await executeCommand(closeMatchCommand, { eventId: a.event.id, matchId: m.id }, a.ctx(), ports);
    expect(closed.matchedMinor).toBe(level.amountMinor);
    const [entry] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ id: string }>(
        sql`select id from donations.paddle_entries where call_id = ${call.id} and status = 'confirmed'`,
      ),
    );
    if (!entry) throw new Error('no entry');
    await executeCommand(voidEntryCommand, { eventId: a.event.id, entryId: entry.id }, a.ctx(), ports);
    expect((await matchOf(m.id)).pledge?.status).toBe('cancelled');
  });
});

describe('the employer matching list (P4-17)', () => {
  const params = {
    headers: {
      employer: 'Employer',
      donor: 'Donor',
      email: 'Email',
      date: 'Date',
      campaign: 'Campaign',
      amount: 'Amount',
    },
    locale: 'en',
  };
  const start = (ctx: Ctx) =>
    executeCommand(
      employerExportBulk.start,
      { eventId: a.event.id, selection: { filter: {} }, params },
      ctx,
      ports,
    );

  it('needs a recent step-up and the export permission', async () => {
    await expect(start(a.ctx({ stepUpAt: null }))).rejects.toMatchObject({ code: 'step_up_required' });
    await expect(start(userCtx(a.viewerId, a.org.id))).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lists paid gifts that name an employer, by employer, net of refunds; never another org’s', async () => {
    await paidGift(25_000, { employer: 'Zephyr Labs', donor: { name: 'Zoe Z', email: 'zoe@example.test' } });
    const acme = await paidGift(12_000, {
      employer: 'Acme Corp',
      donor: { name: 'Ari A', email: 'ari@example.test' },
    });
    await paidGift(7_000, { employer: 'acme corp', donor: { name: 'Bo B', email: 'bo@example.test' } });
    const gone = await paidGift(3_000, {
      employer: 'Refunded Inc',
      donor: { name: 'Rae R', email: 'rae@example.test' },
    });
    await refund(gone.orderId, 3_000);
    await refund(acme.orderId, 2_000);
    expect((await view()).employerGiftCount).toBeGreaterThanOrEqual(4);
    const { operationId } = await start(a.ctx());
    await runBulk(a.org.id, operationId);
    const file = await executeQuery(employerExportBulk.file, { operationId }, a.ctx(), ports);
    expect(file.name).toMatch(/^employer-matching-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = file.content.replace(/^﻿/, '').trim().split(/\r?\n/);
    expect(lines[0]).toBe('Employer,Donor,Email,Date,Campaign,Amount');
    const body = lines.slice(1);
    expect(body).toHaveLength(3);
    expect(body[0]).toMatch(/^Acme Corp,Ari A,ari@example\.test,\d{4}-\d{2}-\d{2},Challenge Fund,\$100\.00$/);
    expect(body[1]).toMatch(/^acme corp,Bo B,bo@example\.test,/);
    expect(body[2]).toMatch(/^Zephyr Labs,Zoe Z,zoe@example\.test,.*\$250\.00$/);
    expect(file.content).not.toContain('Refunded Inc');
    expect(file.content).not.toContain('Fixture Corp');
  });
});
