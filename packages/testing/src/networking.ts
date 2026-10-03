import { type TenantTx, withTenant } from '@yayatoh/db';
import {
  addMeetingSlotsCommand,
  directoryQuery,
  myMeetingsQuery,
  optInCommand,
  optOutCommand,
  reportPersonCommand,
  requestConnectionCommand,
  requestMeetingCommand,
  respondConnectionCommand,
  respondMeetingCommand,
  saveMeetingLocationCommand,
  updateNetworkSettingsCommand,
} from '@yayatoh/engagement';
import { type Command, type Ctx, createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { sql } from 'drizzle-orm';
import { ports } from './ports.ts';

/** The fixture event's first people (distinct contacts with an active place), by address. */
export async function networkPeople(orgId: string, eventId: string): Promise<string[]> {
  const rows = await withTenant(createCtx({ orgId, actor: { type: 'system', name: 'fixture' } }), (tx) =>
    tx.execute<{ email: string }>(sql`
      select email from (
        select distinct on (contact_id) contact_id, lower(email) as email, created_at
        from attendees.attendees where event_id = ${eventId} and status = 'active'
        order by contact_id, created_at
      ) x order by created_at, email limit 2`),
  );
  return rows.map((r) => r.email);
}

/**
 * M5.8a networking on the fixture event (isolation coverage of every networking table): turned
 * on, a meeting point and a booth, three slots. Its two people opt in, connect and agree a meeting;
 * then the first reports the second (which blocks them: the connection is withdrawn and the
 * meeting cancelled) and the second opts out (a profile row that must never be listed).
 */
export async function networkingFixture(orgId: string, eventId: string, ctx: (o?: Partial<Ctx>) => Ctx) {
  const [a, b] = await networkPeople(orgId, eventId);
  if (!a || !b) throw new Error('fixture: networking needs two people at the fixture event');
  const pub = createCtx({ orgId });
  const run = <I, O, R>(cmd: Command<I, O, R, TenantTx>, input: I, as: Ctx = pub) =>
    executeCommand(cmd, input, as, ports);
  await run(updateNetworkSettingsCommand, { eventId, enabled: true, meetingsEnabled: true }, ctx());
  const loc = await run(
    saveMeetingLocationCommand,
    { eventId, name: 'Meeting point 1', kind: 'meeting_point', capacity: 2 },
    ctx(),
  );
  await run(saveMeetingLocationCommand, { eventId, name: 'Booth 12', kind: 'booth', capacity: 1 }, ctx());
  const [ev] = await withTenant(ctx(), (tx) =>
    tx.execute<{ starts_at: string }>(sql`select starts_at::text from events.events where id = ${eventId}`),
  );
  const start = new Date(ev?.starts_at ?? '');
  await run(
    addMeetingSlotsCommand,
    { eventId, startsAt: start, endsAt: new Date(start.getTime() + 45 * 60_000), minutes: 15 },
    ctx(),
  );
  const optIn = (email: string, name: string) =>
    run(optInCommand, {
      eventId,
      email,
      displayName: name,
      headline: 'Fixture title',
      company: 'Fixture Co',
      bio: 'Here to meet people.',
      interests: 'Design, Data',
      consent: true as const,
    });
  await optIn(a, 'Ana Fixture');
  await optIn(b, 'Ben Fixture');
  const ben = (await executeQuery(directoryQuery, { eventId, email: a }, pub, ports)).people[0]?.id ?? '';
  const req = await run(requestConnectionCommand, { eventId, email: a, personId: ben, message: 'Hi Ben' });
  await run(respondConnectionCommand, { eventId, email: b, connectionId: req.id, accept: true });
  const slots = (await executeQuery(myMeetingsQuery, { eventId, email: a }, pub, ports)).slots;
  const meeting = await run(requestMeetingCommand, {
    eventId,
    email: a,
    personId: ben,
    slotId: slots[0]?.id ?? '',
    locationId: loc.id,
    message: 'Coffee?',
  });
  await run(respondMeetingCommand, { eventId, email: b, meetingId: meeting.id, accept: true });
  await run(reportPersonCommand, {
    eventId,
    email: a,
    personId: ben,
    reason: 'spam',
    details: 'Sent the same pitch to everyone.',
  });
  await run(optOutCommand, { eventId, email: b });
}
