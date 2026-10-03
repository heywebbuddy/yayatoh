import { addGuestCommand } from '@yayatoh/attendees';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  addMeetingSlotsCommand,
  blockedQuery,
  blockPersonCommand,
  cancelMeetingCommand,
  deleteMeetingLocationCommand,
  deleteMeetingSlotCommand,
  directoryQuery,
  myConnectionsQuery,
  myMeetingQuery,
  myMeetingsQuery,
  networkConsoleQuery,
  networkHomeQuery,
  optInCommand,
  optOutCommand,
  personQuery,
  reportPersonCommand,
  requestConnectionCommand,
  requestMeetingCommand,
  resolveReportCommand,
  respondConnectionCommand,
  respondMeetingCommand,
  restoreProfileCommand,
  saveMeetingLocationCommand,
  unblockPersonCommand,
  updateNetworkSettingsCommand,
  updateProfileCommand,
  withdrawConnectionCommand,
} from '@yayatoh/engagement';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { networkPeople, type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M5.8a networking: opt-in profiles (off by default), the directory and its search, connections,
 * meeting slots and locations with capacity, meetings (a location never double-books), block and
 * report, the organizer console; tenant isolation and the leak crawl over every attendee read.
 */
let a: OrgFixture;
let b: OrgFixture;
const pub = (o: OrgFixture = a): Ctx => createCtx({ orgId: o.org.id });

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const reason = err.details?.reason;
    return typeof reason === 'string' ? `${err.code}:${reason}` : err.code;
  }
}

interface Ev {
  readonly id: string;
  readonly startsAt: Date;
  readonly emails: string[];
}

/** A fresh published event of org A with `n` guests (and networking on unless told otherwise). */
async function freshEvent(n: number, opts: { enable?: boolean } = {}): Promise<Ev> {
  const tag = uuidv7().slice(-8);
  const startsAt = new Date(Date.UTC(2027, 10, 4, 15));
  const ev = await executeCommand(
    createEventCommand,
    {
      name: `Networking ${tag}`,
      slug: `networking-${tag}`,
      timezone: 'America/Chicago',
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 8 * 3_600_000).toISOString(),
    },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, a.ctx(), ports);
  const emails: string[] = [];
  for (let i = 0; i < n; i++) {
    const email = `net-${tag}-${i}@example.test`;
    await executeCommand(
      addGuestCommand,
      { eventId: ev.id, name: `Guest ${i} ${tag}`, email },
      a.ctx(),
      ports,
    );
    emails.push(email);
  }
  if (opts.enable !== false)
    await executeCommand(
      updateNetworkSettingsCommand,
      { eventId: ev.id, enabled: true, meetingsEnabled: true },
      a.ctx(),
      ports,
    );
  return { id: ev.id, startsAt, emails };
}

const optIn = (ev: Ev, i: number, extra: Record<string, unknown> = {}) =>
  executeCommand(
    optInCommand,
    {
      eventId: ev.id,
      email: ev.emails[i],
      displayName: `Person ${i}`,
      headline: `Title ${i}`,
      company: i % 2 ? 'Odd Co' : 'Even Co',
      interests: i % 2 ? 'Design, AI' : 'Data',
      consent: true,
      ...extra,
    },
    pub(),
    ports,
  );

const dir = (ev: Ev, i: number, q = '') =>
  executeQuery(directoryQuery, { eventId: ev.id, email: ev.emails[i], q }, pub(), ports);

async function idOf(ev: Ev, viewer: number, name: string): Promise<string> {
  const d = await dir(ev, viewer, name);
  const p = d.people.find((x) => x.displayName === name);
  if (!p) throw new Error(`${name} not in the directory of ${viewer}`);
  return p.id;
}

async function addSlots(ev: Ev, count: number, minutes = 15) {
  await executeCommand(
    addMeetingSlotsCommand,
    {
      eventId: ev.id,
      startsAt: ev.startsAt,
      endsAt: new Date(ev.startsAt.getTime() + count * minutes * 60_000),
      minutes,
    },
    a.ctx(),
    ports,
  );
  const m = await executeQuery(networkConsoleQuery, { eventId: ev.id }, a.ctx(), ports);
  return m.slots.map((s) => s.id);
}

const location = (ev: Ev, name: string, capacity: number) =>
  executeCommand(
    saveMeetingLocationCommand,
    { eventId: ev.id, name, kind: 'meeting_point', capacity },
    a.ctx(),
    ports,
  );

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});

afterAll(async () => {
  await closePools();
});

describe('opt-in (off by default)', () => {
  it('a registered person has no profile until they opt in, and cannot browse before', async () => {
    const ev = await freshEvent(2);
    const home = await executeQuery(networkHomeQuery, { eventId: ev.id, email: ev.emails[0] }, pub(), ports);
    expect(home.profile).toBeNull();
    expect(home.attendeeName).toMatch(/^Guest 0 /);
    expect(home.timeZone).toBe('America/Chicago');
    expect(await codeOf(dir(ev, 0))).toBe('invalid_state:not_opted_in');
    await optIn(ev, 1);
    // Person 1 opted in, but sees nobody: person 0 never opted in.
    expect((await dir(ev, 1)).people).toEqual([]);
    expect(await codeOf(dir(ev, 0))).toBe('invalid_state:not_opted_in');
  });

  it('opting in needs the consent tick and a name; an address with no place is refused', async () => {
    const ev = await freshEvent(1);
    expect(await codeOf(optIn(ev, 0, { consent: false }))).toBe('validation_failed');
    expect(await codeOf(optIn(ev, 0, { displayName: ' ' }))).toBe('validation_failed');
    expect(
      await codeOf(
        executeQuery(networkHomeQuery, { eventId: ev.id, email: 'nobody@example.test' }, pub(), ports),
      ),
    ).toBe('forbidden:not_attendee');
    await optIn(ev, 0, { interests: 'AI, ai ,\nData' });
    const home = await executeQuery(networkHomeQuery, { eventId: ev.id, email: ev.emails[0] }, pub(), ports);
    expect(home.profile).toMatchObject({ optedIn: true, hidden: false, interests: ['AI', 'Data'] });
  });

  it('networking is not found until the organizer turns it on, and on unpublished events', async () => {
    const ev = await freshEvent(1, { enable: false });
    expect(await codeOf(optIn(ev, 0))).toBe('not_found');
    await executeCommand(
      updateNetworkSettingsCommand,
      { eventId: ev.id, enabled: true, meetingsEnabled: false },
      a.ctx(),
      ports,
    );
    expect(await codeOf(optIn(ev, 0))).toBe('ok');
    // Off again: everything is not found, and the profile is kept for when it comes back.
    await executeCommand(
      updateNetworkSettingsCommand,
      { eventId: ev.id, enabled: false, meetingsEnabled: true },
      a.ctx(),
      ports,
    );
    expect(await codeOf(dir(ev, 0))).toBe('not_found');
  });

  it('a cancelled place takes the person out of the directory and of networking', async () => {
    const ev = await freshEvent(2);
    await optIn(ev, 0);
    await optIn(ev, 1);
    expect((await dir(ev, 0)).people.map((p) => p.displayName)).toEqual(['Person 1']);
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(
        sql`update attendees.attendees set status = 'cancelled' where event_id = ${ev.id} and lower(email) = ${ev.emails[1]}`,
      ),
    );
    expect((await dir(ev, 0)).people).toEqual([]);
    expect(await codeOf(dir(ev, 1))).toBe('forbidden:not_attendee');
  });
});

describe('directory and search', () => {
  let ev: Ev;
  beforeAll(async () => {
    ev = await freshEvent(5);
    for (const i of [0, 1, 2, 3]) await optIn(ev, i);
    await executeCommand(
      updateProfileCommand,
      {
        eventId: ev.id,
        email: ev.emails[3],
        displayName: '100% Real_Name',
        company: 'Odd Co',
        interests: 'Robots',
      },
      pub(),
      ports,
    );
  });

  it('lists every other opted-in person, by name, never yourself', async () => {
    const d = await dir(ev, 0);
    expect(d.people.map((p) => p.displayName)).toEqual(['100% Real_Name', 'Person 1', 'Person 2']);
    expect(d.total).toBe(3);
    expect(d.people.every((p) => p.connection === 'none')).toBe(true);
  });

  it('searches names, titles, companies and interests (case-insensitive, wildcards are literal)', async () => {
    const names = async (q: string) => (await dir(ev, 0, q)).people.map((p) => p.displayName);
    expect(await names('person 2')).toEqual(['Person 2']);
    expect(await names('odd co')).toEqual(['100% Real_Name', 'Person 1']);
    expect(await names('design')).toEqual(['Person 1']);
    expect(await names('robots')).toEqual(['100% Real_Name']);
    expect(await names('title 1')).toEqual(['Person 1']);
    expect(await names('%')).toEqual(['100% Real_Name']);
    expect(await names('_')).toEqual(['100% Real_Name']);
    expect(await names('nobody here')).toEqual([]);
  });

  it('a person is found by id only when listed; yourself and unknown ids are not found', async () => {
    const own = await idOf(ev, 1, 'Person 0');
    expect(
      await codeOf(
        executeQuery(personQuery, { eventId: ev.id, email: ev.emails[1], personId: own }, pub(), ports),
      ),
    ).toBe('ok');
    // Your own id, and an unknown one, are not found.
    expect(
      await codeOf(
        executeQuery(personQuery, { eventId: ev.id, email: ev.emails[0], personId: own }, pub(), ports),
      ),
    ).toBe('not_found');
    expect(
      await codeOf(
        executeQuery(personQuery, { eventId: ev.id, email: ev.emails[0], personId: uuidv7() }, pub(), ports),
      ),
    ).toBe('not_found');
  });

  it('opting out leaves the directory at once; opting back in returns', async () => {
    await executeCommand(optOutCommand, { eventId: ev.id, email: ev.emails[2] }, pub(), ports);
    expect((await dir(ev, 0)).people.map((p) => p.displayName)).not.toContain('Person 2');
    expect(await codeOf(dir(ev, 2))).toBe('invalid_state:not_opted_in');
    await optIn(ev, 2);
    expect((await dir(ev, 0)).people.map((p) => p.displayName)).toContain('Person 2');
  });
});

describe('leak crawl: someone not opted in never appears', () => {
  it('no attendee read carries the profile of a person who opted out, was hidden, or never opted in', async () => {
    const ev = await freshEvent(6);
    for (const i of [0, 1, 2, 3, 4]) await optIn(ev, i);
    // 0 and 1 connect and meet; 3 opts out; 4 is hidden by the organizer; 5 never opts in.
    const [slot] = await addSlots(ev, 2);
    const loc = await location(ev, 'Leak point', 3);
    const one = await idOf(ev, 0, 'Person 1');
    const c = await executeCommand(
      requestConnectionCommand,
      { eventId: ev.id, email: ev.emails[0], personId: one },
      pub(),
      ports,
    );
    await executeCommand(
      respondConnectionCommand,
      { eventId: ev.id, email: ev.emails[1], connectionId: c.id, accept: true },
      pub(),
      ports,
    );
    const three = await idOf(ev, 0, 'Person 3');
    const four = await idOf(ev, 0, 'Person 4');
    // Pending requests and a meeting from the people about to leave.
    await executeCommand(
      requestConnectionCommand,
      { eventId: ev.id, email: ev.emails[3], personId: one, message: 'from 3' },
      pub(),
      ports,
    );
    await executeCommand(
      requestMeetingCommand,
      {
        eventId: ev.id,
        email: ev.emails[4],
        personId: one,
        slotId: slot ?? '',
        locationId: loc.id,
        message: 'from 4',
      },
      pub(),
      ports,
    );
    await executeCommand(
      reportPersonCommand,
      { eventId: ev.id, email: ev.emails[2], personId: four, reason: 'spam' },
      pub(),
      ports,
    );
    const report = (await executeQuery(networkConsoleQuery, { eventId: ev.id }, a.ctx(), ports)).reports[0];
    await executeCommand(
      resolveReportCommand,
      { eventId: ev.id, reportId: report?.id ?? '', action: 'hide' },
      a.ctx(),
      ports,
    );
    await executeCommand(optOutCommand, { eventId: ev.id, email: ev.emails[3] }, pub(), ports);
    // Canaries in everything the leavers ever wrote.
    const CANARY = '__CANARY_NETWORK__';
    await withTenant(systemCtx(a.org.id), async (tx) => {
      await tx.execute(sql`update engagement.network_profiles set display_name = ${`${CANARY} name`},
        headline = ${`${CANARY} title`}, company = ${`${CANARY} co`}, bio = ${`${CANARY} bio`},
        interests = array[${`${CANARY} interest`}] where id in (${three}, ${four})`);
    });
    const seen: string[] = [];
    const look = async (p: Promise<unknown>) => {
      try {
        seen.push(JSON.stringify(await p));
      } catch (err) {
        if (!isDomainError(err)) throw err;
        seen.push(err.code);
      }
    };
    for (const i of [0, 1, 2]) {
      const at = { eventId: ev.id, email: ev.emails[i] };
      await look(executeQuery(networkHomeQuery, at, pub(), ports));
      for (const q of ['', 'Person', CANARY, 'canary', 'name', 'co', 'interest', '_'])
        for (const page of [1, 2]) await look(executeQuery(directoryQuery, { ...at, q, page }, pub(), ports));
      for (const personId of [three, four, one, uuidv7()])
        await look(executeQuery(personQuery, { ...at, personId }, pub(), ports));
      await look(executeQuery(myConnectionsQuery, at, pub(), ports));
      await look(executeQuery(myMeetingsQuery, at, pub(), ports));
      await look(executeQuery(blockedQuery, at, pub(), ports));
      expect(await codeOf(executeQuery(personQuery, { ...at, personId: three }, pub(), ports))).toBe(
        'not_found',
      );
      expect(await codeOf(executeQuery(personQuery, { ...at, personId: four }, pub(), ports))).toBe(
        'not_found',
      );
    }
    const all = seen.join('\n');
    expect(all).not.toContain(CANARY);
    expect(all).not.toContain('Guest 5');
    expect(all).not.toContain(ev.emails[5]);
    expect(all).not.toContain('from 3');
    expect(all).not.toContain('from 4');
    // The crawl saw real people (a crawl that sees nothing proves nothing).
    expect(all).toContain('Person 1');
    // No attendee read ever carries an address, a contact or an attendee id.
    for (const e of ev.emails) expect(all).not.toContain(e);
    expect(all).not.toMatch(/contactId|attendeeId|"email"/);
  });
});

describe('connections', () => {
  it('request, answer, decline rules, withdraw and remove', async () => {
    const ev = await freshEvent(3);
    for (const i of [0, 1, 2]) await optIn(ev, i);
    const one = await idOf(ev, 0, 'Person 1');
    const zero = await idOf(ev, 1, 'Person 0');
    const two = await idOf(ev, 0, 'Person 2');
    const ask = (i: number, personId: string, message?: string) =>
      executeCommand(
        requestConnectionCommand,
        { eventId: ev.id, email: ev.emails[i], personId, message },
        pub(),
        ports,
      );
    const r = await ask(0, one, 'Hello!');
    expect(r.status).toBe('pending');
    expect(await codeOf(ask(0, one))).toBe('conflict:already_requested');
    expect((await dir(ev, 0, 'Person 1')).people[0]?.connection).toBe('pending_out');
    expect((await dir(ev, 1, 'Person 0')).people[0]?.connection).toBe('pending_in');
    const inbox = await executeQuery(
      myConnectionsQuery,
      { eventId: ev.id, email: ev.emails[1] },
      pub(),
      ports,
    );
    expect(inbox.incoming).toHaveLength(1);
    expect(inbox.incoming[0]).toMatchObject({ message: 'Hello!', person: { displayName: 'Person 0' } });
    // Only the addressee answers.
    expect(
      await codeOf(
        executeCommand(
          respondConnectionCommand,
          { eventId: ev.id, email: ev.emails[0], connectionId: r.id, accept: true },
          pub(),
          ports,
        ),
      ),
    ).toBe('invalid_state:not_pending');
    // A stranger to the request can't even see it.
    expect(
      await codeOf(
        executeCommand(
          respondConnectionCommand,
          { eventId: ev.id, email: ev.emails[2], connectionId: r.id, accept: true },
          pub(),
          ports,
        ),
      ),
    ).toBe('not_found');
    await executeCommand(
      respondConnectionCommand,
      { eventId: ev.id, email: ev.emails[1], connectionId: r.id, accept: false },
      pub(),
      ports,
    );
    // Declined: the one declined may not ask again; the other side may.
    expect(await codeOf(ask(0, one))).toBe('invalid_state:declined');
    const back = await ask(1, zero);
    expect(back.status).toBe('pending');
    // Asking back while a request waits accepts it.
    const r2 = await ask(0, two);
    const both = await ask(2, await idOf(ev, 2, 'Person 0'));
    expect(both).toEqual({ id: r2.id, status: 'accepted' });
    const mine = await executeQuery(
      myConnectionsQuery,
      { eventId: ev.id, email: ev.emails[0] },
      pub(),
      ports,
    );
    expect(mine.connected.map((c) => c.person.displayName)).toEqual(['Person 2']);
    expect(mine.incoming.map((c) => c.person.displayName)).toEqual(['Person 1']);
    expect(await codeOf(ask(0, two))).toBe('conflict:connected');
    // Remove a connection (either side), withdraw a request you sent.
    await executeCommand(
      withdrawConnectionCommand,
      { eventId: ev.id, email: ev.emails[2], connectionId: r2.id },
      pub(),
      ports,
    );
    await executeCommand(
      withdrawConnectionCommand,
      { eventId: ev.id, email: ev.emails[1], connectionId: back.id },
      pub(),
      ports,
    );
    const after = await executeQuery(
      myConnectionsQuery,
      { eventId: ev.id, email: ev.emails[0] },
      pub(),
      ports,
    );
    expect(after).toEqual({ incoming: [], outgoing: [], connected: [] });
    // Accepting emits engagement.connection_accepted@1 with ids only.
    const events = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ payload: Record<string, unknown> }>(
        sql`select payload from platform.domain_events where type = 'engagement.connection_accepted' and payload->>'connectionId' = ${r2.id}`,
      ),
    );
    expect(events[0]?.payload).toEqual({ eventId: ev.id, connectionId: r2.id });
  });
});

describe('meetings: slots, locations, capacity', () => {
  it('the organizer adds slots and locations with validation', async () => {
    const ev = await freshEvent(0);
    const add = (from: Date, to: Date, minutes: number) =>
      executeCommand(
        addMeetingSlotsCommand,
        { eventId: ev.id, startsAt: from, endsAt: to, minutes },
        a.ctx(),
        ports,
      );
    const t = (m: number) => new Date(ev.startsAt.getTime() + m * 60_000);
    expect(await add(t(0), t(60), 20)).toEqual({ added: 3 });
    expect(await codeOf(add(t(30), t(90), 15))).toBe('invalid_state:overlap');
    expect(await codeOf(add(t(60), t(70), 15))).toBe('validation_failed:too_short');
    expect(await codeOf(add(t(-60), t(0), 15))).toBe('validation_failed:outside_event');
    expect(await codeOf(add(t(90), t(80), 15))).toBe('validation_failed:before_start');
    expect(await add(t(60), t(75), 15)).toEqual({ added: 1 });
    const loc = await location(ev, 'Lounge', 2);
    expect(await codeOf(location(ev, 'lounge', 3))).toBe('conflict');
    expect(
      await codeOf(
        executeCommand(
          saveMeetingLocationCommand,
          { eventId: ev.id, name: 'Big', kind: 'booth', capacity: 51 },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('validation_failed');
    const c = await executeQuery(networkConsoleQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(c.slots).toHaveLength(4);
    expect(c.locations).toEqual([
      { id: loc.id, name: 'Lounge', kind: 'meeting_point', capacity: 2, booked: 0, peak: 0 },
    ]);
    // Viewers read the console, never write; the other org sees nothing.
    const viewer = userCtx(a.viewerId, a.org.id);
    expect(await codeOf(executeQuery(networkConsoleQuery, { eventId: ev.id }, viewer, ports))).toBe('ok');
    expect(
      await codeOf(
        executeCommand(
          saveMeetingLocationCommand,
          { eventId: ev.id, name: 'X', kind: 'booth', capacity: 1 },
          viewer,
          ports,
        ),
      ),
    ).toBe('forbidden');
    expect(await codeOf(executeQuery(networkConsoleQuery, { eventId: ev.id }, b.ctx(), ports))).toBe(
      'not_found',
    );
    expect(
      await codeOf(
        executeCommand(deleteMeetingLocationCommand, { eventId: ev.id, locationId: loc.id }, b.ctx(), ports),
      ),
    ).toBe('not_found');
  });

  it('a request is checked at once; acceptance takes a table; full, busy and past are refused', async () => {
    const ev = await freshEvent(5);
    for (const i of [0, 1, 2, 3, 4]) await optIn(ev, i);
    const [s1, s2] = await addSlots(ev, 2);
    const booth = await location(ev, 'Booth 7', 1);
    const meet = (i: number, j: string, slotId = s1 ?? '', locationId = booth.id) =>
      executeCommand(
        requestMeetingCommand,
        { eventId: ev.id, email: ev.emails[i], personId: j, slotId, locationId },
        pub(),
        ports,
      );
    const answer = (i: number, meetingId: string, accept = true) =>
      executeCommand(
        respondMeetingCommand,
        { eventId: ev.id, email: ev.emails[i], meetingId, accept },
        pub(),
        ports,
      );
    const p1 = await idOf(ev, 0, 'Person 1');
    const p3 = await idOf(ev, 2, 'Person 3');
    const m1 = await meet(0, p1);
    expect(await codeOf(meet(0, p1))).toBe('conflict:already_requested');
    const m2 = await meet(2, p3);
    expect(await codeOf(meet(0, p1, uuidv7()))).toBe('validation_failed:unknown');
    expect(await codeOf(meet(0, p1, s1, uuidv7()))).toBe('validation_failed:unknown');
    // Only the invitee answers.
    expect(await codeOf(answer(0, m1.id))).toBe('invalid_state:not_pending');
    expect(await answer(1, m1.id)).toEqual({ ok: true, tableNo: 1 });
    // The booth holds one meeting at a time: the second acceptance, and new requests, are refused.
    expect(await codeOf(answer(3, m2.id))).toBe('invalid_state:location_full');
    expect(await codeOf(meet(2, p3))).toBe('invalid_state:location_full');
    // Person 0 already meets someone in slot 1.
    const lounge = await location(ev, 'Lounge', 5);
    expect(await codeOf(meet(0, await idOf(ev, 0, 'Person 4'), s1, lounge.id))).toBe('invalid_state:busy');
    expect(await codeOf(meet(4, await idOf(ev, 4, 'Person 1'), s1, lounge.id))).toBe(
      'invalid_state:person_busy',
    );
    // The capacity can't drop below what is booked; a used location or slot can't be deleted.
    expect(
      await codeOf(
        executeCommand(
          saveMeetingLocationCommand,
          { eventId: ev.id, locationId: lounge.id, name: 'Lounge', kind: 'meeting_point', capacity: 1 },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('ok');
    expect(
      await codeOf(
        executeCommand(
          deleteMeetingLocationCommand,
          { eventId: ev.id, locationId: booth.id },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('invalid_state:in_use');
    expect(
      await codeOf(
        executeCommand(deleteMeetingSlotCommand, { eventId: ev.id, slotId: s1 ?? '' }, a.ctx(), ports),
      ),
    ).toBe('invalid_state:in_use');
    expect(
      await codeOf(
        executeCommand(deleteMeetingSlotCommand, { eventId: ev.id, slotId: s2 ?? '' }, a.ctx(), ports),
      ),
    ).toBe('ok');
    // Both see it as upcoming, with the table; an ICS-ready read for either party only.
    const mine = await executeQuery(myMeetingsQuery, { eventId: ev.id, email: ev.emails[1] }, pub(), ports);
    expect(mine.upcoming).toHaveLength(1);
    expect(mine.upcoming[0]).toMatchObject({
      direction: 'incoming',
      tableNo: 1,
      location: { name: 'Booth 7' },
    });
    expect(
      await codeOf(
        executeQuery(myMeetingQuery, { eventId: ev.id, email: ev.emails[0], meetingId: m1.id }, pub(), ports),
      ),
    ).toBe('ok');
    expect(
      await codeOf(
        executeQuery(myMeetingQuery, { eventId: ev.id, email: ev.emails[2], meetingId: m1.id }, pub(), ports),
      ),
    ).toBe('not_found');
    // Cancelling frees the table: the waiting acceptance now goes through.
    await executeCommand(
      cancelMeetingCommand,
      { eventId: ev.id, email: ev.emails[0], meetingId: m1.id },
      pub(),
      ports,
    );
    expect(await answer(3, m2.id)).toEqual({ ok: true, tableNo: 1 });
    const c = await executeQuery(networkConsoleQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(c.locations.find((l) => l.id === booth.id)).toMatchObject({ booked: 1, peak: 1 });
    expect(c.stats.meetings).toBe(1);
    // Slots in the past can't be booked.
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(
        sql`update engagement.meeting_slots set starts_at = now() - interval '1 hour', ends_at = now() - interval '45 minutes' where id = ${s1}`,
      ),
    );
    expect(await codeOf(meet(4, await idOf(ev, 4, 'Person 0'), s1, lounge.id))).toBe(
      'validation_failed:past',
    );
  });

  it('switching meetings off refuses requests and hides the slots', async () => {
    const ev = await freshEvent(2);
    for (const i of [0, 1]) await optIn(ev, i);
    const [s1] = await addSlots(ev, 1);
    const loc = await location(ev, 'Spot', 1);
    await executeCommand(
      updateNetworkSettingsCommand,
      { eventId: ev.id, enabled: true, meetingsEnabled: false },
      a.ctx(),
      ports,
    );
    const one = await idOf(ev, 0, 'Person 1');
    expect(
      await codeOf(
        executeCommand(
          requestMeetingCommand,
          { eventId: ev.id, email: ev.emails[0], personId: one, slotId: s1 ?? '', locationId: loc.id },
          pub(),
          ports,
        ),
      ),
    ).toBe('invalid_state:meetings_off');
    const mine = await executeQuery(myMeetingsQuery, { eventId: ev.id, email: ev.emails[0] }, pub(), ports);
    expect(mine.slots).toEqual([]);
    expect(mine.locations).toEqual([]);
  });

  it('a location never double-books: 12 concurrent acceptances for a capacity of 3 seat exactly 3', async () => {
    const ev = await freshEvent(24);
    for (let i = 0; i < 24; i++) await optIn(ev, i);
    const [slot] = await addSlots(ev, 1);
    const loc = await location(ev, 'Hot spot', 3);
    const ids = new Map<number, string>();
    const d = await dir(ev, 0);
    for (const p of d.people) ids.set(Number(p.displayName.split(' ')[1]), p.id);
    const d0 = await dir(ev, 1, 'Person 0');
    ids.set(0, d0.people[0]?.id ?? '');
    // Pairs (0,1), (2,3) … (22,23): the even one asks, the odd one accepts, all at once.
    const requests: { id: string; invitee: number }[] = [];
    for (let i = 0; i < 24; i += 2) {
      const r = await executeCommand(
        requestMeetingCommand,
        {
          eventId: ev.id,
          email: ev.emails[i],
          personId: ids.get(i + 1) ?? '',
          slotId: slot ?? '',
          locationId: loc.id,
        },
        pub(),
        ports,
      );
      requests.push({ id: r.id, invitee: i + 1 });
    }
    const results = await Promise.all(
      requests.map((r) =>
        codeOf(
          executeCommand(
            respondMeetingCommand,
            { eventId: ev.id, email: ev.emails[r.invitee], meetingId: r.id, accept: true },
            pub(),
            ports,
          ),
        ),
      ),
    );
    expect(results.filter((r) => r === 'ok')).toHaveLength(3);
    expect(results.filter((r) => r === 'invalid_state:location_full')).toHaveLength(9);
    const tables = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ table_no: number }>(
        sql`select table_no from engagement.meetings where location_id = ${loc.id} and status = 'accepted' order by table_no`,
      ),
    );
    expect(tables.map((t) => t.table_no)).toEqual([1, 2, 3]);
    // The database itself refuses a second meeting at a held table.
    await expect(
      withTenant(systemCtx(a.org.id), (tx) =>
        tx.execute(sql`update engagement.meetings set status = 'accepted', table_no = 1
          where id = (select id from engagement.meetings where location_id = ${loc.id} and status = 'pending' limit 1)`),
      ),
    ).rejects.toThrow();
    // Accepting emits engagement.meeting_accepted@1 with ids only.
    const events = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from platform.domain_events where type = 'engagement.meeting_accepted' and payload->>'locationId' = ${loc.id}`,
      ),
    );
    expect(events[0]?.n).toBe(3);
  });

  it('one person is never in two meetings at once, even when both accept concurrently', async () => {
    const ev = await freshEvent(5);
    for (const i of [0, 1, 2, 3, 4]) await optIn(ev, i);
    const [slot] = await addSlots(ev, 1);
    const l1 = await location(ev, 'Left', 5);
    const l2 = await location(ev, 'Right', 5);
    const zero = await idOf(ev, 1, 'Person 0');
    // Four people ask person 0 for the same slot (two locations); person 0 accepts them all at once.
    const asks = await Promise.all(
      [1, 2, 3, 4].map((i) =>
        executeCommand(
          requestMeetingCommand,
          {
            eventId: ev.id,
            email: ev.emails[i],
            personId: zero,
            slotId: slot ?? '',
            locationId: i % 2 ? l1.id : l2.id,
          },
          pub(),
          ports,
        ),
      ),
    );
    const results = await Promise.all(
      asks.map((r) =>
        codeOf(
          executeCommand(
            respondMeetingCommand,
            { eventId: ev.id, email: ev.emails[0], meetingId: r.id, accept: true },
            pub(),
            ports,
          ),
        ),
      ),
    );
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === 'invalid_state:busy')).toHaveLength(3);
  });
});

describe('block and report', () => {
  it('blocking hides both people from each other and cuts every tie; unblocking restores the directory', async () => {
    const ev = await freshEvent(3);
    for (const i of [0, 1, 2]) await optIn(ev, i);
    const [slot] = await addSlots(ev, 1);
    const loc = await location(ev, 'Corner', 2);
    const one = await idOf(ev, 0, 'Person 1');
    const zero = await idOf(ev, 1, 'Person 0');
    const c = await executeCommand(
      requestConnectionCommand,
      { eventId: ev.id, email: ev.emails[0], personId: one },
      pub(),
      ports,
    );
    await executeCommand(
      respondConnectionCommand,
      { eventId: ev.id, email: ev.emails[1], connectionId: c.id, accept: true },
      pub(),
      ports,
    );
    const m = await executeCommand(
      requestMeetingCommand,
      { eventId: ev.id, email: ev.emails[0], personId: one, slotId: slot ?? '', locationId: loc.id },
      pub(),
      ports,
    );
    await executeCommand(
      respondMeetingCommand,
      { eventId: ev.id, email: ev.emails[1], meetingId: m.id, accept: true },
      pub(),
      ports,
    );
    await executeCommand(
      blockPersonCommand,
      { eventId: ev.id, email: ev.emails[1], personId: zero },
      pub(),
      ports,
    );
    expect((await dir(ev, 0)).people.map((p) => p.displayName)).toEqual(['Person 2']);
    expect((await dir(ev, 1)).people.map((p) => p.displayName)).toEqual(['Person 2']);
    expect(
      await codeOf(
        executeQuery(personQuery, { eventId: ev.id, email: ev.emails[0], personId: one }, pub(), ports),
      ),
    ).toBe('not_found');
    expect(
      await codeOf(
        executeCommand(
          requestConnectionCommand,
          { eventId: ev.id, email: ev.emails[0], personId: one },
          pub(),
          ports,
        ),
      ),
    ).toBe('not_found');
    expect(
      await codeOf(
        executeCommand(
          requestMeetingCommand,
          { eventId: ev.id, email: ev.emails[0], personId: one, slotId: slot ?? '', locationId: loc.id },
          pub(),
          ports,
        ),
      ),
    ).toBe('not_found');
    const conns = await executeQuery(
      myConnectionsQuery,
      { eventId: ev.id, email: ev.emails[0] },
      pub(),
      ports,
    );
    expect(conns.connected).toEqual([]);
    const meets = await executeQuery(myMeetingsQuery, { eventId: ev.id, email: ev.emails[0] }, pub(), ports);
    expect(meets.upcoming).toEqual([]);
    const blocked = await executeQuery(blockedQuery, { eventId: ev.id, email: ev.emails[1] }, pub(), ports);
    expect(blocked).toEqual([{ id: zero, displayName: 'Person 0' }]);
    expect(await executeQuery(blockedQuery, { eventId: ev.id, email: ev.emails[0] }, pub(), ports)).toEqual(
      [],
    );
    await executeCommand(
      unblockPersonCommand,
      { eventId: ev.id, email: ev.emails[1], personId: zero },
      pub(),
      ports,
    );
    expect((await dir(ev, 0)).people.map((p) => p.displayName)).toEqual(['Person 1', 'Person 2']);
    // The connection doesn't come back by itself.
    expect((await dir(ev, 0, 'Person 1')).people[0]?.connection).toBe('none');
  });

  it('reporting blocks; the organizer hides or dismisses; hidden people leave networking; restore', async () => {
    const ev = await freshEvent(4);
    for (const i of [0, 1, 2, 3]) await optIn(ev, i);
    const three = await idOf(ev, 0, 'Person 3');
    const [slot] = await addSlots(ev, 1);
    const loc = await location(ev, 'Desk', 2);
    // Person 3 has a request waiting on person 2 and an accepted meeting with person 1.
    await executeCommand(
      requestConnectionCommand,
      { eventId: ev.id, email: ev.emails[3], personId: await idOf(ev, 3, 'Person 2') },
      pub(),
      ports,
    );
    const m = await executeCommand(
      requestMeetingCommand,
      {
        eventId: ev.id,
        email: ev.emails[3],
        personId: await idOf(ev, 3, 'Person 1'),
        slotId: slot ?? '',
        locationId: loc.id,
      },
      pub(),
      ports,
    );
    await executeCommand(
      respondMeetingCommand,
      { eventId: ev.id, email: ev.emails[1], meetingId: m.id, accept: true },
      pub(),
      ports,
    );
    const report = (i: number, reason: string, details?: string) =>
      executeCommand(
        reportPersonCommand,
        { eventId: ev.id, email: ev.emails[i], personId: three, reason, details },
        pub(),
        ports,
      );
    expect(await codeOf(report(0, 'other'))).toBe('validation_failed:required');
    expect(await codeOf(report(0, 'rude'))).toBe('validation_failed');
    await report(0, 'harassment', 'Kept messaging after I said no.');
    // Reported means blocked for the reporter; a second report from them changes nothing.
    expect((await dir(ev, 0)).people.map((p) => p.displayName)).not.toContain('Person 3');
    await report(0, 'spam');
    await report(1, 'spam');
    let c = await executeQuery(networkConsoleQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(c.reports.filter((r) => r.status === 'open')).toHaveLength(2);
    expect(c.reports.find((r) => r.reason === 'harassment')).toMatchObject({
      details: 'Kept messaging after I said no.',
      reporter: { displayName: 'Person 0' },
      reported: { displayName: 'Person 3', hidden: false },
    });
    const viewer = userCtx(a.viewerId, a.org.id);
    const first = c.reports[0]?.id ?? '';
    expect(
      await codeOf(
        executeCommand(
          resolveReportCommand,
          { eventId: ev.id, reportId: first, action: 'hide' },
          viewer,
          ports,
        ),
      ),
    ).toBe('forbidden');
    expect(
      await codeOf(
        executeCommand(
          resolveReportCommand,
          { eventId: ev.id, reportId: first, action: 'hide' },
          b.ctx(),
          ports,
        ),
      ),
    ).toBe('not_found');
    await executeCommand(
      resolveReportCommand,
      { eventId: ev.id, reportId: first, action: 'hide' },
      a.ctx(),
      ports,
    );
    c = await executeQuery(networkConsoleQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(c.reports.every((r) => r.status === 'hidden')).toBe(true);
    expect(c.hidden).toEqual([{ id: three, displayName: 'Person 3' }]);
    expect(c.stats.meetings).toBe(0);
    expect(
      await codeOf(
        executeCommand(
          resolveReportCommand,
          { eventId: ev.id, reportId: first, action: 'dismiss' },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('invalid_state:resolved');
    // Hidden: gone for everyone (even people who didn't report), can't browse or opt back in.
    expect((await dir(ev, 2)).people.map((p) => p.displayName)).not.toContain('Person 3');
    expect(
      (await executeQuery(myConnectionsQuery, { eventId: ev.id, email: ev.emails[2] }, pub(), ports))
        .incoming,
    ).toEqual([]);
    expect(await codeOf(dir(ev, 3))).toBe('invalid_state:hidden');
    expect(await codeOf(optIn(ev, 3))).toBe('invalid_state:hidden');
    const home = await executeQuery(networkHomeQuery, { eventId: ev.id, email: ev.emails[3] }, pub(), ports);
    expect(home.profile?.hidden).toBe(true);
    await executeCommand(restoreProfileCommand, { eventId: ev.id, profileId: three }, a.ctx(), ports);
    expect((await dir(ev, 2)).people.map((p) => p.displayName)).toContain('Person 3');
    // Still blocked for the two who reported.
    expect((await dir(ev, 0)).people.map((p) => p.displayName)).not.toContain('Person 3');
  });

  it('dismiss closes one report and leaves the person listed', async () => {
    const ev = await freshEvent(2);
    for (const i of [0, 1]) await optIn(ev, i);
    await executeCommand(
      reportPersonCommand,
      { eventId: ev.id, email: ev.emails[0], personId: await idOf(ev, 0, 'Person 1'), reason: 'fake' },
      pub(),
      ports,
    );
    const c = await executeQuery(networkConsoleQuery, { eventId: ev.id }, a.ctx(), ports);
    await executeCommand(
      resolveReportCommand,
      { eventId: ev.id, reportId: c.reports[0]?.id ?? '', action: 'dismiss' },
      a.ctx(),
      ports,
    );
    const after = await executeQuery(networkConsoleQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(after.reports[0]?.status).toBe('dismissed');
    expect(after.hidden).toEqual([]);
    expect(after.stats.optedIn).toBe(2);
  });
});

describe('tenant isolation', () => {
  it("another org's context sees none of org A's networking, and the fixture has rows for both orgs", async () => {
    const [email] = await networkPeople(a.org.id, a.event.id);
    expect(
      await codeOf(
        executeQuery(networkHomeQuery, { eventId: a.event.id, email: email ?? '' }, pub(b), ports),
      ),
    ).toBe('not_found');
    expect(await codeOf(executeQuery(networkConsoleQuery, { eventId: a.event.id }, b.ctx(), ports))).toBe(
      'not_found',
    );
    for (const o of [a, b]) {
      const counts = await withTenant(systemCtx(o.org.id), (tx) =>
        tx.execute<Record<string, number>>(sql`select
          (select count(*)::int from engagement.network_settings) as settings,
          (select count(*)::int from engagement.network_profiles where event_id = ${o.event.id}) as profiles,
          (select count(*)::int from engagement.network_connections where event_id = ${o.event.id}) as connections,
          (select count(*)::int from engagement.network_blocks where event_id = ${o.event.id}) as blocks,
          (select count(*)::int from engagement.network_reports where event_id = ${o.event.id}) as reports,
          (select count(*)::int from engagement.meeting_locations where event_id = ${o.event.id}) as locations,
          (select count(*)::int from engagement.meeting_slots where event_id = ${o.event.id}) as slots,
          (select count(*)::int from engagement.meetings where event_id = ${o.event.id} and status = 'accepted') as meetings`),
      );
      expect(counts[0]).toMatchObject({
        profiles: 2,
        connections: 1,
        blocks: 1,
        reports: 1,
        locations: 2,
        slots: 3,
        meetings: 0,
      });
    }
    // The fixture's second person opted out (and was reported): never listed for anyone.
    const people = await networkPeople(a.org.id, a.event.id);
    const d = await executeQuery(
      directoryQuery,
      { eventId: a.event.id, email: people[0] ?? '' },
      pub(),
      ports,
    );
    expect(d.people).toEqual([]);
  });
});
