import {
  type AlertDeps,
  type ConferenceSources,
  catchUpAlerts,
  evaluateEventAlertsTx,
} from '@yayatoh/alerts';
import { createCheckpointCommand, enrollDeviceCommand } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, uuidv7 } from '@yayatoh/kernel';
import { createNotifier } from '@yayatoh/notifications';
import { startCheckoutCommand } from '@yayatoh/orders';
import {
  createExhibitorCommand,
  createRoomCommand,
  createSessionCommand,
  createSpeakerCommand,
  createSponsorCommand,
  createSponsorTierCommand,
  inviteExhibitorMemberCommand,
  updateSessionCommand,
} from '@yayatoh/program';
import { seedRegistrationDefaultsCommand } from '@yayatoh/registration';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { ports } from './ports.ts';

/** The M5.9a acceptance fixture's numbers. */
export const CONFERENCE_FIXTURE = {
  /** Sessions at or over 95 % of their places (of five with a limit). */
  nearlyFull: 3,
  sessions: 5,
  /** Exhibitors, those with leads, and so those without. */
  exhibitors: 7,
  withLeads: 2,
  withoutLeads: 5,
  /** Exhibitors with a live portal person (the others have none). */
  staffed: 3,
  withoutStaff: 4,
  /** People waiting in the full panel's line (over the threshold of 10). */
  waiting: 12,
  /** Sessions holding more places than their room seats. */
  roomsTooSmall: 1,
  speakerTasksOverdue: 1,
  deliverablesOverdue: 2,
  printersOffline: 1,
  kiosksOffline: 1,
  approvalsPending: 1,
  invoicesOverdue: 1,
  /** People in the keynote's room now. */
  keynoteInRoom: 3,
} as const;

/**
 * The fake sources of facts from modules not on this build yet (leads M5.6b, sponsor deliverables
 * M5.4b, badge printers M5.5b): per event, in memory. Tests set and change them; `null` means not
 * served (the rule stays quiet).
 */
export interface FakeConferenceState {
  readonly leads: Map<string, Map<string, number>>;
  readonly deliverables: Map<string, number>;
  readonly printers: Map<string, number>;
}

export function fakeConferenceSources(
  state: FakeConferenceState = { leads: new Map(), deliverables: new Map(), printers: new Map() },
): ConferenceSources & { state: FakeConferenceState } {
  return {
    state,
    exhibitorLeads: async (_tx, eventId) => state.leads.get(eventId) ?? null,
    overdueDeliverables: async (_tx, eventId) => state.deliverables.get(eventId) ?? null,
    printersOffline: async (_tx, eventId) => state.printers.get(eventId) ?? null,
  };
}

export interface ConferenceScenario {
  readonly orgId: string;
  readonly eventId: string;
  readonly eventSlug: string;
  readonly eventName: string;
  readonly sessionIds: { readonly [title: string]: string };
  readonly exhibitorIds: readonly string[];
  /** The fake sources' contents for this event (leads per exhibitor, deliverables, printers). */
  readonly fake: { leads: Record<string, number>; deliverables: number; printers: number };
  /** Fixes, through the real commands where there is one. */
  readonly addPlaces: () => Promise<void>;
  readonly recordLeads: () => Promise<void>;
  readonly staffExhibitors: () => Promise<void>;
  readonly completeSpeakerTasks: () => Promise<void>;
  readonly clearLine: () => Promise<void>;
  readonly decideApplications: () => Promise<void>;
  readonly settleInvoices: () => Promise<void>;
  readonly bringStationsOnline: () => Promise<void>;
  /** Re-evaluate the event's alerts (as the worker would). */
  readonly evaluate: (now?: Date) => Promise<void>;
}

const SESSIONS = [
  // title, room, places, enrolled
  ['Opening keynote', 'Hall A', 200, 196], // 98 %
  ['Data workshop', 'Room B', 40, 38], // 95 %
  ['City panel', 'Room C', 60, 60], // full, with a line of 12
  ['Robotics lab', 'Room B', 50, 45], // 90 %, but Room B seats 40
  ['Fireside chat', 'Room C', 100, 20],
] as const;
const ROOMS = [
  ['Hall A', 220],
  ['Room B', 40],
  ['Room C', 120],
] as const;

/**
 * The M5.9a fixture, built through the real commands in one org (integration tests and e2e share
 * it): a conference happening now (Chicago) with five sessions with places — three of them at or
 * over 95 % (98 %, 95 %, full), one holding 45 places in a 40-seat room, the full one with twelve
 * people in its line — seven exhibitors (three with portal people; two with leads in the fake lead
 * source, so five without), a speaker with an overdue task, a sponsor with two overdue
 * deliverables and one offline printer (fake sources), a kiosk silent for ten minutes, an
 * application waiting three days and an invoice ten days overdue. Three people are in the
 * keynote's room. Then the alert engine evaluates it.
 */
export async function conferenceScenario(
  orgId: string,
  opts: {
    ctx?: Ctx;
    /** Alert deps; their `conference` sources serve this event's fake facts. */
    deps?: AlertDeps & { conference?: ReturnType<typeof fakeConferenceSources> };
    /** Leave the fake sources empty (the e2e web server holds its own). */
    withoutFakes?: boolean;
  } = {},
): Promise<ConferenceScenario> {
  const ctx = opts.ctx ?? createCtx({ orgId, actor: { type: 'system', name: 'fixture' } });
  const sources = opts.deps?.conference ?? fakeConferenceSources();
  const deps: AlertDeps = { notifier: opts.deps?.notifier ?? createNotifier(), conference: sources };
  const tag = uuidv7().slice(-8);
  const now = Date.now();
  const eventName = `Harbor Summit ${tag}`;
  const event = await executeCommand(
    createEventCommand,
    {
      name: eventName,
      slug: `summit-${tag}`,
      profile: 'conference',
      timezone: 'America/Chicago',
      startsAt: new Date(now - 30 * 60_000).toISOString(),
      endsAt: new Date(now + 8 * 3_600_000).toISOString(),
    },
    ctx,
    ports,
  );
  const ticketType = await executeCommand(
    createTicketTypeCommand,
    { eventId: event.id, name: 'Summit pass', priceMinor: 0, quantityTotal: 500, maxPerOrder: 25 },
    ctx,
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: event.id, transition: 'publish' }, ctx, ports);

  // One buyer's tickets (the line's people) on the order the invoice is for.
  const checkout = await executeCommand(
    startCheckoutCommand,
    {
      eventId: event.id,
      items: [{ ticketTypeId: ticketType.id, quantity: CONFERENCE_FIXTURE.waiting }],
      buyer: { email: `billing.${tag}@summit.test`, name: 'Billing Contact' },
    },
    createCtx({ orgId }),
    ports,
  );
  const ticketIds = (
    await withTenant(ctx, (tx) =>
      tx.execute<{ id: string }>(
        sql`select id from ticketing.tickets where order_id = ${checkout.order.id}::uuid order by id`,
      ),
    )
  ).map((r) => r.id);
  const roomIds = new Map<string, string>();
  for (const [name, capacity] of ROOMS)
    roomIds.set(
      name,
      (await executeCommand(createRoomCommand, { eventId: event.id, name, capacity }, ctx, ports)).id,
    );
  const sessionIds: Record<string, string> = {};
  for (const [i, [title, room, capacity]] of SESSIONS.entries()) {
    const r = await executeCommand(
      createSessionCommand,
      {
        eventId: event.id,
        title,
        roomId: roomIds.get(room) ?? null,
        capacity,
        // The keynote runs now; the others later today.
        startsAt: new Date(now - (i === 0 ? 20 : -60 * i) * 60_000),
        endsAt: new Date(now + (i === 0 ? 40 : 60 * i + 45) * 60_000),
      },
      ctx,
      ports,
    );
    sessionIds[title] = r.session.id;
  }
  // Places held (M5.2b's counter; inserted as the enrollments would leave it).
  await withTenant(ctx, async (tx) => {
    for (const [title, , , enrolled] of SESSIONS)
      await tx.execute(
        sql`update program.session_details set enrolled = ${enrolled} where session_id = ${sessionIds[title]}::uuid`,
      );
    for (let i = 0; i < CONFERENCE_FIXTURE.waiting; i++)
      await tx.execute(sql`insert into registration.session_enrollments
          (org_id, event_id, session_id, registrant_id, order_id, status, position_at)
        values (${orgId}, ${event.id}, ${sessionIds['City panel']}::uuid, ${ticketIds[i]}::uuid, ${checkout.order.id}::uuid, 'waiting',
          now() - make_interval(mins => ${CONFERENCE_FIXTURE.waiting - i}))`);
  });

  // Exhibitors: three with a portal person, two with leads.
  const exhibitorIds: string[] = [];
  for (let i = 0; i < CONFERENCE_FIXTURE.exhibitors; i++)
    exhibitorIds.push(
      (
        await executeCommand(
          createExhibitorCommand,
          {
            eventId: event.id,
            name: `Exhibitor ${String.fromCharCode(65 + i)} ${tag}`,
            boothLabel: `B${i + 1}`,
          },
          ctx,
          ports,
        )
      ).id,
    );
  const invite = async (exhibitorId: string, i: number) =>
    executeCommand(
      inviteExhibitorMemberCommand,
      { eventId: event.id, exhibitorId, email: `booth${i}.${tag}@expo.test`, role: 'exhibitor_admin' },
      ctx,
      ports,
    );
  for (const [i, id] of exhibitorIds.slice(0, CONFERENCE_FIXTURE.staffed).entries()) await invite(id, i);
  const fake: ConferenceScenario['fake'] = {
    leads: Object.fromEntries(
      exhibitorIds.slice(0, CONFERENCE_FIXTURE.withLeads).map((id, i) => [id, 4 - i]),
    ),
    deliverables: CONFERENCE_FIXTURE.deliverablesOverdue,
    printers: CONFERENCE_FIXTURE.printersOffline,
  };
  const setFakes = () => {
    if (opts.withoutFakes) return;
    sources.state.leads.set(event.id, new Map(Object.entries(fake.leads)));
    sources.state.deliverables.set(event.id, fake.deliverables);
    sources.state.printers.set(event.id, fake.printers);
  };
  setFakes();

  // Sponsors: one tier, two sponsors (their deliverables live in the fake source).
  const tier = await executeCommand(
    createSponsorTierCommand,
    { eventId: event.id, name: 'Gold', position: 1 },
    ctx,
    ports,
  );
  for (const name of [`Northwind ${tag}`, `Contoso ${tag}`])
    await executeCommand(createSponsorCommand, { eventId: event.id, tierId: tier.id, name }, ctx, ports);

  // A speaker with a task due yesterday, still open.
  const speaker = await executeCommand(
    createSpeakerCommand,
    { eventId: event.id, name: `Speaker ${tag}` },
    ctx,
    ports,
  );
  await withTenant(ctx, async (tx) => {
    const [task] = await tx.execute<{ id: string }>(sql`insert into program.portal_tasks
        (org_id, event_id, subject_kind, kind, title, due_at, created_by)
      values (${orgId}, ${event.id}, 'speaker', 'upload', 'Upload your slides', now() - interval '1 day', 'fixture')
      returning id`);
    await tx.execute(sql`insert into program.portal_task_assignees (org_id, task_id, event_id, subject_id)
      values (${orgId}, ${task?.id}::uuid, ${event.id}, ${speaker.id})`);
  });

  // One application waiting three days (M5.1c), and one invoice ten days past due (M5.1d).
  await executeCommand(seedRegistrationDefaultsCommand, { eventId: event.id, names: {} }, ctx, ports);
  await withTenant(ctx, async (tx) => {
    await tx.execute(sql`insert into registration.registrants
        (org_id, event_id, registration_type_id, admission_item_id, status, name, email, created_at)
      select ${orgId}, ${event.id}, t.id, i.id, 'pending', 'Pending Applicant', ${`applicant.${tag}@summit.test`},
        now() - interval '3 days'
      from registration.registration_types t, registration.admission_items i
      where t.event_id = ${event.id} and i.event_id = ${event.id} and i.kind = 'admission'
      order by t.created_at, i.created_at limit 1`);
  });
  await withTenant(ctx, async (tx) => {
    const [seq] = await tx.execute<{ n: number }>(sql`
      insert into orders.invoice_sequences (org_id, last_number) values (${orgId}, 1)
      on conflict (org_id) do update set last_number = orders.invoice_sequences.last_number + 1
      returning last_number as n`);
    await tx.execute(sql`
      insert into orders.invoices (org_id, order_id, event_id, number, buyer_name, buyer_email, currency,
        total_minor, fee_minor, terms, issued_on, due_on, due_at, issued_by)
      values (${orgId}, ${checkout.order.id}, ${event.id}, ${seq?.n ?? 1}, 'Billing Contact',
        ${`billing.${tag}@summit.test`}, 'USD', 120000, 0, 'net30_event7', current_date - 40,
        current_date - 10, now() - interval '10 days', 'fixture')`);
  });

  // A kiosk locked to the event, silent for ten minutes; three people in the keynote's room.
  const kiosk = await executeCommand(enrollDeviceCommand, { label: `Kiosk ${tag}` }, ctx, ports);
  const pin = `pbkdf2-sha256$100000$${'a'.repeat(22)}$${'b'.repeat(43)}`;
  await withTenant(ctx, (tx) =>
    tx.execute(sql`update checkin.devices set mode = 'kiosk', kiosk_event_id = ${event.id}::uuid,
        kiosk_pin_hash = ${pin}, kiosk_started_at = now() - interval '1 hour',
        last_seen_at = now() - interval '10 minutes'
      where id = ${kiosk.deviceId}::uuid`),
  );
  const door = await executeCommand(
    createCheckpointCommand,
    {
      eventId: event.id,
      name: `Keynote door ${tag}`,
      kind: 'session',
      sessionId: sessionIds['Opening keynote'],
    },
    ctx,
    ports,
  );
  await withTenant(ctx, async (tx) => {
    for (let i = 0; i < CONFERENCE_FIXTURE.keynoteInRoom; i++)
      await tx.execute(sql`insert into checkin.session_attendance
          (org_id, event_id, checkpoint_id, session_id, ticket_id, in_at)
        values (${orgId}, ${event.id}, ${door.id}::uuid, ${sessionIds['Opening keynote']}::uuid, ${ticketIds[i]}::uuid,
          now() - interval '5 minutes')`);
  });

  const evaluate = async (when?: Date) => {
    await catchUpAlerts(orgId, deps);
    const at = when ?? new Date();
    await withTenant(ctx, (tx) => evaluateEventAlertsTx(tx, { ...ctx, now: at }, event.id, deps, at));
  };
  await evaluate();

  return {
    orgId,
    eventId: event.id,
    eventSlug: event.slug,
    eventName,
    sessionIds,
    exhibitorIds,
    fake,
    addPlaces: async () => {
      // The organizer opens more places in the three nearly full sessions (the real command).
      for (const [title, room, capacity] of SESSIONS.slice(0, 3)) {
        const s = sessionIds[title] as string;
        const i = SESSIONS.findIndex((x) => x[0] === title);
        await executeCommand(
          updateSessionCommand,
          {
            eventId: event.id,
            sessionId: s,
            title,
            roomId: roomIds.get(room) ?? null,
            capacity: capacity * 2,
            startsAt: new Date(now - (i === 0 ? 20 : -60 * i) * 60_000),
            endsAt: new Date(now + (i === 0 ? 40 : 60 * i + 45) * 60_000),
          },
          ctx,
          ports,
        );
      }
    },
    recordLeads: async () => {
      for (const id of exhibitorIds) fake.leads[id] = fake.leads[id] ?? 1;
      setFakes();
    },
    staffExhibitors: async () => {
      for (const [i, id] of exhibitorIds.entries()) if (i >= CONFERENCE_FIXTURE.staffed) await invite(id, i);
    },
    completeSpeakerTasks: async () => {
      await withTenant(ctx, (tx) =>
        tx.execute(sql`update program.portal_task_assignees set status = 'done', completed_at = now()
          where event_id = ${event.id}::uuid`),
      );
    },
    clearLine: async () => {
      await withTenant(ctx, (tx) =>
        tx.execute(sql`update registration.session_enrollments set status = 'left', ended_at = now()
          where event_id = ${event.id}::uuid and status = 'waiting'`),
      );
    },
    decideApplications: async () => {
      await withTenant(ctx, (tx) =>
        tx.execute(sql`update registration.registrants set status = 'denied', decided_at = now(),
            decision_source = 'manual', decision_reason = 'Fixture: full.'
          where event_id = ${event.id}::uuid and status = 'pending'`),
      );
    },
    settleInvoices: async () => {
      await withTenant(ctx, (tx) =>
        tx.execute(sql`update orders.invoices set status = 'void', voided_at = now(), void_reason = 'Fixture: settled.'
          where event_id = ${event.id}::uuid and status = 'open'`),
      );
    },
    bringStationsOnline: async () => {
      fake.printers = 0;
      setFakes();
      await withTenant(ctx, (tx) =>
        tx.execute(sql`update checkin.devices set last_seen_at = now() where id = ${kiosk.deviceId}::uuid`),
      );
    },
    evaluate,
  };
}
