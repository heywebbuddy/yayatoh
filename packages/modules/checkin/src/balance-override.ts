import { eventDay, ruleResult } from '@yayatoh/checkin-engine';
import { findEventTx } from '@yayatoh/events';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { CHECKINS_CHANNEL, publishRealtimeTx, tenantCommand } from '@yayatoh/platform';
import { z } from 'zod';
import { scanCheckpointTx } from './checkpoints.ts';
import { withOccurrenceTx } from './occurrence.ts';
import { liveAdmissionTx, resolveCode, ScanOutcomeDto, summary } from './scan.ts';
import { admissions, scans } from './schema.ts';
import { openHighSignalCountTx } from './signals.ts';
import { actorScanScopeTx, scopeAllowsCheckpoint } from './staff.ts';

/**
 * Admit a ticket whose invoice still has a balance (M5.1d, P5-5): the door refused it
 * (`balance_due`); staff admit it anyway with a reason. Every other rule still applies (this
 * event, live, in the window, the scanner's checkpoint scope, one admission per day). The
 * admission is marked `balance_override`, the scan log records it, and the audit keeps the reason.
 * Doors stay open during a read-only freeze, so this does too.
 */
export const admitBalanceDueCommand = tenantCommand({
  name: 'checkin.admitBalanceDue',
  duringFreeze: 'allowed',
  input: z.object({
    eventId: z.uuid(),
    code: z.string().trim().min(1).max(400),
    checkpointId: z.uuid().optional(),
    note: z.string().trim().min(3).max(300),
  }),
  output: ScanOutcomeDto,
  entitlement: 'checkin',
  permission: 'checkin:scan',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const checkpoint = await scanCheckpointTx(tx, event.id, input.checkpointId);
    if (checkpoint?.kind === 'zone')
      throw new DomainError('validation_failed', 'Zones admit nobody', { reason: 'zone_checkpoint' });
    if (!scopeAllowsCheckpoint(await actorScanScopeTx(tx, ctx, event.id), checkpoint?.id ?? null))
      throw new DomainError('forbidden', 'Not your checkpoint', { reason: 'wrong_checkpoint' });
    const { kind, ticket } = await resolveCode(tx, input.code);
    const verdict = ruleResult({ now: ctx.now, event, ticket: await withOccurrenceTx(tx, ticket) });
    if (verdict !== 'ok' || !ticket)
      throw new DomainError('invalid_state', 'This ticket cannot be admitted', { reason: verdict });
    if (!ticket.paymentDue)
      throw new DomainError('invalid_state', 'Nothing is due on this ticket', { reason: 'no_balance_due' });
    const scannedBy = ctx.actor.type === 'user' ? ctx.actor.userId : null;
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
        balanceOverride: true,
      })
      .onConflictDoNothing()
      .returning({ id: admissions.id });
    const live = adm ? null : await liveAdmissionTx(tx, ticket.id, day);
    const result = adm ? 'admitted' : 'duplicate';
    if (adm) {
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
    }
    await tx.insert(scans).values({
      orgId,
      eventId: event.id,
      ticketId: ticket.id,
      admissionId: adm?.id ?? live?.id ?? null,
      result,
      codeKind: kind,
      scannedAt: ctx.now,
      scannedBy,
      checkpointId: checkpoint?.id ?? null,
    });
    return {
      result,
      ticket: summary(ticket),
      admissionId: adm?.id ?? live?.id ?? null,
      firstAdmittedAt: adm ? null : (live?.admittedAt ?? null),
      openSignals: await openHighSignalCountTx(tx, ticket),
      // Audit only (the output allowlist drops it).
      ticketId: ticket.id,
    };
  },
  audit: (input, r) => ({
    action: 'checkin.balance_override',
    targetType: 'ticket',
    targetId: r.ticketId,
    data: {
      eventId: input.eventId,
      result: r.result,
      note: input.note,
      checkpointId: input.checkpointId ?? null,
    },
  }),
});
