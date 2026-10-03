import type { TenantTx } from '@yayatoh/db';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import {
  chatConversations,
  chatMessages,
  chatReports,
  meetings,
  networkConnections,
  networkProfiles,
  networkReports,
} from '../schema.ts';

/**
 * Data-subject requests for networking (M5.8a) and chat (M5.8b), run by engagement's data-subject
 * contributor (`data-subject.ts`, M6.1c) in the request's transaction. A person is their org
 * contacts (a networking profile is keyed by contact, one per event).
 *
 * The access document gets what the person wrote or chose to show: their profiles, the notes on
 * requests they sent, the reports they filed and the chat messages they sent. Nothing about the
 * other side (who they met is the other person's data too) and no internal ids.
 */

/** The person's profiles at every event of the org (ids for the queries below). */
async function profilesOfTx(tx: TenantTx, contactIds: readonly string[]) {
  if (contactIds.length === 0) return [];
  return tx
    .select()
    .from(networkProfiles)
    .where(inArray(networkProfiles.contactId, [...contactIds]))
    .orderBy(asc(networkProfiles.createdAt));
}

/** Chat messages the person sent: their side of direct chats (a or b) and of booth chats (a). */
const sentByProfiles = (profileIds: readonly string[]) =>
  or(
    and(
      inArray(
        chatMessages.conversationId,
        sql`(select ${chatConversations.id} from ${chatConversations} where ${inArray(chatConversations.profileA, [...profileIds])})`,
      ),
      eq(chatMessages.sender, 'a'),
    ),
    and(
      inArray(
        chatMessages.conversationId,
        sql`(select ${chatConversations.id} from ${chatConversations} where ${inArray(chatConversations.profileB, [...profileIds])})`,
      ),
      eq(chatMessages.sender, 'b'),
    ),
  );

/** Chat reports the person filed (their side of the conversation). */
const filedByProfiles = (profileIds: readonly string[]) =>
  or(
    and(
      inArray(
        chatReports.conversationId,
        sql`(select ${chatConversations.id} from ${chatConversations} where ${inArray(chatConversations.profileA, [...profileIds])})`,
      ),
      eq(chatReports.reporter, 'a'),
    ),
    and(
      inArray(
        chatReports.conversationId,
        sql`(select ${chatConversations.id} from ${chatConversations} where ${inArray(chatConversations.profileB, [...profileIds])})`,
      ),
      eq(chatReports.reporter, 'b'),
    ),
  );

/** Everything networking and chat hold that the person wrote, allowlisted (no ids, no other side). */
export async function networkingDsarTx(tx: TenantTx, contactIds: readonly string[]) {
  const profiles = await profilesOfTx(tx, contactIds);
  const ids = profiles.map((p) => p.id);
  if (ids.length === 0)
    return {
      profiles: [],
      requestNotes: [],
      meetingNotes: [],
      reports: [],
      chatMessages: [],
      chatReports: [],
    };
  const requests = await tx
    .select()
    .from(networkConnections)
    .where(and(inArray(networkConnections.requesterId, ids), sql`${networkConnections.message} is not null`))
    .orderBy(asc(networkConnections.createdAt));
  const asked = await tx
    .select()
    .from(meetings)
    .where(and(inArray(meetings.requesterId, ids), sql`${meetings.message} is not null`))
    .orderBy(asc(meetings.createdAt));
  const filed = await tx
    .select()
    .from(networkReports)
    .where(inArray(networkReports.reporterId, ids))
    .orderBy(asc(networkReports.createdAt));
  const sent = await tx
    .select()
    .from(chatMessages)
    .where(sentByProfiles(ids))
    .orderBy(asc(chatMessages.createdAt));
  const chatFiled = await tx
    .select()
    .from(chatReports)
    .where(filedByProfiles(ids))
    .orderBy(asc(chatReports.createdAt));
  return {
    profiles: profiles.map((p) => ({
      eventId: p.eventId,
      optedIn: p.optedIn,
      displayName: p.displayName,
      headline: p.headline,
      company: p.company,
      bio: p.bio,
      interests: p.interests,
      createdAt: p.createdAt,
    })),
    requestNotes: requests.map((r) => ({
      eventId: r.eventId,
      status: r.status,
      message: r.message,
      createdAt: r.createdAt,
    })),
    meetingNotes: asked.map((m) => ({
      eventId: m.eventId,
      status: m.status,
      message: m.message,
      createdAt: m.createdAt,
    })),
    reports: filed.map((r) => ({
      eventId: r.eventId,
      reason: r.reason,
      details: r.details,
      status: r.status,
      createdAt: r.createdAt,
    })),
    chatMessages: sent.map((m) => ({
      eventId: m.eventId,
      // A message an organizer removed after a report is not shown to anyone, but it is still held.
      body: m.body,
      removed: m.removedAt !== null,
      createdAt: m.createdAt,
    })),
    chatReports: chatFiled.map((r) => ({
      eventId: r.eventId,
      reason: r.reason,
      details: r.details,
      createdAt: r.createdAt,
    })),
  };
}

/**
 * Erase: the person's profiles are redacted in place and opted out (rows stay, so the other
 * side's connections, meetings, blocks and reports keep their meaning); the notes they wrote and
 * the details of reports they filed are cleared; the chat messages they sent are deleted (nothing
 * depends on a message; the conversation and the other side's messages stay).
 */
export async function eraseNetworkingDsarTx(tx: TenantTx, contactIds: readonly string[]) {
  const profiles = await profilesOfTx(tx, contactIds);
  const ids = profiles.map((p) => p.id);
  if (ids.length === 0)
    return {
      profiles: 0,
      notes: 0,
      connections: 0,
      meetings: 0,
      reports: 0,
      chatReports: 0,
      chatMessages: 0,
    };
  await tx
    .update(networkProfiles)
    .set({
      optedIn: false,
      optedInAt: null,
      displayName: 'Erased',
      headline: null,
      company: null,
      bio: null,
      interests: [],
    })
    .where(inArray(networkProfiles.id, ids));
  const connections = await tx
    .update(networkConnections)
    .set({ message: null })
    .where(and(inArray(networkConnections.requesterId, ids), sql`${networkConnections.message} is not null`))
    .returning({ id: networkConnections.id });
  const asked = await tx
    .update(meetings)
    .set({ message: null })
    .where(and(inArray(meetings.requesterId, ids), sql`${meetings.message} is not null`))
    .returning({ id: meetings.id });
  const filed = await tx
    .update(networkReports)
    .set({ details: null })
    .where(and(inArray(networkReports.reporterId, ids), sql`${networkReports.details} is not null`))
    .returning({ id: networkReports.id });
  const chatFiled = await tx
    .update(chatReports)
    .set({ details: null })
    .where(and(filedByProfiles(ids), sql`${chatReports.details} is not null`))
    .returning({ id: chatReports.id });
  const notes = connections.length + asked.length + filed.length + chatFiled.length;
  const deleted = await tx.delete(chatMessages).where(sentByProfiles(ids)).returning({ id: chatMessages.id });
  return {
    profiles: ids.length,
    notes,
    connections: connections.length,
    meetings: asked.length,
    reports: filed.length,
    chatReports: chatFiled.length,
    chatMessages: deleted.length,
  };
}
