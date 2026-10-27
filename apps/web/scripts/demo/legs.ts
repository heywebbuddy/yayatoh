import {
  addOccurrencesCommand,
  createEventCommand,
  getEventBySlugQuery,
  transitionEventCommand,
} from '@yayatoh/events';
import { buildRow } from '@yayatoh/floorplan';
import {
  assignSeatCategoryCommand,
  giveDateOwnChartCommand,
  publishEventLayoutCommand,
  setEventLayoutCommand,
} from '@yayatoh/seating';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { addDays, ask, type Demo, log, owner, run, step } from './kit.ts';

const SLUG = 'demo-city-hopper-express';

/**
 * One seat per date ("airplane style"): a three-date run whose dates each have their own seat map.
 * Try it at /events/demo-city-hopper-express/legs: pick a seat on two or three dates in one order.
 */
export async function legsTrip(d: Demo) {
  if (await ask(getEventBySlugQuery, { slug: SLUG }, owner(d)).catch(() => null))
    return log(`${SLUG} exists, skipped`);
  const day = (n: number, h: number) => {
    const t = addDays(new Date(), n);
    t.setUTCHours(h, 0, 0, 0);
    return t.toISOString();
  };
  const ev = await step('legs event', () =>
    run<unknown, { id: string }>(
      createEventCommand,
      {
        name: 'Demo · City Hopper Express',
        tagline: 'One train, three nights: choose a seat on each date you ride.',
        timezone: d.timezone,
        startsAt: day(20, 17),
        endsAt: day(20, 20),
        profile: 'gala',
      },
      owner(d),
    ),
  );
  if (!ev) return;
  const dates = await run<unknown, { id: string }[]>(
    addOccurrencesCommand,
    { eventId: ev.id, dates: [20, 27, 34].map((n) => ({ startsAt: day(n, 17), endsAt: day(n, 20) })) },
    owner(d),
  );
  const seat = await run<unknown, { id: string }>(
    createTicketTypeCommand,
    { eventId: ev.id, name: 'Window seat', priceMinor: 4_000, quantityTotal: 200 },
    owner(d),
  );
  const rows = ['A', 'B', 'C'].map((label, i) => buildRow({ label, count: 8, x: 100, y: 100 + i * 120 }));
  await run(
    setEventLayoutCommand,
    { eventId: ev.id, doc: { version: 1, width: 1200, height: 600, items: rows } },
    owner(d),
  );
  await run(
    assignSeatCategoryCommand,
    { eventId: ev.id, itemIds: rows.map((r) => r.id), ticketTypeId: seat.id },
    owner(d),
  );
  await run(publishEventLayoutCommand, { eventId: ev.id }, owner(d));
  for (const o of dates) await run(giveDateOwnChartCommand, { eventId: ev.id, occurrenceId: o.id }, owner(d));
  await run(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, owner(d));
  log(`${SLUG}: 3 dates with their own seat maps`);
}
