import { addGuestCommand } from '@yayatoh/attendees';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  announcementMailer,
  announcementsQuery,
  blockThreadCommand,
  CONTACT_HOURLY_LIMIT,
  contactBlockCommand,
  contactMessageCommand,
  contactReportCommand,
  contactWroteNotifier,
  markThreadReadCommand,
  previewAnnouncementQuery,
  publicThread,
  replyToThreadCommand,
  reportThreadCommand,
  sendAnnouncementCommand,
  threadQuery,
  threadReplyMailer,
  threadsQuery,
  threadToken,
} from '@yayatoh/messaging';
import { createNotifier, dispatchDue, inboxQuery, memoryTransports } from '@yayatoh/notifications';
import { consumeEvent, eventKey, recentEventsTx } from '@yayatoh/platform';
import { setSuspensionCommand } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

const ORIGIN = 'https://app.yayatoh.test';
const NOON = () => new Date('2030-03-01T17:00:00Z');
const notifier = createNotifier();
let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let empty: string;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const mk = async (name: string) =>
    (
      await executeCommand(
        createEventCommand,
        {
          name,
          timezone: 'America/Chicago',
          startsAt: '2030-06-01T23:00:00Z',
          endsAt: '2030-06-02T03:00:00Z',
        },
        a.ctx(),
        ports,
      )
    ).id;
  eventId = await mk('Harbor Gala');
  empty = await mk('Nobody Yet');
  for (const [name, email] of [
    ['Ana', 'ana@example.test'],
    ['Ben', 'ben@example.test'],
    ['Ana again', 'ANA@example.test'],
  ] as const)
    await executeCommand(addGuestCommand, { eventId, name, email }, a.ctx(), ports).catch(() => undefined);
});
afterAll(closePools);

const key = () => ({ idempotencyKey: uuidv7() });
const input = (over: Record<string, unknown> = {}) => ({
  eventId,
  subject: 'Harbor doors at 7',
  body: 'Doors open at 7.\nParking in lot C.',
  channels: ['email'],
  ...over,
});

async function fanOut(orgId = a.org.id) {
  const events = await withTenant(systemCtx(orgId), (tx) =>
    recentEventsTx(tx, orgId, ['announcement.sent', 'thread.replied', 'thread.contact_wrote'], 3_600_000),
  );
  const subs = [
    announcementMailer({ notifier, appOrigin: ORIGIN }),
    threadReplyMailer({ notifier, appOrigin: ORIGIN }),
    contactWroteNotifier({ notifier }),
  ];
  for (const e of events) for (const s of subs) if (s.events.includes(eventKey(e))) await consumeEvent(s, e);
}

const threadFor = async (email: string) => {
  const [t] = await withTenant(systemCtx(a.org.id), (tx) =>
    tx.execute<{ id: string }>(sql`select id from messaging.threads where contact_email_norm = ${email}`),
  );
  if (!t) throw new Error(`no thread for ${email}`);
  return t.id;
};

describe('messaging: announcements', () => {
  it('previews with the recipient count, then sends once per address; viewers and bad input are refused', async () => {
    const preview = await executeQuery(previewAnnouncementQuery, input(), a.ctx(), ports);
    expect(preview.recipients).toBe(2);
    expect(preview.subject).toBe('Harbor doors at 7');
    expect(preview.html).toContain('Parking in lot C.');

    await expect(
      executeCommand(sendAnnouncementCommand, input(), userCtx(a.viewerId, a.org.id, key()), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(sendAnnouncementCommand, input({ subject: '  ' }), a.ctx(key()), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(sendAnnouncementCommand, input({ channels: [] }), a.ctx(key()), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(sendAnnouncementCommand, input({ eventId: empty }), a.ctx(key()), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'no_recipients' } });

    // The same Idempotency-Key replays the first result instead of sending twice.
    const k = key();
    const first = await executeCommand(sendAnnouncementCommand, input(), a.ctx(k), ports);
    const again = await executeCommand(sendAnnouncementCommand, input(), a.ctx(k), ports);
    expect(again).toEqual(first);
    expect(first.recipients).toBe(2);

    await fanOut();
    await fanOut(); // a replayed relay changes nothing
    const { transports, emails } = memoryTransports();
    await dispatchDue(a.org.id, { transports, appOrigin: ORIGIN, now: NOON });
    const mine = emails.filter((e) => e.subject === 'Harbor doors at 7');
    expect(mine.map((e) => e.to).sort()).toEqual(['ana@example.test', 'ben@example.test']);
    const ana = mine.find((e) => e.to === 'ana@example.test');
    expect(ana?.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(ana?.html).toContain(`${ORIGIN}/messages/${threadToken(await threadFor('ana@example.test'))}`);

    const log = await executeQuery(announcementsQuery, { eventId }, a.ctx(), ports);
    expect(log.find((x) => x.id === first.id)).toMatchObject({
      subject: 'Harbor doors at 7',
      recipients: 2,
      channels: ['email'],
      delivery: { sent: 2, pending: 0, notSent: 0 },
    });
    // Viewers cannot read the log; another org sees none of it.
    await expect(
      executeQuery(announcementsQuery, { eventId }, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await executeQuery(announcementsQuery, { eventId }, b.ctx(), ports)).toEqual([]);
  });

  it('is refused while staff paused messaging', async () => {
    await executeCommand(
      setSuspensionCommand,
      { kind: 'pause_messaging', paused: true, reason: 'review' },
      systemCtx(a.org.id),
      ports,
    );
    try {
      await expect(
        executeCommand(sendAnnouncementCommand, input(), a.ctx(key()), ports),
      ).rejects.toMatchObject({
        code: 'invalid_state',
        details: { reason: 'messaging_paused' },
      });
    } finally {
      await executeCommand(
        setSuspensionCommand,
        { kind: 'pause_messaging', paused: false, reason: 'done' },
        systemCtx(a.org.id),
        ports,
      );
    }
  });
});

describe('messaging: conversations', () => {
  it('a contact replies from the link; the team is notified; the organizer reads and answers by email', async () => {
    const threadId = await threadFor('ben@example.test');
    const token = threadToken(threadId);
    const anon = createCtx({ orgId: a.org.id });
    await executeCommand(contactMessageCommand, { token, body: 'Is there step-free access?' }, anon, ports);
    await fanOut();

    const inbox = await executeQuery(threadsQuery, { filter: 'unread' }, a.ctx(), ports);
    expect(inbox.find((t) => t.id === threadId)).toMatchObject({
      contactEmail: 'ben@example.test',
      preview: 'Is there step-free access?',
      lastDirection: 'in',
      unread: true,
    });
    const ownerItems = await executeQuery(inboxQuery, {}, a.ctx(), ports);
    expect(ownerItems.items.find((i) => i.kind === 'messaging.contact_replied')).toMatchObject({
      href: `/messages/${threadId}`,
      params: { name: 'Ben', eventName: 'Harbor Gala' },
    });
    // Viewers have no access to conversations.
    await expect(executeQuery(threadsQuery, {}, userCtx(a.viewerId, a.org.id), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });

    const thread = await executeQuery(threadQuery, { threadId }, a.ctx(), ports);
    expect(thread.messages.map((m) => [m.direction, m.subject, m.body])).toEqual([
      ['out', 'Harbor doors at 7', 'Doors open at 7.\nParking in lot C.'],
      ['in', null, 'Is there step-free access?'],
    ]);
    await executeCommand(markThreadReadCommand, { threadId }, a.ctx(), ports);
    expect((await executeQuery(threadQuery, { threadId }, a.ctx(), ports)).unread).toBe(false);

    await executeCommand(
      replyToThreadCommand,
      { threadId, body: 'Yes, ramps at every door.' },
      a.ctx(),
      ports,
    );
    await fanOut();
    const { transports, emails } = memoryTransports();
    await dispatchDue(a.org.id, { transports, appOrigin: ORIGIN, now: NOON });
    const reply = emails.find(
      (e) => e.to === 'ben@example.test' && e.subject === 'New reply from Alpha Events',
    );
    expect(reply?.text).toContain('Yes, ramps at every door.');
    expect(reply?.text).toContain(`${ORIGIN}/messages/${token}`);

    // The contact's view is allowlisted and in order.
    const view = await publicThread(token);
    expect(view).toMatchObject({ orgName: 'Alpha Events', contactName: 'Ben', blocked: false });
    expect(view?.messages.map((m) => m.direction)).toEqual(['out', 'in', 'out']);
    expect(JSON.stringify(view)).not.toContain(threadId);
    expect(JSON.stringify(view)).not.toContain(a.ownerId);
  });

  it('blocking works both ways and reports reach Yayatoh', async () => {
    const threadId = await threadFor('ana@example.test');
    const token = threadToken(threadId);
    const anon = createCtx({ orgId: a.org.id });

    await executeCommand(blockThreadCommand, { threadId, blocked: true }, a.ctx(), ports);
    await expect(
      executeCommand(contactMessageCommand, { token, body: 'Hello?' }, anon, ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'blocked' } });
    expect((await publicThread(token))?.blocked).toBe(true);
    await expect(
      executeCommand(blockThreadCommand, { threadId, blocked: false }, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await executeCommand(blockThreadCommand, { threadId, blocked: false }, a.ctx(), ports);
    await executeCommand(contactMessageCommand, { token, body: 'Hello again' }, anon, ports);

    // The contact blocks the organizer: replies are refused, and event updates stop.
    await executeCommand(contactBlockCommand, { token, blocked: true }, anon, ports);
    await expect(
      executeCommand(replyToThreadCommand, { threadId, body: 'Sorry!' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'blocked_by_contact' } });
    await expect(
      executeCommand(contactMessageCommand, { token, body: 'x' }, anon, ports),
    ).rejects.toMatchObject({ details: { reason: 'you_blocked' } });
    const sent = await executeCommand(
      sendAnnouncementCommand,
      input({ subject: 'After block' }),
      a.ctx(key()),
      ports,
    );
    await fanOut();
    const { transports, emails } = memoryTransports();
    await dispatchDue(a.org.id, { transports, appOrigin: ORIGIN, now: NOON });
    expect(emails.filter((e) => e.subject === 'After block').map((e) => e.to)).toEqual(['ben@example.test']);
    expect(sent.recipients).toBe(2);
    await executeCommand(contactBlockCommand, { token, blocked: false }, anon, ports);

    await executeCommand(reportThreadCommand, { threadId, reason: 'abuse', note: 'Rude' }, a.ctx(), ports);
    await executeCommand(contactReportCommand, { token, reason: 'spam' }, anon, ports);
    expect((await executeQuery(threadQuery, { threadId }, a.ctx(), ports)).reported).toBe(true);
    const reports = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ reporter: string; reason: string }>(
        sql`select reporter, reason from messaging.reports where thread_id = ${threadId} order by created_at`,
      ),
    );
    expect(reports.map((r) => [r.reporter, r.reason])).toEqual([
      ['organizer', 'abuse'],
      ['contact', 'spam'],
    ]);
  });

  it('limits a contact to a few messages an hour; links do not cross orgs', async () => {
    const threadId = await threadFor('ben@example.test');
    const token = threadToken(threadId);
    const anon = createCtx({ orgId: a.org.id });
    const [{ n } = { n: 0 }] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from messaging.thread_messages where thread_id = ${threadId} and direction = 'in' and created_at > now() - interval '1 hour'`,
      ),
    );
    for (let i = n; i < CONTACT_HOURLY_LIMIT; i++)
      await executeCommand(contactMessageCommand, { token, body: `Message ${i}` }, anon, ports);
    await expect(
      executeCommand(contactMessageCommand, { token, body: 'One too many' }, anon, ports),
    ).rejects.toMatchObject({ code: 'rate_limited' });

    // The same token under another org's context finds nothing (RLS); org B cannot open it.
    await expect(
      executeCommand(contactMessageCommand, { token, body: 'x' }, createCtx({ orgId: b.org.id }), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(executeQuery(threadQuery, { threadId }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(await publicThread(`${threadId}~forged`)).toBeNull();
  });
});
