import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { getEventBySlugQuery, listOccurrencesQuery, listSeriesQuery } from '@yayatoh/events';
import { currentFormTx } from '@yayatoh/forms';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import { eventSeatingQuery } from '@yayatoh/seating';
import {
  createFromTemplateCommand,
  deleteTemplateCommand,
  duplicateEventCommand,
  listTemplatesQuery,
  saveTemplateCommand,
} from '@yayatoh/templates';
import { listTicketTypesQuery } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

/** Rows per table for one event (org A's RLS). */
async function counts(f: OrgFixture, eventId: string) {
  const [r] = await withTenant(f.ctx(), (tx) =>
    tx.execute<Record<string, number>>(sql`select
      (select count(*)::int from orders.orders where event_id = ${eventId}) as orders,
      (select count(*)::int from ticketing.tickets where event_id = ${eventId}) as tickets,
      (select count(*)::int from attendees.attendees where event_id = ${eventId}) as attendees,
      (select count(*)::int from checkin.admissions where event_id = ${eventId}) as admissions,
      (select count(*)::int from checkin.scans where event_id = ${eventId}) as scans,
      (select count(*)::int from payments.settlements where event_id = ${eventId}) as settlements,
      (select count(*)::int from ticketing.promo_codes where event_id = ${eventId}) as promos,
      (select count(*)::int from events.occurrences where event_id = ${eventId}) as dates,
      (select count(*)::int from seating.event_seats where event_id = ${eventId} and status in ('held', 'sold')) as seats_taken,
      (select count(*)::int from seating.seat_assignments where event_id = ${eventId}) as seated_guests,
      (select coalesce(sum(quantity_sold + quantity_held), 0)::int from ticketing.ticket_types where event_id = ${eventId}) as stock_used`),
  );
  return r ?? {};
}

describe('duplicate event', () => {
  it('copies settings, ticket types, questions and the floor plan — never orders or attendees', async () => {
    const source = await counts(a, a.event.id);
    // The fixture event really has sales, attendees and check-ins to leave behind.
    expect(source.orders).toBeGreaterThan(0);
    expect(source.tickets).toBeGreaterThan(0);
    expect(source.attendees).toBeGreaterThan(0);
    expect(source.admissions).toBeGreaterThan(0);

    const copy = await executeCommand(
      duplicateEventCommand,
      { eventId: a.event.id, name: `${a.event.name} (copy)`, startsAt: '2028-10-14T14:00:00Z' },
      a.ctx(),
      ports,
    );
    expect(copy).toMatchObject({
      status: 'draft',
      publishedAt: null,
      timezone: a.event.timezone,
      profile: a.event.profile,
      currency: a.event.currency,
    });
    expect(copy.slug).not.toBe(a.event.slug);
    expect(copy.endsAt.getTime() - copy.startsAt.getTime()).toBe(
      a.event.endsAt.getTime() - a.event.startsAt.getTime(),
    );
    expect(await counts(a, copy.id)).toEqual({
      orders: 0,
      tickets: 0,
      attendees: 0,
      admissions: 0,
      scans: 0,
      settlements: 0,
      promos: 0,
      dates: 0,
      seats_taken: 0,
      seated_guests: 0,
      stock_used: 0,
    });
    const types = await executeQuery(listTicketTypesQuery, { eventId: copy.id }, a.ctx(), ports);
    const sourceTypes = await executeQuery(listTicketTypesQuery, { eventId: a.event.id }, a.ctx(), ports);
    expect(types.map((t) => [t.name, t.priceMinor, t.quantityTotal, t.quantitySold])).toEqual(
      sourceTypes.filter((t) => !t.archivedAt).map((t) => [t.name, t.priceMinor, t.quantityTotal, 0]),
    );
    const form = await withTenant(a.ctx(), (tx) =>
      currentFormTx(tx, { kind: 'checkout_questions', subjectType: 'event', subjectId: copy.id }),
    );
    expect(form?.definition.fields.map((f) => f.key)).toEqual(['kids', 'access_needs']);
    const seating = await executeQuery(eventSeatingQuery, { eventId: copy.id }, a.ctx(), ports);
    expect(seating?.status).toBe('draft');
    expect(seating?.seats.length).toBeGreaterThan(0);
    expect(seating?.seats.every((s) => s.status === 'available' || s.status === 'blocked')).toBe(true);
    // It stays in the source's series.
    const series = await executeQuery(listSeriesQuery, {}, a.ctx(), ports);
    expect(series.find((s) => s.eventIds.includes(a.event.id))?.eventIds).toContain(copy.id);
    // A second copy with the same name gets its own address.
    const again = await executeCommand(
      duplicateEventCommand,
      { eventId: a.event.id, name: `${a.event.name} (copy)` },
      a.ctx(),
      ports,
    );
    expect(again.slug).toBe(`${copy.slug}-2`);
    expect(again.startsAt).toEqual(a.event.startsAt);
  });

  it('a multi-date event is copied as one draft date as long as its first date', async () => {
    const [fixtureWeekly] = (await withTenant(a.ctx(), (tx) =>
      tx.execute<{ id: string }>(sql`select id from events.events where slug = ${`${a.org.slug}-weekly`}`),
    )) as { id: string }[];
    if (!fixtureWeekly) throw new Error('fixture weekly event missing');
    const dates = await executeQuery(listOccurrencesQuery, { eventId: fixtureWeekly.id }, a.ctx(), ports);
    const firstLive = dates.find((d) => d.status === 'scheduled');
    const copy = await executeCommand(
      duplicateEventCommand,
      { eventId: fixtureWeekly.id, name: `Weekly copy ${a.org.slug}` },
      a.ctx(),
      ports,
    );
    expect(copy.startsAt).toEqual(firstLive?.startsAt);
    expect(copy.endsAt).toEqual(firstLive?.endsAt);
    expect(await executeQuery(listOccurrencesQuery, { eventId: copy.id }, a.ctx(), ports)).toEqual([]);
  });

  it('viewers cannot duplicate; another org cannot duplicate this event', async () => {
    await expect(
      executeCommand(
        duplicateEventCommand,
        { eventId: a.event.id, name: 'Viewer copy' },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(duplicateEventCommand, { eventId: a.event.id, name: 'Stolen copy' }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('templates', () => {
  it('saves a template and creates events from it, re-anchoring sales windows', async () => {
    const t = await executeCommand(
      saveTemplateCommand,
      { eventId: a.event.id, name: `Gala kit ${a.org.slug}`, description: 'Our standard gala' },
      a.ctx(),
      ports,
    );
    expect(t).toMatchObject({ name: `Gala kit ${a.org.slug}`, profile: a.event.profile, questions: 2 });
    expect(t.ticketTypes).toBeGreaterThan(0);
    expect(t.seats).toBeGreaterThan(0);
    await expect(
      executeCommand(saveTemplateCommand, { eventId: a.event.id, name: t.name }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'conflict', details: { field: 'name' } });

    const e = await executeCommand(
      createFromTemplateCommand,
      { templateId: t.id, name: `From kit ${a.org.slug}`, startsAt: '2029-02-01T01:00:00Z' },
      a.ctx(),
      ports,
    );
    expect(e.status).toBe('draft');
    expect((await executeQuery(getEventBySlugQuery, { slug: e.slug }, a.ctx(), ports)).id).toBe(e.id);
    expect(await counts(a, e.id)).toMatchObject({ orders: 0, tickets: 0, attendees: 0, dates: 0 });
    expect((await executeQuery(listTicketTypesQuery, { eventId: e.id }, a.ctx(), ports)).length).toBe(
      t.ticketTypes,
    );
  });

  it('templates belong to their org: invisible, unusable and undeletable elsewhere; viewers read only', async () => {
    const mine = await executeQuery(listTemplatesQuery, {}, a.ctx(), ports);
    const theirs = await executeQuery(listTemplatesQuery, {}, b.ctx(), ports);
    expect(mine.length).toBeGreaterThan(0);
    const ids = new Set(mine.map((t) => t.id));
    expect(theirs.some((t) => ids.has(t.id))).toBe(false);
    const [t] = mine;
    if (!t) throw new Error('no template');
    await expect(
      executeCommand(
        createFromTemplateCommand,
        { templateId: t.id, name: 'Borrowed', startsAt: '2029-01-01T00:00:00Z' },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(deleteTemplateCommand, { templateId: t.id }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    const viewer = userCtx(a.viewerId, a.org.id);
    expect((await executeQuery(listTemplatesQuery, {}, viewer, ports)).length).toBe(mine.length);
    await expect(
      executeCommand(saveTemplateCommand, { eventId: a.event.id, name: 'Viewer kit' }, viewer, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        createFromTemplateCommand,
        { templateId: t.id, name: 'Viewer event', startsAt: '2029-01-01T00:00:00Z' },
        viewer,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await executeCommand(deleteTemplateCommand, { templateId: t.id }, a.ctx(), ports);
    expect((await executeQuery(listTemplatesQuery, {}, a.ctx(), ports)).some((x) => x.id === t.id)).toBe(
      false,
    );
  });
});
