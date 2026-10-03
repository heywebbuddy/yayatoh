import { addGuestCommand } from '@yayatoh/attendees';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  chatThreadQuery,
  directoryQuery,
  optInCommand,
  reportPersonCommand,
  requestConnectionCommand,
  respondConnectionCommand,
  sendChatMessageCommand,
  updateNetworkSettingsCommand,
} from '@yayatoh/engagement';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { findSubjectQuery } from '@yayatoh/privacy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eraseNow, exportNow } from '../src/dsar/helpers.ts';
import { type OrgFixture, systemCtx, twoOrgs } from '../src/index.ts';
import { ports } from '../src/ports.ts';

/**
 * Batch 3j merge: the M5.8a privacy gap. Networking profiles, request notes, reports and chat
 * messages (M5.8a/b) were in neither the access document nor erasure. Batch 3u merge: they are part
 * of engagement's data-subject contributor (M6.1c), so a data-subject request finds, exports and
 * erases them, and only the person's own writing (never the other side's).
 */
let a: OrgFixture;
let b: OrgFixture;
const pub = (): Ctx => createCtx({ orgId: a.org.id });
const tag = uuidv7().slice(-8);
const email = (i: number) => `netdsar-${tag}-${i}@example.test`;
let eventId = '';
const ids: string[] = [];

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const startsAt = new Date(Date.UTC(2027, 10, 4, 15));
  const ev = await executeCommand(
    createEventCommand,
    {
      name: `Net DSAR ${tag}`,
      slug: `net-dsar-${tag}`,
      profile: 'conference',
      timezone: 'America/Chicago',
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 8 * 3_600_000).toISOString(),
    },
    a.ctx(),
    ports,
  );
  eventId = ev.id;
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  await executeCommand(
    updateNetworkSettingsCommand,
    { eventId, enabled: true, meetingsEnabled: true },
    a.ctx(),
    ports,
  );
  for (const i of [0, 1, 2]) {
    await executeCommand(
      addGuestCommand,
      { eventId, name: `Guest ${i} ${tag}`, email: email(i) },
      a.ctx(),
      ports,
    );
    await executeCommand(
      optInCommand,
      {
        eventId,
        email: email(i),
        displayName: `Person ${i} ${tag}`,
        company: `Company ${i} ${tag}`,
        headline: `Headline ${i} ${tag}`,
        bio: `Bio of person ${i} ${tag}`,
        interests: 'sailing, chess',
        consent: true,
      },
      pub(),
      ports,
    );
  }
  const rows = await withTenant(systemCtx(a.org.id), (tx) =>
    tx.execute<{ id: string; name: string }>(
      sql`select id, display_name as name from engagement.network_profiles where event_id = ${eventId}`,
    ),
  );
  for (const i of [0, 1, 2]) ids.push(rows.find((r) => r.name === `Person ${i} ${tag}`)?.id ?? '');
  // Person 0 asks Person 1 with a note; Person 1 accepts; they chat both ways.
  const req = await executeCommand(
    requestConnectionCommand,
    { eventId, email: email(0), personId: ids[1] ?? '', message: `Note from 0 ${tag}` },
    pub(),
    ports,
  );
  await executeCommand(
    respondConnectionCommand,
    { eventId, email: email(1), connectionId: req.id, accept: true },
    pub(),
    ports,
  );
  await executeCommand(
    sendChatMessageCommand,
    { eventId, email: email(0), personId: ids[1] ?? '', body: `Message from 0 ${tag}` },
    pub(),
    ports,
  );
  await executeCommand(
    sendChatMessageCommand,
    { eventId, email: email(1), personId: ids[0] ?? '', body: `Reply from 1 ${tag}` },
    pub(),
    ports,
  );
  // Person 0 reports Person 2 with details.
  await executeCommand(
    reportPersonCommand,
    { eventId, email: email(0), personId: ids[2] ?? '', reason: 'spam', details: `Report by 0 ${tag}` },
    pub(),
    ports,
  );
});
afterAll(closePools);

async function exportDoc(address: string) {
  const { modules } = await exportNow(address, a.ctx());
  const networking = (modules.engagement ?? {}) as Record<string, unknown[]>;
  return { text: JSON.stringify(networking), doc: { networking } };
}

/** What a data-subject export of the address holds in engagement's networking sections. */
async function networkingCounts(address: string, org = a) {
  const { modules } = await exportNow(address, org.ctx());
  const doc = (modules.engagement ?? {}) as Record<string, unknown[] | undefined>;
  return { networkProfiles: doc.profiles?.length ?? 0, chatMessages: doc.chatMessages?.length ?? 0 };
}

describe('data-subject requests cover networking and chat (M5.8a privacy gap)', () => {
  it('finding a person counts their networking profile and the chat messages they sent', async () => {
    const r = await executeQuery(findSubjectQuery, { email: email(0) }, a.ctx(), ports);
    // The profile, the request note, the report and the message they sent.
    expect(r.summary.engagement).toBe(4);
    expect(await networkingCounts(email(0))).toEqual({ networkProfiles: 1, chatMessages: 1 });
    // Another org holds nothing networking about this address.
    const other = await executeQuery(findSubjectQuery, { email: email(0) }, b.ctx(), ports);
    expect(other.summary.engagement ?? 0).toBe(0);
    expect(await networkingCounts(email(0), b)).toEqual({ networkProfiles: 0, chatMessages: 0 });
  });

  it('the access document lists what the person wrote, never the other side or internal ids', async () => {
    const { text, doc } = await exportDoc(email(0));
    expect(doc.networking.profiles).toEqual([
      expect.objectContaining({
        eventId,
        optedIn: true,
        displayName: `Person 0 ${tag}`,
        company: `Company 0 ${tag}`,
        headline: `Headline 0 ${tag}`,
        bio: `Bio of person 0 ${tag}`,
        interests: ['sailing', 'chess'],
      }),
    ]);
    expect(doc.networking.requestNotes).toEqual([expect.objectContaining({ message: `Note from 0 ${tag}` })]);
    expect(doc.networking.reports).toEqual([
      expect.objectContaining({ reason: 'spam', details: `Report by 0 ${tag}` }),
    ]);
    expect(doc.networking.chatMessages).toEqual([
      expect.objectContaining({ body: `Message from 0 ${tag}`, removed: false }),
    ]);
    // The other people's profiles and messages are theirs: not in this person's document.
    expect(text).not.toContain(`Reply from 1 ${tag}`);
    expect(text).not.toContain(`Bio of person 1 ${tag}`);
    expect(text).not.toContain(`Person 2 ${tag}`);
    for (const id of ids) expect(text).not.toContain(id);
  });

  it('erasure redacts and opts out the profile, clears the notes and deletes only their messages', async () => {
    const r = await eraseNow(email(0), a.ctx());
    const rows = (table: string) => r.receipt.erased.find((e) => e.table === table)?.rows ?? 0;
    expect(rows('engagement.network_profiles')).toBe(1);
    expect(rows('engagement.chat_messages')).toBe(1);
    // The request note and the report's details.
    expect(rows('engagement.network_connections') + rows('engagement.network_reports')).toBe(2);
    const [p] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<Record<string, unknown>>(
        sql`select opted_in, display_name, headline, company, bio, interests from engagement.network_profiles where id = ${ids[0]}`,
      ),
    );
    expect(p).toEqual({
      opted_in: false,
      display_name: 'Erased',
      headline: null,
      company: null,
      bio: null,
      interests: [],
    });
    const left = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ body: string }>(sql`select m.body from engagement.chat_messages m
        join engagement.chat_conversations c on c.id = m.conversation_id where c.event_id = ${eventId}`),
    );
    expect(left.map((m) => m.body)).toEqual([`Reply from 1 ${tag}`]);
    const notes = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ message: string | null; details: string | null }>(sql`select
        (select message from engagement.network_connections where requester_id = ${ids[0]}) as message,
        (select details from engagement.network_reports where reporter_id = ${ids[0]}) as details`),
    );
    expect(notes[0]).toEqual({ message: null, details: null });
    // The others no longer see the person in the directory; the other side's thread keeps its reply.
    const dir = await executeQuery(directoryQuery, { eventId, email: email(1) }, pub(), ports);
    expect(JSON.stringify(dir)).not.toContain(`Person 0 ${tag}`);
    const thread = await executeQuery(
      chatThreadQuery,
      { eventId, email: email(1), personId: ids[0] ?? '' },
      pub(),
      ports,
    ).catch(() => null);
    expect(JSON.stringify(thread ?? {})).not.toContain(`Message from 0 ${tag}`);
    // Finding the person again: nothing networking left to export.
    expect((await networkingCounts(email(0))).chatMessages).toBe(0);
  });
});
