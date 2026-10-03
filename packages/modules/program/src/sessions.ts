import { isUniqueViolation, type TenantTx } from '@yayatoh/db';
import { type EventDto, findOccurrenceTx, sanitizeMarkdown } from '@yayatoh/events';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type ScheduleWarning, scheduleWarnings, warningsFor } from './domain/schedule.ts';
import {
  ProgramDto,
  RoomDto,
  type ScheduleWarningDto,
  SessionDto,
  SessionResultDto,
  TrackDto,
} from './dto.ts';
import { exhibitorsOf, speakersOf, sponsorsOf, sponsorTiersOf } from './people.ts';
import { rooms, sessionSpeakers, sessions, speakers, tracks } from './schema.ts';
import { eventOf, invalid } from './shared.ts';

export const MAX_SESSIONS_PER_EVENT = 500;
export const MAX_TRACKS_PER_EVENT = 30;
export const MAX_ROOMS_PER_EVENT = 50;
export const MAX_SPEAKERS_PER_SESSION = 20;

async function countOf(tx: TenantTx, table: typeof tracks | typeof rooms | typeof sessions, eventId: string) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(eq(table.eventId, eventId));
  return row?.n ?? 0;
}

const Name = z.string().trim().min(1).max(80);

/* ------------------------------------------------------------------------ tracks / rooms ---- */

export const createTrackCommand = tenantCommand({
  name: 'program.createTrack',
  input: z.object({ eventId: z.uuid(), name: Name }),
  output: TrackDto,
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    if ((await countOf(tx, tracks, input.eventId)) >= MAX_TRACKS_PER_EVENT)
      throw new DomainError('invalid_state', 'Too many tracks', { reason: 'too_many' });
    try {
      const [row] = await tx
        .insert(tracks)
        .values({ orgId: requireOrg(ctx), eventId: input.eventId, name: input.name })
        .returning();
      if (!row) throw new DomainError('internal');
      return TrackDto.parse(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw new DomainError('conflict', 'Track exists', { field: 'name' });
      throw err;
    }
  },
  audit: (input, row) => ({
    action: 'program.track.create',
    targetType: 'event',
    targetId: input.eventId,
    data: { trackId: row.id },
  }),
});

export const deleteTrackCommand = tenantCommand({
  name: 'program.deleteTrack',
  category: 'delete',
  input: z.object({ eventId: z.uuid(), trackId: z.uuid() }),
  output: z.object({ deleted: z.boolean() }),
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    // Sessions keep their place in the agenda; they just lose the track.
    await tx
      .update(sessions)
      .set({ trackId: null, updatedAt: ctx.now })
      .where(and(eq(sessions.eventId, input.eventId), eq(sessions.trackId, input.trackId)));
    const rows = await tx
      .delete(tracks)
      .where(and(eq(tracks.id, input.trackId), eq(tracks.eventId, input.eventId)))
      .returning({ id: tracks.id });
    if (rows.length === 0) throw new DomainError('not_found');
    return { deleted: true };
  },
  audit: (input) => ({
    action: 'program.track.delete',
    targetType: 'event',
    targetId: input.eventId,
    data: { trackId: input.trackId },
  }),
});

export const createRoomCommand = tenantCommand({
  name: 'program.createRoom',
  input: z.object({
    eventId: z.uuid(),
    name: Name,
    capacity: z.number().int().min(1).max(1_000_000).nullable().default(null),
  }),
  output: RoomDto,
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    if ((await countOf(tx, rooms, input.eventId)) >= MAX_ROOMS_PER_EVENT)
      throw new DomainError('invalid_state', 'Too many rooms', { reason: 'too_many' });
    try {
      const [row] = await tx
        .insert(rooms)
        .values({
          orgId: requireOrg(ctx),
          eventId: input.eventId,
          name: input.name,
          capacity: input.capacity,
        })
        .returning();
      if (!row) throw new DomainError('internal');
      return RoomDto.parse(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw new DomainError('conflict', 'Room exists', { field: 'name' });
      throw err;
    }
  },
  audit: (input, row) => ({
    action: 'program.room.create',
    targetType: 'event',
    targetId: input.eventId,
    data: { roomId: row.id },
  }),
});

export const deleteRoomCommand = tenantCommand({
  name: 'program.deleteRoom',
  category: 'delete',
  input: z.object({ eventId: z.uuid(), roomId: z.uuid() }),
  output: z.object({ deleted: z.boolean() }),
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await tx
      .update(sessions)
      .set({ roomId: null, updatedAt: ctx.now })
      .where(and(eq(sessions.eventId, input.eventId), eq(sessions.roomId, input.roomId)));
    const rows = await tx
      .delete(rooms)
      .where(and(eq(rooms.id, input.roomId), eq(rooms.eventId, input.eventId)))
      .returning({ id: rooms.id });
    if (rows.length === 0) throw new DomainError('not_found');
    return { deleted: true };
  },
  audit: (input) => ({
    action: 'program.room.delete',
    targetType: 'event',
    targetId: input.eventId,
    data: { roomId: input.roomId },
  }),
});

/* ------------------------------------------------------------------------------ sessions ---- */

const SessionFields = z.object({
  title: z.string().trim().min(1).max(160),
  description: z
    .string()
    .max(5000)
    .transform((v) => sanitizeMarkdown(v, 5000))
    .default(''),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  occurrenceId: z.uuid().nullable().default(null),
  roomId: z.uuid().nullable().default(null),
  trackId: z.uuid().nullable().default(null),
  capacity: z.number().int().min(1).max(1_000_000).nullable().default(null),
  speakerIds: z.array(z.uuid()).max(MAX_SPEAKERS_PER_SESSION).default([]),
});
const timeOrder = (v: { startsAt: Date; endsAt: Date }) =>
  !Number.isNaN(v.startsAt.getTime()) && !Number.isNaN(v.endsAt.getTime()) && v.endsAt > v.startsAt;

export const CreateSessionInput = SessionFields.extend({ eventId: z.uuid() }).refine(timeOrder, {
  message: 'endsAt must be after startsAt',
  path: ['endsAt'],
});
export type CreateSessionInput = z.input<typeof CreateSessionInput>;
export const UpdateSessionInput = SessionFields.extend({ eventId: z.uuid(), sessionId: z.uuid() }).refine(
  timeOrder,
  { message: 'endsAt must be after startsAt', path: ['endsAt'] },
);

type SessionFields = z.output<typeof SessionFields>;

/** Every reference must belong to this event (RLS already keeps them inside the org). */
async function checkRefs(tx: TenantTx, eventId: string, v: SessionFields) {
  if (v.roomId) {
    const [r] = await tx
      .select({ id: rooms.id })
      .from(rooms)
      .where(and(eq(rooms.id, v.roomId), eq(rooms.eventId, eventId)));
    if (!r) throw invalid('roomId', 'unknown');
  }
  if (v.trackId) {
    const [r] = await tx
      .select({ id: tracks.id })
      .from(tracks)
      .where(and(eq(tracks.id, v.trackId), eq(tracks.eventId, eventId)));
    if (!r) throw invalid('trackId', 'unknown');
  }
  if (v.occurrenceId) {
    const occ = await findOccurrenceTx(tx, v.occurrenceId);
    if (!occ || occ.eventId !== eventId) throw invalid('occurrenceId', 'unknown');
    if (occ.status !== 'scheduled') throw invalid('occurrenceId', 'cancelled');
    // A session on a date happens within that date.
    if (v.startsAt < occ.startsAt || v.endsAt > occ.endsAt) throw invalid('startsAt', 'outside_date');
  }
  const ids = [...new Set(v.speakerIds)];
  if (ids.length) {
    const found = await tx
      .select({ id: speakers.id })
      .from(speakers)
      .where(and(eq(speakers.eventId, eventId), inArray(speakers.id, ids)));
    if (found.length !== ids.length) throw invalid('speakerIds', 'unknown');
  }
  return ids;
}

async function writeSpeakers(tx: TenantTx, orgId: string, sessionId: string, speakerIds: readonly string[]) {
  await tx.delete(sessionSpeakers).where(eq(sessionSpeakers.sessionId, sessionId));
  if (speakerIds.length)
    await tx
      .insert(sessionSpeakers)
      .values(speakerIds.map((speakerId, position) => ({ orgId, sessionId, speakerId, position })));
}

export async function sessionsOf(tx: TenantTx, eventId: string): Promise<SessionDto[]> {
  const rows = await tx
    .select()
    .from(sessions)
    .where(eq(sessions.eventId, eventId))
    .orderBy(asc(sessions.startsAt), asc(sessions.endsAt), asc(sessions.title));
  const links = rows.length
    ? await tx
        .select({ sessionId: sessionSpeakers.sessionId, speakerId: sessionSpeakers.speakerId })
        .from(sessionSpeakers)
        .where(
          inArray(
            sessionSpeakers.sessionId,
            rows.map((r) => r.id),
          ),
        )
        .orderBy(asc(sessionSpeakers.position))
    : [];
  return rows.map((r) =>
    SessionDto.parse({
      ...r,
      speakerIds: links.filter((l) => l.sessionId === r.id).map((l) => l.speakerId),
    }),
  );
}

export const toWarningDto = (w: ScheduleWarning): ScheduleWarningDto => ({
  kind: w.kind,
  sessionId: w.sessionId,
  otherId: w.kind === 'outside_event' ? null : w.otherId,
  roomId: w.kind === 'room_overlap' ? w.roomId : null,
  speakerId: w.kind === 'speaker_overlap' ? w.speakerId : null,
});

function warningsOf(ev: EventDto, list: readonly SessionDto[]): ScheduleWarning[] {
  // M5.3b: a draft has placeholder times until the organizer places it, so it warns about nothing.
  return scheduleWarnings(
    list.filter((s) => !s.draft),
    { startsAt: ev.startsAt, endsAt: ev.endsAt },
  );
}

async function resultFor(tx: TenantTx, ev: EventDto, sessionId: string): Promise<SessionResultDto> {
  const list = await sessionsOf(tx, ev.id);
  const session = list.find((s) => s.id === sessionId);
  if (!session) throw new DomainError('not_found');
  return { session, warnings: warningsFor(warningsOf(ev, list), sessionId).map(toWarningDto) };
}

export const createSessionCommand = tenantCommand({
  name: 'program.createSession',
  input: CreateSessionInput,
  output: SessionResultDto,
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const ev = await eventOf(tx, input.eventId);
    if ((await countOf(tx, sessions, input.eventId)) >= MAX_SESSIONS_PER_EVENT)
      throw new DomainError('invalid_state', 'Too many sessions', { reason: 'too_many' });
    const speakerIds = await checkRefs(tx, input.eventId, input);
    const [row] = await tx
      .insert(sessions)
      .values({
        orgId,
        eventId: input.eventId,
        occurrenceId: input.occurrenceId,
        title: input.title,
        description: input.description,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        roomId: input.roomId,
        trackId: input.trackId,
        capacity: input.capacity,
      })
      .returning({ id: sessions.id });
    if (!row) throw new DomainError('internal');
    await writeSpeakers(tx, orgId, row.id, speakerIds);
    return resultFor(tx, ev, row.id);
  },
  audit: (input, res) => ({
    action: 'program.session.create',
    targetType: 'event',
    targetId: input.eventId,
    data: { sessionId: res.session.id, warnings: res.warnings.length },
  }),
});

export const updateSessionCommand = tenantCommand({
  name: 'program.updateSession',
  input: UpdateSessionInput,
  output: SessionResultDto,
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const ev = await eventOf(tx, input.eventId);
    const speakerIds = await checkRefs(tx, input.eventId, input);
    const rows = await tx
      .update(sessions)
      .set({
        occurrenceId: input.occurrenceId,
        title: input.title,
        description: input.description,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        roomId: input.roomId,
        trackId: input.trackId,
        capacity: input.capacity,
        updatedAt: ctx.now,
      })
      .where(and(eq(sessions.id, input.sessionId), eq(sessions.eventId, input.eventId)))
      .returning({ id: sessions.id });
    if (rows.length === 0) throw new DomainError('not_found');
    await writeSpeakers(tx, requireOrg(ctx), input.sessionId, speakerIds);
    return resultFor(tx, ev, input.sessionId);
  },
  audit: (input, res) => ({
    action: 'program.session.update',
    targetType: 'event',
    targetId: input.eventId,
    data: { sessionId: input.sessionId, warnings: res.warnings.length },
  }),
});

export const deleteSessionCommand = tenantCommand({
  name: 'program.deleteSession',
  category: 'delete',
  input: z.object({ eventId: z.uuid(), sessionId: z.uuid() }),
  output: z.object({ deleted: z.boolean() }),
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .delete(sessions)
      .where(and(eq(sessions.id, input.sessionId), eq(sessions.eventId, input.eventId)))
      .returning({ id: sessions.id });
    if (rows.length === 0) throw new DomainError('not_found');
    return { deleted: true };
  },
  audit: (input) => ({
    action: 'program.session.delete',
    targetType: 'event',
    targetId: input.eventId,
    data: { sessionId: input.sessionId },
  }),
});

/* --------------------------------------------------------------------------------- query ---- */

/** The whole program of one event, with the schedule's conflict warnings. Readers may view it. */
export const programQuery = tenantQuery({
  name: 'program.program',
  input: z.object({ eventId: z.uuid() }),
  output: ProgramDto,
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const ev = await eventOf(tx, input.eventId);
    // One transaction connection: read in sequence.
    const trackRows = await tx
      .select()
      .from(tracks)
      .where(eq(tracks.eventId, ev.id))
      .orderBy(asc(tracks.name));
    const roomRows = await tx.select().from(rooms).where(eq(rooms.eventId, ev.id)).orderBy(asc(rooms.name));
    const list = await sessionsOf(tx, ev.id);
    const speakerList = await speakersOf(tx, ev.id);
    const exhibitorList = await exhibitorsOf(tx, ev.id);
    const tierList = await sponsorTiersOf(tx, ev.id);
    const sponsorList = await sponsorsOf(tx, ev.id);
    return {
      tracks: trackRows.map((r) => TrackDto.parse(r)),
      rooms: roomRows.map((r) => RoomDto.parse(r)),
      sessions: list,
      speakers: speakerList,
      exhibitors: exhibitorList,
      sponsorTiers: tierList,
      sponsors: sponsorList,
      warnings: warningsOf(ev, list).map(toWarningDto),
    };
  },
});

/** Counts for readiness rules (M1.4f): how much of the program exists. */
export const programCountsQuery = tenantQuery({
  name: 'program.counts',
  input: z.object({ eventId: z.uuid() }),
  output: z.object({
    sessions: z.number().int(),
    speakers: z.number().int(),
    exhibitors: z.number().int(),
    sponsors: z.number().int(),
  }),
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const rows = await tx.execute<{
      sessions: number;
      speakers: number;
      exhibitors: number;
      sponsors: number;
    }>(sql`
      select
        (select count(*)::int from program.sessions where event_id = ${input.eventId}) as sessions,
        (select count(*)::int from program.speakers where event_id = ${input.eventId}) as speakers,
        (select count(*)::int from program.exhibitors where event_id = ${input.eventId}) as exhibitors,
        (select count(*)::int from program.sponsors where event_id = ${input.eventId}) as sponsors`);
    const r = rows[0];
    return {
      sessions: r?.sessions ?? 0,
      speakers: r?.speakers ?? 0,
      exhibitors: r?.exhibitors ?? 0,
      sponsors: r?.sponsors ?? 0,
    };
  },
});
