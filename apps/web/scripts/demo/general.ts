import { sql } from '@yayatoh/db';
import {
  createCampaignCommand as createDonationCampaignCommand,
  createLevelCommand,
} from '@yayatoh/donations';
import { addRecurringOccurrencesCommand } from '@yayatoh/events';
import { recordBoxOfficeSaleCommand, startCheckoutCommand } from '@yayatoh/orders';
import { submitReviewCommand } from '@yayatoh/reviews';
import {
  type Built,
  buildEvent,
  checkIns,
  complete,
  type EventSpec,
  existing,
  promoCodes,
  publish,
  sell,
  ticketTypes,
  type VenueKey,
} from './common.ts';
import { addDays, type Demo, log, owner, people, read, run, step, visitor } from './kit.ts';

const REVIEWS = [
  [5, 'Brilliant afternoon, so well organised. The volunteers were lovely.'],
  [4, 'Great vibe and good food. Queues at the entrance were a bit long.'],
  [5, 'Brought the kids and they loved it. We will be back next year!'],
  [4, 'Lovely event, would like more seating in the shade.'],
  [5, 'Everything was on time and the venue was perfect.'],
] as const;

/** A community event: free and paid tickets, a donation drive, attendee reviews after the event. */
export async function community(d: Demo, venues: Record<VenueKey, string>, spec: EventSpec, tag: string) {
  if (await existing(d, spec.slug)) return log(`${spec.slug} exists, skipped`);
  const b = await buildEvent(d, venues, spec);
  const t = await ticketTypes(d, b, [
    {
      name: 'Free entry',
      priceMinor: 0,
      quantityTotal: 300,
      description: 'Registration is free; please book so we can plan.',
      maxPerOrder: 6,
    },
    {
      name: 'Supporter ticket',
      priceMinor: 1_500,
      quantityTotal: 100,
      description: 'Pay what helps: covers supplies and refreshments.',
    },
    {
      name: 'Family pack (4)',
      priceMinor: 4_000,
      quantityTotal: 40,
      description: 'Four entries and a picnic hamper.',
    },
  ]);
  await step(`${b.slug} donations`, async () => {
    const c = await run<unknown, { id: string }>(
      createDonationCampaignCommand,
      {
        eventId: b.id,
        name: 'Keep our coastline clean',
        description: 'Every gift buys gloves, bags and saplings for the next clean-up.',
        goalMinor: 300_000,
        minGiftMinor: 500,
      },
      owner(d),
    );
    for (const [name, amountMinor] of [
      ['Plant a tree', 1_000],
      ['Clean-up kit for a volunteer', 2_500],
      ['Sponsor a whole beach', 25_000],
    ] as const)
      await run(createLevelCommand, { eventId: b.id, campaignId: c.id, name, amountMinor }, owner(d));
  });
  await promoCodes(d, b, tag.toUpperCase());
  await publish(d, b);
  // Free registrations through the public checkout (as visitors do), then box-office sales.
  const free = people(d, tag, 18);
  const tokens: string[] = [];
  if (t['Free entry'])
    for (const [i, p] of free.entries()) {
      const r = await step(`${b.slug} free ${p.email}`, () =>
        run<unknown, { manageToken: string }>(
          startCheckoutCommand,
          {
            eventId: b.id,
            items: [{ ticketTypeId: t['Free entry'], quantity: 1 + (i % 3) }],
            buyer: { email: p.email, name: p.name },
            marketingOptIn: i % 2 === 0,
          },
          visitor(d, b.past ? addDays(b.startsAt, -10 + (i % 8)) : undefined),
        ),
      );
      if (r) tokens.push(r.manageToken);
    }
  const paid = people(d, tag, 14, 18);
  await sell(
    d,
    b,
    paid.flatMap((buyer, i) => {
      const id = i % 3 === 0 ? t['Family pack (4)'] : t['Supporter ticket'];
      return id ? [{ buyer, items: [{ ticketTypeId: id, quantity: 1 + (i % 2) }] }] : [];
    }),
  );
  await checkIns(d, b, 0.75);
  await complete(d, b);
  if (b.past)
    for (const [i, token] of tokens.slice(0, REVIEWS.length).entries()) {
      const [rating, body] = REVIEWS[i] as (typeof REVIEWS)[number];
      await step(`${b.slug} review`, () =>
        run(submitReviewCommand, { manageToken: token, rating, body }, visitor(d, addDays(b.endsAt, 1 + i))),
      );
    }
}

/** An agency event for a client: invitation-only guest list, press passes, check-in. */
export async function agency(d: Demo, venues: Record<VenueKey, string>, spec: EventSpec, tag: string) {
  if (await existing(d, spec.slug)) return log(`${spec.slug} exists, skipped`);
  const b = await buildEvent(d, venues, spec);
  const t = await ticketTypes(d, b, [
    {
      name: 'Invited guest',
      priceMinor: 0,
      quantityTotal: 120,
      description: 'By invitation from the client.',
      visibility: 'hidden',
    },
    {
      name: 'Press & media',
      priceMinor: 0,
      quantityTotal: 20,
      description: 'Press kit and the photo pit.',
      visibility: 'hidden',
    },
    {
      name: 'Partner delegate',
      priceMinor: 7_500,
      quantityTotal: 60,
      description: 'Partner programme, lunch and the evening reception.',
    },
  ]);
  await promoCodes(d, b, tag.toUpperCase());
  await publish(d, b);
  const guests = people(d, tag, 28);
  await sell(
    d,
    b,
    guests.flatMap((buyer, i) => {
      const id = i % 7 === 0 ? t['Press & media'] : i % 3 === 0 ? t['Partner delegate'] : t['Invited guest'];
      return id ? [{ buyer, items: [{ ticketTypeId: id, quantity: 1 }] }] : [];
    }),
  );
  await checkIns(d, b, 0.9);
  await complete(d, b);
}

/** Any other event: here a weekly workshop with dates to choose from (or a one-off). */
export async function other(
  d: Demo,
  venues: Record<VenueKey, string>,
  spec: EventSpec,
  tag: string,
  weekly: boolean,
) {
  if (await existing(d, spec.slug)) return log(`${spec.slug} exists, skipped`);
  const b = await buildEvent(d, venues, spec);
  let dates: { id: string }[] = [];
  if (weekly) {
    await step(`${b.slug} weekly dates`, () =>
      run(
        addRecurringOccurrencesCommand,
        {
          eventId: b.id,
          rule: {
            startDate: spec.date,
            startTime: spec.start,
            endTime: spec.end,
            freq: 'weekly',
            interval: 1,
            byWeekday: [6],
            count: 6,
          },
          capacity: 12,
        },
        owner(d),
      ),
    );
    dates = await read<{ id: string } & Record<string, unknown>>(
      d,
      sql`select id from events.occurrences where event_id = ${b.id} order by starts_at`,
    );
  }
  const t = await ticketTypes(d, b, [
    {
      name: 'Workshop seat',
      priceMinor: 4_500,
      quantityTotal: 72,
      description: 'All materials and two firings included.',
    },
    { name: 'Bring a friend (2 seats)', priceMinor: 8_000, quantityTotal: 20 },
  ]);
  await promoCodes(d, b, tag.toUpperCase());
  await publish(d, b);
  const buyers = people(d, tag, weekly ? 30 : 16);
  if (weekly && dates.length) {
    for (const [i, buyer] of buyers.entries()) {
      const date = dates[i % dates.length] as { id: string };
      const id = i % 4 === 0 ? t['Bring a friend (2 seats)'] : t['Workshop seat'];
      if (!id) continue;
      await sellOnDate(d, b, buyer, id, date.id, i);
    }
    log(`${b.slug}: ${buyers.length} bookings over ${dates.length} dates`);
  } else {
    await sell(
      d,
      b,
      buyers.flatMap((buyer, i) => {
        const id = i % 4 === 0 ? t['Bring a friend (2 seats)'] : t['Workshop seat'];
        return id ? [{ buyer, items: [{ ticketTypeId: id, quantity: 1 }] }] : [];
      }),
    );
  }
  await checkIns(d, b, 0.8);
  await complete(d, b);
}

async function sellOnDate(
  d: Demo,
  b: Built,
  buyer: { email: string; name: string },
  ticketTypeId: string,
  occurrenceId: string,
  i: number,
) {
  await step(`${b.slug} booking ${buyer.email}`, () =>
    run(
      recordBoxOfficeSaleCommand,
      {
        eventId: b.id,
        occurrenceId,
        items: [{ ticketTypeId, quantity: 1 }],
        buyer,
        method: i % 2 ? 'cash' : 'card_terminal',
        reference: `DEMO-W${String(i + 1).padStart(3, '0')}`,
        locale: 'en',
      },
      owner(d),
    ),
  );
}
