import { CONTACT_SIGNAL_EVENTS, catchUpContactSignals, catchUpParticipation } from '@yayatoh/audiences';
import { setFeeOverrideCommand } from '@yayatoh/billing';
import { scanTicketCommand } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, uuidv7 } from '@yayatoh/kernel';
import { recordBoxOfficeSaleCommand } from '@yayatoh/orders';
import { emitEvents } from '@yayatoh/platform';
import { createSessionCommand } from '@yayatoh/program';
import { createTicketTypeCommand, ticketsForOrderTx } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { ports } from './ports.ts';

/**
 * The vision's John Doe (docs/vision.md §11), M6.1b: attended Event A, bought VIP at Event B
 * (and went), registered for Event C (upcoming), attended 4 conference sessions at B, opened
 * 2 email campaigns, $1,800 of tickets over time. Three neighbours give the org's distributions
 * and the segment its edges:
 * - Mia Lane: General at A and at B, never checked in ($700; two no-shows);
 * - Ray Park: VIP at B, checked in ($1,200; no no-shows in one event);
 * - Zoe Hart: General at C, upcoming ($300; no history: the prior).
 */
export const CONTACT_STATS_EVENTS = {
  a: { startsAt: '2025-04-10T15:00:00Z', endsAt: '2025-04-10T22:00:00Z', during: '2025-04-10T16:00:00Z' },
  b: { startsAt: '2025-09-18T13:00:00Z', endsAt: '2025-09-19T22:00:00Z', during: '2025-09-18T13:30:00Z' },
  c: { startsAt: '2030-01-20T19:00:00Z', endsAt: '2030-01-20T23:00:00Z', during: '2030-01-20T19:30:00Z' },
} as const;

/** Prices in minor units (USD): A General $300, B VIP $1,200, B General $400, C General $300. */
export const CONTACT_STATS_PRICES = {
  aGeneral: 30_000,
  bVip: 120_000,
  bGeneral: 40_000,
  cGeneral: 30_000,
} as const;

export const JOHN_DOE_EXPECTED = {
  events: 3,
  eventsRegistered: 3,
  eventsAttended: 2,
  pastRegistered: 2,
  noShows: 0,
  sessionsAttended: 4,
  campaignsOpened: 2,
  orders: 3,
  lifetimeMinor: 180_000,
  currency: 'USD',
  /** (0 + 1) / (2 + 5) = 14.29 %. */
  noShowBps: 1_429,
  /** points = 10 × 2 + 5 × 4 + 2 × 2 = 44; round(100 × 44 / 69) = 64. */
  engagementScore: 64,
  /** Among the four: events 3 vs 2, 1, 1 → 4; lifetime $1,800 vs $1,200, $700, $300 → 4. */
  rfmFrequency: 4,
  rfmMonetary: 4,
} as const;

export interface ContactStatsPerson {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

export interface ContactStatsScenario {
  readonly tag: string;
  readonly events: { readonly a: string; readonly b: string; readonly c: string };
  readonly eventNames: { readonly a: string; readonly b: string; readonly c: string };
  readonly sessionIds: readonly string[];
  readonly campaignIds: readonly string[];
  readonly people: {
    readonly john: ContactStatsPerson;
    readonly mia: ContactStatsPerson;
    readonly ray: ContactStatsPerson;
    readonly zoe: ContactStatsPerson;
  };
  /** "LTV > $1,000 and no-show propensity < 20 %": John and Ray. */
  readonly expectedHighValueReliable: readonly string[];
}

/**
 * Build the scenario in one org through the real commands (box office sales, door scans, program
 * sessions), then the outbox signals for sessions attended and campaigns opened, then let the
 * participation projector and the signals subscriber catch up. Integration tests and e2e share it.
 * The org's ticket fee is set to zero so lifetime value is the ticket prices exactly.
 */
export async function contactStatsScenario(
  orgId: string,
  ctx: Ctx = createCtx({ orgId, actor: { type: 'system', name: 'fixture' } }),
): Promise<ContactStatsScenario> {
  const tag = uuidv7().slice(-8);
  const E = CONTACT_STATS_EVENTS;
  const P = CONTACT_STATS_PRICES;
  const at = (iso: string) => ({ ...ctx, now: new Date(iso) });
  const before = (iso: string) => at(new Date(new Date(iso).getTime() - 30 * 86_400_000).toISOString());
  await executeCommand(
    setFeeOverrideCommand,
    { currency: 'USD', percentBps: 0, fixedMinor: 0, reason: 'contact stats fixture: prices only' },
    ctx,
    ports,
  );

  const event = async (key: 'a' | 'b' | 'c', name: string) => {
    const when = E[key];
    const c = before(when.startsAt);
    const e = await executeCommand(
      createEventCommand,
      { name, timezone: 'UTC', startsAt: when.startsAt, endsAt: when.endsAt },
      c,
      ports,
    );
    return e.id;
  };
  const ticketType = async (eventId: string, name: string, priceMinor: number, when: string) =>
    (
      await executeCommand(
        createTicketTypeCommand,
        { eventId, name, priceMinor, quantityTotal: 50 },
        before(when),
        ports,
      )
    ).id;

  const eventNames = {
    a: `Spring Summit ${tag}`,
    b: `Harbor Conference ${tag}`,
    c: `Winter Gala ${tag}`,
  };
  const a = await event('a', eventNames.a);
  const b = await event('b', eventNames.b);
  const c = await event('c', eventNames.c);
  const aGeneral = await ticketType(a, 'General', P.aGeneral, E.a.startsAt);
  const bVip = await ticketType(b, 'VIP', P.bVip, E.b.startsAt);
  const bGeneral = await ticketType(b, 'General', P.bGeneral, E.b.startsAt);
  const cGeneral = await ticketType(c, 'General', P.cGeneral, E.c.startsAt);
  for (const [id, when] of [
    [a, E.a.startsAt],
    [b, E.b.startsAt],
    [c, E.c.startsAt],
  ] as const)
    await executeCommand(transitionEventCommand, { eventId: id, transition: 'publish' }, before(when), ports);

  // Four sessions on B's first day.
  const sessionIds: string[] = [];
  for (let i = 0; i < 4; i++) {
    const start = new Date(new Date(E.b.startsAt).getTime() + i * 2 * 3_600_000);
    const s = await executeCommand(
      createSessionCommand,
      {
        eventId: b,
        title: `Session ${i + 1}`,
        startsAt: start,
        endsAt: new Date(start.getTime() + 3_600_000),
      },
      before(E.b.startsAt),
      ports,
    );
    sessionIds.push(s.session.id);
  }

  const email = (who: string) => `${who.toLowerCase().replace(/\s+/g, '.')}.${tag}@stats.test`;
  const sell = async (eventId: string, ticketTypeId: string, who: string, when: string) => {
    const { order } = await executeCommand(
      recordBoxOfficeSaleCommand,
      {
        eventId,
        items: [{ ticketTypeId, quantity: 1 }],
        buyer: { email: email(who), name: who },
        method: 'cash',
      },
      at(when),
      ports,
    );
    const [ticket] = await withTenant(ctx, (tx) => ticketsForOrderTx(tx, order.id));
    return ticket?.code ?? '';
  };
  const scan = (eventId: string, code: string, during: string) =>
    executeCommand(scanTicketCommand, { eventId, code }, at(during), ports);

  // Event A (past): John goes, Mia does not.
  await scan(a, await sell(a, aGeneral, 'John Doe', '2025-03-15T12:00:00Z'), E.a.during);
  await sell(a, aGeneral, 'Mia Lane', '2025-03-16T12:00:00Z');
  // Event B (past): John (VIP) and Ray (VIP) go, Mia (General) does not.
  await scan(b, await sell(b, bVip, 'John Doe', '2025-08-20T12:00:00Z'), E.b.during);
  await sell(b, bGeneral, 'Mia Lane', '2025-08-21T12:00:00Z');
  await scan(b, await sell(b, bVip, 'Ray Park', '2025-08-22T12:00:00Z'), E.b.during);
  // Event C (upcoming): John and Zoe registered.
  await sell(c, cGeneral, 'John Doe', '2025-12-01T12:00:00Z');
  await sell(c, cGeneral, 'Zoe Hart', '2025-12-02T12:00:00Z');

  const ids = await withTenant(ctx, (tx) =>
    tx.execute<{ id: string; email: string; name: string }>(
      sql`select id, email, name from crm.contacts where email like ${`%.${tag}@stats.test`}`,
    ),
  );
  const person = (who: string): ContactStatsPerson => {
    const row = ids.find((r) => r.email === email(who));
    if (!row) throw new Error(`no contact for ${who}`);
    return { id: row.id, name: who, email: row.email };
  };
  const people = {
    john: person('John Doe'),
    mia: person('Mia Lane'),
    ray: person('Ray Park'),
    zoe: person('Zoe Hart'),
  };

  // The signals (M6.1b event contracts): John attended B's four sessions and opened two campaigns.
  const campaignIds = [uuidv7(), uuidv7()];
  const [sessionType, campaignType] = CONTACT_SIGNAL_EVENTS.map((k) => k.split('@')[0] as string);
  await withTenant(ctx, (tx) =>
    emitEvents(tx, ctx, [
      ...sessionIds.map((sessionId, i) => ({
        type: sessionType as string,
        version: 1,
        aggregateType: 'session',
        aggregateId: sessionId,
        payload: {
          eventId: b,
          sessionId,
          contactId: people.john.id,
          attendedAt: new Date(new Date(E.b.startsAt).getTime() + i * 2 * 3_600_000 + 60_000).toISOString(),
        },
      })),
      ...campaignIds.map((campaignId, i) => ({
        type: campaignType as string,
        version: 1,
        aggregateType: 'campaign',
        aggregateId: campaignId,
        payload: {
          campaignId,
          contactId: people.john.id,
          openedAt: `2025-0${6 + i}-10T09:00:00.000Z`,
        },
      })),
    ]),
  );
  await catchUpParticipation(orgId);
  await catchUpContactSignals(orgId);
  return {
    tag,
    events: { a, b, c },
    eventNames,
    sessionIds,
    campaignIds,
    people,
    expectedHighValueReliable: ['John Doe', 'Ray Park'],
  };
}
