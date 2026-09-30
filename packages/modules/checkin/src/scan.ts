import { eventDay, ruleResult, zoneAllows } from '@yayatoh/checkin-engine';
import type { TenantTx } from '@yayatoh/db';
import { eventStaffTx, findEventTx } from '@yayatoh/events';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { CHECKINS_CHANNEL, publishRealtimeTx, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { CODE_PREFIX, verifyTicketCode } from '@yayatoh/ticket-crypto';
import {
  activeTicketCountTx,
  publicKeysTx,
  type ScannableTicket,
  ticketForLegacyCodeTx,
  ticketForScanTx,
} from '@yayatoh/ticketing';
import { and, desc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  checkInvalidBurstTx,
  checkpointsTx,
  raiseSignalTx,
  scanCheckpointTx,
  TWO_ENTRANCES_WINDOW_MS,
} from './checkpoints.ts';
import { withOccurrenceTx } from './occurrence.ts';
import { admissions, checkpoints, SCAN_RESULTS, type ScanResult, scans } from './schema.ts';
import { checkVelocityTx, FraudSignalDto, fraudSignalsTx, openHighSignalCountTx } from './signals.ts';
import { actorScanScopeTx, scopeAllowsCheckpoint } from './staff.ts';

const SHORT_CODE = /^[2-9A-HJKMNP-TV-Z]{8}$/;

const TicketSummary = z.object({
  holderName: z.string(),
  typeName: z.string(),
  serial: z.int(),
  shortCode: z.string(),
});

export const ScanOutcomeDto = z.object({
  result: z.enum(SCAN_RESULTS),
  ticket: TicketSummary.nullable(),
  admissionId: z.uuid().nullable(),
  /** For a duplicate: when the ticket was first admitted today. */
  firstAdmittedAt: z.date().nullable(),
  /**
   * Open high-severity fraud signals about this ticket or its order (M1.9e): the door shows a
   * banner to fetch a supervisor. A count only; 0 when no ticket is described.
   */
  openSignals: z.int(),
});
export type ScanOutcomeDto = z.infer<typeof ScanOutcomeDto>;

async function resolveCode(
  tx: TenantTx,
  raw: string,
): Promise<{ kind: 'yy1' | 'short' | 'legacy' | 'unknown'; ticket: ScannableTicket | null }> {
  const code = raw.trim().toUpperCase();
  if (code.startsWith(CODE_PREFIX)) {
    const v = await verifyTicketCode(code, await publicKeysTx(tx));
    if (!v.ok) return { kind: 'yy1', ticket: null };
    const t = await ticketForScanTx(tx, { id: v.ticketId });
    // A reissued ticket (new rev) makes older codes for it invalid.
    return { kind: 'yy1', ticket: t && t.rev === v.rev ? t : null };
  }
  // Migrated tickets keep their legacy QR (roadmap §7.5): checked before short codes.
  const legacy = await ticketForLegacyCodeTx(tx, raw);
  if (legacy) return { kind: 'legacy', ticket: legacy };
  if (SHORT_CODE.test(code)) return { kind: 'short', ticket: await ticketForScanTx(tx, { shortCode: code }) };
  return { kind: 'unknown', ticket: null };
}

const summary = (t: ScannableTicket | null) =>
  t ? { holderName: t.holderName, typeName: t.typeName, serial: t.serial, shortCode: t.shortCode } : null;

export const scanTicketCommand = tenantCommand({
  name: 'checkin.scanTicket',
  // Doors stay open during a read-only freeze (M2.5a): scans are never refused by it.
  duringFreeze: 'allowed',
  input: z.object({
    eventId: z.uuid(),
    code: z.string().trim().min(1).max(400),
    /** Set by scanners that retry: the same id returns the first outcome instead of a duplicate. */
    clientScanId: z.string().trim().min(8).max(80).optional(),
    /** Where the scanner stands. An entrance admits; a zone checks the pass includes it. */
    checkpointId: z.uuid().optional(),
  }),
  output: ScanOutcomeDto,
  entitlement: 'checkin',
  permission: 'checkin:scan',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const checkpoint = await scanCheckpointTx(tx, event.id, input.checkpointId);
    const { kind, ticket } = await resolveCode(tx, input.code);
    const scannedBy = ctx.actor.type === 'user' ? ctx.actor.userId : null;

    if (input.clientScanId) {
      const [prior] = await tx.select().from(scans).where(eq(scans.clientScanId, input.clientScanId));
      if (prior) {
        const [adm] = prior.admissionId
          ? await tx.select().from(admissions).where(eq(admissions.id, prior.admissionId))
          : [];
        const priorTicket = prior.ticketId ? await ticketForScanTx(tx, { id: prior.ticketId }) : null;
        return {
          result: prior.result as ScanResult,
          ticket: summary(priorTicket),
          admissionId: prior.admissionId,
          firstAdmittedAt: prior.result === 'duplicate' ? (adm?.admittedAt ?? null) : null,
          openSignals: priorTicket ? await openHighSignalCountTx(tx, priorTicket) : 0,
        };
      }
    }

    // Checkpoint-scoped door staff scan only where they are assigned (and never "whole event").
    const inScope = scopeAllowsCheckpoint(await actorScanScopeTx(tx, ctx, event.id), checkpoint?.id ?? null);
    const verdict = inScope
      ? ruleResult({ now: ctx.now, event, ticket: await withOccurrenceTx(tx, ticket) })
      : 'wrong_checkpoint';
    let result: ScanResult = verdict === 'ok' ? 'admitted' : verdict;
    let admissionId: string | null = null;
    let firstAdmittedAt: Date | null = null;
    if (verdict === 'ok' && ticket && checkpoint?.kind === 'zone') {
      // Zones admit nobody to the event; they only check the pass includes the zone.
      result = zoneAllows(checkpoint, ticket.ticketTypeId) ? 'granted' : 'no_access';
    } else if (verdict === 'ok' && ticket) {
      const day = eventDay(ctx.now, event.timezone);
      const [adm] = await tx
        .insert(admissions)
        .values({
          orgId,
          eventId: event.id,
          ticketId: ticket.id,
          day,
          admittedAt: ctx.now,
          admittedBy: scannedBy,
          checkpointId: checkpoint?.id ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: admissions.id });
      if (adm) {
        admissionId = adm.id;
        emit({
          type: 'ticket.admitted',
          version: 1,
          aggregateType: 'ticket',
          aggregateId: ticket.id,
          payload: {
            orgId,
            eventId: event.id,
            ticketId: ticket.id,
            admissionId: adm.id,
            day,
            admittedAt: ctx.now.toISOString(),
          },
        });
        // Door screens follow along (M3.1b): delivered after commit, no ticket or holder in it.
        await publishRealtimeTx(tx, orgId, CHECKINS_CHANNEL, {
          eventId: event.id,
          event: 'admission',
          data: {
            change: 'admitted',
            checkpointId: checkpoint?.id ?? null,
            count: 1,
            at: ctx.now.toISOString(),
          },
        });
      } else {
        result = 'duplicate';
        const [live] = await tx
          .select()
          .from(admissions)
          .where(
            and(eq(admissions.ticketId, ticket.id), eq(admissions.day, day), isNull(admissions.undoneAt)),
          );
        admissionId = live?.id ?? null;
        firstAdmittedAt = live?.admittedAt ?? null;
        // Admitted at one entrance, shown at another minutes later: a pass being handed back.
        if (
          live?.checkpointId &&
          checkpoint &&
          live.checkpointId !== checkpoint.id &&
          ctx.now.getTime() - live.admittedAt.getTime() <= TWO_ENTRANCES_WINDOW_MS
        ) {
          await raiseSignalTx(tx, emit, {
            orgId,
            eventId: event.id,
            kind: 'two_entrances',
            at: ctx.now,
            ticketId: ticket.id,
            checkpointId: checkpoint.id,
            userId: scannedBy,
            detail: { firstCheckpointId: live.checkpointId },
          });
        }
      }
    }
    // Out of scope, the code isn't looked at further: the log keeps no ticket for it.
    const loggedTicket = inScope ? (ticket?.id ?? null) : null;
    await tx.insert(scans).values({
      orgId,
      eventId: event.id,
      ticketId: loggedTicket,
      admissionId,
      result,
      codeKind: kind,
      clientScanId: input.clientScanId ?? null,
      scannedAt: ctx.now,
      scannedBy,
      checkpointId: checkpoint?.id ?? null,
    });
    if (result === 'invalid')
      await checkInvalidBurstTx(tx, emit, {
        orgId,
        eventId: event.id,
        at: ctx.now,
        userId: scannedBy,
        deviceId: null,
      });
    await checkVelocityTx(tx, emit, {
      orgId,
      eventId: event.id,
      from: ctx.now,
      to: ctx.now,
      userId: scannedBy,
      ticketIds: loggedTicket ? [loggedTicket] : [],
    });
    // Tickets for another event are not described: a scanner only learns about this event's tickets.
    // Nor are tickets shown where the scanner may not scan.
    const described = result !== 'wrong_event' && result !== 'wrong_checkpoint';
    return {
      result,
      ticket: described ? summary(ticket) : null,
      admissionId,
      firstAdmittedAt,
      openSignals: described && ticket ? await openHighSignalCountTx(tx, ticket) : 0,
    };
  },
  audit: (input, r) => ({
    action: 'checkin.scan',
    targetType: 'event',
    targetId: input.eventId,
    data: { result: r?.result, checkpointId: input.checkpointId ?? null },
  }),
});

export const undoAdmissionCommand = tenantCommand({
  name: 'checkin.undoAdmission',
  // Doors stay open during a read-only freeze (M2.5a): scans are never refused by it.
  duringFreeze: 'allowed',
  // The event scopes the permission (event door staff) and must own the admission.
  input: z.object({ eventId: z.uuid(), admissionId: z.uuid() }),
  output: z.object({ undone: z.boolean() }),
  entitlement: 'checkin',
  permission: 'checkin:scan',
  handler: async ({ input, ctx, tx, emit }) => {
    const rows = await tx
      .update(admissions)
      .set({
        undoneAt: ctx.now,
        undoneBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
        updatedAt: ctx.now,
      })
      .where(
        and(
          eq(admissions.id, input.admissionId),
          eq(admissions.eventId, input.eventId),
          isNull(admissions.undoneAt),
        ),
      )
      .returning({
        id: admissions.id,
        ticketId: admissions.ticketId,
        admittedAt: admissions.admittedAt,
        checkpointId: admissions.checkpointId,
        day: admissions.day,
      });
    const [undone] = rows;
    if (!undone) throw new DomainError('not_found', 'Admission not found or already undone');
    // Projections that count check-ins (M3.1 metrics, M3.6 audiences) follow the undo.
    emit({
      type: 'ticket.admission_undone',
      version: 1,
      aggregateType: 'ticket',
      aggregateId: undone.ticketId,
      payload: {
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        ticketId: undone.ticketId,
        admissionId: undone.id,
        admittedAt: undone.admittedAt.toISOString(),
        day: undone.day,
      },
    });
    // Door screens follow along (M3.1b): delivered after commit, no ticket or holder in it.
    await publishRealtimeTx(tx, requireOrg(ctx), CHECKINS_CHANNEL, {
      eventId: input.eventId,
      event: 'admission',
      data: {
        change: 'undone',
        checkpointId: undone.checkpointId ?? null,
        count: 1,
        at: ctx.now.toISOString(),
      },
    });
    return { undone: true };
  },
  audit: (input) => ({ action: 'checkin.undo', targetType: 'admission', targetId: input.admissionId }),
});

export const CheckinStatusDto = z.object({
  issued: z.int(),
  admittedToday: z.int(),
  /** Today's live admissions per entrance (admissions without an entrance are not listed). */
  byCheckpoint: z.array(z.object({ checkpointId: z.uuid(), name: z.string(), admittedToday: z.int() })),
  /** Open fraud signals (two entrances, bursts, velocity), newest first. */
  signals: z.array(FraudSignalDto),
  /** Door staff per checkpoint (`checkpointId: null` = the whole event), live assignments only. */
  staff: z.array(z.object({ checkpointId: z.uuid().nullable(), userIds: z.array(z.uuid()) })),
  /** Tickets let in by two devices while offline (checkin.duplicate_offline), newest first. */
  alerts: z.array(
    z.object({ at: z.date(), holderName: z.string().nullable(), shortCode: z.string().nullable() }),
  ),
  recent: z.array(
    z.object({
      at: z.date(),
      result: z.enum(SCAN_RESULTS),
      holderName: z.string().nullable(),
      admissionId: z.uuid().nullable(),
      undone: z.boolean(),
    }),
  ),
});

export const checkinStatusQuery = tenantQuery({
  name: 'checkin.status',
  input: z.object({ eventId: z.uuid() }),
  output: CheckinStatusDto,
  entitlement: 'checkin',
  permission: 'checkin:scan',
  handler: async ({ input, ctx, tx }) => {
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const day = eventDay(ctx.now, event.timezone);
    const [adm] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(admissions)
      .where(and(eq(admissions.eventId, event.id), eq(admissions.day, day), isNull(admissions.undoneAt)));
    const recent = await tx
      .select({
        at: scans.scannedAt,
        result: scans.result,
        ticketId: scans.ticketId,
        admissionId: scans.admissionId,
      })
      .from(scans)
      .where(eq(scans.eventId, event.id))
      .orderBy(desc(scans.scannedAt), desc(scans.id))
      .limit(20);
    const holders = new Map<string, string>();
    for (const id of new Set(
      recent.flatMap((r) => (r.ticketId && r.result !== 'wrong_event' ? [r.ticketId] : [])),
    )) {
      const t = await ticketForScanTx(tx, { id });
      if (t) holders.set(id, t.holderName);
    }
    const admissionIds = recent.flatMap((r) =>
      r.admissionId && r.result === 'admitted' ? [r.admissionId] : [],
    );
    const undone = new Set(
      admissionIds.length
        ? (
            await tx
              .select({ id: admissions.id })
              .from(admissions)
              .where(and(inArray(admissions.id, admissionIds), sql`${admissions.undoneAt} is not null`))
          ).map((r) => r.id)
        : [],
    );
    const dupes = await tx
      .select({ at: scans.scannedAt, ticketId: scans.ticketId })
      .from(scans)
      .where(and(eq(scans.eventId, event.id), eq(scans.result, 'duplicate_offline')))
      .orderBy(desc(scans.scannedAt), desc(scans.id))
      .limit(20);
    const alerts = [];
    for (const d of dupes) {
      const t = d.ticketId ? await ticketForScanTx(tx, { id: d.ticketId }) : null;
      alerts.push({ at: d.at, holderName: t?.holderName ?? null, shortCode: t?.shortCode ?? null });
    }
    const cps = await checkpointsTx(tx, event.id, true);
    const perEntrance = await tx
      .select({ checkpointId: admissions.checkpointId, n: sql<number>`count(*)::int` })
      .from(admissions)
      .where(and(eq(admissions.eventId, event.id), eq(admissions.day, day), isNull(admissions.undoneAt)))
      .groupBy(admissions.checkpointId);
    const counts = new Map(perEntrance.map((r) => [r.checkpointId, r.n]));
    const byCheckpoint = cps
      .filter((c) => c.kind === 'entrance' && (c.archivedAt === null || counts.has(c.id)))
      .map((c) => ({ checkpointId: c.id, name: c.name, admittedToday: counts.get(c.id) ?? 0 }));
    // The door screen shows the door's own signals; checkout and chat ones live on the fraud list
    // and the order (a scan of an affected ticket still shows its count, M1.9e).
    const signals = await fraudSignalsTx(tx, event.id, {
      openOnly: true,
      limit: 20,
      filter: { source: 'checkin' },
    });
    const doorStaff = (await eventStaffTx(tx, event.id, ctx.now)).filter((g) => g.role === 'door_staff');
    const staffAt = (checkpointId: string | null) =>
      doorStaff
        .filter((g) =>
          checkpointId === null ? g.checkpointIds.length === 0 : g.checkpointIds.includes(checkpointId),
        )
        .map((g) => g.userId);
    const staff = [
      { checkpointId: null, userIds: staffAt(null) },
      ...cps
        .filter((c) => c.archivedAt === null)
        .map((c) => ({ checkpointId: c.id, userIds: staffAt(c.id) })),
    ];
    return {
      alerts,
      signals,
      staff,
      byCheckpoint,
      issued: await activeTicketCountTx(tx, event.id),
      admittedToday: adm?.n ?? 0,
      recent: recent.map((r) => ({
        at: r.at,
        result: r.result as ScanResult,
        holderName: r.ticketId ? (holders.get(r.ticketId) ?? null) : null,
        admissionId: r.result === 'admitted' ? r.admissionId : null,
        undone: r.admissionId ? undone.has(r.admissionId) : false,
      })),
    };
  },
});

/** The tickets (of those given) with at least one live admission at this event, any day. */
export async function admittedTicketIdsTx(
  tx: TenantTx,
  eventId: string,
  ticketIds: readonly string[],
): Promise<Set<string>> {
  if (ticketIds.length === 0) return new Set();
  const rows = await tx
    .selectDistinct({ ticketId: admissions.ticketId })
    .from(admissions)
    .where(
      and(
        eq(admissions.eventId, eventId),
        inArray(admissions.ticketId, [...ticketIds]),
        isNull(admissions.undoneAt),
      ),
    );
  return new Set(rows.map((r) => r.ticketId));
}

/** Live admissions of some tickets, oldest first (the contact timeline). */
export async function admissionsForTicketsTx(tx: TenantTx, ticketIds: readonly string[]) {
  if (ticketIds.length === 0) return [];
  return tx
    .select({ ticketId: admissions.ticketId, eventId: admissions.eventId, admittedAt: admissions.admittedAt })
    .from(admissions)
    .where(and(inArray(admissions.ticketId, [...ticketIds]), isNull(admissions.undoneAt)))
    .orderBy(admissions.admittedAt)
    .limit(500);
}

/**
 * The door's scan log for some tickets (every attempt, rejections included, with the entrance):
 * the "access log" of a dispute evidence packet (M1.6e). Bounded; oldest first.
 */
export async function scanLogForTicketsTx(tx: TenantTx, ticketIds: readonly string[], limit = 300) {
  if (ticketIds.length === 0) return [];
  return tx
    .select({
      ticketId: scans.ticketId,
      scannedAt: scans.scannedAt,
      result: scans.result,
      offline: scans.offline,
      checkpoint: checkpoints.name,
    })
    .from(scans)
    .leftJoin(checkpoints, and(eq(checkpoints.orgId, scans.orgId), eq(checkpoints.id, scans.checkpointId)))
    .where(inArray(scans.ticketId, [...ticketIds]))
    .orderBy(scans.scannedAt)
    .limit(limit);
}

/**
 * The tickets admitted at this event (live admissions; on one event-timezone day when `day` is
 * given), as a subquery for attendee filters (M1.8f: checked in today / ever / never).
 */
export function admittedTicketIdsSql(eventId: string, day?: string): SQL {
  return sql`select ${admissions.ticketId} from ${admissions} where ${and(
    eq(admissions.eventId, eventId),
    isNull(admissions.undoneAt),
    day ? eq(admissions.day, day) : undefined,
  )}`;
}
