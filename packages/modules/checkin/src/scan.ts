import { eventDay, ruleResult } from '@yayatoh/checkin-engine';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { CODE_PREFIX, verifyTicketCode } from '@yayatoh/ticket-crypto';
import { activeTicketCountTx, publicKeysTx, type ScannableTicket, ticketForScanTx } from '@yayatoh/ticketing';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { admissions, SCAN_RESULTS, type ScanResult, scans } from './schema.ts';

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
});
export type ScanOutcomeDto = z.infer<typeof ScanOutcomeDto>;

async function resolveCode(
  tx: TenantTx,
  raw: string,
): Promise<{ kind: 'yy1' | 'short' | 'unknown'; ticket: ScannableTicket | null }> {
  const code = raw.trim().toUpperCase();
  if (code.startsWith(CODE_PREFIX)) {
    const v = await verifyTicketCode(code, await publicKeysTx(tx));
    if (!v.ok) return { kind: 'yy1', ticket: null };
    const t = await ticketForScanTx(tx, { id: v.ticketId });
    // A reissued ticket (new rev) makes older codes for it invalid.
    return { kind: 'yy1', ticket: t && t.rev === v.rev ? t : null };
  }
  if (SHORT_CODE.test(code)) return { kind: 'short', ticket: await ticketForScanTx(tx, { shortCode: code }) };
  return { kind: 'unknown', ticket: null };
}

const summary = (t: ScannableTicket | null) =>
  t ? { holderName: t.holderName, typeName: t.typeName, serial: t.serial, shortCode: t.shortCode } : null;

export const scanTicketCommand = tenantCommand({
  name: 'checkin.scanTicket',
  input: z.object({
    eventId: z.uuid(),
    code: z.string().trim().min(1).max(400),
    /** Set by scanners that retry: the same id returns the first outcome instead of a duplicate. */
    clientScanId: z.string().trim().min(8).max(80).optional(),
  }),
  output: ScanOutcomeDto,
  entitlement: 'checkin',
  permission: 'checkin:scan',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const { kind, ticket } = await resolveCode(tx, input.code);
    const scannedBy = ctx.actor.type === 'user' ? ctx.actor.userId : null;

    if (input.clientScanId) {
      const [prior] = await tx.select().from(scans).where(eq(scans.clientScanId, input.clientScanId));
      if (prior) {
        const [adm] = prior.admissionId
          ? await tx.select().from(admissions).where(eq(admissions.id, prior.admissionId))
          : [];
        return {
          result: prior.result as ScanResult,
          ticket: prior.ticketId ? summary(await ticketForScanTx(tx, { id: prior.ticketId })) : null,
          admissionId: prior.admissionId,
          firstAdmittedAt: prior.result === 'duplicate' ? (adm?.admittedAt ?? null) : null,
        };
      }
    }

    const verdict = ruleResult({ now: ctx.now, event, ticket });
    let result: ScanResult = verdict === 'ok' ? 'admitted' : verdict;
    let admissionId: string | null = null;
    let firstAdmittedAt: Date | null = null;
    if (verdict === 'ok' && ticket) {
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
          payload: { orgId, eventId: event.id, ticketId: ticket.id, admissionId: adm.id, day },
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
      }
    }
    await tx.insert(scans).values({
      orgId,
      eventId: event.id,
      ticketId: ticket?.id ?? null,
      admissionId,
      result,
      codeKind: kind,
      clientScanId: input.clientScanId ?? null,
      scannedAt: ctx.now,
      scannedBy,
    });
    // Tickets for another event are not described: a scanner only learns about this event's tickets.
    return {
      result,
      ticket: result === 'wrong_event' ? null : summary(ticket),
      admissionId,
      firstAdmittedAt,
    };
  },
  audit: (input, r) => ({
    action: 'checkin.scan',
    targetType: 'event',
    targetId: input.eventId,
    data: { result: r?.result },
  }),
});

export const undoAdmissionCommand = tenantCommand({
  name: 'checkin.undoAdmission',
  input: z.object({ admissionId: z.uuid() }),
  output: z.object({ undone: z.boolean() }),
  entitlement: 'checkin',
  permission: 'checkin:scan',
  handler: async ({ input, ctx, tx }) => {
    const rows = await tx
      .update(admissions)
      .set({
        undoneAt: ctx.now,
        undoneBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
        updatedAt: ctx.now,
      })
      .where(and(eq(admissions.id, input.admissionId), isNull(admissions.undoneAt)))
      .returning({ id: admissions.id });
    if (rows.length === 0) throw new DomainError('not_found', 'Admission not found or already undone');
    return { undone: true };
  },
  audit: (input) => ({ action: 'checkin.undo', targetType: 'admission', targetId: input.admissionId }),
});

export const CheckinStatusDto = z.object({
  issued: z.int(),
  admittedToday: z.int(),
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
    return {
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
