import { ruleResult, SESSION_GATES } from '@yayatoh/checkin-engine';
import { withoutTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { sessionDoorChoicesTx, sessionDoorFactsTx } from '@yayatoh/program';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { scanCheckpointTx } from './checkpoints.ts';
import { scanningDeviceOf } from './live.ts';
import { withOccurrenceTx } from './occurrence.ts';
import { resolveCode, ScanOutcomeDto, summary } from './scan.ts';
import { checkpoints, scans, sessionAttendance } from './schema.ts';
import { attendedEvent, newSelfCheckinToken, sessionDoorTx, sessionScanTx } from './session-doors.ts';
import { openHighSignalCountTx } from './signals.ts';
import { actorScanScopeTx, scopeAllowsCheckpoint } from './staff.ts';

const Gate = z.enum(SESSION_GATES);

/**
 * M5.6a: let someone into a session although a gate refused them (`not_enrolled`,
 * `admission_level`, `capacity`): staff name the gates to waive and give a reason. The other
 * gates and every event rule still apply (this event, live, in the window, the scanner's scope).
 * Only gates actually in the way are waived and recorded on the visit; the audit keeps them with
 * the reason. Online only (an offline device shows the refusal and asks for a connection).
 */
export const admitSessionOverrideCommand = tenantCommand({
  name: 'checkin.admitSessionOverride',
  duringFreeze: 'allowed',
  input: z.object({
    eventId: z.uuid(),
    checkpointId: z.uuid(),
    code: z.string().trim().min(1).max(400),
    gates: z.array(Gate).min(1).max(SESSION_GATES.length),
    reason: z.string().trim().min(3).max(300),
  }),
  output: ScanOutcomeDto,
  entitlement: 'checkin',
  permission: 'checkin:scan',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const checkpoint = await scanCheckpointTx(tx, event.id, input.checkpointId);
    const door = checkpoint ? await sessionDoorTx(tx, checkpoint) : null;
    if (!checkpoint || !door)
      throw new DomainError('validation_failed', 'Not a session door', { reason: 'not_session_door' });
    if (!scopeAllowsCheckpoint(await actorScanScopeTx(tx, ctx, event.id), checkpoint.id))
      throw new DomainError('forbidden', 'Not your checkpoint', { reason: 'wrong_checkpoint' });
    const { kind, ticket } = await resolveCode(tx, input.code);
    const verdict = ruleResult({ now: ctx.now, event, ticket: await withOccurrenceTx(tx, ticket) });
    if (verdict !== 'ok' || !ticket)
      throw new DomainError('invalid_state', 'This ticket cannot be let in', { reason: verdict });
    const scannedBy = ctx.actor.type === 'user' ? ctx.actor.userId : null;
    const deviceId = scanningDeviceOf(ctx);
    const s = await sessionScanTx(tx, emit, {
      orgId,
      door,
      ticket,
      at: ctx.now,
      direction: 'in',
      deviceId,
      scannedBy,
      overrides: [...new Set(input.gates)],
      reason: input.reason,
    });
    if (s.result === 'entered' && s.waived.length === 0)
      throw new DomainError('invalid_state', 'Nothing to override', { reason: 'nothing_to_override' });
    await tx.insert(scans).values({
      orgId,
      eventId: event.id,
      ticketId: ticket.id,
      result: s.result,
      codeKind: kind,
      scannedAt: ctx.now,
      scannedBy,
      deviceId,
      checkpointId: checkpoint.id,
    });
    return {
      result: s.result,
      ticket: summary(ticket),
      admissionId: null,
      firstAdmittedAt: s.firstInAt,
      openSignals: await openHighSignalCountTx(tx, ticket),
      // Audit only (the output allowlist drops them).
      ticketId: ticket.id,
      waived: s.waived,
    };
  },
  audit: (input, r) => ({
    action: 'checkin.session_override',
    targetType: 'ticket',
    targetId: r.ticketId,
    data: {
      eventId: input.eventId,
      checkpointId: input.checkpointId,
      result: r.result,
      gates: r.waived,
      reason: input.reason,
    },
  }),
});

/** Turn a session door's self check-in flyer on (a new token: old flyers stop working) or off. */
export const setSelfCheckinCommand = tenantCommand({
  name: 'checkin.setSelfCheckin',
  input: z.object({ eventId: z.uuid(), checkpointId: z.uuid(), enabled: z.boolean() }),
  output: z.object({ selfCheckin: z.boolean() }),
  entitlement: 'checkin',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .update(checkpoints)
      .set({ selfCheckinToken: input.enabled ? newSelfCheckinToken() : null, updatedAt: ctx.now })
      .where(
        and(
          eq(checkpoints.id, input.checkpointId),
          eq(checkpoints.eventId, input.eventId),
          eq(checkpoints.kind, 'session'),
        ),
      )
      .returning({ token: checkpoints.selfCheckinToken });
    if (!row) throw new DomainError('not_found', 'Session door not found');
    return { selfCheckin: row.token !== null };
  },
  audit: (input) => ({
    action: input.enabled ? 'checkin.self_checkin_on' : 'checkin.self_checkin_off',
    targetType: 'checkpoint',
    targetId: input.checkpointId,
    data: { eventId: input.eventId },
  }),
});

export const SessionChoiceDto = z.object({
  id: z.uuid(),
  title: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  roomName: z.string().nullable(),
  roomCapacity: z.int().nullable(),
  enrollmentRequired: z.boolean(),
});

/** The event's sessions a session door can be set up for (the organizer's picker). */
export const sessionDoorChoicesQuery = tenantQuery({
  name: 'checkin.sessionDoorChoices',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(SessionChoiceDto),
  entitlement: 'checkin',
  permission: 'events:write',
  handler: async ({ input, tx }) =>
    (await sessionDoorChoicesTx(tx, input.eventId)).map((s) => ({
      id: s.sessionId,
      title: s.title,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      roomName: s.roomName,
      roomCapacity: s.roomCapacity,
      enrollmentRequired: s.enrollmentRequired,
    })),
});

export const SessionAttendanceDto = z.object({
  checkpointId: z.uuid(),
  name: z.string(),
  archived: z.boolean(),
  sessionId: z.uuid(),
  title: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  roomName: z.string().nullable(),
  /** The door's number, else the room's; null = no limit. */
  capacity: z.int().nullable(),
  enrollmentRequired: z.boolean(),
  /** In the room now (door scans; flyer check-ins don't hold a seat). */
  inRoom: z.int(),
  /** Different people who came (any way). */
  attended: z.int(),
  /** Of them, checked in from the flyer. */
  selfCheckins: z.int(),
  /** Visits let in by a staff override. */
  overrides: z.int(),
  /** Average time in the room per person, over people who scanned out; null = nobody yet. */
  avgDwellMs: z.int().nullable(),
  /** The flyer's token (null = off): staff print it. */
  selfCheckinToken: z.string().nullable(),
});
export type SessionAttendanceDto = z.infer<typeof SessionAttendanceDto>;

/** Session doors with their room counts, attendance and dwell (the organizer's session check-in page). */
export const sessionAttendanceQuery = tenantQuery({
  name: 'checkin.sessionAttendance',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(SessionAttendanceDto),
  entitlement: 'checkin',
  permission: 'checkin:scan',
  handler: async ({ input, tx }) => {
    const doors = await tx
      .select()
      .from(checkpoints)
      .where(and(eq(checkpoints.eventId, input.eventId), eq(checkpoints.kind, 'session')))
      .orderBy(asc(checkpoints.name));
    const facts = new Map(
      (
        await sessionDoorFactsTx(tx, [...new Set(doors.flatMap((d) => (d.sessionId ? [d.sessionId] : [])))])
      ).map((f) => [f.sessionId, f]),
    );
    const stats = await tx.execute<{
      session_id: string;
      in_room: number;
      attended: number;
      self: number;
      overrides: number;
      avg_dwell: number | null;
    }>(sql`
      with per_ticket as (
        select session_id, ticket_id,
          sum(extract(epoch from (out_at - in_at)) * 1000) filter (where out_at is not null) as dwell
        from checkin.session_attendance where event_id = ${input.eventId}
        group by session_id, ticket_id
      )
      select a.session_id,
        count(*) filter (where a.out_at is null and a.source <> 'self')::int as in_room,
        count(distinct a.ticket_id)::int as attended,
        count(distinct a.ticket_id) filter (where a.source = 'self')::int as self,
        count(*) filter (where a.source = 'override')::int as overrides,
        (select round(avg(p.dwell))::bigint from per_ticket p where p.session_id = a.session_id and p.dwell is not null) as avg_dwell
      from checkin.session_attendance a
      where a.event_id = ${input.eventId}
      group by a.session_id`);
    const bySession = new Map(stats.map((r) => [r.session_id, r]));
    return doors.flatMap((d) => {
      const f = d.sessionId ? facts.get(d.sessionId) : undefined;
      if (!f) return [];
      const st = bySession.get(f.sessionId);
      return [
        {
          checkpointId: d.id,
          name: d.name,
          archived: d.archivedAt !== null,
          sessionId: f.sessionId,
          title: f.title,
          startsAt: f.startsAt,
          endsAt: f.endsAt,
          roomName: f.roomName,
          capacity: d.capacity ?? f.roomCapacity,
          enrollmentRequired: f.enrollmentRequired,
          inRoom: Number(st?.in_room ?? 0),
          attended: Number(st?.attended ?? 0),
          selfCheckins: Number(st?.self ?? 0),
          overrides: Number(st?.overrides ?? 0),
          avgDwellMs: st?.avg_dwell === null || st?.avg_dwell === undefined ? null : Number(st.avg_dwell),
          selfCheckinToken: d.selfCheckinToken,
        },
      ];
    });
  },
});

/* ------------------------------------------------------- self check-in from a flyer ---- */

/** The flyer's door: the org (to open a tenant context) and the checkpoint, by its token. */
export async function selfCheckinDoor(
  token: string,
): Promise<{ orgId: string; checkpointId: string } | null> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string; checkpoint_id: string }>(
      sql`select org_id, checkpoint_id from checkin.self_checkin_door(${token})`,
    ),
  );
  const r = rows[0];
  return r ? { orgId: r.org_id, checkpointId: r.checkpoint_id } : null;
}

/** Self check-in opens this long before the session starts and closes when it ends. */
export const SELF_CHECKIN_EARLY_MS = 30 * 60_000;

const flyerDoorTx = async (tx: Parameters<typeof sessionDoorTx>[0], token: string) => {
  const [c] = await tx
    .select()
    .from(checkpoints)
    .where(and(eq(checkpoints.selfCheckinToken, token), isNull(checkpoints.archivedAt)));
  return c ? sessionDoorTx(tx, c) : null;
};

export const SelfCheckinPageDto = z.object({
  eventName: z.string(),
  timezone: z.string(),
  title: z.string(),
  roomName: z.string().nullable(),
  startsAt: z.date(),
  endsAt: z.date(),
  /** Inside the window (30 minutes before the start to the end). */
  open: z.boolean(),
});

/** What the flyer's page shows (an allowlist: the session and its event, nothing about people). */
export const selfCheckinPageQuery = tenantQuery({
  name: 'checkin.selfCheckinPage',
  input: z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{32}$/) }),
  output: SelfCheckinPageDto,
  entitlement: 'checkin',
  permission: 'public:self_checkin',
  handler: async ({ input, ctx, tx }) => {
    const door = await flyerDoorTx(tx, input.token);
    const event = door ? await findEventTx(tx, door.checkpoint.eventId) : null;
    if (!door || !event) throw new DomainError('not_found');
    return {
      eventName: event.name,
      timezone: event.timezone,
      title: door.session.title,
      roomName: door.session.roomName,
      startsAt: door.session.startsAt,
      endsAt: door.session.endsAt,
      open: selfCheckinOpen(door.session, ctx.now),
    };
  },
});

const selfCheckinOpen = (s: { startsAt: Date; endsAt: Date }, now: Date) =>
  now.getTime() >= s.startsAt.getTime() - SELF_CHECKIN_EARLY_MS && now.getTime() <= s.endsAt.getTime();

export const SELF_CHECKIN_RESULTS = ['entered', 'duplicate', 'not_found', 'closed'] as const;

/**
 * An attendee checks themselves into a session from its flyer (M5.6a): attendance only, no
 * gates and no seat held. They type the code on their ticket or badge; a code that isn't a live
 * pass for this event is `not_found` (nothing about any ticket is said). Once per visit.
 */
export const selfCheckInCommand = tenantCommand({
  name: 'checkin.selfCheckIn',
  input: z.object({
    token: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
    code: z.string().trim().min(4).max(400),
  }),
  output: z.object({ result: z.enum(SELF_CHECKIN_RESULTS) }),
  entitlement: 'checkin',
  permission: 'public:self_checkin',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const door = await flyerDoorTx(tx, input.token);
    const event = door ? await findEventTx(tx, door.checkpoint.eventId) : null;
    if (!door || !event) throw new DomainError('not_found');
    if (!selfCheckinOpen(door.session, ctx.now)) return { result: 'closed' as const };
    const { ticket } = await resolveCode(tx, input.code);
    const verdict = ruleResult({ now: ctx.now, event, ticket: await withOccurrenceTx(tx, ticket) });
    if (verdict !== 'ok' || !ticket) return { result: 'not_found' as const };
    const [row] = await tx
      .insert(sessionAttendance)
      .values({
        orgId,
        eventId: event.id,
        checkpointId: door.checkpoint.id,
        sessionId: door.session.sessionId,
        ticketId: ticket.id,
        inAt: ctx.now,
        source: 'self',
      })
      .onConflictDoNothing()
      .returning({ id: sessionAttendance.id });
    if (!row) return { result: 'duplicate' as const };
    emit(attendedEvent(orgId, door, ticket.id, row.id, ctx.now, 'self'));
    return { result: 'entered' as const };
  },
  audit: (_input, r) => ({
    action: 'checkin.self_checkin',
    targetType: 'checkpoint',
    targetId: null,
    data: { result: r.result },
  }),
});
