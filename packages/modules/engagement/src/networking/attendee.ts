import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, desc, eq, gt, inArray, ne, notInArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  DIRECTORY_PAGE,
  escapeLike,
  freeTable,
  MAX_PENDING_REQUESTS,
  normalizeInterests,
} from '../domain/networking.ts';
import {
  meetingLocations,
  meetingSlots,
  meetings,
  networkBlocks,
  networkConnections,
  networkProfiles,
  networkReports,
  REPORT_REASONS,
} from '../schema.ts';
import {
  BlockedDto,
  type ConnectionDto,
  DirectoryDto,
  type MeetingDto,
  MeetingDto as MeetingOut,
  MyConnectionsDto,
  MyMeetingsDto,
  type MyProfileDto,
  NetworkHomeDto,
  PersonDetailDto,
  type PersonDto,
} from './dto.ts';
import {
  activeProfilesTx,
  blockedWithTx,
  leaveNetworkTx,
  listed,
  memberOf,
  type ProfileRow,
  personRef,
  severTx,
  type Viewer,
  viewerTx,
  visiblePersonTx,
} from './state.ts';

/**
 * Networking as an attendee does it (M5.8a): opt in, browse and search the people of the event
 * who also opted in, ask to connect, request meetings at a slot and location, block and report.
 * Open to anyone (`public:networking`) because attendees are not org members: every command
 * resolves the viewer from the address the web app verified (an emailed code, M1.5f) and their
 * active place at the event, and refuses everything else.
 */
const Email = z.email().max(254);
const At = { eventId: z.uuid(), email: Email };
const Optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .default(null);

const invalid = (field: string, reason: string) =>
  new DomainError('validation_failed', `Invalid ${field}`, { field, reason });
const refused = (reason: string, message = reason) => new DomainError('invalid_state', message, { reason });

const toMine = (p: ProfileRow): MyProfileDto => ({
  optedIn: p.optedIn,
  hidden: p.hiddenAt !== null,
  displayName: p.displayName,
  headline: p.headline,
  company: p.company,
  bio: p.bio,
  interests: p.interests,
});

/** The relation of `me` to each of `ids`: pending either way or connected, with the row id. */
async function relationsTx(tx: TenantTx, me: string, ids: readonly string[]) {
  const out = new Map<string, { connection: PersonDto['connection']; id: string }>();
  if (ids.length === 0) return out;
  const rows = await tx
    .select()
    .from(networkConnections)
    .where(
      and(
        inArray(networkConnections.status, ['pending', 'accepted']),
        or(
          and(eq(networkConnections.requesterId, me), inArray(networkConnections.addresseeId, [...ids])),
          and(eq(networkConnections.addresseeId, me), inArray(networkConnections.requesterId, [...ids])),
        ),
      ),
    );
  for (const r of rows) {
    const other = r.requesterId === me ? r.addresseeId : r.requesterId;
    out.set(other, {
      id: r.id,
      connection: r.status === 'accepted' ? 'connected' : r.requesterId === me ? 'pending_out' : 'pending_in',
    });
  }
  return out;
}

const toPerson = (p: ProfileRow, rel?: { connection: PersonDto['connection'] }): PersonDto => ({
  id: p.id,
  displayName: p.displayName,
  headline: p.headline,
  company: p.company,
  interests: p.interests,
  connection: rel?.connection ?? 'none',
});

/* ------------------------------------------------------------------------------ profile ---- */

export const networkHomeQuery = tenantQuery({
  name: 'engagement.networkHome',
  input: z.object(At),
  output: NetworkHomeDto,
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, tx }) => {
    const v = await viewerTx(tx, input.eventId, input.email);
    return {
      eventName: v.ev.name,
      timeZone: v.ev.timezone,
      meetingsEnabled: v.settings.meetingsEnabled,
      attendeeName: v.attendeeName,
      profile: v.profile ? toMine(v.profile) : null,
    };
  },
});

const ProfileFields = {
  displayName: z.string().trim().min(1).max(80),
  headline: Optional(80),
  company: Optional(80),
  bio: Optional(500),
  /** Comma- or line-separated. */
  interests: z.string().max(1000).default(''),
};

export const OptInInput = z.object({
  ...At,
  ...ProfileFields,
  /** The attendee ticked "show my profile to other attendees who also opted in". */
  consent: z.literal(true, { error: 'consent' }),
});

/**
 * Opt in (networking is off for everyone until they do): creates or updates the profile and lists
 * it. Refused while the organizer has hidden it.
 */
export const optInCommand = tenantCommand({
  name: 'engagement.optIn',
  input: OptInInput,
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, ctx, tx }) => {
    const v = await viewerTx(tx, input.eventId, input.email, true);
    if (v.profile?.hiddenAt) throw refused('hidden', 'Your profile is hidden');
    const fields = {
      displayName: input.displayName,
      headline: input.headline,
      company: input.company,
      bio: input.bio,
      interests: normalizeInterests(input.interests),
    };
    if (v.profile)
      await tx
        .update(networkProfiles)
        .set({ ...fields, optedIn: true, optedInAt: ctx.now, updatedAt: ctx.now })
        .where(eq(networkProfiles.id, v.profile.id));
    else
      await tx.insert(networkProfiles).values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        contactId: v.contactId,
        ...fields,
        optedIn: true,
        optedInAt: ctx.now,
      });
    return { ok: true as const };
  },
  audit: (input) => ({ action: 'engagement.network.opt_in', targetType: 'event', targetId: input.eventId }),
});

export const UpdateProfileInput = z.object({ ...At, ...ProfileFields });

export const updateProfileCommand = tenantCommand({
  name: 'engagement.updateNetworkProfile',
  input: UpdateProfileInput,
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, ctx, tx }) => {
    const me = memberOf(await viewerTx(tx, input.eventId, input.email, true));
    await tx
      .update(networkProfiles)
      .set({
        displayName: input.displayName,
        headline: input.headline,
        company: input.company,
        bio: input.bio,
        interests: normalizeInterests(input.interests),
        updatedAt: ctx.now,
      })
      .where(eq(networkProfiles.id, me.id));
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'engagement.network.profile_update',
    targetType: 'event',
    targetId: input.eventId,
  }),
});

/** Leave the directory: hidden from everyone at once; pending requests and meetings ahead end. */
export const optOutCommand = tenantCommand({
  name: 'engagement.optOut',
  input: z.object(At),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, ctx, tx }) => {
    const v = await viewerTx(tx, input.eventId, input.email, true);
    if (!v.profile?.optedIn) return { ok: true as const };
    await tx
      .update(networkProfiles)
      .set({ optedIn: false, updatedAt: ctx.now })
      .where(eq(networkProfiles.id, v.profile.id));
    await leaveNetworkTx(tx, ctx, v.profile.id);
    return { ok: true as const };
  },
  audit: (input) => ({ action: 'engagement.network.opt_out', targetType: 'event', targetId: input.eventId }),
});

/* ---------------------------------------------------------------------------- directory ---- */

/** Listed, attending people the viewer may see (no block either way), optionally matching `q`. */
async function directoryRowsTx(tx: TenantTx, me: ProfileRow, q: string | null): Promise<ProfileRow[]> {
  const hidden = [...(await blockedWithTx(tx, me.id)), me.id];
  const like = q ? `%${escapeLike(q)}%` : null;
  const rows = await tx
    .select()
    .from(networkProfiles)
    .where(
      and(
        eq(networkProfiles.eventId, me.eventId),
        eq(networkProfiles.optedIn, true),
        sql`${networkProfiles.hiddenAt} is null`,
        notInArray(networkProfiles.id, hidden),
        like
          ? sql`(${networkProfiles.displayName} ilike ${like} escape '\\'
              or ${networkProfiles.headline} ilike ${like} escape '\\'
              or ${networkProfiles.company} ilike ${like} escape '\\'
              or array_to_string(${networkProfiles.interests}, ' ') ilike ${like} escape '\\')`
          : undefined,
      ),
    )
    .orderBy(sql`lower(${networkProfiles.displayName})`, asc(networkProfiles.id));
  return activeProfilesTx(tx, me.eventId, rows);
}

export const DirectoryInput = z.object({
  ...At,
  q: z.string().trim().max(80).default(''),
  page: z.int().min(1).max(1000).default(1),
});

/** The event's directory: only people who opted in, and only for people who opted in too. */
export const directoryQuery = tenantQuery({
  name: 'engagement.directory',
  input: DirectoryInput,
  output: DirectoryDto,
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, tx }) => {
    const me = memberOf(await viewerTx(tx, input.eventId, input.email));
    const all = await directoryRowsTx(tx, me, input.q || null);
    const pages = Math.max(1, Math.ceil(all.length / DIRECTORY_PAGE));
    const page = Math.min(input.page, pages);
    const slice = all.slice((page - 1) * DIRECTORY_PAGE, page * DIRECTORY_PAGE);
    const rel = await relationsTx(
      tx,
      me.id,
      slice.map((p) => p.id),
    );
    return { people: slice.map((p) => toPerson(p, rel.get(p.id))), total: all.length, page, pages };
  },
});

export const personQuery = tenantQuery({
  name: 'engagement.networkPerson',
  input: z.object({ ...At, personId: z.uuid() }),
  output: PersonDetailDto,
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, tx }) => {
    const me = memberOf(await viewerTx(tx, input.eventId, input.email));
    const p = await visiblePersonTx(tx, me, input.personId);
    const rel = (await relationsTx(tx, me.id, [p.id])).get(p.id);
    return {
      ...toPerson(p, rel),
      bio: p.bio,
      connectionId: rel && rel.connection !== 'connected' ? rel.id : null,
    };
  },
});

/* -------------------------------------------------------------------------- connections ---- */

export const RequestConnectionInput = z.object({ ...At, personId: z.uuid(), message: Optional(300) });

/**
 * Ask to connect. One row per pair: a request the other side already sent is accepted instead;
 * after a decline, the person who was declined cannot ask again.
 */
export const requestConnectionCommand = tenantCommand({
  name: 'engagement.requestConnection',
  input: RequestConnectionInput,
  output: z.object({ id: z.uuid(), status: z.enum(['pending', 'accepted']) }),
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, ctx, tx, emit }) => {
    const me = memberOf(await viewerTx(tx, input.eventId, input.email, true));
    const other = await visiblePersonTx(tx, me, input.personId);
    const [row] = await tx
      .select()
      .from(networkConnections)
      .where(
        sql`least(${networkConnections.requesterId}, ${networkConnections.addresseeId}) = least(${me.id}::uuid, ${other.id}::uuid)
        and greatest(${networkConnections.requesterId}, ${networkConnections.addresseeId}) = greatest(${me.id}::uuid, ${other.id}::uuid)`,
      )
      .for('update');
    if (row?.status === 'accepted')
      throw new DomainError('conflict', 'Already connected', { reason: 'connected' });
    if (row?.status === 'pending' && row.requesterId === me.id)
      throw new DomainError('conflict', 'Already asked', { reason: 'already_requested' });
    if (row?.status === 'pending') {
      // They asked first: asking back accepts.
      await tx
        .update(networkConnections)
        .set({ status: 'accepted', respondedAt: ctx.now, updatedAt: ctx.now })
        .where(eq(networkConnections.id, row.id));
      emitConnected(emit, input.eventId, row.id);
      return { id: row.id, status: 'accepted' as const };
    }
    if (row?.status === 'declined' && row.requesterId === me.id) throw refused('declined');
    const [n] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(networkConnections)
      .where(and(eq(networkConnections.requesterId, me.id), eq(networkConnections.status, 'pending')));
    if ((n?.n ?? 0) >= MAX_PENDING_REQUESTS) throw refused('too_many');
    if (row) {
      await tx
        .update(networkConnections)
        .set({
          requesterId: me.id,
          addresseeId: other.id,
          status: 'pending',
          message: input.message,
          respondedAt: null,
          updatedAt: ctx.now,
        })
        .where(eq(networkConnections.id, row.id));
      return { id: row.id, status: 'pending' as const };
    }
    const [created] = await tx
      .insert(networkConnections)
      .values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        requesterId: me.id,
        addresseeId: other.id,
        message: input.message,
      })
      .returning({ id: networkConnections.id });
    if (!created) throw new DomainError('internal');
    return { id: created.id, status: 'pending' as const };
  },
  audit: (input, r) => ({
    action: 'engagement.network.connection_request',
    targetType: 'network_connection',
    targetId: r.id,
    data: { eventId: input.eventId, status: r.status },
  }),
});

function emitConnected(emit: (e: DomainEvent) => void, eventId: string, connectionId: string) {
  emit({
    type: 'engagement.connection_accepted',
    version: 1,
    aggregateType: 'network_connection',
    aggregateId: connectionId,
    payload: { eventId, connectionId },
  });
}

/** A connection row the viewer is part of, locked. */
async function connectionFor(tx: TenantTx, me: ProfileRow, id: string) {
  const [row] = await tx
    .select()
    .from(networkConnections)
    .where(
      and(
        eq(networkConnections.id, id),
        eq(networkConnections.eventId, me.eventId),
        or(eq(networkConnections.requesterId, me.id), eq(networkConnections.addresseeId, me.id)),
      ),
    )
    .for('update');
  if (!row) throw new DomainError('not_found');
  return row;
}

export const respondConnectionCommand = tenantCommand({
  name: 'engagement.respondConnection',
  input: z.object({ ...At, connectionId: z.uuid(), accept: z.boolean() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, ctx, tx, emit }) => {
    const me = memberOf(await viewerTx(tx, input.eventId, input.email, true));
    const row = await connectionFor(tx, me, input.connectionId);
    if (row.addresseeId !== me.id || row.status !== 'pending') throw refused('not_pending');
    if (input.accept) await visiblePersonTx(tx, me, row.requesterId);
    await tx
      .update(networkConnections)
      .set({ status: input.accept ? 'accepted' : 'declined', respondedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(networkConnections.id, row.id));
    if (input.accept) emitConnected(emit, input.eventId, row.id);
    return { ok: true as const };
  },
  audit: (input) => ({
    action: input.accept ? 'engagement.network.connection_accept' : 'engagement.network.connection_decline',
    targetType: 'network_connection',
    targetId: input.connectionId,
  }),
});

/** Withdraw a request you sent, or remove a connection (either side). */
export const withdrawConnectionCommand = tenantCommand({
  name: 'engagement.withdrawConnection',
  input: z.object({ ...At, connectionId: z.uuid() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, ctx, tx }) => {
    const me = memberOf(await viewerTx(tx, input.eventId, input.email, true));
    const row = await connectionFor(tx, me, input.connectionId);
    const mine = row.status === 'pending' && row.requesterId === me.id;
    if (!mine && row.status !== 'accepted') throw refused('not_pending');
    await tx
      .update(networkConnections)
      .set({ status: 'withdrawn', respondedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(networkConnections.id, row.id));
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'engagement.network.connection_withdraw',
    targetType: 'network_connection',
    targetId: input.connectionId,
  }),
});

/** People on the other end, listed, attending and not blocked: everyone else is left out. */
async function othersTx(tx: TenantTx, me: ProfileRow, ids: readonly string[]) {
  if (ids.length === 0) return new Map<string, ProfileRow>();
  const rows = await tx
    .select()
    .from(networkProfiles)
    .where(inArray(networkProfiles.id, [...new Set(ids)]));
  const blocked = await blockedWithTx(tx, me.id);
  const ok = await activeProfilesTx(
    tx,
    me.eventId,
    rows.filter((r) => listed(r) && !blocked.has(r.id)),
  );
  return new Map(ok.map((r) => [r.id, r]));
}

export const myConnectionsQuery = tenantQuery({
  name: 'engagement.myConnections',
  input: z.object(At),
  output: MyConnectionsDto,
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, tx }) => {
    const me = memberOf(await viewerTx(tx, input.eventId, input.email));
    const rows = await tx
      .select()
      .from(networkConnections)
      .where(
        and(
          inArray(networkConnections.status, ['pending', 'accepted']),
          or(eq(networkConnections.requesterId, me.id), eq(networkConnections.addresseeId, me.id)),
        ),
      )
      .orderBy(desc(networkConnections.updatedAt));
    const other = (r: (typeof rows)[number]) => (r.requesterId === me.id ? r.addresseeId : r.requesterId);
    const people = await othersTx(tx, me, rows.map(other));
    const out: ConnectionDto[] = [];
    for (const r of rows) {
      const p = people.get(other(r));
      if (!p) continue;
      out.push({
        id: r.id,
        direction: r.requesterId === me.id ? 'outgoing' : 'incoming',
        status: r.status as ConnectionDto['status'],
        message: r.message,
        person: personRef(p),
        createdAt: r.createdAt,
      });
    }
    return {
      incoming: out.filter((c) => c.status === 'pending' && c.direction === 'incoming'),
      outgoing: out.filter((c) => c.status === 'pending' && c.direction === 'outgoing'),
      connected: out
        .filter((c) => c.status === 'accepted')
        .sort((a, b) => a.person.displayName.localeCompare(b.person.displayName)),
    };
  },
});

/* ----------------------------------------------------------------------------- meetings ---- */

function meetingsOn(v: Viewer) {
  if (!v.settings.meetingsEnabled) throw refused('meetings_off', 'Meetings are off');
}

/** Whether a profile already has an accepted meeting in a slot. */
async function busyTx(tx: TenantTx, profileId: string, slotId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: meetings.id })
    .from(meetings)
    .where(
      and(
        eq(meetings.slotId, slotId),
        eq(meetings.status, 'accepted'),
        or(eq(meetings.requesterId, profileId), eq(meetings.inviteeId, profileId)),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function tablesTakenTx(tx: TenantTx, locationId: string, slotId: string): Promise<number[]> {
  const rows = await tx
    .select({ t: meetings.tableNo })
    .from(meetings)
    .where(
      and(eq(meetings.locationId, locationId), eq(meetings.slotId, slotId), eq(meetings.status, 'accepted')),
    );
  return rows.map((r) => r.t ?? 0);
}

async function slotAheadTx(tx: TenantTx, ctx: Ctx, eventId: string, slotId: string) {
  const [slot] = await tx
    .select()
    .from(meetingSlots)
    .where(and(eq(meetingSlots.id, slotId), eq(meetingSlots.eventId, eventId)));
  if (!slot) throw invalid('slotId', 'unknown');
  if (slot.startsAt <= ctx.now) throw invalid('slotId', 'past');
  return slot;
}

async function locationTx(tx: TenantTx, eventId: string, locationId: string, lock = false) {
  const q = tx
    .select()
    .from(meetingLocations)
    .where(and(eq(meetingLocations.id, locationId), eq(meetingLocations.eventId, eventId)));
  const [loc] = await (lock ? q.for('update') : q);
  if (!loc) throw invalid('locationId', 'unknown');
  return loc;
}

export const RequestMeetingInput = z.object({
  ...At,
  personId: z.uuid(),
  slotId: z.uuid(),
  locationId: z.uuid(),
  message: Optional(300),
});

/**
 * Ask someone to meet at a slot and location. Refused when the location is already full for that
 * slot, when either person already has a meeting then, or for the same pair and slot twice.
 */
export const requestMeetingCommand = tenantCommand({
  name: 'engagement.requestMeeting',
  input: RequestMeetingInput,
  output: z.object({ id: z.uuid() }),
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, ctx, tx }) => {
    const v = await viewerTx(tx, input.eventId, input.email, true);
    const me = memberOf(v);
    meetingsOn(v);
    const other = await visiblePersonTx(tx, me, input.personId);
    const slot = await slotAheadTx(tx, ctx, input.eventId, input.slotId);
    const loc = await locationTx(tx, input.eventId, input.locationId);
    if (freeTable(loc.capacity, await tablesTakenTx(tx, loc.id, slot.id)) === null)
      throw refused('location_full');
    if (await busyTx(tx, me.id, slot.id)) throw refused('busy');
    if (await busyTx(tx, other.id, slot.id)) throw refused('person_busy');
    const [dupe] = await tx
      .select({ id: meetings.id })
      .from(meetings)
      .where(
        and(
          eq(meetings.slotId, slot.id),
          eq(meetings.status, 'pending'),
          or(
            and(eq(meetings.requesterId, me.id), eq(meetings.inviteeId, other.id)),
            and(eq(meetings.requesterId, other.id), eq(meetings.inviteeId, me.id)),
          ),
        ),
      )
      .limit(1);
    if (dupe) throw new DomainError('conflict', 'Already asked', { reason: 'already_requested' });
    const [n] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(meetings)
      .where(and(eq(meetings.requesterId, me.id), eq(meetings.status, 'pending')));
    if ((n?.n ?? 0) >= MAX_PENDING_REQUESTS) throw refused('too_many');
    const [row] = await tx
      .insert(meetings)
      .values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        slotId: slot.id,
        locationId: loc.id,
        requesterId: me.id,
        inviteeId: other.id,
        message: input.message,
      })
      .returning({ id: meetings.id });
    if (!row) throw new DomainError('internal');
    return { id: row.id };
  },
  audit: (input, r) => ({
    action: 'engagement.network.meeting_request',
    targetType: 'meeting',
    targetId: r.id,
    data: { eventId: input.eventId, slotId: input.slotId, locationId: input.locationId },
  }),
});

async function meetingFor(tx: TenantTx, me: ProfileRow, id: string) {
  const [row] = await tx
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.id, id),
        eq(meetings.eventId, me.eventId),
        or(eq(meetings.requesterId, me.id), eq(meetings.inviteeId, me.id)),
      ),
    )
    .for('update');
  if (!row) throw new DomainError('not_found');
  return row;
}

/**
 * Accept or decline a meeting you were asked to. Accepting takes the lowest free table at the
 * location for that slot, holding the location row (and both people's profiles, in id order) so
 * concurrent acceptances queue: a location never holds more meetings than its capacity, and the
 * partial unique key on (location, slot, table) refuses a double booking even so.
 */
export const respondMeetingCommand = tenantCommand({
  name: 'engagement.respondMeeting',
  input: z.object({ ...At, meetingId: z.uuid(), accept: z.boolean() }),
  output: z.object({ ok: z.literal(true), tableNo: z.int().nullable() }),
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, ctx, tx, emit }) => {
    const v = await viewerTx(tx, input.eventId, input.email);
    const me = memberOf(v);
    const m = await meetingFor(tx, me, input.meetingId);
    if (m.inviteeId !== me.id || m.status !== 'pending') throw refused('not_pending');
    if (!input.accept) {
      await tx
        .update(meetings)
        .set({ status: 'declined', respondedAt: ctx.now, updatedAt: ctx.now })
        .where(eq(meetings.id, m.id));
      return { ok: true as const, tableNo: null };
    }
    meetingsOn(v);
    const loc = await locationTx(tx, m.eventId, m.locationId, true);
    await tx
      .select({ id: networkProfiles.id })
      .from(networkProfiles)
      .where(inArray(networkProfiles.id, [m.requesterId, m.inviteeId].sort()))
      .orderBy(asc(networkProfiles.id))
      .for('update');
    await visiblePersonTx(tx, me, m.requesterId);
    const slot = await slotAheadTx(tx, ctx, m.eventId, m.slotId);
    if (await busyTx(tx, me.id, slot.id)) throw refused('busy');
    if (await busyTx(tx, m.requesterId, slot.id)) throw refused('person_busy');
    const table = freeTable(loc.capacity, await tablesTakenTx(tx, loc.id, slot.id));
    if (table === null) throw refused('location_full');
    await tx
      .update(meetings)
      .set({ status: 'accepted', tableNo: table, respondedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(meetings.id, m.id));
    emit({
      type: 'engagement.meeting_accepted',
      version: 1,
      aggregateType: 'meeting',
      aggregateId: m.id,
      payload: { eventId: m.eventId, meetingId: m.id, slotId: m.slotId, locationId: m.locationId },
    });
    return { ok: true as const, tableNo: table };
  },
  audit: (input, r) => ({
    action: input.accept ? 'engagement.network.meeting_accept' : 'engagement.network.meeting_decline',
    targetType: 'meeting',
    targetId: input.meetingId,
    data: { tableNo: r.tableNo },
  }),
});

/** Cancel a meeting: the requester while it waits, either person once accepted (frees the table). */
export const cancelMeetingCommand = tenantCommand({
  name: 'engagement.cancelMeeting',
  input: z.object({ ...At, meetingId: z.uuid() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, ctx, tx }) => {
    const me = memberOf(await viewerTx(tx, input.eventId, input.email));
    const m = await meetingFor(tx, me, input.meetingId);
    const ok = (m.status === 'pending' && m.requesterId === me.id) || m.status === 'accepted';
    if (!ok) throw refused('not_pending');
    await tx
      .update(meetings)
      .set({ status: 'cancelled', tableNo: null, respondedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(meetings.id, m.id));
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'engagement.network.meeting_cancel',
    targetType: 'meeting',
    targetId: input.meetingId,
  }),
});

async function meetingDtosTx(tx: TenantTx, me: ProfileRow, rows: (typeof meetings.$inferSelect)[]) {
  if (rows.length === 0) return [];
  const other = (r: (typeof rows)[number]) => (r.requesterId === me.id ? r.inviteeId : r.requesterId);
  const people = await othersTx(tx, me, rows.map(other));
  const slots = new Map(
    (
      await tx
        .select()
        .from(meetingSlots)
        .where(inArray(meetingSlots.id, [...new Set(rows.map((r) => r.slotId))]))
    ).map((s) => [s.id, s]),
  );
  const locs = new Map(
    (
      await tx
        .select()
        .from(meetingLocations)
        .where(inArray(meetingLocations.id, [...new Set(rows.map((r) => r.locationId))]))
    ).map((l) => [l.id, l]),
  );
  const out: MeetingDto[] = [];
  for (const r of rows) {
    const p = people.get(other(r));
    const s = slots.get(r.slotId);
    const l = locs.get(r.locationId);
    if (!p || !s || !l) continue;
    out.push({
      id: r.id,
      direction: r.requesterId === me.id ? 'outgoing' : 'incoming',
      status: r.status as MeetingDto['status'],
      message: r.message,
      person: personRef(p),
      slot: { id: s.id, startsAt: s.startsAt, endsAt: s.endsAt },
      location: { id: l.id, name: l.name, kind: l.kind as MeetingDto['location']['kind'] },
      tableNo: r.tableNo,
      createdAt: r.createdAt,
    });
  }
  return out.sort((a, b) => a.slot.startsAt.getTime() - b.slot.startsAt.getTime());
}

export const myMeetingsQuery = tenantQuery({
  name: 'engagement.myMeetings',
  input: z.object(At),
  output: MyMeetingsDto,
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, ctx, tx }) => {
    const v = await viewerTx(tx, input.eventId, input.email);
    const me = memberOf(v);
    const ahead = tx
      .select({ id: meetingSlots.id })
      .from(meetingSlots)
      .where(gt(meetingSlots.startsAt, ctx.now));
    const rows = await tx
      .select()
      .from(meetings)
      .where(
        and(
          inArray(meetings.status, ['pending', 'accepted']),
          inArray(meetings.slotId, ahead),
          or(eq(meetings.requesterId, me.id), eq(meetings.inviteeId, me.id)),
        ),
      );
    const list = await meetingDtosTx(tx, me, rows);
    const slots = v.settings.meetingsEnabled
      ? await tx
          .select({ id: meetingSlots.id, startsAt: meetingSlots.startsAt, endsAt: meetingSlots.endsAt })
          .from(meetingSlots)
          .where(and(eq(meetingSlots.eventId, input.eventId), gt(meetingSlots.startsAt, ctx.now)))
          .orderBy(asc(meetingSlots.startsAt))
      : [];
    const locations = v.settings.meetingsEnabled
      ? (
          await tx
            .select({ id: meetingLocations.id, name: meetingLocations.name, kind: meetingLocations.kind })
            .from(meetingLocations)
            .where(eq(meetingLocations.eventId, input.eventId))
            .orderBy(sql`lower(${meetingLocations.name})`)
        ).map((l) => ({ ...l, kind: l.kind as MeetingDto['location']['kind'] }))
      : [];
    return {
      incoming: list.filter((m) => m.status === 'pending' && m.direction === 'incoming'),
      outgoing: list.filter((m) => m.status === 'pending' && m.direction === 'outgoing'),
      upcoming: list.filter((m) => m.status === 'accepted'),
      slots,
      locations,
    };
  },
});

/** One accepted meeting of the viewer (for its calendar file). */
export const myMeetingQuery = tenantQuery({
  name: 'engagement.myMeeting',
  input: z.object({ ...At, meetingId: z.uuid() }),
  output: MeetingOut,
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, tx }) => {
    const me = memberOf(await viewerTx(tx, input.eventId, input.email));
    const rows = await tx
      .select()
      .from(meetings)
      .where(
        and(
          eq(meetings.id, input.meetingId),
          eq(meetings.status, 'accepted'),
          or(eq(meetings.requesterId, me.id), eq(meetings.inviteeId, me.id)),
        ),
      );
    const [m] = await meetingDtosTx(tx, me, rows);
    if (!m) throw new DomainError('not_found');
    return m;
  },
});

/* ------------------------------------------------------------------------ block, report ---- */

/** Block someone (M5.8b chat reports block too): insert the block and cut every tie. */
export async function blockTx(tx: TenantTx, ctx: Ctx, me: ProfileRow, otherId: string) {
  await tx
    .insert(networkBlocks)
    .values({ orgId: requireOrg(ctx), eventId: me.eventId, blockerId: me.id, blockedId: otherId })
    .onConflictDoNothing();
  await severTx(tx, ctx, me.id, otherId);
}

/** A person the viewer may block or report: any profile of the event but their own. */
async function targetTx(tx: TenantTx, me: ProfileRow, personId: string) {
  const [p] = await tx
    .select({ id: networkProfiles.id })
    .from(networkProfiles)
    .where(
      and(
        eq(networkProfiles.id, personId),
        eq(networkProfiles.eventId, me.eventId),
        ne(networkProfiles.id, me.id),
      ),
    );
  if (!p) throw new DomainError('not_found');
  return p.id;
}

/**
 * Block someone: from now on neither sees the other anywhere in networking or can ask anything;
 * requests between them are withdrawn, their connection removed and meetings ahead cancelled.
 */
export const blockPersonCommand = tenantCommand({
  name: 'engagement.blockPerson',
  input: z.object({ ...At, personId: z.uuid() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, ctx, tx }) => {
    const me = memberOf(await viewerTx(tx, input.eventId, input.email, true));
    await blockTx(tx, ctx, me, await targetTx(tx, me, input.personId));
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'engagement.network.block',
    targetType: 'network_profile',
    targetId: input.personId,
  }),
});

export const unblockPersonCommand = tenantCommand({
  name: 'engagement.unblockPerson',
  input: z.object({ ...At, personId: z.uuid() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, tx }) => {
    const me = memberOf(await viewerTx(tx, input.eventId, input.email, true));
    await tx
      .delete(networkBlocks)
      .where(and(eq(networkBlocks.blockerId, me.id), eq(networkBlocks.blockedId, input.personId)));
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'engagement.network.unblock',
    targetType: 'network_profile',
    targetId: input.personId,
  }),
});

export const blockedQuery = tenantQuery({
  name: 'engagement.blockedPeople',
  input: z.object(At),
  output: z.array(BlockedDto),
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, tx }) => {
    const me = memberOf(await viewerTx(tx, input.eventId, input.email));
    return tx
      .select({ id: networkProfiles.id, displayName: networkProfiles.displayName })
      .from(networkBlocks)
      .innerJoin(networkProfiles, eq(networkProfiles.id, networkBlocks.blockedId))
      .where(
        and(
          eq(networkBlocks.blockerId, me.id),
          // Someone who left networking (opted out, hidden) is not shown even here; the block stays.
          eq(networkProfiles.optedIn, true),
          sql`${networkProfiles.hiddenAt} is null`,
        ),
      )
      .orderBy(sql`lower(${networkProfiles.displayName})`);
  },
});

export const ReportInput = z.object({
  ...At,
  personId: z.uuid(),
  reason: z.enum(REPORT_REASONS),
  details: Optional(500),
});

/** Report someone to the organizer. Reporting also blocks them; one open report per pair. */
export const reportPersonCommand = tenantCommand({
  name: 'engagement.reportPerson',
  input: ReportInput,
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'sessions',
  permission: 'public:networking',
  handler: async ({ input, ctx, tx }) => {
    const me = memberOf(await viewerTx(tx, input.eventId, input.email, true));
    const other = await targetTx(tx, me, input.personId);
    if (input.reason === 'other' && !input.details) throw invalid('details', 'required');
    await tx
      .insert(networkReports)
      .values({
        orgId: requireOrg(ctx),
        eventId: me.eventId,
        reporterId: me.id,
        reportedId: other,
        reason: input.reason,
        details: input.details,
      })
      .onConflictDoNothing();
    await blockTx(tx, ctx, me, other);
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'engagement.network.report',
    targetType: 'network_profile',
    targetId: input.personId,
    data: { reason: input.reason },
  }),
});
