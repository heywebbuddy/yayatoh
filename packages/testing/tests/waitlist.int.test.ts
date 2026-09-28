import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  addOccurrencesCommand,
  createEventCommand,
  transitionEventCommand,
  updateOccurrenceCommand,
} from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  declineWaitlistOfferCommand,
  eraseOrdersDsarTx,
  expireOrdersCommand,
  joinWaitlistCommand,
  leaveWaitlistCommand,
  listWaitlistsQuery,
  offerWaitlistEntryCommand,
  publicWaitlistEntry,
  rejoinWaitlistCommand,
  removeWaitlistEntriesCommand,
  startCheckoutCommand,
  sweepWaitlistsCommand,
  updateWaitlistCommand,
  waitlistEntriesQuery,
  waitlistExportBulk,
  waitlistHeldBack,
  waitlistRef,
  waitlistToken,
} from '@yayatoh/orders';
import { recentEventsTx } from '@yayatoh/platform';
import { createTicketTypeCommand, listTicketTypesQuery, updateTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, runBulk, staleCtx, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let n = 0;

const HOUR = 3_600_000;
const later = (ms: number) => new Date(Date.now() + ms);
const anon = (now?: Date) => createCtx({ orgId: a.org.id, ...(now ? { now } : {}) });
const sys = (now?: Date): Ctx => ({ ...systemCtx(a.org.id), ...(now ? { now } : {}) });
const sweep = (now?: Date) => executeCommand(sweepWaitlistsCommand, {}, sys(now), ports);
const person = (name: string) => ({ name, email: `${name.toLowerCase()}.${n}@example.test` });

interface Scenario {
  eventId: string;
  typeId: string;
  holdOrderId: string;
}

/** A published event with one paid pass of `total` places, all held by one unpaid checkout. */
async function soldOut(total: number, opts: { maxPerOrder?: number } = {}): Promise<Scenario> {
  n += 1;
  const e = await executeCommand(
    createEventCommand,
    {
      name: `Waitlist ${n} ${a.org.slug}`,
      timezone: 'America/Chicago',
      startsAt: '2027-11-01T23:00:00Z',
      endsAt: '2027-11-02T03:00:00Z',
    },
    a.ctx(),
    ports,
  );
  const t = await executeCommand(
    createTicketTypeCommand,
    {
      eventId: e.id,
      name: 'GA',
      priceMinor: 5000,
      quantityTotal: total,
      maxPerOrder: opts.maxPerOrder ?? Math.max(total, 4),
    },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, a.ctx(), ports);
  const hold = await executeCommand(
    startCheckoutCommand,
    {
      eventId: e.id,
      items: [{ ticketTypeId: t.id, quantity: total }],
      buyer: { email: `holder.${n}@example.test`, name: 'Holder' },
    },
    anon(),
    ports,
  );
  return { eventId: e.id, typeId: t.id, holdOrderId: hold.order.id };
}

const join = (s: Scenario, who: { name: string; email: string }, quantity = 1, extra = {}) =>
  executeCommand(
    joinWaitlistCommand,
    { eventId: s.eventId, ticketTypeId: s.typeId, quantity, ...who, ...extra },
    anon(),
    ports,
  );

const stock = async (s: Scenario) => {
  const t = (await executeQuery(listTicketTypesQuery, { eventId: s.eventId }, a.ctx(), ports)).find(
    (x) => x.id === s.typeId,
  );
  return { sold: t?.quantitySold, held: t?.quantityHeld };
};

const entries = async (s: Scenario) => {
  const [list] = await executeQuery(listWaitlistsQuery, { eventId: s.eventId }, a.ctx(), ports);
  if (!list) return [];
  return (await executeQuery(waitlistEntriesQuery, { waitlistId: list.id }, a.ctx(), ports)).entries;
};
const statusOf = async (s: Scenario, entryId: string) =>
  (await entries(s)).find((x) => x.id === entryId)?.status;

/** Let the scenario's first checkout lapse (its places become free). */
const lapseHold = (now = later(11 * 60_000)) =>
  executeCommand(
    expireOrdersCommand,
    {},
    { ...sys(), now, actor: { type: 'system', name: 'sweeper' } },
    ports,
  );

const buy = (s: Scenario, who: { name: string; email: string }, quantity: number, extra: object = {}) =>
  executeCommand(
    startCheckoutCommand,
    { eventId: s.eventId, items: [{ ticketTypeId: s.typeId, quantity }], buyer: who, ...extra },
    anon(),
    ports,
  );

async function pay(orderId: string, totalMinor: number, tag: string) {
  await executeCommand(
    attachPaymentCommand,
    { orderId, provider: 'fake', providerPaymentId: `fakepi_wl_${tag}` },
    anon(),
    ports,
  );
  return executeCommand(
    applyProviderEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_wl_${tag}`,
      type: 'payment.succeeded',
      providerPaymentId: `fakepi_wl_${tag}`,
      amountMinor: totalMinor,
      currency: 'USD',
      orgId: a.org.id,
      orderId,
    },
    sys(),
    ports,
  );
}

const offeredEvents = (entryId: string) =>
  withTenant(a.ctx(), async (tx) =>
    (await recentEventsTx(tx, a.org.id, ['waitlist.offered'], HOUR)).filter(
      (e) => (e.payload as { entryId: string }).entryId === entryId,
    ),
  );

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

describe('waitlists: joining (M3.10a)', () => {
  it('joins only a sold-out pass, within its per-order limits; the same address keeps its place', async () => {
    n += 1;
    const e = await executeCommand(
      createEventCommand,
      {
        name: `Open ${n}`,
        timezone: 'UTC',
        startsAt: '2027-11-01T23:00:00Z',
        endsAt: '2027-11-02T03:00:00Z',
      },
      a.ctx(),
      ports,
    );
    const t = await executeCommand(
      createTicketTypeCommand,
      { eventId: e.id, name: 'GA', priceMinor: 5000, quantityTotal: 5 },
      a.ctx(),
      ports,
    );
    const open = { eventId: e.id, typeId: t.id, holdOrderId: '' };
    // Not published: nothing to join.
    await expect(join(open, person('Early'))).rejects.toMatchObject({ code: 'not_found' });
    await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, a.ctx(), ports);
    await expect(join(open, person('Early'))).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'not_sold_out' },
    });

    const s = await soldOut(2, { maxPerOrder: 3 });
    const amy = await join(s, person('Amy'));
    const ben = await join(s, person('Ben'), 2);
    expect(amy).toEqual({ entryId: expect.any(String), position: 1, alreadyJoined: false });
    expect(ben).toMatchObject({ position: 2, alreadyJoined: false });
    // Same address again (any case): the place already held, nothing new.
    expect(await join(s, { name: 'Amy', email: person('Amy').email.toUpperCase() })).toEqual({
      ...amy,
      alreadyJoined: true,
    });
    await expect(join(s, person('Cat'), 4)).rejects.toMatchObject({
      code: 'validation_failed',
      details: { field: 'quantity' },
    });
    await expect(
      join(s, person('Cat'), 1, { occurrenceId: '0190a8c4-0000-7000-8000-000000000000' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    // Joining is recorded once per new place (the confirmation email's event).
    const joined = await withTenant(a.ctx(), (tx) => recentEventsTx(tx, a.org.id, ['waitlist.joined'], HOUR));
    expect(
      joined.filter((x) => [amy.entryId, ben.entryId].includes((x.payload as { entryId: string }).entryId)),
    ).toHaveLength(2);
    // The public view of one's own link: position, pass, event; no offer yet.
    const view = await publicWaitlistEntry(waitlistToken(ben.entryId));
    expect(view).toMatchObject({
      status: 'waiting',
      position: 2,
      quantity: 2,
      pass: { name: 'GA' },
      offer: null,
      canRejoin: false,
    });
    expect(await publicWaitlistEntry(`${ben.entryId}~forged`)).toBeNull();
  });
});

describe('waitlists: timed offers', () => {
  it('freed stock is kept for the line and offered exactly once, in order, under concurrency', async () => {
    const s = await soldOut(2);
    const amy = await join(s, person('Amy'), 1);
    const ben = await join(s, person('Ben'), 2);
    await lapseHold();
    expect(await stock(s)).toEqual({ sold: 0, held: 0 });
    // Two places are free, three are waited for: the public can't buy them, and the page says so.
    await expect(buy(s, person('Public'), 1)).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'sold_out' },
    });
    expect(await waitlistHeldBack(a.org.id, s.eventId)).toContain(s.typeId);

    // Ten sweepers and ten buyers at once: Amy (1) gets an offer once; Ben (2) doesn't fit the one left.
    const results = await Promise.allSettled([
      ...Array.from({ length: 10 }, () => sweep()),
      ...Array.from({ length: 10 }, (_, i) => buy(s, person(`Rush${i}`), 1)),
    ]);
    const buys = results.slice(10);
    expect(buys.every((r) => r.status === 'rejected')).toBe(true);
    const sweeps = results.slice(0, 10).filter((r) => r.status === 'fulfilled');
    expect(sweeps.length).toBeGreaterThan(0);
    expect(await statusOf(s, amy.entryId)).toBe('offered');
    expect(await statusOf(s, ben.entryId)).toBe('waiting');
    expect(await stock(s)).toEqual({ sold: 0, held: 1 });
    expect(await offeredEvents(amy.entryId)).toHaveLength(1);
    // Sweeping again changes nothing (idempotent).
    expect(await sweep()).toMatchObject({ offered: 0 });
    expect(await offeredEvents(amy.entryId)).toHaveLength(1);

    // A capacity increase frees two more: Ben's whole quantity now fits; the rest is on sale again.
    await executeCommand(
      updateTicketTypeCommand,
      { ticketTypeId: s.typeId, quantityTotal: 4 },
      a.ctx(),
      ports,
    );
    expect(await sweep()).toMatchObject({ offered: 1 });
    expect(await statusOf(s, ben.entryId)).toBe('offered');
    expect(await stock(s)).toEqual({ sold: 0, held: 3 });
    expect(await waitlistHeldBack(a.org.id, s.eventId)).not.toContain(s.typeId);
    const walkIn = await buy(s, person('Walkin'), 1);
    expect(walkIn.order.status).toBe('reserved');
    expect(await stock(s)).toEqual({ sold: 0, held: 4 });
  });

  it('an accepted offer checks out through the normal checkout with the held stock', async () => {
    const s = await soldOut(3);
    const amy = person('Amy');
    const entry = await join(s, amy, 2);
    await lapseHold();
    await sweep();
    expect(await stock(s)).toEqual({ sold: 0, held: 2 });
    const token = waitlistToken(entry.entryId);
    const view = await publicWaitlistEntry(token);
    expect(view).toMatchObject({ status: 'offered', offer: { quantity: 2, unitAllInMinor: 5000 } });
    expect(view?.offer?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * HOUR);
    // Only the address it was made to, only its pass and quantity.
    await expect(buy(s, person('Mallory'), 1, { waitlistToken: token })).rejects.toMatchObject({
      code: 'forbidden',
      details: { reason: 'offer_email' },
    });
    await expect(buy(s, amy, 3, { waitlistToken: token })).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'offer_items' },
    });
    await expect(buy(s, amy, 1, { waitlistToken: `${entry.entryId}~nope` })).rejects.toMatchObject({
      code: 'not_found',
    });
    // Buying one of the two: the order holds one; the other goes back (and is on sale: nobody waits).
    const r = await buy(s, { ...amy, email: amy.email.toUpperCase() }, 1, { waitlistToken: token });
    expect(r.order).toMatchObject({ status: 'reserved', totalMinor: 5000 });
    expect(await stock(s)).toEqual({ sold: 0, held: 1 });
    expect(await statusOf(s, entry.entryId)).toBe('accepted');
    // The link is spent.
    await expect(buy(s, amy, 1, { waitlistToken: token })).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'offer_closed' },
    });
    expect(await pay(r.order.id, 5000, `accept${n}`)).toMatchObject({ outcome: 'applied', status: 'paid' });
    expect(await stock(s)).toEqual({ sold: 1, held: 0 });
  });

  it('an offer order that lapses unpaid gives its stock back to the open offer; later payment reclaims it', async () => {
    const s = await soldOut(1);
    const amy = person('Amy');
    const entry = await join(s, amy, 1);
    await join(s, person('Ben'), 1);
    await lapseHold();
    await sweep();
    const token = waitlistToken(entry.entryId);
    const first = await buy(s, amy, 1, { waitlistToken: token });
    await executeCommand(
      attachPaymentCommand,
      { orderId: first.order.id, provider: 'fake', providerPaymentId: `fakepi_wl_lapse${n}` },
      anon(),
      ports,
    );
    // 16 minutes later the order lapses: the offer (open for 24 h) holds the place again, not Ben.
    await lapseHold(later(16 * 60_000));
    expect(await statusOf(s, entry.entryId)).toBe('offered');
    expect(await stock(s)).toEqual({ sold: 0, held: 1 });
    await sweep(later(17 * 60_000));
    expect((await entries(s)).find((x) => x.name === 'Ben')?.status).toBe('waiting');
    // The first payment arrives after all: it takes the offer's place (no second hold).
    const paid = await executeCommand(
      applyProviderEventCommand,
      {
        provider: 'fake',
        id: `fakeevt_wl_lapse${n}`,
        type: 'payment.succeeded',
        providerPaymentId: `fakepi_wl_lapse${n}`,
        amountMinor: 5000,
        currency: 'USD',
        orgId: a.org.id,
        orderId: first.order.id,
      },
      sys(),
      ports,
    );
    expect(paid).toMatchObject({ outcome: 'applied', status: 'paid' });
    expect(await statusOf(s, entry.entryId)).toBe('accepted');
    expect(await stock(s)).toEqual({ sold: 1, held: 0 });
  });

  it('an expired offer releases its stock to the next person; rejoining goes to the back of the line', async () => {
    const s = await soldOut(1);
    const amy = await join(s, person('Amy'));
    const ben = await join(s, person('Ben'));
    const cat = await join(s, person('Cat'));
    await lapseHold();
    await sweep();
    expect(await statusOf(s, amy.entryId)).toBe('offered');
    // A day later Amy's offer has lapsed: Ben gets the place in the same sweep (the org's other
    // scenarios' offers lapse too).
    const swept = await sweep(later(25 * HOUR));
    expect(swept.expired).toBeGreaterThanOrEqual(1);
    expect(swept.offered).toBeGreaterThanOrEqual(1);
    expect(await statusOf(s, amy.entryId)).toBe('expired');
    expect(await statusOf(s, ben.entryId)).toBe('offered');
    expect(await stock(s)).toEqual({ sold: 0, held: 1 });
    const expired = await withTenant(a.ctx(), (tx) =>
      recentEventsTx(tx, a.org.id, ['waitlist.offer_expired'], HOUR),
    );
    expect(expired.some((x) => (x.payload as { entryId: string }).entryId === amy.entryId)).toBe(true);
    // An expired offer's link can't buy.
    await expect(
      buy(s, person('Amy'), 1, { waitlistToken: waitlistToken(amy.entryId) }),
    ).rejects.toMatchObject({
      code: 'invalid_state',
    });
    // Amy rejoins: behind Cat.
    expect(
      await executeCommand(rejoinWaitlistCommand, { token: waitlistToken(amy.entryId) }, anon(), ports),
    ).toEqual({ status: 'waiting', position: 2 });
    await expect(
      executeCommand(rejoinWaitlistCommand, { token: waitlistToken(amy.entryId) }, anon(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    // Ben declines: Cat (ahead of Amy now) gets it.
    await executeCommand(declineWaitlistOfferCommand, { token: waitlistToken(ben.entryId) }, anon(), ports);
    expect(await stock(s)).toEqual({ sold: 0, held: 0 });
    await sweep();
    expect(await statusOf(s, cat.entryId)).toBe('offered');
    expect(await statusOf(s, amy.entryId)).toBe('waiting');
    // A declined offer may rejoin too; leaving from the link ends the place (an open offer's stock goes back).
    expect(
      await executeCommand(rejoinWaitlistCommand, { token: waitlistToken(ben.entryId) }, anon(), ports),
    ).toEqual({ status: 'waiting', position: 2 });
    expect(
      await executeCommand(leaveWaitlistCommand, { token: waitlistToken(cat.entryId) }, anon(), ports),
    ).toEqual({ status: 'left' });
    expect(await stock(s)).toEqual({ sold: 0, held: 0 });
    await sweep();
    expect(await statusOf(s, amy.entryId)).toBe('offered');
    expect(await statusOf(s, ben.entryId)).toBe('waiting');
  });
});

describe('waitlists: dates', () => {
  it('a date has its own line: its capacity decides, other dates keep selling', async () => {
    n += 1;
    const e = await executeCommand(
      createEventCommand,
      {
        name: `Dates ${n}`,
        timezone: 'UTC',
        startsAt: '2027-11-01T18:00:00Z',
        endsAt: '2027-11-01T22:00:00Z',
      },
      a.ctx(),
      ports,
    );
    const [d1, d2] = await executeCommand(
      addOccurrencesCommand,
      {
        eventId: e.id,
        dates: [
          { startsAt: '2027-11-01T18:00:00Z', endsAt: '2027-11-01T22:00:00Z', capacity: 1 },
          { startsAt: '2027-11-02T18:00:00Z', endsAt: '2027-11-02T22:00:00Z', capacity: 5 },
        ],
      },
      a.ctx(),
      ports,
    );
    if (!d1 || !d2) throw new Error('dates');
    const t = await executeCommand(
      createTicketTypeCommand,
      { eventId: e.id, name: 'Night', priceMinor: 5000, quantityTotal: 50 },
      a.ctx(),
      ports,
    );
    await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, a.ctx(), ports);
    const s = { eventId: e.id, typeId: t.id, holdOrderId: '' };
    await buy(s, person('First'), 1, { occurrenceId: d1.id });
    await expect(join(s, person('Nodate'))).rejects.toMatchObject({ details: { reason: 'choose_date' } });
    await expect(join(s, person('Second'), 1, { occurrenceId: d2.id })).rejects.toMatchObject({
      details: { reason: 'not_sold_out' },
    });
    const zoe = await join(s, person('Zoe'), 1, { occurrenceId: d1.id });
    expect(zoe.position).toBe(1);
    // The other date sells as usual.
    expect((await buy(s, person('Other'), 2, { occurrenceId: d2.id })).order.status).toBe('reserved');
    // The pass has plenty of stock, but the date is full: no offer.
    expect(await sweep()).toMatchObject({ offered: 0 });
    // Room on the date: Zoe first, and the public still can't take the place she waits for.
    await executeCommand(
      updateOccurrenceCommand,
      { scope: 'one', occurrenceId: d1.id, startsAt: d1.startsAt, endsAt: d1.endsAt, capacity: 2 },
      a.ctx(),
      ports,
    );
    await expect(buy(s, person('Public'), 1, { occurrenceId: d1.id })).rejects.toMatchObject({
      details: { reason: 'date_sold_out' },
    });
    expect(await sweep()).toMatchObject({ offered: 1 });
    const view = await publicWaitlistEntry(waitlistToken(zoe.entryId));
    expect(view).toMatchObject({ status: 'offered', date: { id: d1.id } });
    // The offer is for its date only.
    await expect(
      buy(s, { name: 'Zoe', email: person('Zoe').email }, 1, {
        occurrenceId: d2.id,
        waitlistToken: waitlistToken(zoe.entryId),
      }),
    ).rejects.toMatchObject({ details: { reason: 'offer_items' } });
    const r = await buy(s, { name: 'Zoe', email: person('Zoe').email }, 1, {
      occurrenceId: d1.id,
      waitlistToken: waitlistToken(zoe.entryId),
    });
    expect(r.order.status).toBe('reserved');
  });
});

describe('waitlists: organizer console', () => {
  it('counts, pause auto-offers, manual offer out of order, window, remove', async () => {
    const s = await soldOut(1);
    const amy = await join(s, person('Amy'), 1);
    const ben = await join(s, person('Ben'), 1);
    const [list] = await executeQuery(listWaitlistsQuery, { eventId: s.eventId }, a.ctx(), ports);
    expect(list).toMatchObject({
      waiting: 2,
      waitingPlaces: 2,
      offered: 0,
      autoOffer: true,
      offerMinutes: 1440,
    });
    if (!list) throw new Error('list');
    await executeCommand(
      updateWaitlistCommand,
      { waitlistId: list.id, autoOffer: false, offerMinutes: 120 },
      a.ctx(),
      ports,
    );
    await expect(
      executeCommand(updateWaitlistCommand, { waitlistId: list.id, offerMinutes: 5 }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await lapseHold();
    // Paused: the sweeper offers nothing, and the public still can't take the waited-for place.
    expect(await sweep()).toMatchObject({ offered: 0 });
    await expect(buy(s, person('Public'), 1)).rejects.toMatchObject({ code: 'conflict' });
    // The organizer offers to Ben (second in line) by hand, with the list's two-hour window.
    const offered = await executeCommand(offerWaitlistEntryCommand, { entryId: ben.entryId }, a.ctx(), ports);
    expect(offered.offerExpiresAt.getTime() - Date.now()).toBeLessThan(2 * HOUR + 60_000);
    expect(offered.offerExpiresAt.getTime() - Date.now()).toBeGreaterThan(2 * HOUR - 60_000);
    // Nothing left for Amy.
    await expect(
      executeCommand(offerWaitlistEntryCommand, { entryId: amy.entryId }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'not_enough_stock' } });
    await expect(
      executeCommand(offerWaitlistEntryCommand, { entryId: ben.entryId }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    const rows = await entries(s);
    expect(rows.map((r) => [r.name, r.status, r.position, r.offeredBy])).toEqual([
      ['Ben', 'offered', null, 'manual'],
      ['Amy', 'waiting', 1, null],
    ]);
    // Removing Ben releases his offer's stock.
    expect(
      await executeCommand(removeWaitlistEntriesCommand, { entryIds: [ben.entryId] }, a.ctx(), ports),
    ).toEqual({ removed: 1 });
    expect(await stock(s)).toEqual({ sold: 0, held: 0 });
    expect(await statusOf(s, ben.entryId)).toBe('removed');
    // Resumed: the sweeper offers to Amy.
    await executeCommand(updateWaitlistCommand, { waitlistId: list.id, autoOffer: true }, a.ctx(), ports);
    expect(await sweep()).toMatchObject({ offered: 1 });
    expect(await statusOf(s, amy.entryId)).toBe('offered');
    // Audited.
    const audit = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ action: string }>(
        sql`select action from platform.audit_events where target_id in (${list.id}, ${ben.entryId}) order by created_at`,
      ),
    );
    expect(audit.map((r) => r.action)).toEqual(
      expect.arrayContaining(['waitlist.update', 'waitlist.offer', 'waitlist.remove']),
    );
  });

  it('exports the list as CSV through the bulk path: step-up, attendees:export, audited', async () => {
    const s = await soldOut(1);
    await join(s, person('Amy'), 1);
    await join(s, { name: 'Ben "B" Ng', email: person('Ben').email }, 1);
    const [list] = await executeQuery(listWaitlistsQuery, { eventId: s.eventId }, a.ctx(), ports);
    if (!list) throw new Error('list');
    const start = {
      eventId: s.eventId,
      selection: { filter: { waitlistId: list.id } },
      params: {
        headers: {
          position: '#',
          name: 'Name',
          email: 'Email',
          quantity: 'Qty',
          status: 'Status',
          joinedAt: 'Joined',
        },
        statuses: {
          waiting: 'Waiting',
          offered: 'Offered',
          accepted: 'Bought',
          expired: 'Expired',
          declined: 'Declined',
          left: 'Left',
          removed: 'Removed',
        },
      },
    };
    await expect(
      executeCommand(waitlistExportBulk.start, start, staleCtx(a.ctx()), ports),
    ).rejects.toMatchObject({
      code: 'step_up_required',
    });
    await expect(
      executeCommand(waitlistExportBulk.start, start, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(executeCommand(waitlistExportBulk.start, start, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    const { operationId, total } = await executeCommand(waitlistExportBulk.start, start, a.ctx(), ports);
    expect(total).toBe(2);
    expect(await runBulk(a.org.id, operationId)).toBe('done');
    const file = await executeQuery(waitlistExportBulk.file, { operationId }, a.ctx(), ports);
    const lines = file.content.replace(/^﻿/, '').trim().split(/\r?\n/);
    expect(lines[0]).toBe('#,Name,Email,Qty,Status,Joined');
    expect(lines[1]).toMatch(
      new RegExp(`^1,Amy,amy\\.${n}@example\\.test,1,Waiting,2\\d{3}-\\d{2}-\\d{2} \\d{2}:\\d{2}$`),
    );
    expect(lines[2]).toContain('2,"Ben ""B"" Ng"');
    const audit = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ action: string }>(
        sql`select action from platform.audit_events where target_id = ${operationId}`,
      ),
    );
    expect(audit.map((r) => r.action)).toContain('bulk.start');
  });
});

describe('waitlists: permissions and isolation', () => {
  it('viewers are refused; another org sees nothing and cannot act on these places', async () => {
    const s = await soldOut(1);
    const amy = await join(s, person('Amy'), 1);
    const [list] = await executeQuery(listWaitlistsQuery, { eventId: s.eventId }, a.ctx(), ports);
    if (!list) throw new Error('list');
    const viewer = userCtx(a.viewerId, a.org.id);
    await expect(
      executeQuery(listWaitlistsQuery, { eventId: s.eventId }, viewer, ports),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      executeQuery(waitlistEntriesQuery, { waitlistId: list.id }, viewer, ports),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    for (const [cmd, input] of [
      [offerWaitlistEntryCommand, { entryId: amy.entryId }],
      [updateWaitlistCommand, { waitlistId: list.id, autoOffer: false }],
      [removeWaitlistEntriesCommand, { entryIds: [amy.entryId] }],
    ] as const)
      await expect(executeCommand(cmd as never, input as never, viewer, ports)).rejects.toMatchObject({
        code: 'forbidden',
      });
    // The public can't run the sweeper.
    await expect(executeCommand(sweepWaitlistsCommand, {}, anon(), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    // Org B: RLS hides every list and place; acting on them is "not found".
    expect(await executeQuery(listWaitlistsQuery, { eventId: s.eventId }, b.ctx(), ports)).toEqual([]);
    await expect(
      executeQuery(waitlistEntriesQuery, { waitlistId: list.id }, b.ctx(), ports),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      executeCommand(offerWaitlistEntryCommand, { entryId: amy.entryId }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(updateWaitlistCommand, { waitlistId: list.id, autoOffer: false }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    // A's link resolves to A only; used under B's context it finds nothing.
    expect(await waitlistRef(waitlistToken(amy.entryId))).toEqual({ orgId: a.org.id, entryId: amy.entryId });
    await expect(
      executeCommand(
        leaveWaitlistCommand,
        { token: waitlistToken(amy.entryId) },
        createCtx({ orgId: b.org.id }),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    // B can't join A's event, and B's sweeper never touches A's line.
    await expect(
      executeCommand(
        joinWaitlistCommand,
        { eventId: s.eventId, ticketTypeId: s.typeId, quantity: 1, ...person('Eve') },
        createCtx({ orgId: b.org.id }),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    await lapseHold();
    await executeCommand(sweepWaitlistsCommand, {}, systemCtx(b.org.id), ports);
    expect(await statusOf(s, amy.entryId)).toBe('waiting');
    // The fixture's rows for both orgs stay invisible across the boundary.
    const seen = await withTenant(b.ctx(), (tx) =>
      tx.execute<{ org_id: string }>(sql`select distinct org_id from orders.waitlist_entries`),
    );
    expect(seen.map((r) => r.org_id)).toEqual([b.org.id]);
  });

  it('erasing a person deletes their places and gives an open offer back', async () => {
    const s = await soldOut(1);
    const who = person('Gone');
    const entry = await join(s, who, 1);
    await lapseHold();
    await sweep();
    expect(await stock(s)).toEqual({ sold: 0, held: 1 });
    await withTenant(a.ctx(), (tx) => eraseOrdersDsarTx(tx, who.email, new Date()));
    expect(await stock(s)).toEqual({ sold: 0, held: 0 });
    expect(await statusOf(s, entry.entryId)).toBeUndefined();
    expect(await waitlistRef(waitlistToken(entry.entryId))).toBeNull();
  });
});
