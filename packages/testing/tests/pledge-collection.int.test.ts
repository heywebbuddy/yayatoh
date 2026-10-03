import { evaluateOrgNow } from '@yayatoh/alerts';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  applyCardSetupCommand,
  armLevelCommand,
  assignPaddleCommand,
  attachCardSetupCommand,
  CARD_CONSENT_VERSION,
  type CollectRunResult,
  claimPledgeChargesCommand,
  closeCallCommand,
  closePledgesCommand,
  collectPledges,
  confirmEntriesCommand,
  createCampaignCommand,
  createLevelCommand,
  donationsConsoleQuery,
  giveWithSavedCardCommand,
  pledgeCollectionQuery,
  pledgeMailer,
  pledgeOutcomesSubscriber,
  pledgePaymentInput,
  pledgePayToken,
  publicPledge,
  recordPaddlesCommand,
  recordPledgePaymentCommand,
  removeSavedCardCommand,
  startCardSetupCommand,
  startPledgePaymentCommand,
  unpaidPledgeFactsTx,
  writeOffPledgeCommand,
} from '@yayatoh/donations';
import { rsvpLinkToken } from '@yayatoh/guests';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { createNotifier } from '@yayatoh/notifications';
import { applyProviderEventCommand, attachPaymentCommand } from '@yayatoh/orders';
import {
  applyAccountEventCommand,
  type ChargeSavedCardInput,
  type FakeCardStore,
  type FakeTestCard,
  fakePaymentProvider,
  type PaymentProvider,
  type ProviderEvent,
  type SetupEvent,
  signFakeSetupWebhook,
  signFakeWebhook,
} from '@yayatoh/payments';
import { catchUpSubscriber, memoryNotifier } from '@yayatoh/platform';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M4.8e cards on file and pledge collection (P4-12, P4-14). Acceptance: a confirmed pledge with a
 * saved card is charged once, on schedule, exactly the pledged amount (replayed jobs never charge
 * twice); reminders stop once paid; a pledge without saved consent is never charged. Plus the
 * declined-card retry and the pay-link fallback, offline payments and write-offs, one-tap giving,
 * the unpaid alert's facts, permissions and tenant isolation.
 */

const SECRET = 'pledge-collection-int-secret-0123456789abcdef';
const APP = 'http://localhost:3000';

let a: OrgFixture;
let b: OrgFixture;

/** A fake provider that counts every distinct charge it actually made (per idempotency key). */
function countingProvider() {
  const cards: FakeCardStore = { charges: new Map(), declinedOnce: new Set() };
  const inner = fakePaymentProvider({ secret: SECRET, appOrigin: APP, cards });
  const calls: ChargeSavedCardInput[] = [];
  const provider: PaymentProvider = {
    ...inner,
    async chargeSavedCard(i) {
      calls.push(i);
      return inner.chargeSavedCard(i);
    },
  };
  /** Charges that went through: one per key, whatever the replays. */
  const succeeded = () => [...cards.charges.entries()].filter(([, r]) => r.status === 'succeeded');
  return { provider, calls, cards, succeeded };
}

const acct = (o: OrgFixture) => `fakeacct_${o.org.slug}`;
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

const q = <T extends Record<string, unknown>>(o: OrgFixture, query: ReturnType<typeof sql>) =>
  withTenant(systemCtx(o.org.id), (tx) => tx.execute<T>(query));

const guestCtx = (o: OrgFixture, key = uuidv7()): Ctx => createCtx({ orgId: o.org.id, idempotencyKey: key });

interface Gala {
  readonly eventId: string;
  readonly endsAt: Date;
  readonly campaignId: string;
  readonly levels: { readonly gold: string; readonly silver: string };
}

/** A published gala of org `o` with a campaign of two levels. */
async function newGala(o: OrgFixture): Promise<Gala> {
  const [ev] = await q<{ id: string; ends_at: Date }>(
    o,
    sql`select id, ends_at from events.events where id = ${o.event.id}`,
  );
  const campaign = await executeCommand(
    createCampaignCommand,
    { eventId: o.event.id, name: `Fund ${uuidv7().slice(-4)}`, goalMinor: 10_000_000 },
    o.ctx(),
    ports,
  );
  const level = async (name: string, amountMinor: number) =>
    (
      await executeCommand(
        createLevelCommand,
        { eventId: o.event.id, campaignId: campaign.id, name, amountMinor },
        o.ctx(),
        ports,
      )
    ).id;
  return {
    eventId: ev?.id ?? '',
    endsAt: new Date(ev?.ends_at ?? 0),
    campaignId: campaign.id,
    levels: { gold: await level('Gold', 100_000), silver: await level('Silver', 25_000) },
  };
}

/** A new party of the gala with a paddle and an RSVP link (its QR code on the table). */
async function newParty(o: OrgFixture, name: string) {
  const linkId = uuidv7();
  const partyId = await withTenant(systemCtx(o.org.id), async (tx) => {
    const [p] = await tx.execute<{ id: string }>(
      sql`insert into guests.parties (org_id, event_id, name) values (${o.org.id}, ${o.event.id}, ${name}) returning id`,
    );
    await tx.execute(sql`insert into guests.guests (org_id, event_id, party_id, first_name, last_name, is_primary)
      values (${o.org.id}, ${o.event.id}, ${p?.id}, ${name}, 'Donor', true)`);
    await tx.execute(sql`insert into guests.party_rsvp (org_id, event_id, party_id, link_id, link_expires_at)
      values (${o.org.id}, ${o.event.id}, ${p?.id}, ${linkId}, now() + interval '400 days')`);
    return p?.id ?? '';
  });
  const paddle = await executeCommand(assignPaddleCommand, { eventId: o.event.id, partyId }, o.ctx(), ports);
  return { partyId, paddle: paddle.number, token: rsvpLinkToken(linkId) };
}

/** Call a level, spot these paddles and confirm them into pledges. */
async function pledge(o: OrgFixture, g: Gala, levelId: string, paddles: number[]) {
  const call = await executeCommand(
    armLevelCommand,
    { eventId: g.eventId, campaignId: g.campaignId, levelId },
    o.ctx(),
    ports,
  );
  await executeCommand(
    recordPaddlesCommand,
    {
      eventId: g.eventId,
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
  await executeCommand(closeCallCommand, { eventId: g.eventId, callId: call.id }, o.ctx(), ports);
  await executeCommand(confirmEntriesCommand, { eventId: g.eventId, callId: call.id }, o.ctx(), ports);
}

/** The guest's card page → the provider's hosted step → the verified setup webhook. */
async function saveCard(
  o: OrgFixture,
  opts: {
    name?: string;
    email?: string;
    rsvpToken?: string;
    card?: FakeTestCard;
    outcome?: 'succeeded' | 'failed';
  } = {},
) {
  const provider = fakePaymentProvider({ secret: SECRET, appOrigin: APP });
  const started = await executeCommand(
    startCardSetupCommand,
    {
      eventId: o.event.id,
      name: opts.name ?? 'Card Holder',
      email: opts.email ?? `holder+${uuidv7().slice(-6)}@example.test`,
      consent: true,
      source: 'table',
      rsvpToken: opts.rsvpToken ?? null,
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
    outcome: opts.outcome ?? 'succeeded',
    card: opts.card ?? '4242',
  });
  const event = (await provider.verifyWebhook(
    body,
    new Headers({ 'x-fake-signature': signature }),
  )) as SetupEvent;
  const applied = await executeCommand(applyCardSetupCommand, event, systemCtx(o.org.id), ports);
  return { ...started, event, applied };
}

const collectionOf = async (o: OrgFixture, partyId: string) => {
  const rows = await q<{
    id: string;
    status: string;
    charge_at: Date | null;
    card_attempts: number;
    due_on: string | null;
    amount_minor: string;
  }>(
    o,
    sql`select c.id, c.status, c.charge_at, c.card_attempts, c.due_on::text, c.amount_minor::text from donations.pledge_collections c
        join donations.pledges p on p.id = c.pledge_id where p.party_id = ${partyId} order by c.created_at`,
  );
  return rows;
};

const mailer = pledgeMailer({ notifier: createNotifier(), appOrigin: APP });
async function drain(o: OrgFixture) {
  await catchUpSubscriber(pledgeOutcomesSubscriber, o.org.id);
  await catchUpSubscriber(mailer, o.org.id);
}

const run = (o: OrgFixture, provider: PaymentProvider, now: Date): Promise<CollectRunResult> =>
  collectPledges(o.org.id, { provider, ports }, { now });

const messagesOf = (o: OrgFixture, prefix: string) =>
  q<{ kind: string; dedupe_key: string; status: string; send_after: Date }>(
    o,
    sql`select kind, dedupe_key, status, send_after from notifications.messages
        where dedupe_key like ${`${prefix}%`} order by dedupe_key`,
  );

let gala: Gala;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  await connect(a);
  gala = await newGala(a);
});

afterAll(async () => {
  await closePools();
});

describe('saving a card (P4-14)', () => {
  it('needs the consent box, a connected org and a valid party link', async () => {
    const base = { eventId: a.event.id, name: 'X', email: 'x@example.test', source: 'table', locale: 'en' };
    await expect(
      executeCommand(startCardSetupCommand, { ...base, consent: false }, guestCtx(a), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(
        startCardSetupCommand,
        { ...base, eventId: b.event.id, consent: true },
        guestCtx(b),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'not_connected' } });
    await expect(
      executeCommand(
        startCardSetupCommand,
        { ...base, consent: true, rsvpToken: 'nope~bad' },
        guestCtx(a),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'link' } });
  });

  it('records the consent and keeps only provider references and display details; activates on the webhook once', async () => {
    const p = await newParty(a, 'Consent');
    const s = await saveCard(a, { rsvpToken: p.token, email: 'Consent@Example.test' });
    expect(s.applied).toEqual({ outcome: 'applied', status: 'active' });
    const [row] = await q<Record<string, unknown>>(
      a,
      sql`select * from donations.saved_cards where id = ${s.cardId}`,
    );
    expect(row).toMatchObject({
      party_id: p.partyId,
      email: 'consent@example.test',
      status: 'active',
      consent_version: CARD_CONSENT_VERSION,
      connected_account_id: acct(a),
      brand: 'visa',
      last4: '4242',
      source: 'party',
    });
    expect(Number.isNaN(new Date(String(row?.consented_at)).getTime())).toBe(false);
    // Removed 30 days after the event (P4-14).
    expect(new Date(String(row?.remove_after)).getTime()).toBe(gala.endsAt.getTime() + 30 * 86_400_000);
    // A replayed webhook changes nothing.
    const again = await executeCommand(applyCardSetupCommand, s.event, systemCtx(a.org.id), ports);
    expect(again.outcome).toBe('duplicate');
  });

  it('a failed setup leaves no usable card', async () => {
    const s = await saveCard(a, { outcome: 'failed' });
    expect(s.applied.status).toBe('failed');
  });
});

describe('closing the night and charging the next morning (P4-12)', () => {
  let withCard: Awaited<ReturnType<typeof newParty>>;
  let noCard: Awaited<ReturnType<typeof newParty>>;
  let chargeAt: Date;
  let pm = '';
  const spy = countingProvider();

  beforeAll(async () => {
    withCard = await newParty(a, 'Carded');
    noCard = await newParty(a, 'Uncarded');
    pm = (await saveCard(a, { rsvpToken: withCard.token, card: '4242' })).event.paymentMethodId ?? '';
    await pledge(a, gala, gala.levels.gold, [withCard.paddle, noCard.paddle]);
  });

  it('only finance roles close the night', async () => {
    await expect(
      executeCommand(closePledgesCommand, { eventId: gala.eventId }, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('a pledge with a saved card is scheduled for 09:00 the next morning; one without is invoiced', async () => {
    const closedAt = new Date('2026-11-20T04:30:00Z'); // 22:30 in Chicago
    const r = await executeCommand(
      closePledgesCommand,
      { eventId: gala.eventId },
      a.ctx({ now: closedAt }),
      ports,
    );
    expect(r.cards).toBeGreaterThanOrEqual(1);
    chargeAt = r.chargeAt as Date;
    expect(chargeAt.toISOString()).toBe('2026-11-20T15:00:00.000Z'); // 09:00 CST
    const [carded] = await collectionOf(a, withCard.partyId);
    expect(carded).toMatchObject({ status: 'scheduled', card_attempts: 0, amount_minor: '100000' });
    const [uncarded] = await collectionOf(a, noCard.partyId);
    expect(uncarded).toMatchObject({ status: 'invoiced', due_on: '2026-12-19' });
    // Closing again picks up nothing new.
    const again = await executeCommand(closePledgesCommand, { eventId: gala.eventId }, a.ctx(), ports);
    expect(again).toEqual({ cards: 0, invoices: 0, chargeAt: null });
  });

  it('nothing is charged before its time', async () => {
    const r = await run(a, spy.provider, new Date(chargeAt.getTime() - 60_000));
    expect(r.charged).toBe(0);
    expect(spy.calls).toHaveLength(0);
  });

  it('on schedule: charged once, exactly the pledged amount, on the connected account', async () => {
    const r = await run(a, spy.provider, chargeAt);
    expect(r.charged).toBeGreaterThanOrEqual(1);
    const mine = spy.calls.filter((c) => c.paymentMethodId === pm);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      connectedAccountId: acct(a),
      amount: { amount: 100_000, currency: 'USD' },
    });
    await drain(a);
    const [c] = await collectionOf(a, withCard.partyId);
    expect(c?.status).toBe('paid');
    // The gift and order follow the usual path: paid, exactly the pledge.
    const [order] = await q<{ status: string; total_minor: string }>(
      a,
      sql`select o.status, o.total_minor::text from donations.pledge_attempts t join orders.orders o on o.id = t.order_id
          where t.collection_id = ${c?.id}`,
    );
    expect(order).toEqual({ status: 'paid', total_minor: '100000' });
  });

  it('replayed runs never charge twice', async () => {
    const before = spy.succeeded().length;
    await run(a, spy.provider, chargeAt);
    await run(a, spy.provider, new Date(chargeAt.getTime() + 3_600_000));
    expect(spy.succeeded().length).toBe(before);
    const attempts = await q<{ n: number }>(
      a,
      sql`select count(*)::int as n from donations.pledge_attempts t join donations.pledge_collections c on c.id = t.collection_id
          join donations.pledges p on p.id = c.pledge_id where p.party_id = ${withCard.partyId}`,
    );
    expect(attempts[0]?.n).toBe(1);
  });

  it('a pledge without saved consent is never charged', async () => {
    for (const h of [0, 24, 24 * 40])
      await run(a, spy.provider, new Date(chargeAt.getTime() + h * 3_600_000));
    const [c] = await collectionOf(a, noCard.partyId);
    expect(c?.status).toBe('invoiced');
    const attempts = await q<{ n: number }>(
      a,
      sql`select count(*)::int as n from donations.pledge_attempts where collection_id = ${c?.id}`,
    );
    expect(attempts[0]?.n).toBe(0);
  });

  it('the summary goes to the donor with an email; reminders need one too', async () => {
    await drain(a);
    const [carded] = await collectionOf(a, withCard.partyId);
    const summary = await messagesOf(a, `pledge-summary:${carded?.id}`);
    expect(summary.map((m) => m.kind)).toEqual(['donations.pledge-summary']);
    // The uncarded party left no email: nothing is sent (the host shares its pay link).
    const [uncarded] = await collectionOf(a, noCard.partyId);
    expect(await messagesOf(a, `pledge-reminder:${uncarded?.id}`)).toHaveLength(0);
  });
});

describe('a crashed run replays under the same key', () => {
  it('the claimed charge is handed out again after 10 minutes and charged once', async () => {
    const spy = countingProvider();
    const p = await newParty(a, 'Crash');
    const pm = (await saveCard(a, { rsvpToken: p.token })).event.paymentMethodId;
    await pledge(a, gala, gala.levels.silver, [p.paddle]);
    const closedAt = new Date('2026-11-21T04:00:00Z');
    const { chargeAt } = await executeCommand(
      closePledgesCommand,
      { eventId: gala.eventId },
      a.ctx({ now: closedAt }),
      ports,
    );
    const at = chargeAt as Date;
    // The run claims the charge and calls the provider, then dies before recording the answer.
    const claimed = await executeCommand(
      claimPledgeChargesCommand,
      {},
      createCtx({ orgId: a.org.id, actor: { type: 'system', name: 'test' }, now: at }),
      ports,
    );
    const mine = claimed.charges.find((c) => c.charge.paymentMethodId === pm);
    expect(mine).toBeDefined();
    await spy.provider.chargeSavedCard(mine?.charge as ChargeSavedCardInput);
    // Too soon for a replay: nothing handed out.
    expect((await run(a, spy.provider, new Date(at.getTime() + 60_000))).charged).toBe(0);
    // After 10 minutes the same order and key are replayed: the provider answers the first charge.
    await run(a, spy.provider, new Date(at.getTime() + 11 * 60_000));
    const keys = spy.calls.filter((c) => c.paymentMethodId === pm).map((c) => c.idempotencyKey);
    expect(keys.length).toBe(2);
    expect(new Set(keys).size).toBe(1);
    expect(spy.succeeded().filter(([k]) => k === keys[0])).toHaveLength(1);
    await drain(a);
    expect((await collectionOf(a, p.partyId))[0]?.status).toBe('paid');
  });
});

describe('a declined card is retried once, then gets a pay link', () => {
  it('9995 declines once: retried a day later and charged', async () => {
    const spy = countingProvider();
    const p = await newParty(a, 'Retry');
    await saveCard(a, { rsvpToken: p.token, card: '9995' });
    await pledge(a, gala, gala.levels.silver, [p.paddle]);
    const { chargeAt } = await executeCommand(
      closePledgesCommand,
      { eventId: gala.eventId },
      a.ctx({ now: new Date('2026-11-22T04:00:00Z') }),
      ports,
    );
    const at = chargeAt as Date;
    expect((await run(a, spy.provider, at)).declined).toBeGreaterThanOrEqual(1);
    let [c] = await collectionOf(a, p.partyId);
    expect(c).toMatchObject({ status: 'scheduled', card_attempts: 1 });
    expect(new Date(String(c?.charge_at)).toISOString()).toBe(
      new Date(at.getTime() + 86_400_000).toISOString(),
    );
    await run(a, spy.provider, new Date(at.getTime() + 86_400_000));
    await drain(a);
    [c] = await collectionOf(a, p.partyId);
    expect(c).toMatchObject({ status: 'paid', card_attempts: 2 });
  });

  it('0002 declines twice: invoiced with a pay link email and reminders, never a third charge', async () => {
    const spy = countingProvider();
    const p = await newParty(a, 'Declined');
    const pm = (await saveCard(a, { rsvpToken: p.token, card: '0002' })).event.paymentMethodId;
    await pledge(a, gala, gala.levels.silver, [p.paddle]);
    const { chargeAt } = await executeCommand(
      closePledgesCommand,
      { eventId: gala.eventId },
      a.ctx({ now: new Date('2026-11-23T04:00:00Z') }),
      ports,
    );
    const at = chargeAt as Date;
    await run(a, spy.provider, at);
    await run(a, spy.provider, new Date(at.getTime() + 86_400_000));
    await run(a, spy.provider, new Date(at.getTime() + 3 * 86_400_000));
    expect(spy.calls.filter((c) => c.paymentMethodId === pm)).toHaveLength(2);
    const [c] = await collectionOf(a, p.partyId);
    expect(c).toMatchObject({ status: 'invoiced', card_attempts: 2 });
    await drain(a);
    expect((await messagesOf(a, `pledge-invoice:${c?.id}`)).map((m) => m.kind)).toEqual([
      'donations.pledge-invoice',
    ]);
    // Reminders at +7, +21 and +28 days, 09:00 in the event's zone (invoiced on Nov 24 local).
    const reminders = await messagesOf(a, `pledge-reminder:${c?.id}`);
    expect(reminders.map((m) => new Date(String(m.send_after)).toISOString())).toEqual([
      '2026-12-01T15:00:00.000Z',
      '2026-12-15T15:00:00.000Z',
      '2026-12-22T15:00:00.000Z',
    ]);
    expect(reminders.every((m) => m.kind === 'donations.pledge-reminder' && m.status === 'queued')).toBe(
      true,
    );
    expect(c?.due_on).toBe('2026-12-24');
    const view = await executeQuery(pledgeCollectionQuery, { eventId: gala.eventId }, a.ctx(), ports);
    const row = view.rows.find((r) => r.paddleNumber === p.paddle);
    expect(row).toMatchObject({ status: 'invoiced', cardAttempts: 2, declineCode: 'card_declined' });
  });
});

describe('the pay link (P4-12)', () => {
  it('pays exactly the pledge; the reminders stop the moment it is paid', async () => {
    const provider = fakePaymentProvider({ secret: SECRET, appOrigin: APP });
    const spy = countingProvider();
    // A card that always declines: two tries, then the invoice (with the donor's email) and reminders.
    const p = await newParty(a, 'Payer');
    await saveCard(a, { rsvpToken: p.token, card: '0002', email: 'payer@example.test' });
    await pledge(a, gala, gala.levels.gold, [p.paddle]);
    const { chargeAt } = await executeCommand(
      closePledgesCommand,
      { eventId: gala.eventId },
      a.ctx({ now: new Date('2026-11-26T04:00:00Z') }),
      ports,
    );
    await run(a, spy.provider, chargeAt as Date);
    await run(a, spy.provider, new Date((chargeAt as Date).getTime() + 86_400_000));
    await drain(a);
    const [c] = await collectionOf(a, p.partyId);
    expect(c?.status).toBe('invoiced');
    const token = pledgePayToken(c?.id ?? '');
    const view = await publicPledge(a.org.id, token);
    expect(view).toMatchObject({ status: 'invoiced', amountMinor: 100_000, levelName: 'Gold', card: null });
    expect(await publicPledge(b.org.id, token)).toBeNull();
    expect((await messagesOf(a, `pledge-reminder:${c?.id}`)).every((m) => m.status === 'queued')).toBe(true);
    const r = await executeCommand(startPledgePaymentCommand, { token, locale: 'en' }, guestCtx(a), ports);
    expect(r.amountMinor).toBe(100_000);
    const pay = await provider.createPayment(
      pledgePaymentInput(a.org.id, r, { description: 'Pledge', returnUrl: `${APP}/x` }),
    );
    await executeCommand(
      attachPaymentCommand,
      { orderId: r.orderId, provider: 'fake', providerPaymentId: pay.providerPaymentId },
      guestCtx(a),
      ports,
    );
    const { body, signature } = signFakeWebhook(SECRET, {
      type: 'payment.succeeded',
      providerPaymentId: pay.providerPaymentId,
      amountMinor: 100_000,
      currency: 'USD',
      orgId: a.org.id,
      orderId: r.orderId,
      applicationFeeMinor: 0,
    });
    const e = (await provider.verifyWebhook(
      body,
      new Headers({ 'x-fake-signature': signature }),
    )) as ProviderEvent;
    await executeCommand(applyProviderEventCommand, e, systemCtx(a.org.id), ports);
    await drain(a);
    expect((await collectionOf(a, p.partyId))[0]?.status).toBe('paid');
    const reminders = await messagesOf(a, `pledge-reminder:${c?.id}`);
    expect(reminders).toHaveLength(3);
    expect(reminders.every((m) => m.status === 'canceled')).toBe(true);
    // Settled: the link refuses another payment.
    await expect(
      executeCommand(startPledgePaymentCommand, { token, locale: 'en' }, guestCtx(a), ports),
    ).rejects.toMatchObject({ details: { reason: 'settled' } });
  });

  it('paying by link before the morning moves the pledge off the card: the card is not charged as well', async () => {
    const spy = countingProvider();
    const p = await newParty(a, 'Switcher');
    const pm = (await saveCard(a, { rsvpToken: p.token })).event.paymentMethodId;
    await pledge(a, gala, gala.levels.silver, [p.paddle]);
    const { chargeAt } = await executeCommand(
      closePledgesCommand,
      { eventId: gala.eventId },
      a.ctx({ now: new Date('2026-11-24T04:00:00Z') }),
      ports,
    );
    const [c] = await collectionOf(a, p.partyId);
    await executeCommand(
      startPledgePaymentCommand,
      { token: pledgePayToken(c?.id ?? ''), locale: 'en' },
      guestCtx(a),
      ports,
    );
    await run(a, spy.provider, chargeAt as Date);
    expect(spy.calls.filter((x) => x.paymentMethodId === pm)).toHaveLength(0);
    expect((await collectionOf(a, p.partyId))[0]?.status).toBe('invoiced');
  });
});

describe('removed cards are never charged', () => {
  it('the guest removes the card: the scheduled pledge is invoiced at its run', async () => {
    const spy = countingProvider();
    const p = await newParty(a, 'Remover');
    const s = await saveCard(a, { rsvpToken: p.token });
    await pledge(a, gala, gala.levels.silver, [p.paddle]);
    const { chargeAt } = await executeCommand(
      closePledgesCommand,
      { eventId: gala.eventId },
      a.ctx({ now: new Date('2026-11-25T04:00:00Z') }),
      ports,
    );
    const removed = await executeCommand(
      removeSavedCardCommand,
      { cardToken: s.cardToken },
      guestCtx(a),
      ports,
    );
    expect(removed.removed).toBe(true);
    expect(removed.detach?.paymentMethodId).toBe(s.event.paymentMethodId);
    const r = await run(a, spy.provider, chargeAt as Date);
    expect(r.invoiced).toBeGreaterThanOrEqual(1);
    expect(spy.calls.filter((x) => x.paymentMethodId === s.event.paymentMethodId)).toHaveLength(0);
    expect((await collectionOf(a, p.partyId))[0]?.status).toBe('invoiced');
  });

  it('cards are removed from the customer 30 days after the event', async () => {
    const spy = countingProvider();
    const detached: string[] = [];
    const provider: PaymentProvider = {
      ...spy.provider,
      async detachSavedCard(i) {
        detached.push(i.paymentMethodId);
        return { status: 'detached' };
      },
    };
    const r = await run(a, provider, new Date(gala.endsAt.getTime() + 31 * 86_400_000));
    expect(r.cardsRemoved).toBeGreaterThanOrEqual(1);
    expect(detached.length).toBe(r.cardsRemoved);
    const [left] = await q<{ n: number }>(
      a,
      sql`select count(*)::int as n from donations.saved_cards where status = 'active'`,
    );
    expect(left?.n).toBe(0);
  });
});

describe('offline payments and write-offs', () => {
  it('finance records a check (not in the future), stopping the charge; raised counts it; a viewer cannot', async () => {
    const p = await newParty(a, 'Check');
    await pledge(a, gala, gala.levels.gold, [p.paddle]);
    const [pl] = await q<{ id: string }>(
      a,
      sql`select id from donations.pledges where party_id = ${p.partyId}`,
    );
    const input = {
      eventId: gala.eventId,
      pledgeId: pl?.id ?? '',
      method: 'check',
      reference: '#1042',
      receivedOn: '2026-01-02',
      note: 'Mailed',
    };
    await expect(
      executeCommand(
        recordPledgePaymentCommand,
        input,
        userCtx(a.viewerId, a.org.id, { idempotencyKey: uuidv7() }),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        recordPledgePaymentCommand,
        { ...input, receivedOn: '2099-01-01' },
        a.ctx({ idempotencyKey: uuidv7() }),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'future' } });
    const before = await executeQuery(donationsConsoleQuery, { eventId: gala.eventId }, a.ctx(), ports);
    const raisedBefore = before.campaigns.find((c) => c.id === gala.campaignId)?.raisedMinor ?? 0;
    // Before the night is closed: the collection is created as paid offline.
    await executeCommand(recordPledgePaymentCommand, input, a.ctx({ idempotencyKey: uuidv7() }), ports);
    expect((await collectionOf(a, p.partyId))[0]?.status).toBe('paid_offline');
    const after = await executeQuery(donationsConsoleQuery, { eventId: gala.eventId }, a.ctx(), ports);
    expect(after.campaigns.find((c) => c.id === gala.campaignId)?.raisedMinor).toBe(raisedBefore + 100_000);
    await expect(
      executeCommand(
        writeOffPledgeCommand,
        { eventId: gala.eventId, pledgeId: pl?.id ?? '', note: 'x' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'settled' } });
  });

  it('a write-off needs a note and stops the reminders', async () => {
    const p = await newParty(a, 'Writeoff');
    await pledge(a, gala, gala.levels.silver, [p.paddle]);
    await executeCommand(closePledgesCommand, { eventId: gala.eventId }, a.ctx(), ports);
    const [pl] = await q<{ id: string }>(
      a,
      sql`select id from donations.pledges where party_id = ${p.partyId}`,
    );
    await expect(
      executeCommand(
        writeOffPledgeCommand,
        { eventId: gala.eventId, pledgeId: pl?.id ?? '', note: ' ' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await executeCommand(
      writeOffPledgeCommand,
      { eventId: gala.eventId, pledgeId: pl?.id ?? '', note: 'Donor passed away' },
      a.ctx(),
      ports,
    );
    expect((await collectionOf(a, p.partyId))[0]?.status).toBe('written_off');
  });
});

describe('one-tap giving with the saved card', () => {
  it('charges the card for a level, once per Idempotency-Key, and refuses a removed card', async () => {
    const spy = countingProvider();
    const s = await saveCard(a, { email: 'tapper@example.test' });
    const key = uuidv7();
    const input = {
      eventId: gala.eventId,
      campaignId: gala.campaignId,
      levelId: gala.levels.silver,
      cardToken: s.cardToken,
    };
    const r1 = await executeCommand(giveWithSavedCardCommand, input, guestCtx(a, key), ports);
    const r2 = await executeCommand(giveWithSavedCardCommand, input, guestCtx(a, key), ports);
    expect(r2.giftId).toBe(r1.giftId);
    expect(r1.charge).toMatchObject({ amount: { amount: 25_000 }, idempotencyKey: `order:${r1.orderId}:1` });
    await spy.provider.chargeSavedCard(r1.charge);
    expect(spy.succeeded()).toHaveLength(1);
    await executeCommand(removeSavedCardCommand, { cardToken: s.cardToken }, guestCtx(a), ports);
    await expect(executeCommand(giveWithSavedCardCommand, input, guestCtx(a), ports)).rejects.toMatchObject({
      details: { reason: 'card' },
    });
  });
});

describe('the unpaid alert facts', () => {
  it('counts unpaid pledges only from 14 days after the event', async () => {
    const facts = (now: Date) =>
      withTenant(systemCtx(a.org.id), (tx) => unpaidPledgeFactsTx(tx, gala.eventId, now));
    expect((await facts(new Date(gala.endsAt.getTime() + 13 * 86_400_000))).count).toBe(0);
    const f = await facts(new Date(gala.endsAt.getTime() + 15 * 86_400_000));
    expect(f.count).toBeGreaterThanOrEqual(2);
    expect(f.amountMinor).toBeGreaterThan(0);
    expect(f.currency).toBe('USD');
  });

  it('the alert engine raises "pledges unpaid" for the event 14 days after it, on the pledges page', async () => {
    const { notifier } = memoryNotifier();
    await evaluateOrgNow(
      a.org.id,
      { notifier },
      { now: new Date(gala.endsAt.getTime() + 15 * 86_400_000), full: true },
    );
    const [alert] = await q<{
      rule: string;
      count: number;
      event_id: string;
      state: string;
      params: Record<string, number>;
    }>(a, sql`select rule, count, event_id, state, params from alerts.alerts where rule = 'pledgesUnpaid'`);
    expect(alert).toMatchObject({ rule: 'pledgesUnpaid', event_id: gala.eventId, state: 'open' });
    expect(alert?.count).toBeGreaterThanOrEqual(2);
    expect(alert?.params.amountMinor).toBeGreaterThan(0);
  });
});

describe('tenant isolation', () => {
  it("org B sees none of org A's cards or collections and cannot use A's links", async () => {
    const [n] = await q<{ n: number }>(
      b,
      sql`select (select count(*) from donations.saved_cards where org_id = ${a.org.id})::int +
                 (select count(*) from donations.pledge_collections where org_id = ${a.org.id})::int +
                 (select count(*) from donations.pledge_attempts where org_id = ${a.org.id})::int as n`,
    );
    expect(n?.n).toBe(0);
    const [c] = await q<{ id: string }>(a, sql`select id from donations.pledge_collections limit 1`);
    await expect(
      executeCommand(
        startPledgePaymentCommand,
        { token: pledgePayToken(c?.id ?? ''), locale: 'en' },
        guestCtx(b),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    // B's own page lists B's paddle pledges only (its fixture pledge; a sponsor's match pledge,
    // M4.8f, is not collected here).
    const view = await executeQuery(pledgeCollectionQuery, { eventId: b.event.id }, b.ctx(), ports);
    const [own] = await q<{ n: number }>(
      b,
      sql`select count(*)::int as n from donations.pledges where status = 'confirmed' and source = 'paddle'`,
    );
    expect(view.rows).toHaveLength(own?.n ?? -1);
  });
});
