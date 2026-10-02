import { CsvError, parseCsv } from '@yayatoh/csv';
import { isUniqueViolation, type TenantTx } from '@yayatoh/db';
import { type EventDto, findOccurrenceTx, sanitizeMarkdown } from '@yayatoh/events';
import { type Ctx, DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  AgendaDto,
  AgendaImportResultDto,
  type AgendaImportRowDto,
  AgendaPublicationDto,
  type AgendaWarningDto,
  SessionAgendaDto,
  SessionAgendaResultDto,
  SessionGroupDto,
  SessionTypeDto,
} from './agenda-dto.ts';
import {
  ADMISSIONS,
  type AgendaPlanRow,
  type AgendaState,
  type AgendaWarning,
  agendaWarnings,
  type ExistingAgendaSession,
  MAX_AGENDA_IMPORT_ROWS,
  mapAgendaHeaders,
  planAgendaImport,
} from './domain/agenda.ts';
import { MAX_SPEAKERS_PER_EVENT } from './people.ts';
import { agendaHash, currentPublicSessionsTx, snapshotOf } from './public-session.ts';
import {
  agendaPublications,
  rooms,
  sessionDetails,
  sessionGroupPicks,
  sessionGroups,
  sessionSpeakers,
  sessions,
  sessionTypes,
  speakerContacts,
  speakers,
  tracks,
} from './schema.ts';
import { MAX_ROOMS_PER_EVENT, MAX_SESSIONS_PER_EVENT, MAX_TRACKS_PER_EVENT, sessionsOf } from './sessions.ts';
import { eventOf, invalid } from './shared.ts';

/**
 * M5.2a — agenda model v2: session types, included vs optional (P5-9), pick-one groups, the
 * per-session capacity counter, agenda publishing states and the bulk agenda CSV import. Every
 * write needs the `sessions` module and `events:write`; reads need `events:read`.
 */

export const MAX_SESSION_TYPES_PER_EVENT = 30;
export const MAX_SESSION_GROUPS_PER_EVENT = 50;
const MAX_CSV_BYTES = 1_000_000;

const Name60 = z.string().trim().min(1).max(60);
const Name80 = z.string().trim().min(1).max(80);

async function countWhere(
  tx: TenantTx,
  table: typeof sessionTypes | typeof sessionGroups,
  eventId: string,
): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(eq(table.eventId, eventId));
  return row?.n ?? 0;
}

const nameTaken = (err: unknown) => {
  if (isUniqueViolation(err)) return new DomainError('conflict', 'Name exists', { field: 'name' });
  return err;
};

/* ------------------------------------------------------------------------ session types ---- */

export const createSessionTypeCommand = tenantCommand({
  name: 'program.createSessionType',
  input: z.object({ eventId: z.uuid(), name: Name60 }),
  output: SessionTypeDto,
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    const n = await countWhere(tx, sessionTypes, input.eventId);
    if (n >= MAX_SESSION_TYPES_PER_EVENT)
      throw new DomainError('invalid_state', 'Too many session types', { reason: 'too_many' });
    try {
      const [row] = await tx
        .insert(sessionTypes)
        .values({ orgId: requireOrg(ctx), eventId: input.eventId, name: input.name, position: n })
        .returning();
      if (!row) throw new DomainError('internal');
      return SessionTypeDto.parse(row);
    } catch (err) {
      throw nameTaken(err);
    }
  },
  audit: (input, row) => ({
    action: 'program.session_type.create',
    targetType: 'event',
    targetId: input.eventId,
    data: { typeId: row.id },
  }),
});

/**
 * The standard types (keynote, talk, workshop, panel, break) in the organizer's language: the
 * console sends the translated names. Names that already exist are skipped, so it is safe to
 * run twice.
 */
export const addStandardSessionTypesCommand = tenantCommand({
  name: 'program.addStandardSessionTypes',
  input: z.object({ eventId: z.uuid(), names: z.array(Name60).min(1).max(10) }),
  output: z.object({ added: z.number().int() }),
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    const existing = await tx
      .select({ name: sessionTypes.name })
      .from(sessionTypes)
      .where(eq(sessionTypes.eventId, input.eventId));
    const have = new Set(existing.map((r) => r.name.toLowerCase()));
    const fresh = input.names.filter((n, i) => {
      const k = n.toLowerCase();
      const firstInInput = input.names.findIndex((m) => m.toLowerCase() === k) === i;
      return firstInInput && !have.has(k);
    });
    if (existing.length + fresh.length > MAX_SESSION_TYPES_PER_EVENT)
      throw new DomainError('invalid_state', 'Too many session types', { reason: 'too_many' });
    if (fresh.length)
      await tx.insert(sessionTypes).values(
        fresh.map((name, i) => ({
          orgId: requireOrg(ctx),
          eventId: input.eventId,
          name,
          position: existing.length + i,
        })),
      );
    return { added: fresh.length };
  },
  audit: (input, res) => ({
    action: 'program.session_type.add_standard',
    targetType: 'event',
    targetId: input.eventId,
    data: { added: res.added },
  }),
});

export const deleteSessionTypeCommand = tenantCommand({
  name: 'program.deleteSessionType',
  category: 'delete',
  input: z.object({ eventId: z.uuid(), typeId: z.uuid() }),
  output: z.object({ deleted: z.boolean() }),
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    // Sessions of this type keep their place; they just lose the type.
    await tx
      .update(sessionDetails)
      .set({ typeId: null, updatedAt: ctx.now })
      .where(and(eq(sessionDetails.eventId, input.eventId), eq(sessionDetails.typeId, input.typeId)));
    const rows = await tx
      .delete(sessionTypes)
      .where(and(eq(sessionTypes.id, input.typeId), eq(sessionTypes.eventId, input.eventId)))
      .returning({ id: sessionTypes.id });
    if (rows.length === 0) throw new DomainError('not_found');
    return { deleted: true };
  },
  audit: (input) => ({
    action: 'program.session_type.delete',
    targetType: 'event',
    targetId: input.eventId,
    data: { typeId: input.typeId },
  }),
});

/* ---------------------------------------------------------------------- pick-one groups ---- */

export const createSessionGroupCommand = tenantCommand({
  name: 'program.createSessionGroup',
  input: z.object({ eventId: z.uuid(), name: Name80 }),
  output: SessionGroupDto,
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    if ((await countWhere(tx, sessionGroups, input.eventId)) >= MAX_SESSION_GROUPS_PER_EVENT)
      throw new DomainError('invalid_state', 'Too many groups', { reason: 'too_many' });
    try {
      const [row] = await tx
        .insert(sessionGroups)
        .values({ orgId: requireOrg(ctx), eventId: input.eventId, name: input.name })
        .returning();
      if (!row) throw new DomainError('internal');
      return SessionGroupDto.parse({ ...row, sessionIds: [], picks: 0 });
    } catch (err) {
      throw nameTaken(err);
    }
  },
  audit: (input, row) => ({
    action: 'program.session_group.create',
    targetType: 'event',
    targetId: input.eventId,
    data: { groupId: row.id },
  }),
});

async function picksIn(tx: TenantTx, where: { groupId?: string; sessionId?: string }): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(sessionGroupPicks)
    .where(
      and(
        where.groupId ? eq(sessionGroupPicks.groupId, where.groupId) : undefined,
        where.sessionId ? eq(sessionGroupPicks.sessionId, where.sessionId) : undefined,
      ),
    );
  return row?.n ?? 0;
}

export const deleteSessionGroupCommand = tenantCommand({
  name: 'program.deleteSessionGroup',
  category: 'delete',
  input: z.object({ eventId: z.uuid(), groupId: z.uuid() }),
  output: z.object({ deleted: z.boolean() }),
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const [group] = await tx
      .select({ id: sessionGroups.id })
      .from(sessionGroups)
      .where(and(eq(sessionGroups.id, input.groupId), eq(sessionGroups.eventId, input.eventId)))
      .for('update');
    if (!group) throw new DomainError('not_found');
    // People who picked a session of the group keep their pick: the group can't go.
    if ((await picksIn(tx, { groupId: group.id })) > 0)
      throw new DomainError('invalid_state', 'People picked a session of this group', {
        reason: 'group_in_use',
      });
    await tx
      .update(sessionDetails)
      .set({ groupId: null, updatedAt: ctx.now })
      .where(eq(sessionDetails.groupId, group.id));
    await tx.delete(sessionGroups).where(eq(sessionGroups.id, group.id));
    return { deleted: true };
  },
  audit: (input) => ({
    action: 'program.session_group.delete',
    targetType: 'event',
    targetId: input.eventId,
    data: { groupId: input.groupId },
  }),
});

/* ------------------------------------------------------------- per-session agenda fields ---- */

type DetailsRow = typeof sessionDetails.$inferSelect;
const toAgendaDto = (d: DetailsRow): SessionAgendaDto =>
  SessionAgendaDto.parse({ ...d, admission: d.admission });

const toWarningDto = (w: AgendaWarning): AgendaWarningDto => ({
  kind: w.kind,
  sessionId: w.sessionId,
  roomId: w.kind === 'room_too_small' ? w.roomId : null,
  groupId: w.kind === 'group_not_overlapping' ? w.groupId : null,
  roomCapacity: w.kind === 'room_too_small' ? w.roomCapacity : null,
  sessionCapacity: w.kind === 'room_too_small' ? w.sessionCapacity : null,
});

async function detailsOf(tx: TenantTx, eventId: string): Promise<DetailsRow[]> {
  return tx.select().from(sessionDetails).where(eq(sessionDetails.eventId, eventId));
}

/** Room-smaller-than-capacity and group warnings for the whole agenda (M1.4f warnings stay in programQuery). */
async function warningsOfEvent(tx: TenantTx, eventId: string): Promise<AgendaWarning[]> {
  const list = await tx
    .select({
      id: sessions.id,
      startsAt: sessions.startsAt,
      endsAt: sessions.endsAt,
      roomId: sessions.roomId,
      capacity: sessions.capacity,
      groupId: sessionDetails.groupId,
    })
    .from(sessions)
    .leftJoin(
      sessionDetails,
      and(eq(sessionDetails.orgId, sessions.orgId), eq(sessionDetails.sessionId, sessions.id)),
    )
    .where(eq(sessions.eventId, eventId));
  const roomRows = await tx
    .select({ id: rooms.id, capacity: rooms.capacity })
    .from(rooms)
    .where(eq(rooms.eventId, eventId));
  return agendaWarnings(list, roomRows);
}

export const SetSessionAgendaInput = z.object({
  eventId: z.uuid(),
  sessionId: z.uuid(),
  typeId: z.uuid().nullable().default(null),
  admission: z.enum(ADMISSIONS).default('included'),
  groupId: z.uuid().nullable().default(null),
  enrollmentOpen: z.boolean().default(true),
});

/**
 * A session's type, included/optional (P5-9), pick-one group and whether enrollment is open.
 * Only optional sessions go in a group. Once people hold places or picks (M5.2b), the session
 * can't become included and can't change group.
 */
export const setSessionAgendaCommand = tenantCommand({
  name: 'program.setSessionAgenda',
  input: SetSessionAgendaInput,
  output: SessionAgendaResultDto,
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    const [d] = await tx
      .select()
      .from(sessionDetails)
      .where(and(eq(sessionDetails.sessionId, input.sessionId), eq(sessionDetails.eventId, input.eventId)))
      .for('update');
    if (!d) throw new DomainError('not_found');
    if (input.typeId) {
      const [t] = await tx
        .select({ id: sessionTypes.id })
        .from(sessionTypes)
        .where(and(eq(sessionTypes.id, input.typeId), eq(sessionTypes.eventId, input.eventId)));
      if (!t) throw invalid('typeId', 'unknown');
    }
    if (input.groupId) {
      if (input.admission !== 'optional') throw invalid('groupId', 'group_needs_optional');
      const [g] = await tx
        .select({ id: sessionGroups.id })
        .from(sessionGroups)
        .where(and(eq(sessionGroups.id, input.groupId), eq(sessionGroups.eventId, input.eventId)));
      if (!g) throw invalid('groupId', 'unknown');
    }
    if (input.groupId !== d.groupId && (await picksIn(tx, { sessionId: d.sessionId })) > 0)
      throw new DomainError('invalid_state', 'People picked this session in its group', {
        reason: 'has_enrollments',
      });
    if (input.admission === 'included' && d.enrolled > 0)
      throw new DomainError('invalid_state', 'People hold places in this session', {
        reason: 'has_enrollments',
      });
    const [row] = await tx
      .update(sessionDetails)
      .set({
        typeId: input.typeId,
        admission: input.admission,
        groupId: input.groupId,
        enrollmentOpen: input.enrollmentOpen,
        updatedAt: ctx.now,
      })
      .where(eq(sessionDetails.id, d.id))
      .returning();
    if (!row) throw new DomainError('internal');
    const warnings = (await warningsOfEvent(tx, input.eventId)).filter((w) => w.sessionId === row.sessionId);
    return { agenda: toAgendaDto(row), warnings: warnings.map(toWarningDto) };
  },
  audit: (input, res) => ({
    action: 'program.session.agenda',
    targetType: 'event',
    targetId: input.eventId,
    data: {
      sessionId: input.sessionId,
      admission: input.admission,
      enrollmentOpen: input.enrollmentOpen,
      warnings: res.warnings.length,
    },
  }),
});

/* ------------------------------------------------------------ capacity counter (M5.2b) ---- */

export const CLAIM_REFUSALS = ['full', 'closed', 'included'] as const;

/**
 * Claim one place in an optional session, atomically: a single conditional UPDATE that only
 * matches while the session is optional, open and not full, so concurrent claims can never
 * oversell (and the `enrolled <= capacity` CHECK backs it up). Inside the caller's tenant
 * transaction; throws `conflict` (`full`) or `invalid_state` (`closed`, `included`). Unused by
 * the UI until M5.2b's enrollment.
 */
export async function claimSessionPlaceTx(
  tx: TenantTx,
  sessionId: string,
): Promise<{ enrolled: number; capacity: number | null }> {
  const [row] = await tx
    .update(sessionDetails)
    .set({ enrolled: sql`${sessionDetails.enrolled} + 1` })
    .where(
      and(
        eq(sessionDetails.sessionId, sessionId),
        eq(sessionDetails.admission, 'optional'),
        eq(sessionDetails.enrollmentOpen, true),
        sql`(${sessionDetails.capacity} is null or ${sessionDetails.enrolled} < ${sessionDetails.capacity})`,
      ),
    )
    .returning({ enrolled: sessionDetails.enrolled, capacity: sessionDetails.capacity });
  if (row) return row;
  const [d] = await tx
    .select({ admission: sessionDetails.admission, open: sessionDetails.enrollmentOpen })
    .from(sessionDetails)
    .where(eq(sessionDetails.sessionId, sessionId));
  if (!d) throw new DomainError('not_found');
  if (d.admission !== 'optional')
    throw new DomainError('invalid_state', 'Included sessions need no enrollment', { reason: 'included' });
  if (!d.open) throw new DomainError('invalid_state', 'Enrollment is closed', { reason: 'closed' });
  throw new DomainError('conflict', 'The session is full', { reason: 'full' });
}

/** Give a place back (a cancelled enrollment). Never goes below zero. */
export async function releaseSessionPlaceTx(tx: TenantTx, sessionId: string): Promise<void> {
  await tx
    .update(sessionDetails)
    .set({ enrolled: sql`${sessionDetails.enrolled} - 1` })
    .where(and(eq(sessionDetails.sessionId, sessionId), sql`${sessionDetails.enrolled} > 0`));
}

/**
 * Record a registrant's pick in a pick-one group (M5.2b calls it next to the place claim). The
 * database refuses a second pick in the same group (`one_per_group`) and a session outside the
 * group (`not_in_group`).
 */
export async function recordGroupPickTx(
  tx: TenantTx,
  ctx: Ctx,
  pick: { groupId: string; sessionId: string; registrantId: string },
): Promise<void> {
  const [d] = await tx
    .select({ groupId: sessionDetails.groupId })
    .from(sessionDetails)
    .where(eq(sessionDetails.sessionId, pick.sessionId));
  if (!d || d.groupId !== pick.groupId)
    throw new DomainError('invalid_state', 'The session is not in this group', { reason: 'not_in_group' });
  try {
    await tx.insert(sessionGroupPicks).values({ orgId: requireOrg(ctx), ...pick });
  } catch (err) {
    if (isUniqueViolation(err))
      throw new DomainError('conflict', 'One session per group', { reason: 'one_per_group' });
    throw err;
  }
}

/** Drop a registrant's pick in a group (their enrollment was cancelled or replaced). */
export async function releaseGroupPickTx(
  tx: TenantTx,
  pick: { groupId: string; registrantId: string },
): Promise<void> {
  await tx
    .delete(sessionGroupPicks)
    .where(
      and(eq(sessionGroupPicks.groupId, pick.groupId), eq(sessionGroupPicks.registrantId, pick.registrantId)),
    );
}

/* ------------------------------------------------------------------------- publishing ---- */

async function publicationOf(tx: TenantTx, eventId: string, lock = false) {
  const q = tx.select().from(agendaPublications).where(eq(agendaPublications.eventId, eventId));
  const [row] = lock ? await q.for('update') : await q;
  return row ?? null;
}

async function publicationDto(tx: TenantTx, eventId: string): Promise<AgendaPublicationDto> {
  const pub = await publicationOf(tx, eventId);
  if (!pub) return { state: 'live', version: 0, publishedAt: null, publishedSessions: null };
  if (pub.state !== 'published')
    return { state: 'draft', version: pub.version, publishedAt: null, publishedSessions: null };
  const current = agendaHash(await currentPublicSessionsTx(tx, eventId));
  const state: AgendaState = current === pub.snapshotHash ? 'published' : 'changed';
  return {
    state,
    version: pub.version,
    publishedAt: pub.publishedAt,
    publishedSessions: Array.isArray(pub.snapshot) ? pub.snapshot.length : 0,
  };
}

/** `program.agenda.published@1`: the org, event and version of the snapshot now public. */
function agendaPublished(eventId: string, version: number, sessionCount: number, at: Date): DomainEvent {
  return {
    type: 'program.agenda.published',
    version: 1,
    aggregateType: 'program_agenda',
    aggregateId: eventId,
    payload: { eventId, version, sessions: sessionCount, publishedAt: at.toISOString() },
  };
}

/**
 * Publish the agenda: the public page now serves this snapshot (allowlisted public shape) until
 * the next publish. Publishing an unchanged agenda again is a no-op (no new version, no event).
 */
export const publishAgendaCommand = tenantCommand({
  name: 'program.publishAgenda',
  input: z.object({ eventId: z.uuid() }),
  output: AgendaPublicationDto,
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    await eventOf(tx, input.eventId);
    // Serialize publishes of one event: take the row lock (or create the row under the unique key).
    await tx
      .insert(agendaPublications)
      .values({ orgId: requireOrg(ctx), eventId: input.eventId })
      .onConflictDoNothing();
    const pub = await publicationOf(tx, input.eventId, true);
    if (!pub) throw new DomainError('internal');
    const current = await currentPublicSessionsTx(tx, input.eventId);
    const hash = agendaHash(current);
    if (pub.state === 'published' && pub.snapshotHash === hash) return publicationDto(tx, input.eventId);
    const version = pub.version + 1;
    await tx
      .update(agendaPublications)
      .set({
        state: 'published',
        version,
        snapshot: snapshotOf(current),
        snapshotHash: hash,
        publishedAt: ctx.now,
        publishedBy: ctx.actor.type === 'user' ? ctx.actor.userId : ctx.actor.type,
        updatedAt: ctx.now,
      })
      .where(eq(agendaPublications.id, pub.id));
    emit(agendaPublished(input.eventId, version, current.length, ctx.now));
    return publicationDto(tx, input.eventId);
  },
  audit: (input, res) => ({
    action: 'program.agenda.publish',
    targetType: 'event',
    targetId: input.eventId,
    data: { version: res.version, sessions: res.publishedSessions },
  }),
});

/**
 * Take the agenda back to draft: the public page shows no sessions until the next publish. From
 * a live agenda this starts reviewing changes before they go public.
 */
export const unpublishAgendaCommand = tenantCommand({
  name: 'program.unpublishAgenda',
  input: z.object({ eventId: z.uuid() }),
  output: AgendaPublicationDto,
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    await tx
      .insert(agendaPublications)
      .values({ orgId: requireOrg(ctx), eventId: input.eventId })
      .onConflictDoNothing();
    await tx
      .update(agendaPublications)
      .set({ state: 'draft', snapshot: null, snapshotHash: null, publishedAt: null, updatedAt: ctx.now })
      .where(eq(agendaPublications.eventId, input.eventId));
    return publicationDto(tx, input.eventId);
  },
  audit: (input) => ({
    action: 'program.agenda.unpublish',
    targetType: 'event',
    targetId: input.eventId,
  }),
});

/* ------------------------------------------------------------------------------ query ---- */

/** The agenda v2 view of one event: types, groups, per-session fields, warnings, publishing. */
export const agendaQuery = tenantQuery({
  name: 'program.agenda',
  input: z.object({ eventId: z.uuid() }),
  output: AgendaDto,
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const ev = await eventOf(tx, input.eventId);
    const types = await tx
      .select()
      .from(sessionTypes)
      .where(eq(sessionTypes.eventId, ev.id))
      .orderBy(asc(sessionTypes.position), asc(sessionTypes.name));
    const groups = await tx
      .select()
      .from(sessionGroups)
      .where(eq(sessionGroups.eventId, ev.id))
      .orderBy(asc(sessionGroups.name));
    const details = await detailsOf(tx, ev.id);
    const order = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.eventId, ev.id))
      .orderBy(asc(sessions.startsAt), asc(sessions.endsAt), asc(sessions.title));
    const picks = groups.length
      ? await tx
          .select({ groupId: sessionGroupPicks.groupId, n: sql<number>`count(*)::int` })
          .from(sessionGroupPicks)
          .where(
            inArray(
              sessionGroupPicks.groupId,
              groups.map((g) => g.id),
            ),
          )
          .groupBy(sessionGroupPicks.groupId)
      : [];
    return {
      types: types.map((t) => SessionTypeDto.parse(t)),
      groups: groups.map((g) =>
        SessionGroupDto.parse({
          ...g,
          sessionIds: order
            .map((o) => o.id)
            .filter((id) => details.some((d) => d.sessionId === id && d.groupId === g.id)),
          picks: picks.find((p) => p.groupId === g.id)?.n ?? 0,
        }),
      ),
      sessions: order.flatMap((o) => {
        const d = details.find((x) => x.sessionId === o.id);
        return d ? [toAgendaDto(d)] : [];
      }),
      warnings: (await warningsOfEvent(tx, ev.id)).map(toWarningDto),
      publication: await publicationDto(tx, ev.id),
    };
  },
});

/* ------------------------------------------------------------------------- CSV import ---- */

const ImportInput = z.object({ eventId: z.uuid(), csv: z.string().min(1).max(MAX_CSV_BYTES) });

function readCsv(csv: string) {
  let parsed: ReturnType<typeof parseCsv>;
  try {
    parsed = parseCsv(csv, { maxRows: MAX_AGENDA_IMPORT_ROWS, maxColumns: 30, maxCell: 5_000 });
  } catch (err) {
    if (err instanceof CsvError)
      throw new DomainError('validation_failed', 'The file is not a readable CSV', {
        field: 'file',
        reason: err.code,
        line: err.line,
      });
    throw err;
  }
  if (parsed.rows.length === 0)
    throw new DomainError('validation_failed', 'The file has no rows', { field: 'file', reason: 'empty' });
  const { missing } = mapAgendaHeaders(parsed.headers);
  if (missing.length)
    throw new DomainError('validation_failed', 'Required columns are missing', {
      field: 'file',
      reason: 'missing_columns',
      columns: missing,
    });
  return parsed;
}

/** Everything the plan compares a file with: sessions in CSV terms (names and emails). */
async function importState(tx: TenantTx, ev: EventDto) {
  const list = await sessionsOf(tx, ev.id);
  const details = await detailsOf(tx, ev.id);
  const roomRows = await tx.select().from(rooms).where(eq(rooms.eventId, ev.id));
  const trackRows = await tx.select().from(tracks).where(eq(tracks.eventId, ev.id));
  const typeRows = await tx.select().from(sessionTypes).where(eq(sessionTypes.eventId, ev.id));
  const groupRows = await tx.select().from(sessionGroups).where(eq(sessionGroups.eventId, ev.id));
  const speakerRows = await tx
    .select({ id: speakers.id, name: speakers.name })
    .from(speakers)
    .where(eq(speakers.eventId, ev.id));
  const contacts = await tx
    .select({ speakerId: speakerContacts.speakerId, email: speakerContacts.email })
    .from(speakerContacts)
    .where(eq(speakerContacts.eventId, ev.id));
  const pickRows = await tx
    .select({ sessionId: sessionGroupPicks.sessionId })
    .from(sessionGroupPicks)
    .innerJoin(
      sessionGroups,
      and(eq(sessionGroups.orgId, sessionGroupPicks.orgId), eq(sessionGroups.id, sessionGroupPicks.groupId)),
    )
    .where(eq(sessionGroups.eventId, ev.id));
  const occurrenceIds = [...new Set(list.map((s) => s.occurrenceId).filter((x): x is string => Boolean(x)))];
  const occurrences = new Map<string, { startsAt: Date; endsAt: Date }>();
  for (const id of occurrenceIds) {
    const occ = await findOccurrenceTx(tx, id);
    if (occ) occurrences.set(id, { startsAt: occ.startsAt, endsAt: occ.endsAt });
  }
  const name = (rows: readonly { id: string; name: string }[], id: string | null) =>
    rows.find((r) => r.id === id)?.name ?? null;
  const emailOf = new Map(contacts.map((c) => [c.speakerId, c.email]));
  const existing: ExistingAgendaSession[] = list.map((s) => {
    const d = details.find((x) => x.sessionId === s.id);
    return {
      id: s.id,
      key: d?.importKey ?? null,
      title: s.title,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      type: name(typeRows, d?.typeId ?? null),
      admission: d?.admission === 'optional' ? 'optional' : 'included',
      capacity: s.capacity,
      room: name(roomRows, s.roomId),
      track: name(trackRows, s.trackId),
      group: name(groupRows, d?.groupId ?? null),
      speakerEmails: s.speakerIds.flatMap((id) => {
        const e = emailOf.get(id);
        return e ? [e] : [];
      }),
      description: s.description,
      occurrence: s.occurrenceId ? (occurrences.get(s.occurrenceId) ?? null) : null,
      locked: (d?.enrolled ?? 0) > 0 || pickRows.some((p) => p.sessionId === s.id),
    };
  });
  return {
    existing,
    details,
    roomRows,
    trackRows,
    typeRows,
    groupRows,
    speakerRows,
    contacts,
    speakerEmails: new Set(contacts.map((c) => c.email)),
  };
}

const cleanDescription = (v: string) => sanitizeMarkdown(v, 5000);

async function planFor(tx: TenantTx, eventId: string, csv: string) {
  const ev = await eventOf(tx, eventId);
  const parsed = readCsv(csv);
  const state = await importState(tx, ev);
  const plan = planAgendaImport(
    parsed.rows,
    parsed.headers,
    ev.timezone,
    { sessions: state.existing, speakerEmails: state.speakerEmails },
    cleanDescription,
  );
  return { ev, plan, state };
}

function summarize(plan: readonly AgendaPlanRow[], applied: boolean): AgendaImportResultDto {
  const rows: AgendaImportRowDto[] = plan.map((p) =>
    p.action === 'error'
      ? { line: p.line, action: 'error', title: p.title, errors: [...p.errors] }
      : { line: p.line, action: p.action, title: p.row.title, errors: [] },
  );
  const count = (a: AgendaPlanRow['action']) => plan.filter((p) => p.action === a).length;
  return {
    applied,
    rows,
    created: count('create'),
    updated: count('update'),
    unchanged: count('unchanged'),
    failed: count('error'),
  };
}

/**
 * Dry run of an agenda CSV: what each row would do (create, update, unchanged) or why it can't
 * be imported. Writes nothing; needs the same rights as the import.
 */
export const agendaImportPreviewQuery = tenantQuery({
  name: 'program.agendaImportPreview',
  input: ImportInput,
  output: AgendaImportResultDto,
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, tx }) => summarize((await planFor(tx, input.eventId, input.csv)).plan, false),
});

/** Find-or-create by name (case-insensitive), within the per-event limit. */
async function ensureNamed(
  cache: Map<string, string>,
  name: string | null,
  limit: number,
  create: (name: string) => Promise<string>,
): Promise<string | null> {
  if (!name) return null;
  const k = name.toLowerCase();
  const hit = cache.get(k);
  if (hit) return hit;
  if (cache.size >= limit)
    throw new DomainError('invalid_state', 'Too many for this event', { reason: 'too_many' });
  const id = await create(name);
  cache.set(k, id);
  return id;
}

/**
 * Apply an agenda CSV: rows that can be imported create or update sessions (with their rooms,
 * tracks, types, groups and speakers, created by name when missing); rows with problems are
 * skipped and reported. Idempotent: applying the same file again changes nothing.
 */
export const importAgendaCommand = tenantCommand({
  name: 'program.importAgenda',
  input: ImportInput,
  output: AgendaImportResultDto,
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const eventId = input.eventId;
    const { plan, state } = await planFor(tx, eventId, input.csv);
    const todo = plan.filter(
      (p): p is Extract<AgendaPlanRow, { action: 'create' | 'update' }> =>
        p.action === 'create' || p.action === 'update',
    );
    const creating = todo.filter((p) => p.action === 'create').length;
    if (state.existing.length + creating > MAX_SESSIONS_PER_EVENT)
      throw new DomainError('invalid_state', 'Too many sessions', { reason: 'too_many' });
    const byName = (rows: readonly { id: string; name: string }[]) =>
      new Map(rows.map((r) => [r.name.toLowerCase(), r.id]));
    const roomIds = byName(state.roomRows);
    const trackIds = byName(state.trackRows);
    const typeIds = byName(state.typeRows);
    const groupIds = byName(state.groupRows);
    const speakerByEmail = new Map(state.contacts.map((c) => [c.email, c.speakerId]));
    const withContact = new Set(state.contacts.map((c) => c.speakerId));
    let speakerCount = state.speakerRows.length;
    const insertReturningId = async (q: Promise<{ id: string }[]>) => {
      const [row] = await q;
      if (!row) throw new DomainError('internal');
      return row.id;
    };
    for (const p of todo) {
      const r = p.row;
      const roomId = await ensureNamed(roomIds, r.room, MAX_ROOMS_PER_EVENT, (name) =>
        insertReturningId(tx.insert(rooms).values({ orgId, eventId, name }).returning({ id: rooms.id })),
      );
      const trackId = await ensureNamed(trackIds, r.track, MAX_TRACKS_PER_EVENT, (name) =>
        insertReturningId(tx.insert(tracks).values({ orgId, eventId, name }).returning({ id: tracks.id })),
      );
      const typeId = await ensureNamed(typeIds, r.type, MAX_SESSION_TYPES_PER_EVENT, (name) =>
        insertReturningId(
          tx
            .insert(sessionTypes)
            .values({ orgId, eventId, name, position: typeIds.size })
            .returning({ id: sessionTypes.id }),
        ),
      );
      const groupId = await ensureNamed(groupIds, r.group, MAX_SESSION_GROUPS_PER_EVENT, (name) =>
        insertReturningId(
          tx.insert(sessionGroups).values({ orgId, eventId, name }).returning({ id: sessionGroups.id }),
        ),
      );
      const speakerIds: string[] = [];
      for (const ref of r.speakers) {
        let id = speakerByEmail.get(ref.email);
        if (!id) {
          // A speaker added in the console without an email: match by name, then remember the email.
          const named = state.speakerRows.find(
            (s) => s.name.toLowerCase() === (ref.name ?? '').toLowerCase() && !withContact.has(s.id),
          );
          if (named) id = named.id;
          else {
            if (speakerCount >= MAX_SPEAKERS_PER_EVENT)
              throw new DomainError('invalid_state', 'Too many speakers', { reason: 'too_many' });
            id = await insertReturningId(
              tx
                .insert(speakers)
                .values({ orgId, eventId, name: ref.name ?? ref.email })
                .returning({ id: speakers.id }),
            );
            speakerCount += 1;
          }
          await tx.insert(speakerContacts).values({ orgId, eventId, speakerId: id, email: ref.email });
          speakerByEmail.set(ref.email, id);
          withContact.add(id);
        }
        speakerIds.push(id);
      }
      const fields = {
        title: r.title,
        description: r.description,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        roomId,
        trackId,
        capacity: r.capacity,
      };
      let sessionId: string;
      if (p.action === 'create') {
        sessionId = await insertReturningId(
          tx
            .insert(sessions)
            .values({ orgId, eventId, ...fields })
            .returning({ id: sessions.id }),
        );
      } else {
        sessionId = p.sessionId;
        await tx
          .update(sessions)
          .set({ ...fields, updatedAt: ctx.now })
          .where(eq(sessions.id, sessionId));
      }
      // The trigger created the details row (and synced the capacity).
      await tx
        .update(sessionDetails)
        .set({ typeId, admission: r.admission, groupId, importKey: r.key, updatedAt: ctx.now })
        .where(eq(sessionDetails.sessionId, sessionId));
      await tx.delete(sessionSpeakers).where(eq(sessionSpeakers.sessionId, sessionId));
      if (speakerIds.length)
        await tx
          .insert(sessionSpeakers)
          .values(speakerIds.map((speakerId, position) => ({ orgId, sessionId, speakerId, position })));
    }
    return summarize(plan, true);
  },
  audit: (input, res) => ({
    action: 'program.agenda.import',
    targetType: 'event',
    targetId: input.eventId,
    data: { created: res.created, updated: res.updated, unchanged: res.unchanged, failed: res.failed },
  }),
});
