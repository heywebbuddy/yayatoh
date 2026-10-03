import { type AlertDeps, catchUpAlerts, evaluateOrgNow } from '@yayatoh/alerts';
import { markGuestsArrivedCommand } from '@yayatoh/checkin';
import { createEventCommand } from '@yayatoh/events';
import { quickLayout } from '@yayatoh/floorplan';
import {
  addPartyGuestCommand,
  createPartyCommand,
  createRsvpLinksCommand,
  createSubEventCommand,
  markRsvpSentCommand,
  partyRsvpQuery,
  recordSubEventResponseCommand,
  saveMenuOptionCommand,
  setRsvpSettingsCommand,
} from '@yayatoh/guests';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { createNotifier } from '@yayatoh/notifications';
import { seatGuestsCommand, setEventLayoutCommand } from '@yayatoh/seating';
import { ports } from './ports.ts';

/** The M4.6a acceptance fixture's numbers. */
export const SOCIAL_FIXTURE = {
  /** Fourteen households of three who haven't answered: "42 guests have not responded to RSVP". */
  pendingParties: 14,
  perParty: 3,
  pending: 42,
  /** Rivera (Sofia and Diego) said yes, Nakamura (Ken) declined. */
  responded: 3,
  invited: 45,
  /** Invitations sent to ten of the waiting households (the other four: 12 guests not sent). */
  sentParties: 10,
  notSent: 12,
  /** Rivera and three waiting households seated: 33 waiting guests without a table. */
  unseated: 33,
  /** Attending: Sofia (Beef, gluten-free) and Diego (no meal yet, wheelchair access). */
  attending: 2,
  mealsMissing: 1,
} as const;

/** Surnames of the waiting households (one per party), in order. */
const FAMILIES = [
  'Abara',
  'Bianchi',
  'Castillo',
  'Dubois',
  'Eriksen',
  'Fontaine',
  'Gallagher',
  'Haddad',
  'Ivanova',
  'Jensen',
  'Kowalski',
  'Laurent',
  'Moreau',
  'Novak',
] as const;
const FIRST = ['Alex', 'Sam', 'Robin'] as const;

export interface SocialPackParty {
  readonly id: string;
  readonly name: string;
  readonly guestIds: readonly string[];
}

export interface SocialPackScenario {
  readonly orgId: string;
  readonly eventId: string;
  readonly eventSlug: string;
  readonly eventName: string;
  readonly subEventId: string;
  readonly deadline: Date;
  /** The fourteen waiting households, in FAMILIES order. */
  readonly pending: readonly SocialPackParty[];
  readonly rivera: SocialPackParty;
  readonly nakamura: SocialPackParty;
  /** The first waiting household's RSVP link token (`/rsvp/{token}`). */
  readonly firstToken: string;
  /** The host records a household's answers (as from a paper reply). */
  readonly answer: (party: SocialPackParty, status: 'attending' | 'declined') => Promise<void>;
  /** Check Sofia Rivera in (the host's day-of check-in). */
  readonly arriveSofia: () => Promise<void>;
  /** What the worker does: the evaluator over the outbox, then the scheduled sweep. */
  readonly evaluate: (now?: Date) => Promise<void>;
}

/**
 * The M4.6a social pack fixture, built through the real commands as a host would (integration
 * tests and e2e share it): a wedding 40 days out (Chicago) with one sub-event everyone is invited
 * to, an RSVP deadline `deadlineInDays` from now (default 5: inside the −7 d window), a menu
 * (Beef; Risotto, vegetarian), a plan of two tables of ten, fourteen households of three who
 * haven't answered (ten were sent their invitation), Rivera attending and Nakamura declined.
 * Rivera and three waiting households are seated. Then the alert engine evaluates it.
 */
export async function socialPackScenario(
  orgId: string,
  opts: { deadlineInDays?: number; ctx?: Ctx; deps?: AlertDeps; evaluate?: boolean } = {},
): Promise<SocialPackScenario> {
  const ctx = opts.ctx ?? createCtx({ orgId, actor: { type: 'system', name: 'fixture' } });
  const deps = opts.deps ?? { notifier: createNotifier() };
  const tag = uuidv7().slice(-8);
  // 40 days out: beyond the sweep's 30-day window, so only the RSVP deadline brings it in.
  const start = new Date(Date.now() + 40 * 86_400_000);
  start.setUTCHours(22, 0, 0, 0);
  const at = (h: number) => new Date(start.getTime() + h * 3_600_000).toISOString();
  const eventName = `Rivera Novak Wedding ${tag}`;
  const ev = await executeCommand(
    createEventCommand,
    {
      name: eventName,
      slug: `social-${tag}`,
      profile: 'wedding',
      timezone: 'America/Chicago',
      startsAt: at(0),
      endsAt: at(7),
    },
    ctx,
    ports,
  );
  const eventId = ev.id;
  const sub = await executeCommand(
    createSubEventCommand,
    {
      eventId,
      name: 'Ceremony and reception',
      kind: 'reception',
      startsAt: at(0),
      endsAt: at(6),
      place: 'The orchard',
      inviteAll: true,
    },
    ctx,
    ports,
  );
  for (const [label, notes] of [
    ['Beef', null],
    ['Risotto', 'Vegetarian'],
  ] as const)
    await executeCommand(saveMenuOptionCommand, { eventId, label, notes }, ctx, ports);

  const household = async (
    name: string,
    people: readonly { firstName: string; meal?: string; dietary?: string; accessibility?: string }[],
  ): Promise<SocialPackParty> => {
    const p = await executeCommand(createPartyCommand, { eventId, name }, ctx, ports);
    const guestIds: string[] = [];
    for (const person of people) {
      const g = await executeCommand(
        addPartyGuestCommand,
        {
          eventId,
          partyId: p.id,
          firstName: person.firstName,
          lastName: name,
          meal: person.meal ?? null,
          dietary: person.dietary ?? null,
          accessibility: person.accessibility ?? null,
        },
        ctx,
        ports,
      );
      guestIds.push(g.id);
    }
    return { id: p.id, name, guestIds };
  };
  const pending: SocialPackParty[] = [];
  for (const family of FAMILIES)
    pending.push(
      await household(
        family,
        FIRST.map((firstName) => ({ firstName })),
      ),
    );
  const rivera = await household('Rivera', [
    { firstName: 'Sofia', meal: 'Beef', dietary: 'Gluten-free' },
    { firstName: 'Diego', accessibility: 'Wheelchair access' },
  ]);
  const nakamura = await household('Nakamura', [{ firstName: 'Ken' }]);

  const answer = async (party: SocialPackParty, status: 'attending' | 'declined') => {
    for (const guestId of party.guestIds)
      await executeCommand(
        recordSubEventResponseCommand,
        { eventId, guestId, subEventId: sub.id, status },
        ctx,
        ports,
      );
  };
  await answer(rivera, 'attending');
  await answer(nakamura, 'declined');

  const deadline = new Date(Date.now() + (opts.deadlineInDays ?? 5) * 86_400_000);
  await executeCommand(setRsvpSettingsCommand, { eventId, deadline, nameLookup: false }, ctx, ports);
  await executeCommand(createRsvpLinksCommand, { eventId }, ctx, ports);
  for (const p of pending.slice(0, SOCIAL_FIXTURE.sentParties))
    await executeCommand(markRsvpSentCommand, { eventId, partyId: p.id }, ctx, ports);
  const first = pending[0] as SocialPackParty;
  const detail = await executeQuery(partyRsvpQuery, { eventId, partyId: first.id }, ctx, ports);
  if (!detail.token) throw new Error('socialPackScenario: no link');

  const doc = quickLayout({ rows: 0, seatsPerRow: 1, tables: 2, seatsPerTable: 10, stage: false });
  await executeCommand(setEventLayoutCommand, { eventId, doc }, ctx, ports);
  const [t1 = '', t2 = ''] = doc.items.map((i) => i.id);
  const seat = (itemId: string, guestIds: string[]) =>
    executeCommand(seatGuestsCommand, { eventId, subEventId: null, itemId, guestIds }, ctx, ports);
  await seat(t1, [...rivera.guestIds, ...pending.slice(0, 2).flatMap((p) => p.guestIds)]);
  await seat(t2, [...(pending[2]?.guestIds ?? [])]);

  const evaluate = async (now = new Date()) => {
    await catchUpAlerts(orgId, deps);
    await evaluateOrgNow(orgId, deps, { full: true, now });
  };
  if (opts.evaluate !== false) await evaluate();
  return {
    orgId,
    eventId,
    eventSlug: ev.slug,
    eventName,
    subEventId: sub.id,
    deadline,
    pending,
    rivera,
    nakamura,
    firstToken: detail.token,
    answer,
    arriveSofia: async () => {
      await executeCommand(
        markGuestsArrivedCommand,
        { eventId, guestIds: [rivera.guestIds[0] as string] },
        ctx,
        ports,
      );
    },
    evaluate,
  };
}
