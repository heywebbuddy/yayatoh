import { sql } from '@yayatoh/db';
import {
  armLevelCommand,
  assignPaddleCommand,
  closeCallCommand,
  confirmEntriesCommand,
  createCampaignCommand as createDonationCampaignCommand,
  createLevelCommand,
  createMatchCommand,
  recordPaddlesCommand,
  recordPledgePaymentCommand,
  saveScreenCommand,
} from '@yayatoh/donations';
import { buildRoundTable, buildRow } from '@yayatoh/floorplan';
import { addPartyGuestCommand, createPartyCommand } from '@yayatoh/guests';
import {
  assignSeatCategoryCommand,
  blockSeatsCommand,
  publishEventLayoutCommand,
  setEventLayoutCommand,
  setTableSponsorCommand,
} from '@yayatoh/seating';
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
import {
  addDays,
  addMinutes,
  createCtxWithKey,
  type Demo,
  dayOf,
  log,
  owner,
  people,
  read,
  run,
  step,
} from './kit.ts';

interface SeatRow {
  readonly seat_uuid: string;
  readonly item_id: string;
  readonly ticket_type_id: string | null;
  readonly label: string;
}
/** The event's seats on sale, in plan order. */
async function seatsOf(d: Demo, eventId: string): Promise<SeatRow[]> {
  return read<SeatRow & Record<string, unknown>>(
    d,
    sql`select seat_uuid, item_id, ticket_type_id, label from seating.event_seats
         where event_id = ${eventId} and status = 'available' and ticket_type_id is not null
         order by item_id, label`,
  );
}

const stage = (x: number, y: number, w: number, h: number, label: string, objectType = 'stage') => ({
  kind: 'object' as const,
  id: crypto.randomUUID(),
  objectType,
  label,
  x,
  y,
  width: w,
  height: h,
});

/** A gala: round tables sold by the seat, sponsored tables, a fund-a-need with a paddle raise. */
export async function gala(d: Demo, venues: Record<VenueKey, string>, spec: EventSpec, tag: string) {
  if (await existing(d, spec.slug)) return log(`${spec.slug} exists, skipped`);
  const b = await buildEvent(d, venues, spec);
  const t = await ticketTypes(d, b, [
    {
      name: 'Gala seat',
      priceMinor: 25_000,
      quantityTotal: 80,
      description: 'Dinner, the programme and the after-party.',
      earlyPriceMinor: 20_000,
    },
    {
      name: 'Patron table seat',
      priceMinor: 50_000,
      quantityTotal: 30,
      description: 'Front tables, a welcome reception and a signed programme.',
    },
    {
      name: 'Sponsor table',
      priceMinor: 400_000,
      quantityTotal: 3,
      visibility: 'hidden',
      description: 'A table of ten for our corporate sponsors.',
      tableSize: 10,
    },
  ]);
  const tables = Array.from({ length: 12 }, (_, i) =>
    buildRoundTable({
      label: `${i + 1}`,
      seats: 10,
      x: 300 + (i % 4) * 450,
      y: 600 + Math.floor(i / 4) * 450,
    }),
  );
  const ctx = () => owner(d);
  const laid = await step(`${b.slug} plan`, () =>
    run(
      setEventLayoutCommand,
      {
        eventId: b.id,
        doc: {
          version: 1,
          width: 2000,
          height: 2000,
          items: [
            ...tables,
            stage(800, 60, 400, 180, 'Stage'),
            stage(1700, 1800, 250, 120, 'Bar', 'bar'),
            stage(80, 1800, 200, 120, 'Entrance', 'entrance'),
          ],
        },
      },
      ctx(),
    ),
  );
  if (laid) {
    const patron = tables.slice(0, 3).map((x) => x.id);
    const gala = tables.slice(3).map((x) => x.id);
    if (t['Patron table seat'])
      await step(`${b.slug} patron tables`, () =>
        run(
          assignSeatCategoryCommand,
          { eventId: b.id, itemIds: patron, ticketTypeId: t['Patron table seat'] },
          ctx(),
        ),
      );
    if (t['Gala seat'])
      await step(`${b.slug} gala tables`, () =>
        run(assignSeatCategoryCommand, { eventId: b.id, itemIds: gala, ticketTypeId: t['Gala seat'] }, ctx()),
      );
    await step(`${b.slug} accessible seats`, () =>
      run(blockSeatsCommand, { eventId: b.id, itemIds: [tables[11]?.id], reason: 'ada' }, ctx()),
    );
    await step(`${b.slug} publish plan`, () => run(publishEventLayoutCommand, { eventId: b.id }, ctx()));
    const sponsors = ['Horizon Foundation', 'Nimbus Technologies', 'Seaside Community Bank'];
    for (const [i, name] of sponsors.entries())
      await step(`${b.slug} table sponsor ${name}`, () =>
        run(
          setTableSponsorCommand,
          { eventId: b.id, itemId: tables[i]?.id, sponsorName: name, published: true },
          ctx(),
        ),
      );
  }
  await promoCodes(d, b, tag.toUpperCase());
  await publish(d, b);
  // Seats: couples and small groups across the room.
  const seats = await seatsOf(d, b.id);
  const buyers = people(d, tag, 26);
  const orders: { buyer: (typeof buyers)[number]; seats: string[] }[] = [];
  let s = 0;
  for (const [i, buyer] of buyers.entries()) {
    const n = 1 + (i % 4);
    const pick = seats.slice(s, s + n).map((x) => x.seat_uuid);
    s += n + (i % 3 === 0 ? 2 : 0);
    if (pick.length) orders.push({ buyer, seats: pick });
  }
  await sell(d, b, orders);
  await donations(d, b, tag);
  await checkIns(d, b);
  await complete(d, b);
}

async function donations(d: Demo, b: Built, tag: string) {
  const ctx = (now?: Date) => owner(d, now);
  const campaign = await step(`${b.slug} fund-a-need`, () =>
    run<unknown, { id: string }>(
      createDonationCampaignCommand,
      {
        eventId: b.id,
        name: 'Fund a classroom',
        description: 'Every paddle raised tonight furnishes a classroom in a rural school for a year.',
        goalMinor: 2_500_000,
      },
      ctx(),
    ),
  );
  if (!campaign) return;
  const levels: string[] = [];
  for (const [name, amountMinor] of [
    ['A classroom for a year', 250_000],
    ['Library books', 50_000],
    ['A school day', 10_000],
  ] as const) {
    const l = await step(`${b.slug} level ${name}`, () =>
      run<unknown, { id: string }>(
        createLevelCommand,
        { eventId: b.id, campaignId: campaign.id, name, amountMinor },
        ctx(),
      ),
    );
    if (l) levels.push(l.id);
  }
  await step(`${b.slug} match`, () =>
    run(
      createMatchCommand,
      {
        eventId: b.id,
        campaignId: campaign.id,
        sponsorName: 'Nimbus Technologies',
        publicName: 'Nimbus doubles every gift',
        ratioPercent: 100,
        capMinor: 500_000,
        startsAt: addDays(b.startsAt, -30),
        endsAt: b.endsAt,
      },
      ctx(),
    ),
  );
  await step(`${b.slug} donation screen`, () =>
    run(saveScreenCommand, { eventId: b.id, campaignId: campaign.id, showNames: true }, ctx()),
  );
  // Paddles for twelve households, then three calls during the evening.
  const donors = people(d, `${tag}-donor`, 12);
  const paddles: { number: number; partyId: string }[] = [];
  for (const p of donors) {
    const party = await step(`${b.slug} donor ${p.last}`, () =>
      run<unknown, { id: string }>(createPartyCommand, { eventId: b.id, name: `${p.name} household` }, ctx()),
    );
    if (!party) continue;
    await step(`${b.slug} donor guest`, () =>
      run(
        addPartyGuestCommand,
        { eventId: b.id, partyId: party.id, firstName: p.first, lastName: p.last },
        ctx(),
      ),
    );
    const paddle = await step(`${b.slug} paddle`, () =>
      run<unknown, { number: number }>(assignPaddleCommand, { eventId: b.id, partyId: party.id }, ctx()),
    );
    if (paddle) paddles.push({ number: paddle.number, partyId: party.id });
  }
  if (!b.past) return log(`${b.slug}: donations ready, ${paddles.length} paddles`);
  const during = addMinutes(b.startsAt, 150);
  for (const [li, levelId] of levels.entries()) {
    const raised = paddles.filter((_, i) => (i + li) % (li + 2) === 0).map((p) => p.number);
    if (raised.length === 0) continue;
    await step(`${b.slug} paddle raise ${li + 1}`, async () => {
      const call = await run<unknown, { id: string }>(
        armLevelCommand,
        { eventId: b.id, campaignId: campaign.id, levelId },
        ctx(during),
      );
      await run(
        recordPaddlesCommand,
        {
          eventId: b.id,
          entries: raised.map((paddle, k) => ({
            clientId: crypto.randomUUID(),
            callId: call.id,
            paddle,
            recordedAt: addMinutes(during, k),
          })),
        },
        ctx(during),
      );
      await run(closeCallCommand, { eventId: b.id, callId: call.id }, ctx(during));
      await run(confirmEntriesCommand, { eventId: b.id, callId: call.id }, ctx(during));
    });
  }
  // Half of the pledges already paid by cheque or wire.
  const pledges = await read<{ id: string } & Record<string, unknown>>(
    d,
    sql`select id from donations.pledges where event_id = ${b.id} order by created_at`,
  ).catch(() => []);
  for (const [i, pl] of pledges.entries()) {
    if (i % 2 === 1) continue;
    await step(`${b.slug} pledge payment`, () =>
      run(
        recordPledgePaymentCommand,
        {
          eventId: b.id,
          pledgeId: pl.id,
          method: i % 4 === 0 ? 'check' : 'wire',
          reference: `DEMO-PLEDGE-${i + 1}`,
          receivedOn: dayOf(addDays(b.endsAt, 3), d.timezone),
        },
        createCtxWithKey(d, `demo-pledge-${pl.id}`),
      ),
    );
  }
  log(`${b.slug}: paddle raise with ${pledges.length} pledges`);
}

/** A concert: a stage and numbered rows in two price zones, standing room, VIP hidden tickets. */
export async function concert(d: Demo, venues: Record<VenueKey, string>, spec: EventSpec, tag: string) {
  if (await existing(d, spec.slug)) return log(`${spec.slug} exists, skipped`);
  const b = await buildEvent(d, venues, spec);
  const t = await ticketTypes(d, b, [
    {
      name: 'Gold (rows A–D)',
      priceMinor: 6_500,
      quantityTotal: 80,
      description: 'Closest to the stage.',
      earlyPriceMinor: 5_500,
    },
    { name: 'Silver (rows E–J)', priceMinor: 3_900, quantityTotal: 120 },
    {
      name: 'Standing',
      priceMinor: 2_500,
      quantityTotal: 300,
      description: 'Standing area by the bar.',
      maxPerOrder: 6,
    },
    {
      name: 'VIP lounge',
      priceMinor: 12_000,
      quantityTotal: 40,
      visibility: 'hidden',
      description: 'Lounge access, a drink and merch.',
    },
  ]);
  const rows = Array.from({ length: 10 }, (_, i) =>
    buildRow({ label: String.fromCharCode(65 + i), count: 20, x: 300, y: 400 + i * 90 }),
  );
  const ctx = () => owner(d);
  const laid = await step(`${b.slug} plan`, () =>
    run(
      setEventLayoutCommand,
      {
        eventId: b.id,
        doc: {
          version: 1,
          width: 1800,
          height: 1500,
          items: [...rows, stage(500, 60, 800, 220, 'Stage'), stage(1450, 1300, 300, 150, 'Bar', 'bar')],
        },
      },
      ctx(),
    ),
  );
  if (laid) {
    if (t['Gold (rows A–D)'])
      await step(`${b.slug} gold rows`, () =>
        run(
          assignSeatCategoryCommand,
          { eventId: b.id, itemIds: rows.slice(0, 4).map((r) => r.id), ticketTypeId: t['Gold (rows A–D)'] },
          ctx(),
        ),
      );
    if (t['Silver (rows E–J)'])
      await step(`${b.slug} silver rows`, () =>
        run(
          assignSeatCategoryCommand,
          { eventId: b.id, itemIds: rows.slice(4).map((r) => r.id), ticketTypeId: t['Silver (rows E–J)'] },
          ctx(),
        ),
      );
    await step(`${b.slug} publish plan`, () => run(publishEventLayoutCommand, { eventId: b.id }, ctx()));
  }
  await promoCodes(d, b, tag.toUpperCase());
  await publish(d, b);
  const seats = await seatsOf(d, b.id);
  const buyers = people(d, tag, 36);
  const orders: {
    buyer: (typeof buyers)[number];
    seats?: string[];
    items?: { ticketTypeId: string; quantity: number }[];
  }[] = [];
  let s = 0;
  for (const [i, buyer] of buyers.entries()) {
    if (i % 3 === 2 && t.Standing)
      orders.push({ buyer, items: [{ ticketTypeId: t.Standing, quantity: 1 + (i % 4) }] });
    else if (i % 11 === 0 && t['VIP lounge'])
      orders.push({ buyer, items: [{ ticketTypeId: t['VIP lounge'], quantity: 2 }] });
    else {
      const n = 1 + (i % 3);
      const pick = seats.slice(s, s + n).map((x) => x.seat_uuid);
      s += n + (i % 4);
      if (pick.length) orders.push({ buyer, seats: pick });
    }
  }
  await sell(d, b, orders);
  await checkIns(d, b, 0.85);
  await complete(d, b);
}
