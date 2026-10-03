import { addGuestCommand } from '@yayatoh/attendees';
import { networkChatSignals } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  addMeetingSlotsCommand,
  attendeeChatChannel,
  BOOTH_CHAT_CHANNEL,
  blockBoothCommand,
  blockPersonCommand,
  blockVisitorCommand,
  boothChatThreadQuery,
  boothInboxQuery,
  boothThreadQuery,
  CHAT_CHANNEL,
  CHAT_PER_MINUTE,
  chatAttachAllowed,
  chatConsoleQuery,
  chatInboxQuery,
  chatRetentionCommand,
  chatThreadQuery,
  directoryQuery,
  exhibitorChatChannel,
  markChatReadCommand,
  moderateChatReportCommand,
  NEW_CHATS_PER_HOUR,
  networkConsoleQuery,
  optInCommand,
  optOutCommand,
  removeChatMessageCommand,
  replyBoothChatCommand,
  reportChatCommand,
  reportVisitorCommand,
  requestConnectionCommand,
  requestMeetingCommand,
  respondConnectionCommand,
  respondMeetingCommand,
  restoreBoothChatCommand,
  saveMeetingLocationCommand,
  sendBoothMessageCommand,
  sendChatMessageCommand,
  setBoothChatCommand,
  UNANSWERED_LIMIT,
  unblockPersonCommand,
  updateNetworkSettingsCommand,
} from '@yayatoh/engagement';
import {
  createEventCommand,
  createPortalSession,
  portalCtx,
  portalPrincipalBySession,
  transitionEventCommand,
} from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import { realtimeChannelName, recentEventsTx } from '@yayatoh/platform';
import {
  assignBoothCommand,
  createExhibitorCommand,
  inviteExhibitorMemberCommand,
  saveBoothCommand,
  saveExhibitorListingCommand,
} from '@yayatoh/program';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M5.8b networking chat (P5-3): 1:1 only between accepted connections or meeting parties, booth
 * chat with exhibitors, blocks (a blocked person's messages never deliver), reports with an
 * excerpt for the organizer and Yayatoh staff and a chat fraud signal, rate limits, delivery over
 * the realtime log to the two inboxes only, retention (D11), tenant isolation and the channel
 * attach rule (another org's or another person's inbox is refused).
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
  readonly endsAt: Date;
  readonly emails: string[];
  /** Profile ids by guest index (after `people`). */
  readonly ids: string[];
}

/** A fresh published event of org A with `n` guests, networking on, everyone opted in. */
async function freshEvent(n: number): Promise<Ev> {
  const tag = uuidv7().slice(-8);
  const startsAt = new Date(Date.UTC(2027, 10, 4, 15));
  const endsAt = new Date(startsAt.getTime() + 8 * 3_600_000);
  const ev = await executeCommand(
    createEventCommand,
    {
      name: `Chat ${tag}`,
      slug: `chat-${tag}`,
      profile: 'conference',
      timezone: 'America/Chicago',
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, a.ctx(), ports);
  await executeCommand(
    updateNetworkSettingsCommand,
    { eventId: ev.id, enabled: true, meetingsEnabled: true },
    a.ctx(),
    ports,
  );
  const emails: string[] = [];
  for (let i = 0; i < n; i++) {
    const email = `chat-${tag}-${i}@example.test`;
    await executeCommand(
      addGuestCommand,
      { eventId: ev.id, name: `Guest ${i} ${tag}`, email },
      a.ctx(),
      ports,
    );
    await executeCommand(
      optInCommand,
      { eventId: ev.id, email, displayName: `Person ${i}`, company: `Co ${i}`, interests: '', consent: true },
      pub(),
      ports,
    );
    emails.push(email);
  }
  const rows = await withTenant(systemCtx(a.org.id), (tx) =>
    tx.execute<{ id: string; name: string }>(
      sql`select id, display_name as name from engagement.network_profiles where event_id = ${ev.id}`,
    ),
  );
  const ids = emails.map((_, i) => rows.find((r) => r.name === `Person ${i}`)?.id ?? '');
  return { id: ev.id, startsAt, endsAt, emails, ids };
}

const at = (ev: Ev, i: number) => ({ eventId: ev.id, email: ev.emails[i] ?? '' });

async function connect(ev: Ev, i: number, j: number) {
  const r = await executeCommand(
    requestConnectionCommand,
    { ...at(ev, i), personId: ev.ids[j] ?? '', message: null },
    pub(),
    ports,
  );
  await executeCommand(
    respondConnectionCommand,
    { ...at(ev, j), connectionId: r.id, accept: true },
    pub(),
    ports,
  );
}

const send = (ev: Ev, i: number, j: number, body = `hello ${uuidv7().slice(-6)}`) =>
  executeCommand(sendChatMessageCommand, { ...at(ev, i), personId: ev.ids[j] ?? '', body }, pub(), ports);

const thread = (ev: Ev, i: number, j: number) =>
  executeQuery(chatThreadQuery, { ...at(ev, i), personId: ev.ids[j] ?? '' }, pub(), ports);

async function rowCount(table: string, where: ReturnType<typeof sql>, org: OrgFixture = a) {
  const [r] = await withTenant(systemCtx(org.org.id), (tx) =>
    tx.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.raw(table)} where ${where}`),
  );
  return r?.n ?? 0;
}

/** An exhibitor at a booth of the event, listed, with its admin signed in to the portal. */
async function boothFor(ev: Ev, name = 'Acme Robotics') {
  const x = await executeCommand(createExhibitorCommand, { eventId: ev.id, name }, a.ctx(), ports);
  await executeCommand(
    saveExhibitorListingCommand,
    { eventId: ev.id, exhibitorId: x.id, listed: true, categories: [], links: [], staffAllowance: null },
    a.ctx(),
    ports,
  );
  const plan = await executeCommand(
    saveBoothCommand,
    {
      eventId: ev.id,
      number: `B${uuidv7().slice(-4)}`,
      category: null,
      x: 0,
      y: 0,
      width: 300,
      height: 300,
    },
    a.ctx(),
    ports,
  );
  const booth = plan.booths.at(-1);
  await executeCommand(
    assignBoothCommand,
    { eventId: ev.id, boothId: booth?.id ?? '', exhibitorId: x.id },
    a.ctx(),
    ports,
  );
  const signIn = async (role: 'exhibitor_admin' | 'exhibitor_staff') => {
    const invited = await executeCommand(
      inviteExhibitorMemberCommand,
      { eventId: ev.id, exhibitorId: x.id, email: `${role}-${uuidv7().slice(-6)}@acme.example`, role },
      a.ctx(),
      ports,
    );
    const s = await createPortalSession({ orgId: a.org.id, accountId: invited.member.id, host: 'chat.test' });
    const p = await portalPrincipalBySession(s.token, 'chat.test');
    if (!p) throw new Error('no principal');
    return portalCtx(p);
  };
  return { id: x.id, admin: await signIn('exhibitor_admin'), staff: await signIn('exhibitor_staff') };
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});

afterAll(async () => {
  await closePools();
});

describe('who may chat (P5-3)', () => {
  it('chat between unconnected people is refused; a pending request is not enough', async () => {
    const ev = await freshEvent(3);
    expect(await codeOf(send(ev, 0, 1))).toBe('forbidden:not_connected');
    expect((await thread(ev, 0, 1)).closed).toBe('not_connected');
    const r = await executeCommand(
      requestConnectionCommand,
      { ...at(ev, 0), personId: ev.ids[1] ?? '', message: null },
      pub(),
      ports,
    );
    expect(await codeOf(send(ev, 0, 1))).toBe('forbidden:not_connected');
    expect(await codeOf(send(ev, 1, 0))).toBe('forbidden:not_connected');
    // Nothing was stored for any refused message.
    expect(await rowCount('engagement.chat_conversations', sql`event_id = ${ev.id}`)).toBe(0);
    expect(await rowCount('engagement.chat_messages', sql`event_id = ${ev.id}`)).toBe(0);
    await executeCommand(
      respondConnectionCommand,
      { ...at(ev, 1), connectionId: r.id, accept: true },
      pub(),
      ports,
    );
    expect(await codeOf(send(ev, 0, 1, 'Hi there'))).toBe('ok');
    expect(await codeOf(send(ev, 1, 0, 'Hello back'))).toBe('ok');
    const t = await thread(ev, 1, 0);
    expect(t.closed).toBeNull();
    expect(t.messages.map((m) => [m.body, m.fromMe])).toEqual([
      ['Hi there', false],
      ['Hello back', true],
    ]);
    // Person 2 is connected to nobody.
    expect(await codeOf(send(ev, 2, 0))).toBe('forbidden:not_connected');
    expect(await codeOf(send(ev, 0, 2))).toBe('forbidden:not_connected');
  });

  it('meeting parties may chat once their meeting is agreed (not while it is only asked)', async () => {
    const ev = await freshEvent(2);
    const loc = await executeCommand(
      saveMeetingLocationCommand,
      { eventId: ev.id, name: 'Point A', kind: 'meeting_point', capacity: 2 },
      a.ctx(),
      ports,
    );
    await executeCommand(
      addMeetingSlotsCommand,
      {
        eventId: ev.id,
        startsAt: ev.startsAt,
        endsAt: new Date(ev.startsAt.getTime() + 30 * 60_000),
        minutes: 15,
      },
      a.ctx(),
      ports,
    );
    const slots = (await executeQuery(networkConsoleQuery, { eventId: ev.id }, a.ctx(), ports)).slots;
    const m = await executeCommand(
      requestMeetingCommand,
      {
        ...at(ev, 0),
        personId: ev.ids[1] ?? '',
        slotId: slots[0]?.id ?? '',
        locationId: loc.id,
        message: null,
      },
      pub(),
      ports,
    );
    expect(await codeOf(send(ev, 0, 1))).toBe('forbidden:not_connected');
    await executeCommand(
      respondMeetingCommand,
      { ...at(ev, 1), meetingId: m.id, accept: true },
      pub(),
      ports,
    );
    expect(await codeOf(send(ev, 0, 1))).toBe('ok');
  });

  it('refuses empty and over-long messages, yourself, and chat the organizer switched off', async () => {
    const ev = await freshEvent(2);
    await connect(ev, 0, 1);
    expect(await codeOf(send(ev, 0, 1, '   \n '))).toBe('validation_failed:required');
    expect(await codeOf(send(ev, 0, 1, 'x'.repeat(2001)))).toBe('validation_failed:too_long');
    expect(await codeOf(send(ev, 0, 0))).toBe('not_found');
    await executeCommand(
      updateNetworkSettingsCommand,
      { eventId: ev.id, enabled: true, meetingsEnabled: true, chatEnabled: false },
      a.ctx(),
      ports,
    );
    expect(await codeOf(send(ev, 0, 1))).toBe('invalid_state:chat_off');
    expect((await thread(ev, 0, 1)).closed).toBe('chat_off');
    expect((await executeQuery(chatInboxQuery, at(ev, 0), pub(), ports)).chatEnabled).toBe(false);
    // Leaving the switch out keeps it as it is.
    await executeCommand(
      updateNetworkSettingsCommand,
      { eventId: ev.id, enabled: true, meetingsEnabled: false },
      a.ctx(),
      ports,
    );
    expect(await codeOf(send(ev, 0, 1))).toBe('invalid_state:chat_off');
    await executeCommand(
      updateNetworkSettingsCommand,
      { eventId: ev.id, enabled: true, meetingsEnabled: true, chatEnabled: true },
      a.ctx(),
      ports,
    );
    expect(await codeOf(send(ev, 0, 1, '  Hi\r\n\n\n\nthere‮ '))).toBe('ok');
    expect((await thread(ev, 1, 0)).messages.at(-1)?.body).toBe('Hi\n\nthere');
  });
});

describe('blocks (a blocked person’s messages never deliver)', () => {
  it('after a block neither side can write or see the chat; nothing is stored or published', async () => {
    const ev = await freshEvent(2);
    await connect(ev, 0, 1);
    await send(ev, 0, 1, 'before the block');
    const channelOf1 = realtimeChannelName(CHAT_CHANNEL, a.org.id, ev.id, ev.ids[1]);
    const published = () => rowCount('platform.realtime_messages', sql`channel = ${channelOf1}`);
    const before = {
      messages: await rowCount('engagement.chat_messages', sql`event_id = ${ev.id}`),
      pub: await published(),
    };
    expect(before.pub).toBe(1);
    await executeCommand(blockPersonCommand, { ...at(ev, 1), personId: ev.ids[0] ?? '' }, pub(), ports);
    expect(await codeOf(send(ev, 0, 1, 'after the block'))).toBe('not_found');
    expect(await codeOf(send(ev, 1, 0, 'blocker writes'))).toBe('not_found');
    expect(await rowCount('engagement.chat_messages', sql`event_id = ${ev.id}`)).toBe(before.messages);
    expect(await published()).toBe(before.pub);
    expect(await codeOf(thread(ev, 0, 1))).toBe('not_found');
    expect(await codeOf(thread(ev, 1, 0))).toBe('not_found');
    for (const i of [0, 1])
      expect((await executeQuery(chatInboxQuery, at(ev, i), pub(), ports)).conversations).toEqual([]);
    // Unblocking does not bring the connection back (the block cut it): still refused.
    await executeCommand(unblockPersonCommand, { ...at(ev, 1), personId: ev.ids[0] ?? '' }, pub(), ports);
    expect(await codeOf(send(ev, 0, 1))).toBe('forbidden:not_connected');
  });

  it('a block racing sends: no message is stored after the block committed', async () => {
    const ev = await freshEvent(2);
    await connect(ev, 0, 1);
    const sends = Array.from({ length: 4 }, (_, i) => codeOf(send(ev, 0, 1, `race ${i}`)));
    const block = executeCommand(
      blockPersonCommand,
      { ...at(ev, 1), personId: ev.ids[0] ?? '' },
      pub(),
      ports,
    );
    const outcomes = await Promise.all(sends);
    await block;
    for (const o of outcomes) expect(['ok', 'not_found']).toContain(o);
    const [blockAt] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ at: string }>(
        sql`select created_at::text as at from engagement.network_blocks where event_id = ${ev.id}`,
      ),
    );
    const late = await rowCount(
      'engagement.chat_messages',
      sql`event_id = ${ev.id} and created_at > ${blockAt?.at ?? ''}::timestamptz`,
    );
    expect(late).toBe(0);
    expect(await codeOf(send(ev, 0, 1))).toBe('not_found');
  });

  it('someone who opted out or was hidden takes no messages and their chats disappear', async () => {
    const ev = await freshEvent(3);
    await connect(ev, 0, 1);
    await connect(ev, 0, 2);
    await send(ev, 0, 1);
    await send(ev, 0, 2);
    await executeCommand(optOutCommand, at(ev, 1), pub(), ports);
    expect(await codeOf(send(ev, 0, 1))).toBe('not_found');
    expect(await codeOf(send(ev, 1, 0))).toBe('invalid_state:not_opted_in');
    const inbox = await executeQuery(chatInboxQuery, at(ev, 0), pub(), ports);
    expect(inbox.conversations.map((c) => c.person?.displayName)).toEqual(['Person 2']);
  });
});

describe('rate limits', () => {
  it('a run of unanswered messages waits for a reply, even when sent at once', async () => {
    const ev = await freshEvent(2);
    await connect(ev, 0, 1);
    const burst = await Promise.all(
      Array.from({ length: UNANSWERED_LIMIT + 4 }, (_, i) => codeOf(send(ev, 0, 1, `m${i}`))),
    );
    expect(burst.filter((o) => o === 'ok')).toHaveLength(UNANSWERED_LIMIT);
    expect(new Set(burst.filter((o) => o !== 'ok'))).toEqual(new Set(['rate_limited:awaiting_reply']));
    await send(ev, 1, 0, 'ok, ok');
    expect(await codeOf(send(ev, 0, 1))).toBe('ok');
  });

  it(`at most ${CHAT_PER_MINUTE} messages a minute, across conversations`, async () => {
    const ev = await freshEvent(4);
    for (const j of [1, 2, 3]) await connect(ev, 0, j);
    const out: string[] = [];
    for (let i = 0; i < CHAT_PER_MINUTE + 1; i++) out.push(await codeOf(send(ev, 0, 1 + (i % 3))));
    expect(out.slice(0, CHAT_PER_MINUTE).every((o) => o === 'ok')).toBe(true);
    expect(out.at(-1)).toBe('rate_limited:too_fast');
    // A minute later it clears.
    const later = createCtx({ orgId: a.org.id, now: new Date(Date.now() + 61_000) });
    expect(
      await codeOf(
        executeCommand(
          sendChatMessageCommand,
          { ...at(ev, 1), personId: ev.ids[0] ?? '', body: 'hi' },
          later,
          ports,
        ),
      ),
    ).toBe('ok');
  });

  it(`at most ${NEW_CHATS_PER_HOUR} new conversations an hour (replies are not limited)`, async () => {
    const ev = await freshEvent(2);
    await connect(ev, 0, 1);
    // Twenty chats person 0 started within the hour, with twenty more guests (their profiles and
    // the conversations are made directly: twenty opt-ins and connections would only be slower).
    const tag = uuidv7().slice(-6);
    for (let i = 0; i < NEW_CHATS_PER_HOUR; i++)
      await executeCommand(
        addGuestCommand,
        { eventId: ev.id, name: `Ghost ${i}`, email: `ghost-${tag}-${i}@example.test` },
        a.ctx(),
        ports,
      );
    await withTenant(systemCtx(a.org.id), async (tx) => {
      const ghosts = await tx.execute<{ id: string }>(sql`
        insert into engagement.network_profiles (org_id, event_id, contact_id, opted_in, display_name)
        select distinct on (contact_id) org_id, event_id, contact_id, false, 'Ghost'
        from attendees.attendees where event_id = ${ev.id} and email like ${`ghost-${tag}-%`}
        returning id`);
      expect(ghosts).toHaveLength(NEW_CHATS_PER_HOUR);
      for (const g of ghosts) {
        const [lo, hi] = [ev.ids[0] ?? '', g.id].sort();
        await tx.execute(sql`
          insert into engagement.chat_conversations (org_id, event_id, kind, profile_a, profile_b, started_by)
          values (${a.org.id}, ${ev.id}, 'direct', ${lo}::uuid, ${hi}::uuid, ${lo === ev.ids[0] ? 'a' : 'b'})`);
      }
    });
    expect(await codeOf(send(ev, 0, 1))).toBe('rate_limited:too_many_new_chats');
    // Person 1 starting the chat is fine, and then person 0 may answer.
    expect(await codeOf(send(ev, 1, 0))).toBe('ok');
    expect(await codeOf(send(ev, 0, 1))).toBe('ok');
  });
});

describe('delivery (the realtime port)', () => {
  it('each message goes to both inboxes only, allowlisted, after commit; reads clear unread', async () => {
    const ev = await freshEvent(3);
    await connect(ev, 0, 1);
    await send(ev, 0, 1, 'Ping');
    const rows = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ channel: string; event: string; data: Record<string, unknown> }>(
        sql`select channel, event, data from platform.realtime_messages where channel like ${`org:${a.org.id}:event:${ev.id}:inbox:%`} order by seq`,
      ),
    );
    expect(rows.map((r) => r.channel).sort()).toEqual(
      [
        realtimeChannelName(CHAT_CHANNEL, a.org.id, ev.id, ev.ids[0]),
        realtimeChannelName(CHAT_CHANNEL, a.org.id, ev.id, ev.ids[1]),
      ].sort(),
    );
    for (const r of rows) {
      expect(Object.keys(r.data).sort()).toEqual(['at', 'body', 'conversationId', 'fromMe', 'id', 'removed']);
      expect(r.data.fromMe).toBe(r.channel.includes(ev.ids[0] ?? 'x'));
      expect(JSON.stringify(r.data)).not.toContain('@example.test');
    }
    const inbox1 = await executeQuery(chatInboxQuery, at(ev, 1), pub(), ports);
    expect(inbox1.conversations).toHaveLength(1);
    expect(inbox1.conversations[0]).toMatchObject({
      kind: 'direct',
      unread: 1,
      person: { id: ev.ids[0], displayName: 'Person 0', company: 'Co 0' },
      last: { body: 'Ping', fromMe: false },
    });
    await executeCommand(
      markChatReadCommand,
      { ...at(ev, 1), conversationId: inbox1.conversations[0]?.id ?? '' },
      pub(),
      ports,
    );
    expect((await executeQuery(chatInboxQuery, at(ev, 1), pub(), ports)).conversations[0]?.unread).toBe(0);
    // Person 2 can't mark someone else's conversation read.
    expect(
      await codeOf(
        executeCommand(
          markChatReadCommand,
          { ...at(ev, 2), conversationId: inbox1.conversations[0]?.id ?? '' },
          pub(),
          ports,
        ),
      ),
    ).toBe('not_found');
    // Nothing but the chosen profile: no addresses, contacts or attendees in any attendee read.
    const json = JSON.stringify([inbox1, await thread(ev, 1, 0)]);
    expect(json).not.toContain('@example.test');
    const [contact] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ id: string }>(
        sql`select contact_id::text as id from engagement.network_profiles where id = ${ev.ids[0]}`,
      ),
    );
    expect(json).not.toContain(contact?.id ?? 'x');
  });
});

describe('the channel attach rule (cross-org channel attach denied)', () => {
  it('an attendee attaches only to their own inbox, in the org that holds it', async () => {
    const ev = await freshEvent(2);
    const own = await attendeeChatChannel(a.org.id, ev.id, ev.emails[0] ?? '');
    expect(own).toBe(realtimeChannelName(CHAT_CHANNEL, a.org.id, ev.id, ev.ids[0]));
    // Under org B the event and the person do not exist: no inbox there.
    expect(await attendeeChatChannel(b.org.id, ev.id, ev.emails[0] ?? '')).toBeNull();
    // Someone with no place at the event, or not opted in, has no inbox.
    expect(await attendeeChatChannel(a.org.id, ev.id, 'stranger@example.test')).toBeNull();
    expect(chatAttachAllowed(own, own ?? '')).toBe(true);
    const otherPerson = realtimeChannelName(CHAT_CHANNEL, a.org.id, ev.id, ev.ids[1]);
    const otherOrg = realtimeChannelName(CHAT_CHANNEL, b.org.id, ev.id, ev.ids[0]);
    const otherEvent = realtimeChannelName(CHAT_CHANNEL, a.org.id, b.event.id, ev.ids[0]);
    const booth = realtimeChannelName(BOOTH_CHAT_CHANNEL, a.org.id, ev.id, ev.ids[0]);
    for (const requested of [otherPerson, otherOrg, otherEvent, booth, `org:${a.org.id}:alerts`, 'garbage'])
      expect(chatAttachAllowed(own, requested), requested).toBe(false);
    expect(chatAttachAllowed(null, own ?? '')).toBe(false);
  });

  it("an exhibitor's people attach only to their own booth's inbox", async () => {
    const ev = await freshEvent(1);
    const x = await boothFor(ev);
    const y = await boothFor(ev, 'Globex');
    const own = await exhibitorChatChannel(x.staff);
    expect(own).toBe(realtimeChannelName(BOOTH_CHAT_CHANNEL, a.org.id, ev.id, x.id));
    expect(chatAttachAllowed(own, realtimeChannelName(BOOTH_CHAT_CHANNEL, a.org.id, ev.id, y.id))).toBe(
      false,
    );
    expect(chatAttachAllowed(own, realtimeChannelName(BOOTH_CHAT_CHANNEL, b.org.id, ev.id, x.id))).toBe(
      false,
    );
    // A member's context is not an exhibitor's.
    expect(await exhibitorChatChannel(a.ctx())).toBeNull();
  });
});

describe('booth chat (attendee ↔ exhibitor)', () => {
  it('off until the exhibitor turns it on; attendee writes, the booth answers, visitors stay profiles', async () => {
    const ev = await freshEvent(2);
    const x = await boothFor(ev);
    const write = (i: number, body = 'Do you ship?') =>
      executeCommand(sendBoothMessageCommand, { ...at(ev, i), exhibitorId: x.id, body }, pub(), ports);
    expect((await executeQuery(chatInboxQuery, at(ev, 0), pub(), ports)).booths).toEqual([]);
    expect(await codeOf(write(0))).toBe('invalid_state:booth_closed');
    expect(
      await codeOf(executeQuery(boothThreadQuery, { ...at(ev, 0), exhibitorId: x.id }, pub(), ports)),
    ).toBe('not_found');
    // Staff may answer but not switch it on.
    expect(await codeOf(executeCommand(setBoothChatCommand, { enabled: true }, x.staff, ports))).toBe(
      'forbidden',
    );
    await executeCommand(setBoothChatCommand, { enabled: true }, x.admin, ports);
    const inbox = await executeQuery(chatInboxQuery, at(ev, 0), pub(), ports);
    expect(inbox.booths).toEqual([{ id: x.id, name: 'Acme Robotics', boothNumbers: [expect.any(String)] }]);
    const sent = await write(0);
    const box = await executeQuery(boothInboxQuery, {}, x.staff, ports);
    expect(box).toMatchObject({
      eventChat: true,
      enabled: true,
      suspended: false,
      atBooth: true,
      canManage: false,
    });
    expect(box.conversations).toEqual([
      {
        id: sent.conversationId,
        visitor: { displayName: 'Person 0', headline: null, company: 'Co 0' },
        last: { body: 'Do you ship?', fromMe: false, at: expect.any(Date) },
        unread: 1,
        blocked: false,
      },
    ]);
    expect(JSON.stringify(box)).not.toContain('@example.test');
    await executeCommand(
      replyBoothChatCommand,
      { conversationId: sent.conversationId, body: 'We do!' },
      x.staff,
      ports,
    );
    const t = await executeQuery(boothThreadQuery, { ...at(ev, 0), exhibitorId: x.id }, pub(), ports);
    expect(t.messages.map((m) => [m.body, m.fromMe])).toEqual([
      ['Do you ship?', true],
      ['We do!', false],
    ]);
    // The booth's own inbox got both messages, from the booth's point of view.
    const boothChannel = realtimeChannelName(BOOTH_CHAT_CHANNEL, a.org.id, ev.id, x.id);
    const onBooth = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ data: { fromMe: boolean; body: string } }>(
        sql`select data from platform.realtime_messages where channel = ${boothChannel} order by seq`,
      ),
    );
    expect(onBooth.map((r) => [r.data.body, r.data.fromMe])).toEqual([
      ['Do you ship?', false],
      ['We do!', true],
    ]);
    // Another exhibitor's people never see it.
    const y = await boothFor(ev, 'Globex');
    expect(
      await codeOf(
        executeQuery(boothChatThreadQuery, { conversationId: sent.conversationId }, y.admin, ports),
      ),
    ).toBe('not_found');
    expect(
      await codeOf(
        executeCommand(
          replyBoothChatCommand,
          { conversationId: sent.conversationId, body: 'x' },
          y.admin,
          ports,
        ),
      ),
    ).toBe('not_found');
    // Switched off again: no new chats, and no answers.
    await executeCommand(setBoothChatCommand, { enabled: false }, x.admin, ports);
    expect(await codeOf(write(0))).toBe('invalid_state:booth_closed');
    expect(await codeOf(write(1))).toBe('invalid_state:booth_closed');
    expect(
      await codeOf(
        executeCommand(
          replyBoothChatCommand,
          { conversationId: sent.conversationId, body: 'x' },
          x.admin,
          ports,
        ),
      ),
    ).toBe('invalid_state:booth_closed');
    expect(
      (await executeQuery(boothThreadQuery, { ...at(ev, 0), exhibitorId: x.id }, pub(), ports)).closed,
    ).toBe('booth_closed');
  });

  it('either side can block; a blocked side’s messages never deliver', async () => {
    const ev = await freshEvent(1);
    const x = await boothFor(ev);
    await executeCommand(setBoothChatCommand, { enabled: true }, x.admin, ports);
    const sent = await executeCommand(
      sendBoothMessageCommand,
      { ...at(ev, 0), exhibitorId: x.id, body: 'Hello booth' },
      pub(),
      ports,
    );
    await executeCommand(
      blockVisitorCommand,
      { conversationId: sent.conversationId, blocked: true },
      x.staff,
      ports,
    );
    const n = await rowCount('engagement.chat_messages', sql`conversation_id = ${sent.conversationId}`);
    expect(
      await codeOf(
        executeCommand(
          sendBoothMessageCommand,
          { ...at(ev, 0), exhibitorId: x.id, body: 'Hello?' },
          pub(),
          ports,
        ),
      ),
    ).toBe('invalid_state:blocked');
    expect(
      await codeOf(
        executeCommand(
          replyBoothChatCommand,
          { conversationId: sent.conversationId, body: 'x' },
          x.admin,
          ports,
        ),
      ),
    ).toBe('invalid_state:blocked');
    expect(await rowCount('engagement.chat_messages', sql`conversation_id = ${sent.conversationId}`)).toBe(n);
    const t = await executeQuery(boothThreadQuery, { ...at(ev, 0), exhibitorId: x.id }, pub(), ports);
    expect([t.closed, t.blockedByMe]).toEqual(['blocked', false]);
    await executeCommand(
      blockVisitorCommand,
      { conversationId: sent.conversationId, blocked: false },
      x.staff,
      ports,
    );
    // The attendee blocks the booth instead: the booth's answers stop.
    await executeCommand(blockBoothCommand, { ...at(ev, 0), exhibitorId: x.id, blocked: true }, pub(), ports);
    expect(
      await codeOf(
        executeCommand(
          replyBoothChatCommand,
          { conversationId: sent.conversationId, body: 'x' },
          x.admin,
          ports,
        ),
      ),
    ).toBe('invalid_state:blocked');
    expect(
      (await executeQuery(boothChatThreadQuery, { conversationId: sent.conversationId }, x.admin, ports))
        .closed,
    ).toBe('blocked');
    // The booth can't lift the attendee's block, only its own.
    await executeCommand(
      blockVisitorCommand,
      { conversationId: sent.conversationId, blocked: false },
      x.admin,
      ports,
    );
    expect(
      await codeOf(
        executeCommand(
          replyBoothChatCommand,
          { conversationId: sent.conversationId, body: 'x' },
          x.admin,
          ports,
        ),
      ),
    ).toBe('invalid_state:blocked');
    await executeCommand(
      blockBoothCommand,
      { ...at(ev, 0), exhibitorId: x.id, blocked: false },
      pub(),
      ports,
    );
    expect(
      await codeOf(
        executeCommand(
          replyBoothChatCommand,
          { conversationId: sent.conversationId, body: 'Back' },
          x.admin,
          ports,
        ),
      ),
    ).toBe('ok');
    // A visitor who leaves networking disappears from the booth's inbox.
    await executeCommand(optOutCommand, at(ev, 0), pub(), ports);
    expect((await executeQuery(boothInboxQuery, {}, x.admin, ports)).conversations).toEqual([]);
    expect(
      await codeOf(
        executeCommand(
          replyBoothChatCommand,
          { conversationId: sent.conversationId, body: 'x' },
          x.admin,
          ports,
        ),
      ),
    ).toBe('not_found');
  });
});

describe('reports and moderation', () => {
  it('a report blocks, shows the organizer an excerpt, raises a chat fraud signal, and is moderated', async () => {
    const ev = await freshEvent(3);
    await connect(ev, 0, 1);
    await send(ev, 1, 0, 'Buy my course');
    await send(ev, 0, 1, 'No thanks');
    const bad = await send(ev, 1, 0, 'Buy it now!!!');
    expect(
      await codeOf(
        executeCommand(
          reportChatCommand,
          { ...at(ev, 0), conversationId: bad.conversationId, reason: 'other', details: null },
          pub(),
          ports,
        ),
      ),
    ).toBe('validation_failed:required');
    // Someone else's conversation can't be reported by person 2.
    expect(
      await codeOf(
        executeCommand(
          reportChatCommand,
          { ...at(ev, 2), conversationId: bad.conversationId, reason: 'spam', details: null },
          pub(),
          ports,
        ),
      ),
    ).toBe('not_found');
    await executeCommand(
      reportChatCommand,
      { ...at(ev, 0), conversationId: bad.conversationId, reason: 'harassment', details: 'Keeps pushing.' },
      pub(),
      ports,
    );
    // Reporting blocks: person 1's messages never deliver now.
    expect(await codeOf(send(ev, 1, 0))).toBe('not_found');
    // The outbox carries ids and the reason only.
    const events = await withTenant(systemCtx(a.org.id), (tx) =>
      recentEventsTx(tx, a.org.id, ['engagement.chat_reported'], 3_600_000),
    );
    const e = events.find((x) => (x.payload as { eventId?: string }).eventId === ev.id);
    expect(e).toBeTruthy();
    expect(Object.keys(e?.payload ?? {}).sort()).toEqual([
      'contactId',
      'eventId',
      'orgId',
      'reason',
      'reportId',
    ]);
    expect(JSON.stringify(e?.payload)).not.toContain('Keeps pushing');
    // M1.9e: a chat_abuse signal about person 1's contact (harassment is high).
    const { consumeEvent } = await import('@yayatoh/platform');
    if (e) {
      await consumeEvent(networkChatSignals(), e);
      await consumeEvent(networkChatSignals(), e);
    }
    const signals = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{
        kind: string;
        severity: string;
        source: string;
        contact_id: string;
        detail: { reason: string };
      }>(
        sql`select kind, severity, source, contact_id::text, detail from checkin.fraud_signals where event_id = ${ev.id}`,
      ),
    );
    const [p1] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ id: string }>(
        sql`select contact_id::text as id from engagement.network_profiles where id = ${ev.ids[1]}`,
      ),
    );
    expect(signals).toEqual([
      {
        kind: 'chat_abuse',
        severity: 'high',
        source: 'chat',
        contact_id: p1?.id,
        detail: { reason: 'abuse' },
      },
    ]);

    // The organizer's console: the report with its excerpt (names, not addresses).
    const viewer = userCtx(a.viewerId, a.org.id);
    const consoleView = await executeQuery(chatConsoleQuery, { eventId: ev.id }, viewer, ports);
    expect(consoleView.stats).toMatchObject({ conversations: 1, messagesToday: 3, openReports: 1 });
    const report = consoleView.reports[0];
    expect(report).toMatchObject({
      kind: 'direct',
      reason: 'harassment',
      details: 'Keeps pushing.',
      moderation: 'open',
      reporterName: 'Person 0',
      reported: { kind: 'person', name: 'Person 1', actioned: false },
    });
    expect(report?.excerpt.map((m) => [m.from, m.body, m.byReported])).toEqual([
      ['Person 1', 'Buy my course', true],
      ['Person 0', 'No thanks', false],
      ['Person 1', 'Buy it now!!!', true],
    ]);
    expect(JSON.stringify(consoleView)).not.toContain('@example.test');
    // Viewers read; only events:write acts.
    const msgId = report?.excerpt[2]?.id ?? '';
    expect(
      await codeOf(
        executeCommand(removeChatMessageCommand, { eventId: ev.id, messageId: msgId }, viewer, ports),
      ),
    ).toBe('forbidden');
    expect(
      await codeOf(
        executeCommand(
          moderateChatReportCommand,
          { eventId: ev.id, reportId: report?.id ?? '', action: 'hide' },
          viewer,
          ports,
        ),
      ),
    ).toBe('forbidden');
    // Remove the message: both sides see it removed (no text), and both inboxes are told.
    await executeCommand(removeChatMessageCommand, { eventId: ev.id, messageId: msgId }, a.ctx(), ports);
    expect(
      await codeOf(
        executeCommand(removeChatMessageCommand, { eventId: ev.id, messageId: msgId }, a.ctx(), ports),
      ),
    ).toBe('invalid_state:already_removed');
    const removed = await rowCount(
      'platform.realtime_messages',
      sql`event = 'removed' and channel like ${`org:${a.org.id}:event:${ev.id}:inbox:%`}`,
    );
    expect(removed).toBe(2);
    // Hide person 1 (as for an M5.8a report): gone from the directory, report actioned.
    await executeCommand(
      moderateChatReportCommand,
      { eventId: ev.id, reportId: report?.id ?? '', action: 'hide' },
      a.ctx(),
      ports,
    );
    expect(
      await codeOf(
        executeCommand(
          moderateChatReportCommand,
          { eventId: ev.id, reportId: report?.id ?? '', action: 'dismiss' },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('invalid_state:resolved');
    const after = await executeQuery(chatConsoleQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(after.reports[0]).toMatchObject({ moderation: 'actioned', reported: { actioned: true } });
    expect(after.reports[0]?.excerpt[2]).toMatchObject({ removed: true });
    const dir = await executeQuery(directoryQuery, at(ev, 2), pub(), ports);
    expect(dir.people.map((p) => p.displayName)).not.toContain('Person 1');
  });

  it('only messages of a reported conversation can be removed', async () => {
    const ev = await freshEvent(2);
    await connect(ev, 0, 1);
    const m = await send(ev, 0, 1);
    expect(
      await codeOf(
        executeCommand(removeChatMessageCommand, { eventId: ev.id, messageId: m.messageId }, a.ctx(), ports),
      ),
    ).toBe('not_found');
  });

  it('a booth report suspends the booth’s chat; the organizer can lift it', async () => {
    const ev = await freshEvent(1);
    const x = await boothFor(ev);
    await executeCommand(setBoothChatCommand, { enabled: true }, x.admin, ports);
    const sent = await executeCommand(
      sendBoothMessageCommand,
      { ...at(ev, 0), exhibitorId: x.id, body: 'Hi' },
      pub(),
      ports,
    );
    await executeCommand(
      replyBoothChatCommand,
      { conversationId: sent.conversationId, body: 'Rude reply' },
      x.staff,
      ports,
    );
    await executeCommand(
      reportChatCommand,
      { ...at(ev, 0), conversationId: sent.conversationId, reason: 'inappropriate', details: null },
      pub(),
      ports,
    );
    const view = await executeQuery(chatConsoleQuery, { eventId: ev.id }, a.ctx(), ports);
    const r = view.reports[0];
    expect(r).toMatchObject({
      kind: 'booth',
      reporterName: 'Person 0',
      reported: { kind: 'exhibitor', name: 'Acme Robotics' },
    });
    // No fraud signal about an exhibitor (contactId is null on the event).
    const events = await withTenant(systemCtx(a.org.id), (tx) =>
      recentEventsTx(tx, a.org.id, ['engagement.chat_reported'], 3_600_000),
    );
    expect(events.find((e) => (e.payload as { eventId?: string }).eventId === ev.id)?.payload).toMatchObject({
      contactId: null,
    });
    await executeCommand(
      moderateChatReportCommand,
      { eventId: ev.id, reportId: r?.id ?? '', action: 'hide' },
      a.ctx(),
      ports,
    );
    const box = await executeQuery(boothInboxQuery, {}, x.admin, ports);
    expect([box.enabled, box.suspended]).toEqual([true, true]);
    expect(
      (await executeQuery(chatConsoleQuery, { eventId: ev.id }, a.ctx(), ports)).suspendedBooths,
    ).toEqual([{ id: x.id, name: 'Acme Robotics' }]);
    // The attendee unblocks the booth: it still takes no chats while suspended.
    await executeCommand(
      blockBoothCommand,
      { ...at(ev, 0), exhibitorId: x.id, blocked: false },
      pub(),
      ports,
    );
    expect(
      await codeOf(
        executeCommand(
          sendBoothMessageCommand,
          { ...at(ev, 0), exhibitorId: x.id, body: 'Hi?' },
          pub(),
          ports,
        ),
      ),
    ).toBe('invalid_state:booth_closed');
    // The exhibitor can't lift a suspension by switching off and on.
    await executeCommand(setBoothChatCommand, { enabled: true }, x.admin, ports);
    expect((await executeQuery(boothInboxQuery, {}, x.admin, ports)).suspended).toBe(true);
    await executeCommand(restoreBoothChatCommand, { eventId: ev.id, exhibitorId: x.id }, a.ctx(), ports);
    expect(
      await codeOf(
        executeCommand(
          sendBoothMessageCommand,
          { ...at(ev, 0), exhibitorId: x.id, body: 'Hi again' },
          pub(),
          ports,
        ),
      ),
    ).toBe('ok');
  });

  it('a booth reports a visitor: the visitor is blocked and a signal names their contact', async () => {
    const ev = await freshEvent(1);
    const x = await boothFor(ev);
    await executeCommand(setBoothChatCommand, { enabled: true }, x.admin, ports);
    const sent = await executeCommand(
      sendBoothMessageCommand,
      { ...at(ev, 0), exhibitorId: x.id, body: 'Spam spam' },
      pub(),
      ports,
    );
    await executeCommand(
      reportVisitorCommand,
      { conversationId: sent.conversationId, reason: 'spam', details: null },
      x.staff,
      ports,
    );
    expect(
      await codeOf(
        executeCommand(
          sendBoothMessageCommand,
          { ...at(ev, 0), exhibitorId: x.id, body: 'More' },
          pub(),
          ports,
        ),
      ),
    ).toBe('invalid_state:blocked');
    const view = await executeQuery(chatConsoleQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(view.reports[0]).toMatchObject({
      reporterName: 'Acme Robotics',
      reported: { kind: 'person', name: 'Person 0' },
    });
    const events = await withTenant(systemCtx(a.org.id), (tx) =>
      recentEventsTx(tx, a.org.id, ['engagement.chat_reported'], 3_600_000),
    );
    expect(events.find((e) => (e.payload as { eventId?: string }).eventId === ev.id)?.payload).toMatchObject({
      contactId: expect.any(String),
      reason: 'spam',
    });
  });
});

describe('retention (D11)', () => {
  it('chats go 24 months after their event ended, not before', async () => {
    const ev = await freshEvent(2);
    await connect(ev, 0, 1);
    await send(ev, 0, 1);
    const run = (months: number) =>
      executeCommand(
        chatRetentionCommand,
        {},
        createCtx({
          orgId: a.org.id,
          actor: { type: 'system', name: 'privacy.retention' },
          now: new Date(
            Date.UTC(
              ev.endsAt.getUTCFullYear(),
              ev.endsAt.getUTCMonth() + months,
              ev.endsAt.getUTCDate(),
              23,
            ),
          ),
        }),
        ports,
      );
    await run(23);
    expect(await rowCount('engagement.chat_conversations', sql`event_id = ${ev.id}`)).toBe(1);
    const r = await run(25);
    expect(r.conversations).toBeGreaterThanOrEqual(1);
    expect(await rowCount('engagement.chat_conversations', sql`event_id = ${ev.id}`)).toBe(0);
    expect(await rowCount('engagement.chat_messages', sql`event_id = ${ev.id}`)).toBe(0);
    // A member can't run it.
    expect(await codeOf(executeCommand(chatRetentionCommand, {}, a.ctx(), ports))).toBe('forbidden');
  });
});

describe('tenant isolation', () => {
  it("org B reaches none of org A's chats", async () => {
    const ev = await freshEvent(2);
    await connect(ev, 0, 1);
    const m = await send(ev, 0, 1);
    expect(await codeOf(executeQuery(chatInboxQuery, at(ev, 0), pub(b), ports))).toBe('not_found');
    expect(
      await codeOf(
        executeCommand(
          sendChatMessageCommand,
          { ...at(ev, 0), personId: ev.ids[1] ?? '', body: 'x' },
          pub(b),
          ports,
        ),
      ),
    ).toBe('not_found');
    expect(await codeOf(executeQuery(chatConsoleQuery, { eventId: ev.id }, b.ctx(), ports))).toBe(
      'not_found',
    );
    expect(
      await codeOf(
        executeCommand(removeChatMessageCommand, { eventId: ev.id, messageId: m.messageId }, b.ctx(), ports),
      ),
    ).toBe('not_found');
    for (const t of ['chat_conversations', 'chat_messages', 'chat_reports', 'booth_chat_settings'])
      expect(await rowCount(`engagement.${t}`, sql`event_id = ${ev.id}`, b)).toBe(0);
    // The fixture made chat rows in both orgs; each sees only its own.
    const mine = await rowCount('engagement.chat_messages', sql`true`, b);
    expect(mine).toBeGreaterThan(0);
    expect(await rowCount('engagement.chat_messages', sql`org_id <> ${b.org.id}`, b)).toBe(0);
  });
});
