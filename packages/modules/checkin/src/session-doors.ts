import { randomBytes } from 'node:crypto';
import {
  dwellMs,
  gateOf,
  type SessionAccessFacts,
  type SessionGate,
  type SessionGateRule,
  sessionGateResult,
} from '@yayatoh/checkin-engine';
import type { TenantTx } from '@yayatoh/db';
import { DomainError, type DomainEvent } from '@yayatoh/kernel';
import { type SessionDoorFacts, sessionDoorFactsTx } from '@yayatoh/program';
import type { ScannableTicket } from '@yayatoh/ticketing';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { type checkpoints, SCAN_RESULTS, type ScanResult, sessionAttendance } from './schema.ts';

/** Device verdicts that let someone into the room. */
const LET_IN: ReadonlySet<string> = new Set(['entered', 'provisional', 'admit']);

type EmitFn = (event: DomainEvent) => void;
type CheckpointRow = typeof checkpoints.$inferSelect;

/* -------------------------------------------------------------- the registration port ---- */

/** What a ticket may do at an event's sessions (registration's answer). */
export interface TicketSessionAccess {
  readonly registrant: boolean;
  /** null = every session of the event. */
  readonly sessionIds: readonly string[] | null;
  readonly enrolledSessionIds: readonly string[];
}

/**
 * Where session doors learn who is registered, enrolled and given which sessions (M5.6a). The
 * `registration` module (a higher tier) provides it; each composition root registers it with
 * `setSessionAccessSource`. Without one, session doors refuse to work (fail closed).
 */
export interface SessionAccessSource {
  accessTx(
    tx: TenantTx,
    eventId: string,
    ticketIds: readonly string[],
  ): Promise<Map<string, TicketSessionAccess>>;
  /** Tickets holding a place (enrolled) in a session: the offline manifest's signed list. */
  enrolledTicketIdsTx(tx: TenantTx, sessionId: string): Promise<string[]>;
}

let registered: SessionAccessSource | null = null;

/** Register the session access source in each app's composition root. */
export function setSessionAccessSource(s: SessionAccessSource): void {
  registered = s;
}

export function sessionAccessSource(): SessionAccessSource {
  if (!registered) throw new DomainError('internal', 'No session access source (composition root)');
  return registered;
}

/* ------------------------------------------------------------------------ the door ---- */

export interface SessionDoor {
  readonly checkpoint: CheckpointRow;
  readonly session: SessionDoorFacts;
  /** The checkpoint's own number, else the room's. */
  readonly rule: SessionGateRule;
}

/** A session checkpoint's session and gates; null when its session is gone (scans are invalid). */
export async function sessionDoorTx(tx: TenantTx, checkpoint: CheckpointRow): Promise<SessionDoor | null> {
  if (checkpoint.kind !== 'session' || !checkpoint.sessionId) return null;
  const [session] = await sessionDoorFactsTx(tx, [checkpoint.sessionId]);
  if (!session || session.eventId !== checkpoint.eventId) return null;
  return {
    checkpoint,
    session,
    rule: {
      sessionId: session.sessionId,
      capacity: checkpoint.capacity ?? session.roomCapacity,
      enrollmentRequired: session.enrollmentRequired,
    },
  };
}

/** People in a session's room now (open visits at its doors; flyer check-ins don't hold a seat). */
export async function occupiedTx(tx: TenantTx, sessionId: string): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(sessionAttendance)
    .where(
      and(
        eq(sessionAttendance.sessionId, sessionId),
        isNull(sessionAttendance.outAt),
        ne(sessionAttendance.source, 'self'),
      ),
    );
  return r?.n ?? 0;
}

async function accessFactsTx(tx: TenantTx, door: SessionDoor, ticketId: string): Promise<SessionAccessFacts> {
  const a = (await sessionAccessSource().accessTx(tx, door.checkpoint.eventId, [ticketId])).get(ticketId);
  return {
    registrant: a?.registrant ?? false,
    sessionIds: a ? a.sessionIds : [],
    enrolled: a?.enrolledSessionIds.includes(door.session.sessionId) ?? false,
  };
}

export interface SessionScanOutcome {
  readonly result: ScanResult;
  readonly attendanceId: string | null;
  /** A duplicate: when the open visit began. */
  readonly firstInAt: Date | null;
  /** A scan out: how long that visit lasted. */
  readonly dwellMs: number | null;
  /** The gates actually waived (an override). */
  readonly waived: readonly SessionGate[];
}

/**
 * One scan at a session door, after the event rules passed. Serialized per session (an advisory
 * lock), so the room count and "already in" are read and acted on together: a full room never
 * takes one more without an override.
 *
 * - `out`: closes the ticket's open visit (`scanned_out`, with its dwell), else `not_in_room`.
 * - `in`: an open visit is a `duplicate`; otherwise the gates, then a new visit (`entered`).
 * - `overrides` (staff, online): waives those gates when they are the ones refusing; the visit
 *   records the gates actually waived and the reason. Asking to waive a gate that wasn't in the
 *   way waives nothing.
 * - `deviceVerdict` (an offline scan being synced): the room count was the device's call, so the
 *   server keeps the device's capacity decision and re-checks the other gates.
 */
export async function sessionScanTx(
  tx: TenantTx,
  emit: EmitFn,
  i: {
    readonly orgId: string;
    readonly door: SessionDoor;
    readonly ticket: ScannableTicket;
    readonly at: Date;
    readonly direction: 'in' | 'out';
    readonly deviceId: string | null;
    readonly scannedBy: string | null;
    readonly offline?: boolean;
    readonly deviceVerdict?: string;
    readonly overrides?: readonly SessionGate[];
    readonly reason?: string;
  },
): Promise<SessionScanOutcome> {
  const { door, ticket } = i;
  const sessionId = door.session.sessionId;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`checkin.session:${sessionId}`}, 0))`);
  const [open] = await tx
    .select()
    .from(sessionAttendance)
    .where(
      and(
        eq(sessionAttendance.sessionId, sessionId),
        eq(sessionAttendance.ticketId, ticket.id),
        isNull(sessionAttendance.outAt),
      ),
    );
  const none = { attendanceId: null, firstInAt: null, dwellMs: null, waived: [] };
  if (i.direction === 'out') {
    if (!open || open.source === 'self') return { ...none, result: 'not_in_room' };
    const outAt = i.at.getTime() < open.inAt.getTime() ? open.inAt : i.at;
    await tx
      .update(sessionAttendance)
      .set({ outAt, outDeviceId: i.deviceId, updatedAt: new Date() })
      .where(eq(sessionAttendance.id, open.id));
    const stay = dwellMs([{ inAt: open.inAt, outAt }], outAt);
    emit({
      type: 'checkin.session_left',
      version: 1,
      aggregateType: 'ticket',
      aggregateId: ticket.id,
      payload: {
        orgId: i.orgId,
        eventId: door.checkpoint.eventId,
        sessionId,
        ticketId: ticket.id,
        attendanceId: open.id,
        outAt: outAt.toISOString(),
        dwellMs: stay,
      },
    });
    return { ...none, result: 'scanned_out', attendanceId: open.id, dwellMs: stay };
  }
  if (open) return { ...none, result: 'duplicate', attendanceId: open.id, firstInAt: open.inAt };

  const access = await accessFactsTx(tx, door, ticket.id);
  const occupied = await occupiedTx(tx, sessionId);
  const offlineCapacity = i.deviceVerdict !== undefined;
  const waived: SessionGate[] = offlineCapacity ? ['capacity'] : [];
  const asked = new Set(i.overrides ?? []);
  const actuallyWaived: SessionGate[] = [];
  let verdict: ReturnType<typeof sessionGateResult>;
  for (;;) {
    verdict = sessionGateResult({ rule: door.rule, access, occupied, overrides: waived });
    const gate = verdict === 'ok' ? null : gateOf(verdict);
    if (!gate || !asked.has(gate)) break;
    waived.push(gate);
    actuallyWaived.push(gate);
  }
  if (verdict !== 'ok') return { ...none, result: verdict };
  // Offline: a device that refused them (a full room, or a gate it saw differently) let nobody
  // in, so no visit is recorded; its refusal stands.
  if (offlineCapacity && !LET_IN.has(i.deviceVerdict ?? '')) {
    const refused = (SCAN_RESULTS as readonly string[]).includes(i.deviceVerdict ?? '')
      ? (i.deviceVerdict as ScanResult)
      : 'invalid';
    return { ...none, result: refused };
  }

  const source = actuallyWaived.length > 0 ? 'override' : 'scan';
  const [row] = await tx
    .insert(sessionAttendance)
    .values({
      orgId: i.orgId,
      eventId: door.checkpoint.eventId,
      checkpointId: door.checkpoint.id,
      sessionId,
      ticketId: ticket.id,
      inAt: i.at,
      source,
      inBy: i.scannedBy,
      inDeviceId: i.deviceId,
      offline: i.offline ?? false,
      overrideGates: actuallyWaived,
      overrideReason: source === 'override' ? (i.reason ?? null) : null,
    })
    .returning({ id: sessionAttendance.id });
  if (!row) throw new DomainError('internal');
  emit(attendedEvent(i.orgId, door, ticket.id, row.id, i.at, source));
  return { ...none, result: 'entered', attendanceId: row.id, waived: actuallyWaived };
}

/** `checkin.session_attended@1`: someone came to a session (ids only; engagement and reports follow). */
export function attendedEvent(
  orgId: string,
  door: Pick<SessionDoor, 'checkpoint' | 'session'>,
  ticketId: string,
  attendanceId: string,
  at: Date,
  source: 'scan' | 'override' | 'self',
): DomainEvent {
  return {
    type: 'checkin.session_attended',
    version: 1,
    aggregateType: 'ticket',
    aggregateId: ticketId,
    payload: {
      orgId,
      eventId: door.checkpoint.eventId,
      sessionId: door.session.sessionId,
      checkpointId: door.checkpoint.id,
      ticketId,
      attendanceId,
      at: at.toISOString(),
      source,
    },
  };
}

/** A new flyer token: 24 random bytes, base64url (32 characters). */
export const newSelfCheckinToken = () => randomBytes(24).toString('base64url');
