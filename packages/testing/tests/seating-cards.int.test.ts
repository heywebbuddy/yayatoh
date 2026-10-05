import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { createEventCommand, type EventDto } from '@yayatoh/events';
import { quickLayout } from '@yayatoh/floorplan';
import { addPartyGuestCommand, createPartyCommand } from '@yayatoh/guests';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import { gotenbergRenderer } from '@yayatoh/pdf';
import {
  cardsHtml,
  cardsOf,
  exportGuestSeatingCommand,
  mealCountsTable,
  seatGuestsCommand,
  seatingCardsQuery,
  seatingChartTable,
  setEventLayoutCommand,
} from '@yayatoh/seating';
import { eventRoleCan, roleCan } from '@yayatoh/tenancy';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M4.3b cards and exports: the fixture wedding's reception printed as cards (rendered by
 * Gotenberg), the seating chart and meal counts as an audited export for roles that may export
 * the guest list, and nothing across orgs.
 */

let admin: AdminSql;
let a: OrgFixture;
let b: OrgFixture;

const COPY = {
  title: 'Place cards',
  yourTable: 'Your table',
  guestOf: (n: string) => `Guest of ${n}`,
  hostedBy: (n: string) => `Hosted by ${n}`,
};
const FILE_COPY = {
  place: 'Table',
  guest: 'Guest',
  party: 'Party',
  age: 'Age',
  meal: 'Meal',
  reply: 'Reply',
  ageClass: { adult: 'Adult', child: 'Child', infant: 'Infant' },
  status: { attending: 'Attending', pending: 'Awaiting reply', declined: 'Declined' },
  notSeated: 'Not seated',
  notChosen: 'Not chosen',
  children: 'Children',
  infants: 'Infants',
  total: 'Total',
  guestOf: (n: string) => `Guest of ${n}`,
};

const cards = (f: OrgFixture, eventId: string, subEventId: string | null = null, ctx = f.ctx()) =>
  executeQuery(seatingCardsQuery, { eventId, subEventId }, ctx, ports);

const exportOf = (
  f: OrgFixture,
  eventId: string,
  kind: 'chart' | 'meals',
  subEventId: string | null = null,
  ctx = f.ctx(),
) => executeCommand(exportGuestSeatingCommand, { eventId, subEventId, kind, format: 'csv' }, ctx, ports);

async function reception(f: OrgFixture) {
  const v = await cards(f, f.event.id);
  const r = v.subEvents.find((s) => s.name === 'Reception');
  if (!r) throw new Error('no reception');
  return r.id;
}

beforeAll(async () => {
  admin = adminClient();
  ({ a, b } = await twoOrgs());
});

afterAll(async () => {
  await closePools();
  await admin.end();
});

describe('cards and exports (M4.3b)', () => {
  it('the fixture wedding reception: the seated host on a place card, rendered as a PDF', async () => {
    const sub = await reception(a);
    const v = await cards(a, a.event.id, sub);
    expect(v.hasPlan).toBe(true);
    const seated = v.sheet.places.flatMap((p) => p.guests.map((g) => [p.label, g.name, g.meal]));
    expect(seated).toEqual([['A', 'Fixture Guest', 'Fish']]);
    expect(v.counts).toEqual({ place: 1, escort: 1, table: v.sheet.places.length });
    // Private answers never reach the cards' data.
    expect(JSON.stringify(v)).not.toMatch(/No nuts|Step-free|Fixture Lane/);

    const html = cardsHtml({
      kind: 'place',
      paper: 'letter',
      lang: 'en',
      dir: 'ltr',
      copy: COPY,
      event: { name: a.event.name, startsAt: a.event.startsAt, timeZone: a.event.timezone },
      cards: cardsOf('place', v.sheet),
    });
    const renderer = gotenbergRenderer({
      url: process.env.GOTENBERG_URL ?? 'http://localhost:3300',
      timeoutMs: 60_000,
    });
    const pdf = await getDocument({ data: await renderer.render({ html }) }).promise;
    expect(pdf.numPages).toBe(1);
    const page = await pdf.getPage(1);
    expect(page.view.map(Math.round)).toEqual([0, 0, 612, 792]);
    const text = (await page.getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ');
    expect(text).toContain('Fixture Guest');
  }, 60_000);

  it('a wedding by table: exports the chart and the meal counts, audited', async () => {
    const ev: EventDto = await executeCommand(
      createEventCommand,
      {
        name: `Cards ${a.org.slug}`,
        profile: 'wedding',
        timezone: 'America/Chicago',
        startsAt: '2030-06-01T20:00:00Z',
        endsAt: '2030-06-02T04:00:00Z',
      },
      a.ctx(),
      ports,
    );
    const doc = quickLayout({ rows: 0, seatsPerRow: 1, tables: 2, seatsPerTable: 4, stage: false });
    await executeCommand(setEventLayoutCommand, { eventId: ev.id, doc }, a.ctx(), ports);
    const [t1 = '', t2 = ''] = doc.items.map((i) => i.id);
    const party = await executeCommand(
      createPartyCommand,
      { eventId: ev.id, name: 'Garcia' },
      a.ctx(),
      ports,
    );
    const add = (firstName: string, meal?: string, ageClass?: 'child') =>
      executeCommand(
        addPartyGuestCommand,
        { eventId: ev.id, partyId: party.id, firstName, lastName: 'García', meal, ageClass },
        a.ctx(),
        ports,
      );
    const ana = await add('Ana', 'Beef');
    const sofia = await add('Sofía', undefined, 'child');
    const luis = await add('Luis', 'beef');
    await add('Pablo', '=1+1');
    await executeCommand(
      seatGuestsCommand,
      { eventId: ev.id, subEventId: null, itemId: t1, guestIds: [ana.id, sofia.id] },
      a.ctx(),
      ports,
    );
    await executeCommand(
      seatGuestsCommand,
      { eventId: ev.id, subEventId: null, itemId: t2, guestIds: [luis.id] },
      a.ctx(),
      ports,
    );

    const v = await cards(a, ev.id);
    expect(v.counts).toEqual({ place: 3, escort: 2, table: 2 });

    const chart = await exportOf(a, ev.id, 'chart');
    expect(seatingChartTable(chart.sheet, FILE_COPY)).toEqual([
      ['Table', 'Guest', 'Party', 'Age', 'Meal', 'Reply'],
      ['1', 'Ana García', 'Garcia', 'Adult', 'Beef', 'Awaiting reply'],
      ['1', 'Sofía García', 'Garcia', 'Child', '', 'Awaiting reply'],
      ['2', 'Luis García', 'Garcia', 'Adult', 'beef', 'Awaiting reply'],
      ['Not seated', 'Pablo García', 'Garcia', 'Adult', '=1+1', 'Awaiting reply'],
    ]);
    const meals = await exportOf(a, ev.id, 'meals');
    expect(mealCountsTable(meals.meals, FILE_COPY)).toEqual([
      ['Table', '=1+1', 'Beef', 'Not chosen', 'Children', 'Infants', 'Total'],
      ['1', 0, 1, 1, 1, 0, 2],
      ['2', 0, 1, 0, 0, 0, 1],
      ['Not seated', 1, 0, 0, 0, 0, 1],
      ['Total', 1, 2, 1, 1, 0, 4],
    ]);
    const audit = await admin<{ data: Record<string, unknown> }[]>`
      select data from platform.audit_events where action = 'seating.guests.export' and target_id = ${ev.id}
      order by created_at`;
    expect(audit.map((x) => x.data)).toEqual([
      { subEventId: null, kind: 'chart', format: 'csv', rows: 4 },
      { subEventId: null, kind: 'meals', format: 'csv', rows: 3 },
    ]);
  });

  it('viewers print cards but may not export; planners neither export; another org reaches nothing', async () => {
    const sub = await reception(a);
    const viewer = userCtx(a.viewerId, a.org.id);
    expect((await cards(a, a.event.id, sub, viewer)).counts.place).toBe(1);
    await expect(exportOf(a, a.event.id, 'meals', sub, viewer)).rejects.toMatchObject({ code: 'forbidden' });
    expect(roleCan('viewer', 'attendees:export')).toBe(false);
    expect(eventRoleCan(['planner'], 'attendees:export')).toBe(false);
    expect(eventRoleCan(['planner'], 'guests:read')).toBe(true);
    expect(eventRoleCan(['co_host'], 'attendees:export')).toBe(true);

    // Org B: A's event has no plan and no guests there; its sub-event is unknown.
    const fromB = await cards(b, a.event.id);
    expect(fromB).toMatchObject({ hasPlan: false, sheet: { places: [], unseated: [] } });
    await expect(cards(b, a.event.id, sub)).rejects.toMatchObject({ code: 'not_found' });
    const out = await exportOf(b, a.event.id, 'chart');
    expect(out.sheet).toEqual({ places: [], unseated: [] });
    expect(JSON.stringify(out)).not.toContain('Fixture');
  });
});
