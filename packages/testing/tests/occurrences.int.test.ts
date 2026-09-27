import { scanTicketCommand } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  addOccurrencesCommand,
  addRecurringOccurrencesCommand,
  cancelOccurrenceCommand,
  createEventCommand,
  createSeriesCommand,
  deleteSeriesCommand,
  getEventBySlugQuery,
  listOccurrencesQuery,
  listSeriesQuery,
  previewOccurrencesQuery,
  publicOccurrences,
  publicSeriesBySlug,
  setEventSeriesCommand,
  transitionEventCommand,
  updateOccurrenceCommand,
} from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, utcToZonedInput } from '@yayatoh/kernel';
import { orderByManageToken, recordBoxOfficeSaleCommand, startCheckoutCommand } from '@yayatoh/orders';
import {
  createTicketTypeCommand,
  occurrenceSalesQuery,
  publicTicketTypes,
  updateTicketTypeCommand,
} from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
const TZ = 'America/Chicago';
const local = (d: Date) => utcToZonedInput(d, TZ);

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

async function newEvent(f: OrgFixture, name: string) {
  return executeCommand(
    createEventCommand,
    { name, timezone: TZ, startsAt: '2027-03-04T01:00:00Z', endsAt: '2027-03-04T04:00:00Z' },
    f.ctx(),
    ports,
  );
}

const weeklyRule = {
  startDate: '2027-03-03',
  startTime: '19:00',
  endTime: '22:00',
  freq: 'weekly' as const,
  byWeekday: [3],
  count: 4,
};

describe('occurrences', () => {
  it('previews a weekly rule across DST, then saves it and moves the event span', async () => {
    const e = await newEvent(a, `Weekly ${a.org.slug}`);
    const preview = await executeQuery(
      previewOccurrencesQuery,
      { eventId: e.id, rule: weeklyRule },
      a.ctx(),
      ports,
    );
    expect(preview.dates.map((d) => local(d.startsAt))).toEqual([
      '2027-03-03T19:00',
      '2027-03-10T19:00',
      '2027-03-17T19:00', // after the 14 March spring-forward: still 7 pm
      '2027-03-24T19:00',
    ]);
    expect(preview).toMatchObject({ existing: 0, overLimit: false, max: 366 });
    // Preview writes nothing.
    expect(await executeQuery(listOccurrencesQuery, { eventId: e.id }, a.ctx(), ports)).toHaveLength(0);

    const saved = await executeCommand(
      addRecurringOccurrencesCommand,
      { eventId: e.id, rule: weeklyRule, capacity: 50 },
      a.ctx(),
      ports,
    );
    expect(saved.created).toBe(4);
    const list = await executeQuery(listOccurrencesQuery, { eventId: e.id }, a.ctx(), ports);
    expect(list.map((o) => o.capacity)).toEqual([50, 50, 50, 50]);
    const ev = await executeQuery(getEventBySlugQuery, { slug: e.slug }, a.ctx(), ports);
    expect(local(ev.startsAt)).toBe('2027-03-03T19:00');
    expect(local(ev.endsAt)).toBe('2027-03-24T22:00');
  });

  it('refuses invalid rules with a reason and a field, and the per-event limit', async () => {
    const e = await newEvent(a, `Rules ${a.org.slug}`);
    await expect(
      executeQuery(
        previewOccurrencesQuery,
        { eventId: e.id, rule: { ...weeklyRule, count: null } },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'no_end', field: 'until' } });
    await expect(
      executeCommand(
        addRecurringOccurrencesCommand,
        { eventId: e.id, rule: { ...weeklyRule, freq: 'daily', count: null, until: '2029-01-01' } },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'too_many' } });
    // 360 daily dates, then 10 more would pass 366.
    await executeCommand(
      addRecurringOccurrencesCommand,
      { eventId: e.id, rule: { ...weeklyRule, freq: 'daily', count: 360 } },
      a.ctx(),
      ports,
    );
    const preview = await executeQuery(
      previewOccurrencesQuery,
      { eventId: e.id, rule: { ...weeklyRule, startDate: '2029-01-01', freq: 'daily', count: 10 } },
      a.ctx(),
      ports,
    );
    expect(preview).toMatchObject({ existing: 360, overLimit: true });
    await expect(
      executeCommand(
        addRecurringOccurrencesCommand,
        { eventId: e.id, rule: { ...weeklyRule, startDate: '2029-01-01', freq: 'daily', count: 10 } },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'too_many', existing: 360 } });
  });

  it('adds single dates, refuses a duplicate start and an end before the start', async () => {
    const e = await newEvent(a, `Singles ${a.org.slug}`);
    const [one] = await executeCommand(
      addOccurrencesCommand,
      { eventId: e.id, dates: [{ startsAt: '2027-06-01T23:00:00Z', endsAt: '2027-06-02T02:00:00Z' }] },
      a.ctx(),
      ports,
    );
    expect(one).toMatchObject({ status: 'scheduled', capacity: null });
    await expect(
      executeCommand(
        addOccurrencesCommand,
        { eventId: e.id, dates: [{ startsAt: '2027-06-01T23:00:00Z', endsAt: '2027-06-02T03:00:00Z' }] },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'date_exists' } });
    await expect(
      executeCommand(
        addOccurrencesCommand,
        { eventId: e.id, dates: [{ startsAt: '2027-06-03T23:00:00Z', endsAt: '2027-06-03T22:00:00Z' }] },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'end_before_start' } });
  });

  it('edits one date, or this and every later date keeping each local day across DST', async () => {
    const e = await newEvent(a, `Edits ${a.org.slug}`);
    await executeCommand(addRecurringOccurrencesCommand, { eventId: e.id, rule: weeklyRule }, a.ctx(), ports);
    const [d1, d2, d3, d4] = await executeQuery(listOccurrencesQuery, { eventId: e.id }, a.ctx(), ports);
    if (!d1 || !d2 || !d3 || !d4) throw new Error('dates missing');
    await executeCommand(
      updateOccurrenceCommand,
      {
        scope: 'one',
        occurrenceId: d1.id,
        startsAt: '2027-03-04T00:30:00Z',
        endsAt: '2027-03-04T03:30:00Z',
        capacity: 20,
      },
      a.ctx(),
      ports,
    );
    const r = await executeCommand(
      updateOccurrenceCommand,
      { scope: 'following', occurrenceId: d2.id, startTime: '20:00', endTime: '23:30' },
      a.ctx(),
      ports,
    );
    expect(r.updated).toBe(3);
    const after = await executeQuery(listOccurrencesQuery, { eventId: e.id }, a.ctx(), ports);
    expect(after.map((o) => local(o.startsAt))).toEqual([
      '2027-03-03T18:30',
      '2027-03-10T20:00',
      '2027-03-17T20:00',
      '2027-03-24T20:00',
    ]);
    expect(after.map((o) => local(o.endsAt).slice(11))).toEqual(['21:30', '23:30', '23:30', '23:30']);
    expect(after[0]?.capacity).toBe(20);
    await expect(
      executeCommand(
        updateOccurrenceCommand,
        { scope: 'following', occurrenceId: d2.id, startTime: '8pm', endTime: '23:30' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'invalid_time' } });
  });

  it('viewers cannot change dates; another org cannot see or change them', async () => {
    const e = await newEvent(a, `Perms ${a.org.slug}`);
    const [d] = await executeCommand(
      addOccurrencesCommand,
      { eventId: e.id, dates: [{ startsAt: '2027-07-01T23:00:00Z', endsAt: '2027-07-02T02:00:00Z' }] },
      a.ctx(),
      ports,
    );
    if (!d) throw new Error('no date');
    const viewer = userCtx(a.viewerId, a.org.id);
    await expect(
      executeCommand(addRecurringOccurrencesCommand, { eventId: e.id, rule: weeklyRule }, viewer, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(cancelOccurrenceCommand, { occurrenceId: d.id }, viewer, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // The viewer can read them.
    expect(await executeQuery(listOccurrencesQuery, { eventId: e.id }, viewer, ports)).toHaveLength(1);
    await expect(
      executeCommand(cancelOccurrenceCommand, { occurrenceId: d.id }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await executeQuery(listOccurrencesQuery, { eventId: e.id }, b.ctx(), ports)).toEqual([]);
  });
});

describe('selling dates', () => {
  let eventId: string;
  let slug: string;
  let dates: { id: string; startsAt: Date }[];
  let allDates: string;
  let secondOnly: string;

  const buy = (occurrenceId: string | undefined, ticketTypeId: string, quantity = 1) =>
    executeCommand(
      startCheckoutCommand,
      {
        eventId,
        items: [{ ticketTypeId, quantity }],
        buyer: { email: 'date@example.test', name: 'Dana Date' },
        ...(occurrenceId ? { occurrenceId } : {}),
      },
      createCtx({ orgId: a.org.id }),
      ports,
    );

  beforeAll(async () => {
    const e = await newEvent(a, `Dated ${a.org.slug}`);
    eventId = e.id;
    slug = e.slug;
    await executeCommand(
      addRecurringOccurrencesCommand,
      { eventId, rule: { ...weeklyRule, count: 3 } },
      a.ctx(),
      ports,
    );
    dates = await executeQuery(listOccurrencesQuery, { eventId }, a.ctx(), ports);
    const [, second] = dates;
    if (!second) throw new Error('dates missing');
    // Only 2 places on the second date.
    await executeCommand(
      updateOccurrenceCommand,
      {
        scope: 'one',
        occurrenceId: second.id,
        startsAt: second.startsAt,
        endsAt: new Date(second.startsAt.getTime() + 3 * 3_600_000),
        capacity: 2,
      },
      a.ctx(),
      ports,
    );
    allDates = (
      await executeCommand(
        createTicketTypeCommand,
        { eventId, name: 'Any date', priceMinor: 0, quantityTotal: 100 },
        a.ctx(),
        ports,
      )
    ).id;
    secondOnly = (
      await executeCommand(
        createTicketTypeCommand,
        { eventId, name: 'Second only', priceMinor: 0, quantityTotal: 100, occurrenceIds: [second.id] },
        a.ctx(),
        ports,
      )
    ).id;
    await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  });

  const date = (i: number) => {
    const d = dates[i];
    if (!d) throw new Error(`no date ${i}`);
    return d.id;
  };

  it('ticket types only take dates of their own event', async () => {
    const other = await newEvent(a, `Other ${a.org.slug}`);
    await expect(
      executeCommand(
        createTicketTypeCommand,
        { eventId: other.id, name: 'X', priceMinor: 0, quantityTotal: 1, occurrenceIds: [date(0)] },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { field: 'occurrenceIds' } });
    await expect(
      executeCommand(
        updateTicketTypeCommand,
        { ticketTypeId: allDates, occurrenceIds: [a.event.id] },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('checkout needs a date, and a pass only sells for its dates', async () => {
    await expect(buy(undefined, allDates)).rejects.toMatchObject({ details: { reason: 'choose_date' } });
    await expect(buy(date(0), secondOnly)).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'wrong_date' },
    });
    await expect(buy(a.event.id, allDates)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('the ticket carries its date; public passes list their dates', async () => {
    const r = await buy(date(0), allDates, 2);
    const order = await orderByManageToken(r.manageToken);
    expect(order?.tickets).toHaveLength(2);
    for (const t of order?.tickets ?? []) expect(t.date?.startsAt).toEqual(dates[0]?.startsAt);
    const passes = await publicTicketTypes(slug);
    expect(passes.find((p) => p.id === secondOnly)?.occurrenceIds).toEqual([date(1)]);
    expect(passes.find((p) => p.id === allDates)?.occurrenceIds).toEqual([]);
  });

  it('a date with a capacity sells out (held orders count) and says so publicly', async () => {
    await buy(date(1), secondOnly, 1); // free: paid (and issued) at once
    await buy(date(1), allDates, 1);
    await expect(buy(date(1), allDates, 1)).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'date_sold_out' },
    });
    const pub = await publicOccurrences(slug);
    expect(pub.map((p) => p.soldOut)).toEqual([false, true, false]);
    // Allowlist: nothing but id, times, status and sold-out.
    expect(Object.keys(pub[0] ?? {}).sort()).toEqual(['endsAt', 'id', 'soldOut', 'startsAt', 'status']);
    // The box office respects it too.
    await expect(
      executeCommand(
        recordBoxOfficeSaleCommand,
        {
          eventId,
          occurrenceId: date(1),
          items: [{ ticketTypeId: allDates, quantity: 1 }],
          buyer: { email: 'walk@example.test', name: 'Walk Up' },
          method: 'cash',
        },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'date_sold_out' } });
  });

  it('cancelling a date shows its sold tickets, stops its sales, and does not refund', async () => {
    const before = await executeQuery(occurrenceSalesQuery, { eventId }, a.ctx(), ports);
    const sold = new Map(before.map((s) => [s.occurrenceId, s.activeTickets]));
    expect(sold.get(date(0))).toBe(2);
    expect(sold.get(date(1))).toBe(2);
    await executeCommand(cancelOccurrenceCommand, { occurrenceId: date(0) }, a.ctx(), ports);
    await expect(
      executeCommand(cancelOccurrenceCommand, { occurrenceId: date(0) }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    // Tickets stay active: refunds are the organizer's decision.
    const after = await executeQuery(occurrenceSalesQuery, { eventId }, a.ctx(), ports);
    expect(after.find((s) => s.occurrenceId === date(0))?.activeTickets).toBe(2);
    await expect(buy(date(0), allDates)).rejects.toMatchObject({ details: { reason: 'date_cancelled' } });
    await expect(
      executeCommand(
        updateOccurrenceCommand,
        { scope: 'following', occurrenceId: date(0), startTime: '10:00', endTime: '11:00' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    expect((await publicOccurrences(slug))[0]?.status).toBe('cancelled');
    // The event now spans the remaining dates.
    const ev = await executeQuery(getEventBySlugQuery, { slug }, a.ctx(), ports);
    expect(ev.startsAt).toEqual(dates[1]?.startsAt);
  });

  it('check-in admits a ticket only around its own date (wrong_date otherwise)', async () => {
    const r = await buy(date(2), allDates, 1);
    const [t] = (await orderByManageToken(r.manageToken))?.tickets ?? [];
    if (!t) throw new Error('no ticket');
    const third = dates[2]?.startsAt as Date;
    const second = dates[1]?.startsAt as Date;
    const scan = (at: Date) =>
      executeCommand(scanTicketCommand, { eventId, code: t.shortCode }, a.ctx({ now: at }), ports);
    expect((await scan(second)).result).toBe('wrong_date');
    expect((await scan(new Date(third.getTime() + 60_000))).result).toBe('admitted');
    // A ticket of a cancelled date never admits.
    const [cancelled] = (await withTenant(a.ctx(), (tx) =>
      tx.execute<{ short_code: string }>(
        sql`select short_code from ticketing.tickets where occurrence_id = ${date(0)} limit 1`,
      ),
    )) as { short_code: string }[];
    expect(
      (
        await executeCommand(
          scanTicketCommand,
          { eventId, code: cancelled?.short_code ?? '' },
          a.ctx({ now: new Date(third.getTime() + 60_000) }),
          ports,
        )
      ).result,
    ).toBe('wrong_date');
  });
});

describe('series', () => {
  it('groups events, lists upcoming public ones on a public page, and isolates orgs', async () => {
    const s = await executeCommand(
      createSeriesCommand,
      { name: `Summer Nights ${a.org.slug}`, description: 'Every summer Friday' },
      a.ctx(),
      ports,
    );
    expect(s.slug).toBe(`summer-nights-${a.org.slug}`);
    const pub = await newEvent(a, `Series public ${a.org.slug}`);
    const draft = await newEvent(a, `Series draft ${a.org.slug}`);
    for (const e of [pub, draft])
      await executeCommand(setEventSeriesCommand, { eventId: e.id, seriesId: s.id }, a.ctx(), ports);
    await executeCommand(transitionEventCommand, { eventId: pub.id, transition: 'publish' }, a.ctx(), ports);
    const listed = (await executeQuery(listSeriesQuery, {}, a.ctx(), ports)).find((x) => x.id === s.id);
    expect(listed?.eventIds.sort()).toEqual([pub.id, draft.id].sort());
    const page = await publicSeriesBySlug(s.slug, new Date('2026-01-01T00:00:00Z'));
    expect(page).toMatchObject({
      name: s.name,
      description: 'Every summer Friday',
      organizerName: a.org.name,
    });
    expect(page?.events.map((e) => e.slug)).toEqual([pub.slug]);
    // Past events drop off.
    expect((await publicSeriesBySlug(s.slug, new Date('2030-01-01T00:00:00Z')))?.events).toEqual([]);
    // Slugs are global; another org cannot use it or put its event in it.
    await expect(
      executeCommand(createSeriesCommand, { name: 'Copy', slug: s.slug }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'conflict', details: { field: 'slug' } });
    await expect(
      executeCommand(setEventSeriesCommand, { eventId: b.event.id, seriesId: s.id }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect((await executeQuery(listSeriesQuery, {}, b.ctx(), ports)).some((x) => x.id === s.id)).toBe(false);
    await expect(
      executeCommand(createSeriesCommand, { name: 'Nope' }, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // An event moves between series; deleting a series keeps its events.
    await executeCommand(setEventSeriesCommand, { eventId: draft.id, seriesId: null }, a.ctx(), ports);
    await executeCommand(deleteSeriesCommand, { seriesId: s.id }, a.ctx(), ports);
    expect(await publicSeriesBySlug(s.slug)).toBeNull();
    expect((await executeQuery(getEventBySlugQuery, { slug: pub.slug }, a.ctx(), ports)).id).toBe(pub.id);
  });
});
