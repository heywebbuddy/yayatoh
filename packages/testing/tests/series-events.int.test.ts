import { closePools } from '@yayatoh/db/testing';
import {
  createEventInSeriesCommand,
  createSeriesCommand,
  eventSeriesQuery,
  listEventsQuery,
  listSeriesQuery,
  publicEventSeries,
  publicSeriesBySlug,
  seriesDetailQuery,
  setEventSeriesCommand,
  transitionEventCommand,
} from '@yayatoh/events';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import { duplicateEventCommand } from '@yayatoh/templates';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

/** U7: series and events, connected both ways. */

let a: OrgFixture;
let b: OrgFixture;
beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

const tag = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const eventInput = (name: string, startsAt = '2029-05-01T18:00:00Z', endsAt = '2029-05-01T22:00:00Z') => ({
  name,
  timezone: 'America/Chicago',
  startsAt,
  endsAt,
});

const eventCount = async (f: OrgFixture) => (await executeQuery(listEventsQuery, {}, f.ctx(), ports)).length;

describe('create an event inside a series', () => {
  it('joins an existing series; both console reads and the public link see it', async () => {
    const t = tag();
    const s = await executeCommand(createSeriesCommand, { name: `Season ${t}` }, a.ctx(), ports);
    const ev = await executeCommand(
      createEventInSeriesCommand,
      { event: eventInput(`Opening ${t}`), seriesId: s.id },
      a.ctx(),
      ports,
    );
    expect(ev.status).toBe('draft');
    const listed = (await executeQuery(listSeriesQuery, {}, a.ctx(), ports)).find((x) => x.id === s.id);
    expect(listed?.eventIds).toEqual([ev.id]);
    const detail = await executeQuery(seriesDetailQuery, { slug: s.slug }, a.ctx(), ports);
    expect(detail.events.map((e) => [e.id, e.status])).toEqual([[ev.id, 'draft']]);
    expect(await executeQuery(eventSeriesQuery, { eventId: ev.id }, a.ctx(), ports)).toEqual({
      id: s.id,
      slug: s.slug,
      name: s.name,
    });
    // The public link names only the public address and name.
    expect(await publicEventSeries({ orgId: a.org.id, eventId: ev.id })).toEqual({
      slug: s.slug,
      name: s.name,
    });
  });

  it('creates a new series inline in the same transaction', async () => {
    const t = tag();
    const ev = await executeCommand(
      createEventInSeriesCommand,
      { event: eventInput(`Gig ${t}`), newSeriesName: `Tour ${t}` },
      a.ctx(),
      ports,
    );
    const s = await executeQuery(eventSeriesQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(s?.name).toBe(`Tour ${t}`);
    expect(s?.slug).toBe(`tour-${t}`);
  });

  it('a taken series name refuses on the series field and leaves no event behind', async () => {
    const t = tag();
    await executeCommand(createSeriesCommand, { name: `Taken ${t}` }, a.ctx(), ports);
    const before = await eventCount(a);
    await expect(
      executeCommand(
        createEventInSeriesCommand,
        { event: eventInput(`Orphan ${t}`), newSeriesName: `Taken ${t}` },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { field: 'series' } });
    expect(await eventCount(a)).toBe(before);
  });

  it('an invalid event leaves no new series behind', async () => {
    const t = tag();
    const before = (await executeQuery(listSeriesQuery, {}, a.ctx(), ports)).length;
    await expect(
      executeCommand(
        createEventInSeriesCommand,
        {
          event: eventInput(`Backwards ${t}`, '2029-05-02T18:00:00Z', '2029-05-01T18:00:00Z'),
          newSeriesName: `Never ${t}`,
        },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect((await executeQuery(listSeriesQuery, {}, a.ctx(), ports)).length).toBe(before);
  });

  it('needs exactly one of an existing series or a new name', async () => {
    const t = tag();
    const s = await executeCommand(createSeriesCommand, { name: `Both ${t}` }, a.ctx(), ports);
    for (const extra of [{}, { seriesId: s.id, newSeriesName: `Other ${t}` }])
      await expect(
        executeCommand(
          createEventInSeriesCommand,
          { event: eventInput(`Either ${t}`), ...extra },
          a.ctx(),
          ports,
        ),
      ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('viewers are refused; another org cannot use this series', async () => {
    const t = tag();
    const s = await executeCommand(createSeriesCommand, { name: `Guarded ${t}` }, a.ctx(), ports);
    await expect(
      executeCommand(
        createEventInSeriesCommand,
        { event: eventInput(`Viewer ${t}`), seriesId: s.id },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const before = await eventCount(b);
    await expect(
      executeCommand(
        createEventInSeriesCommand,
        { event: eventInput(`Intruder ${t}`), seriesId: s.id },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found', details: { field: 'series' } });
    expect(await eventCount(b)).toBe(before);
    await expect(executeQuery(seriesDetailQuery, { slug: s.slug }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(await executeQuery(eventSeriesQuery, { eventId: a.event.id }, b.ctx(), ports)).toBeNull();
  });
});

describe('series ↔ events, both ways', () => {
  it('removing an event unlinks it from the series, the event and the public pages', async () => {
    const t = tag();
    const s = await executeCommand(createSeriesCommand, { name: `Unlink ${t}` }, a.ctx(), ports);
    const ev = await executeCommand(
      createEventInSeriesCommand,
      { event: eventInput(`Stop ${t}`), seriesId: s.id },
      a.ctx(),
      ports,
    );
    await executeCommand(
      createTicketTypeCommand,
      { eventId: ev.id, name: 'Entry', priceMinor: 0, quantityTotal: 10 },
      a.ctx(),
      ports,
    );
    await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, a.ctx(), ports);
    const now = new Date('2029-01-01T00:00:00Z');
    expect((await publicSeriesBySlug(s.slug, now))?.events.map((e) => e.slug)).toEqual([ev.slug]);

    await executeCommand(setEventSeriesCommand, { eventId: ev.id, seriesId: null }, a.ctx(), ports);
    expect((await executeQuery(seriesDetailQuery, { slug: s.slug }, a.ctx(), ports)).events).toEqual([]);
    expect(await executeQuery(eventSeriesQuery, { eventId: ev.id }, a.ctx(), ports)).toBeNull();
    expect(await publicEventSeries({ orgId: a.org.id, eventId: ev.id })).toBeNull();
    expect((await publicSeriesBySlug(s.slug, now))?.events).toEqual([]);
  });

  it('the next event copies the latest edition and lands as a draft in the series', async () => {
    const t = tag();
    const s = await executeCommand(createSeriesCommand, { name: `Annual ${t}` }, a.ctx(), ports);
    const first = await executeCommand(
      createEventInSeriesCommand,
      { event: eventInput(`Annual ${t} 2029`), seriesId: s.id },
      a.ctx(),
      ports,
    );
    await executeCommand(
      createTicketTypeCommand,
      { eventId: first.id, name: 'Early bird', priceMinor: 1500, quantityTotal: 50 },
      a.ctx(),
      ports,
    );
    const latest = (await executeQuery(seriesDetailQuery, { slug: s.slug }, a.ctx(), ports)).events.at(-1);
    expect(latest?.id).toBe(first.id);
    const next = await executeCommand(
      duplicateEventCommand,
      { eventId: first.id, name: `Annual ${t} 2030`, startsAt: '2030-05-01T18:00:00Z' },
      a.ctx(),
      ports,
    );
    expect(next.status).toBe('draft');
    const detail = await executeQuery(seriesDetailQuery, { slug: s.slug }, a.ctx(), ports);
    expect(detail.events.map((e) => e.id)).toEqual([first.id, next.id]);
  });
});
