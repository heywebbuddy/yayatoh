import { withTenant } from '@yayatoh/db';
import { adminClient, closePools } from '@yayatoh/db/testing';
import {
  armLevelCommand,
  assignPaddleCommand,
  catchUpGifts,
  closeCallCommand,
  confirmEntriesCommand,
  createCampaignCommand,
  createLevelCommand,
  displayScreen,
  GIVING_SCREEN_CHANNEL,
  giftPaymentInput,
  publicScreen,
  recordPaddlesCommand,
  rotateScreenLinkCommand,
  type ScreenStateDto,
  type StartGiftResultDto,
  saveScreenCommand,
  screenSettingsQuery,
  signScreenToken,
  startGiftCommand,
  undoPaddleStepCommand,
  updateCampaignCommand,
  voidEntryCommand,
} from '@yayatoh/donations';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { applyProviderEventCommand, attachPaymentCommand } from '@yayatoh/orders';
import {
  applyAccountEventCommand,
  fakePaymentProvider,
  type ProviderEvent,
  signFakeWebhook,
} from '@yayatoh/payments';
import {
  createRealtimeFanout,
  listenForRealtime,
  memoryRealtimeHub,
  type RealtimeMessage,
  realtimeChannelName,
} from '@yayatoh/platform';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M4.8d live giving screen: the screen's settings and signed link (replaced links stop), the
 * thermometer's total (paid gifts and counted paddles of the campaign), the level being called,
 * names only for donors who opted in (P4-13, a fixture with mixed consents, scanned in every payload
 * and realtime message), QR gifts, permissions and tenant isolation; and the acceptance: a gift
 * paid on a phone reaches a listening screen within 3 s (p95).
 */
let a: OrgFixture;
let b: OrgFixture;
const SECRET = 'giving-screen-int-test-secret-0123456789ab';
const LINK_SECRET = 'giving-screen-link-secret-0123456789abcdef';
const provider = fakePaymentProvider({ secret: SECRET, appOrigin: 'http://localhost:3000' });
const admin = adminClient();

interface Gala {
  readonly id: string;
  readonly campaignId: string;
  readonly levelId: string;
  readonly smallLevelId: string;
  readonly guests: string[];
}

async function connect(o: OrgFixture) {
  await executeCommand(
    applyAccountEventCommand,
    {
      provider: 'fake',
      id: `evt_acct_screen_${o.org.id}`,
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

/** A published gala with a $100,000 campaign, levels of $1,000 and $250, and named guests (rows only). */
async function newGala(o: OrgFixture, name: string, guests = 4): Promise<Gala> {
  const e = await executeCommand(
    createEventCommand,
    {
      name,
      profile: 'gala',
      timezone: 'America/New_York',
      startsAt: '2027-11-20T00:00:00Z',
      endsAt: '2027-11-20T05:00:00Z',
    },
    o.ctx(),
    ports,
  );
  // Published, so its giving page takes gifts.
  await executeCommand(
    createTicketTypeCommand,
    { eventId: e.id, name: 'Gala seat', priceMinor: 0, quantityTotal: 50 },
    o.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, o.ctx(), ports);
  const campaign = await executeCommand(
    createCampaignCommand,
    { eventId: e.id, name: 'Fund-a-need', goalMinor: 10_000_000 },
    o.ctx(),
    ports,
  );
  const level = async (n: string, amountMinor: number) =>
    (
      await executeCommand(
        createLevelCommand,
        { eventId: e.id, campaignId: campaign.id, name: n, amountMinor },
        o.ctx(),
        ports,
      )
    ).id;
  const levelId = await level('Fund a classroom', 100_000);
  const smallLevelId = await level('A school day', 25_000);
  const ids: string[] = [];
  await withTenant(systemCtx(o.org.id), async (tx) => {
    const [party] = await tx.execute<{ id: string }>(
      sql`insert into guests.parties (org_id, event_id, name) values (${o.org.id}, ${e.id}, 'The Paddle Party') returning id`,
    );
    for (let g = 0; g < guests; g++) {
      const [guest] = await tx.execute<{ id: string }>(
        sql`insert into guests.guests (org_id, event_id, party_id, first_name, last_name, is_primary)
            values (${o.org.id}, ${e.id}, ${party?.id}, ${`Holder${g + 1}`}, 'Paddlename', ${g === 0}) returning id`,
      );
      ids.push(guest?.id ?? '');
    }
  });
  return { id: e.id, campaignId: campaign.id, levelId, smallLevelId, guests: ids };
}

const save = (o: OrgFixture, g: Gala, showNames = true, ctx: Ctx = o.ctx()) =>
  executeCommand(saveScreenCommand, { eventId: g.id, campaignId: g.campaignId, showNames }, ctx, ports);

const settings = (o: OrgFixture, g: Gala, ctx: Ctx = o.ctx()) =>
  executeQuery(screenSettingsQuery, { eventId: g.id }, ctx, ports);

/** A gift started on the giving page (a phone), as the anonymous donor with the form's key. */
const give = (o: OrgFixture, g: Gala, input: Record<string, unknown>) =>
  executeCommand(
    startGiftCommand,
    {
      eventId: g.id,
      campaignId: g.campaignId,
      donor: { name: 'Dana Q. Donor', email: 'dana@example.test' },
      displayAs: 'full_name',
      ...input,
    },
    createCtx({ orgId: o.org.id, idempotencyKey: uuidv7() }),
    ports,
  );

/** The provider confirms the payment (the fake hosted page's webhook, verified and applied). */
async function pay(o: OrgFixture, r: StartGiftResultDto) {
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
  const event = (await provider.verifyWebhook(
    body,
    new Headers({ 'x-fake-signature': signature }),
  )) as ProviderEvent;
  await executeCommand(applyProviderEventCommand, event, systemCtx(o.org.id), ports);
}

async function paddlesFor(o: OrgFixture, g: Gala) {
  const out: number[] = [];
  for (const guestId of g.guests) {
    const p = await executeCommand(assignPaddleCommand, { eventId: g.id, guestId }, o.ctx(), ports);
    out.push(p.number);
  }
  return out;
}

const record = (o: OrgFixture, g: Gala, callId: string, paddles: number[]) =>
  executeCommand(
    recordPaddlesCommand,
    {
      eventId: g.id,
      entries: paddles.map((paddle) => ({ clientId: uuidv7(), callId, paddle, recordedAt: new Date() })),
    },
    o.ctx(),
    ports,
  );

/** Every message published on the event's screen channel, oldest first. */
async function screenMessages(o: OrgFixture, eventId: string) {
  const channel = realtimeChannelName(GIVING_SCREEN_CHANNEL, o.org.id, eventId);
  return withTenant(systemCtx(o.org.id), (tx) =>
    tx.execute<{ event: string; data: unknown }>(
      sql`select event, data from platform.realtime_messages where channel = ${channel} order by seq`,
    ),
  );
}

const lastState = async (o: OrgFixture, eventId: string) =>
  (await screenMessages(o, eventId)).filter((m) => m.event === 'state').at(-1)?.data as
    | ScreenStateDto
    | undefined;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  await connect(a);
  await connect(b);
});
afterAll(closePools);

describe('screen settings and the signed link', () => {
  it('sets the screen up with a campaign of the event; another event’s campaign is refused', async () => {
    const g = await newGala(a, 'Screen Setup');
    const before = await settings(a, g);
    expect(before.screen).toBeNull();
    expect(before.state).toEqual({ campaign: null, totalMinor: 0, gifts: 0, calling: null, thanks: [] });
    expect(before.campaigns.map((c) => c.name)).toEqual(['Fund-a-need']);
    expect(await save(a, g)).toEqual({ version: 1 });
    const after = await settings(a, g);
    expect(after.screen).toMatchObject({ campaignId: g.campaignId, showNames: true, version: 1 });
    expect(after.state.campaign).toEqual({ name: 'Fund-a-need', goalMinor: 10_000_000, currency: 'USD' });
    // Saving again keeps the link's version.
    expect(await save(a, g, false)).toEqual({ version: 1 });
    const other = await newGala(a, 'Screen Other');
    await expect(
      executeCommand(
        saveScreenCommand,
        { eventId: g.id, campaignId: other.campaignId, showNames: true },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('a link opens its screen; a replaced link, a forged one and another org’s stop', async () => {
    const g = await newGala(a, 'Screen Link');
    await expect(
      executeCommand(rotateScreenLinkCommand, { eventId: g.id }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'no_screen' } });
    await save(a, g);
    const v1 = signScreenToken({ orgId: a.org.id, eventId: g.id, version: 1 }, LINK_SECRET);
    expect(await displayScreen(v1, LINK_SECRET)).toEqual({ orgId: a.org.id, eventId: g.id, version: 1 });
    expect(await displayScreen(v1, 'another-secret-0123456789abcdef012345678')).toBeNull();
    // The same event under another org's id finds no screen there.
    const foreign = signScreenToken({ orgId: b.org.id, eventId: g.id, version: 1 }, LINK_SECRET);
    expect(await displayScreen(foreign, LINK_SECRET)).toBeNull();

    expect(await executeCommand(rotateScreenLinkCommand, { eventId: g.id }, a.ctx(), ports)).toEqual({
      version: 2,
    });
    expect(await displayScreen(v1, LINK_SECRET)).toBeNull();
    const v2 = signScreenToken({ orgId: a.org.id, eventId: g.id, version: 2 }, LINK_SECRET);
    expect(await displayScreen(v2, LINK_SECRET)).not.toBeNull();
    // Open screens hear that their link was replaced.
    const link = (await screenMessages(a, g.id)).filter((m) => m.event === 'link');
    expect(link.map((m) => m.data)).toEqual([{ version: 2 }]);

    // A suspended org's screens stop.
    await admin`update tenancy.organizations set status = 'suspended' where id = ${a.org.id}`;
    try {
      expect(await displayScreen(v2, LINK_SECRET)).toBeNull();
    } finally {
      await admin`update tenancy.organizations set status = 'active' where id = ${a.org.id}`;
    }
    expect(await displayScreen(v2, LINK_SECRET)).not.toBeNull();
  });

  it('events:write sets it up and replaces the link; viewers read; door staff and the public cannot', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    const g = await newGala(a, 'Screen Roles');
    await expect(save(a, g, true, viewer)).rejects.toMatchObject({ code: 'forbidden' });
    await save(a, g);
    await expect(
      executeCommand(rotateScreenLinkCommand, { eventId: g.id }, viewer, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect((await settings(a, g, viewer)).screen?.version).toBe(1);
    await expect(settings(a, g, createCtx({ orgId: a.org.id }))).rejects.toMatchObject({
      code: 'forbidden',
    });
    // Audit rows carry the campaign and the setting, never a donor.
    const [row] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ action: string; data: unknown }>(
        sql`select action, data from platform.audit_events where target_id = ${g.id} and action = 'donations.screen.save' order by seq desc limit 1`,
      ),
    );
    expect(row?.data).toEqual({ campaignId: g.campaignId, showNames: true });
  });
});

describe('the thermometer', () => {
  it('totals paid gifts (without the fee cover) and counted paddles; pending gifts, duplicates and voids don’t count', async () => {
    const g = await newGala(a, 'Screen Totals');
    await save(a, g);
    const [p1 = 0, p2 = 0, p3 = 0] = await paddlesFor(a, g);
    // A $50 gift with the fee covered, paid; a $75 gift started but never paid.
    const paid = await give(a, g, { amountMinor: 5_000, coverFee: true, source: 'qr' });
    await pay(a, paid);
    await give(a, g, { amountMinor: 7_500 });
    await catchUpGifts(a.org.id);
    expect((await settings(a, g)).state).toMatchObject({ totalMinor: 5_000, gifts: 1, calling: null });

    // The auctioneer calls $1,000: three paddles, one twice (a duplicate), one later set aside.
    const call = await executeCommand(
      armLevelCommand,
      { eventId: g.id, campaignId: g.campaignId, levelId: g.levelId },
      a.ctx(),
      ports,
    );
    expect((await lastState(a, g.id))?.calling).toEqual({
      levelName: 'Fund a classroom',
      amountMinor: 100_000,
      currency: 'USD',
      paddles: 0,
    });
    await record(a, g, call.id, [p1, p2, p1]);
    expect((await lastState(a, g.id))?.calling?.paddles).toBe(2);
    await record(a, g, call.id, [p3]);
    let state = await lastState(a, g.id);
    expect(state).toMatchObject({ totalMinor: 305_000, gifts: 4 });
    expect(state?.calling?.paddles).toBe(3);
    // Undo sets the newest waiting paddle (the third) aside.
    await executeCommand(undoPaddleStepCommand, { eventId: g.id }, a.ctx(), ports);
    await executeCommand(closeCallCommand, { eventId: g.id, callId: call.id }, a.ctx(), ports);
    state = await lastState(a, g.id);
    expect(state).toMatchObject({ totalMinor: 205_000, gifts: 3, calling: null });
    // Confirming pledges doesn't count them twice; a voided entry leaves the total.
    await executeCommand(confirmEntriesCommand, { eventId: g.id, callId: call.id }, a.ctx(), ports);
    expect((await lastState(a, g.id))?.totalMinor).toBe(205_000);
    const [entry] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ id: string }>(
        sql`select id from donations.paddle_entries where call_id = ${call.id} and status = 'confirmed' limit 1`,
      ),
    );
    await executeCommand(voidEntryCommand, { eventId: g.id, entryId: entry?.id }, a.ctx(), ports);
    expect((await lastState(a, g.id))?.totalMinor).toBe(105_000);

    // The QR gift is recorded as one.
    const [src] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ source: string }>(sql`select source from donations.gifts where id = ${paid.giftId}`),
    );
    expect(src?.source).toBe('qr');
  });

  it('a campaign edit reaches the screen at once', async () => {
    const g = await newGala(a, 'Screen Goal');
    await save(a, g);
    await executeCommand(
      updateCampaignCommand,
      {
        eventId: g.id,
        campaignId: g.campaignId,
        name: 'Build the library',
        description: null,
        goalMinor: 20_000_000,
        minGiftMinor: 500,
        maxGiftMinor: 2_500_000,
        status: 'open',
      },
      a.ctx(),
      ports,
    );
    expect((await lastState(a, g.id))?.campaign).toEqual({
      name: 'Build the library',
      goalMinor: 20_000_000,
      currency: 'USD',
    });
  });
});

describe('names on the screen (P4-13)', () => {
  it('acceptance: with mixed consents the screen never shows an unconsented name', async () => {
    const g = await newGala(a, 'Screen Consents');
    await save(a, g);
    const [p1 = 0, p2 = 0] = await paddlesFor(a, g);
    const donors = [
      { name: 'Ada Lovelace', email: 'ada@example.test', displayAs: 'full_name', showOnScreen: true },
      { name: 'Bo Byrne', email: 'bo@example.test', displayAs: 'first_name', showOnScreen: true },
      { name: 'Cyrus Quiet', email: 'cyrus@example.test', displayAs: 'full_name', showOnScreen: false },
      { name: 'Dora Hidden', email: 'dora@example.test', displayAs: 'first_name', showOnScreen: false },
      { name: 'Eve Secret', email: 'eve@example.test', displayAs: 'anonymous', showOnScreen: true },
      { name: 'Finn Pending', email: 'finn@example.test', displayAs: 'full_name', showOnScreen: true },
    ] as const;
    for (const d of donors) {
      const r = await give(a, g, {
        amountMinor: 10_000,
        donor: { name: d.name, email: d.email },
        displayAs: d.displayAs,
        showOnScreen: d.showOnScreen,
      });
      if (d.name !== 'Finn Pending') await pay(a, r);
    }
    await catchUpGifts(a.org.id);
    // Paddles: pledges carry no consent, their holders are never named.
    const call = await executeCommand(
      armLevelCommand,
      { eventId: g.id, campaignId: g.campaignId, levelId: g.smallLevelId },
      a.ctx(),
      ports,
    );
    await record(a, g, call.id, [p1, p2]);
    await executeCommand(closeCallCommand, { eventId: g.id, callId: call.id }, a.ctx(), ports);
    await executeCommand(confirmEntriesCommand, { eventId: g.id, callId: call.id }, a.ctx(), ports);

    const shown = (await settings(a, g)).state;
    expect(shown.thanks).toEqual(['Bo', 'Ada Lovelace']);
    expect(shown).toMatchObject({ totalMinor: 5 * 10_000 + 2 * 25_000, gifts: 7 });
    // The anonymous donor's opt-in was never stored.
    const [eve] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ show_on_screen: boolean }>(
        sql`select show_on_screen from donations.gifts where donor_email = 'eve@example.test' and event_id = ${g.id}`,
      ),
    );
    expect(eve?.show_on_screen).toBe(false);

    // Every payload the screen gets: the link's page, the snapshot and every realtime message.
    const page = await publicScreen(a.org.id, g.id);
    expect(page?.state).toEqual(shown);
    const messages = await screenMessages(a, g.id);
    expect(messages.length).toBeGreaterThan(3);
    const everything = JSON.stringify([page, shown, messages]);
    for (const secret of [
      'Byrne',
      'Cyrus',
      'Quiet',
      'Dora',
      'Hidden',
      'Eve',
      'Secret',
      'Finn',
      'Paddlename',
      'Holder1',
      '@example.test',
      'Dana',
    ])
      expect(everything, secret).not.toContain(secret);
    expect(everything).toContain('Ada Lovelace');

    // The host turns names off: totals only.
    await save(a, g, false);
    expect((await lastState(a, g.id))?.thanks).toEqual([]);
    expect((await publicScreen(a.org.id, g.id))?.state.thanks).toEqual([]);
  });
});

describe('isolation', () => {
  it('another org can neither set up, read nor open this org’s screen', async () => {
    const g = await newGala(a, 'Screen Isolation');
    await save(a, g);
    await expect(save(b, g)).rejects.toMatchObject({ code: 'not_found' });
    await expect(settings(b, g)).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(rotateScreenLinkCommand, { eventId: g.id }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await publicScreen(b.org.id, g.id)).toBeNull();
    // Org B's own screen of its fixture event is not org A's.
    const rows = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ event_id: string }>(sql`select event_id from donations.screens`),
    );
    expect(rows.map((r) => r.event_id)).toEqual([b.event.id]);
  });
});

describe('acceptance: a gift made on a phone moves the thermometer within 3 s (p95)', () => {
  it('20 phone gifts each reach a listening screen through the realtime log', async () => {
    const g = await newGala(a, 'Screen Latency', 1);
    await save(a, g);
    const hub = memoryRealtimeHub();
    const fanout = createRealtimeFanout({ hub, batchMs: 2 });
    const listener = await listenForRealtime(fanout);
    const channel = realtimeChannelName(GIVING_SCREEN_CHANNEL, a.org.id, g.id);
    const seen: { at: number; m: RealtimeMessage }[] = [];
    const off = hub.subscribe(channel, (m) => seen.push({ at: Date.now(), m }));
    const latencies: number[] = [];
    try {
      for (let i = 1; i <= 20; i++) {
        const r = await give(a, g, { amountMinor: 1_000 * i, source: 'qr' });
        const expected = (1_000 * i * (i + 1)) / 2;
        const t0 = Date.now();
        await pay(a, r);
        // The phone lands on the thank-you page, which applies the outcome (the worker's relay in
        // production does the same, whichever comes first).
        await catchUpGifts(a.org.id);
        const start = Date.now();
        for (;;) {
          const hit = seen.find(
            (s) => s.m.event === 'state' && (s.m.data as ScreenStateDto).totalMinor === expected,
          );
          if (hit) {
            latencies.push(hit.at - t0);
            break;
          }
          if (Date.now() - start > 10_000) throw new Error(`gift ${i} never reached the screen`);
          await new Promise((res) => setTimeout(res, 10));
        }
      }
    } finally {
      off();
      fanout.close();
      await listener.close();
    }
    const sorted = [...latencies].sort((x, y) => x - y);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
    expect(latencies).toHaveLength(20);
    expect(p95).toBeLessThan(3_000);
  });
});
