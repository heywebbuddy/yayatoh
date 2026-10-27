import { addGuestCommand } from '@yayatoh/attendees';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  CHAT_PER_MINUTE,
  chatRetentionCommand,
  lobbyConsoleQuery,
  lobbyQuery,
  moderateLobbyReportCommand,
  optInCommand,
  reportLobbyMessageCommand,
  sendLobbyMessageCommand,
  setLobbyEnabledCommand,
  updateNetworkSettingsCommand,
} from '@yayatoh/engagement';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';

/**
 * The event lobby: off by default, for opted-in attendees only, the 1:1 chat's rate limit,
 * reporting (which blocks the author for the reporter), organizer moderation and retention.
 */
let a: OrgFixture;
const pub = (): Ctx => createCtx({ orgId: a.org.id });

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

async function freshEvent(n: number, endsAt = new Date(Date.UTC(2027, 10, 4, 23))) {
  const tag = uuidv7().slice(-8);
  const startsAt = new Date(endsAt.getTime() - 8 * 3_600_000);
  const ev = await executeCommand(
    createEventCommand,
    {
      name: `Lobby ${tag}`,
      slug: `lobby-${tag}`,
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
    const email = `lobby-${tag}-${i}@example.test`;
    await executeCommand(
      addGuestCommand,
      { eventId: ev.id, name: `Guest ${i} ${tag}`, email },
      a.ctx(),
      ports,
    );
    // The last guest never opts in to networking.
    if (i < n - 1)
      await executeCommand(
        optInCommand,
        { eventId: ev.id, email, displayName: `Person ${i}`, company: null, interests: '', consent: true },
        pub(),
        ports,
      );
    emails.push(email);
  }
  return { id: ev.id, emails };
}

const send = (ev: { id: string; emails: string[] }, i: number, body: string) =>
  executeCommand(sendLobbyMessageCommand, { eventId: ev.id, email: ev.emails[i] ?? '', body }, pub(), ports);
const view = (ev: { id: string; emails: string[] }, i: number) =>
  executeQuery(lobbyQuery, { eventId: ev.id, email: ev.emails[i] ?? '' }, pub(), ports);

beforeAll(async () => {
  ({ a } = await twoOrgs());
});
afterAll(async () => {
  await closePools();
});

describe('event lobby', () => {
  it('is off until the organizer turns it on, then members post and read', async () => {
    const ev = await freshEvent(3);
    expect((await view(ev, 0)).enabled).toBe(false);
    expect(await codeOf(send(ev, 0, 'hi'))).toBe('invalid_state:lobby_off');
    await executeCommand(setLobbyEnabledCommand, { eventId: ev.id, enabled: true }, a.ctx(), ports);
    await send(ev, 0, 'Hello everyone');
    const seen = await view(ev, 1);
    expect(seen.enabled).toBe(true);
    expect(seen.messages.map((m) => [m.body, m.mine])).toEqual([['Hello everyone', false]]);
    expect(seen.unread).toBe(1);
    // Someone who did not opt in to networking can neither read nor write.
    expect(await codeOf(send(ev, 2, 'let me in'))).toBe('invalid_state:not_opted_in');
  });

  it('shares the 1:1 chat rate limit', async () => {
    const ev = await freshEvent(2);
    await executeCommand(setLobbyEnabledCommand, { eventId: ev.id, enabled: true }, a.ctx(), ports);
    for (let i = 0; i < CHAT_PER_MINUTE; i++) await send(ev, 0, `m${i}`);
    expect(await codeOf(send(ev, 0, 'one too many'))).toBe('rate_limited:too_fast');
  });

  it('a report blocks the author for the reporter, and the organizer can remove or hide', async () => {
    const ev = await freshEvent(3);
    await executeCommand(setLobbyEnabledCommand, { eventId: ev.id, enabled: true }, a.ctx(), ports);
    await send(ev, 0, 'rude message');
    const id = (await view(ev, 1)).messages[0]?.id ?? '';
    await executeCommand(
      reportLobbyMessageCommand,
      { eventId: ev.id, email: ev.emails[1] ?? '', messageId: id, reason: 'harassment', details: null },
      pub(),
      ports,
    );
    expect((await view(ev, 1)).messages).toEqual([]);
    expect((await view(ev, 0)).messages.length).toBe(1);
    const c = await executeQuery(lobbyConsoleQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(c.stats.openReports).toBe(1);
    await executeCommand(
      moderateLobbyReportCommand,
      { eventId: ev.id, reportId: c.reports[0]?.id ?? '', action: 'remove' },
      a.ctx(),
      ports,
    );
    expect((await view(ev, 0)).messages[0]?.removed).toBe(true);
  });

  it('is deleted with the other chats 24 months after the event', async () => {
    const old = await freshEvent(2, new Date(Date.UTC(2020, 0, 2)));
    await executeCommand(setLobbyEnabledCommand, { eventId: old.id, enabled: true }, a.ctx(), ports);
    await send(old, 0, 'ancient');
    await executeCommand(chatRetentionCommand, {}, systemCtx(a.org.id), ports);
    const [r] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from engagement.lobby_messages where event_id = ${old.id}`,
      ),
    );
    expect(r?.n).toBe(0);
  });
});
