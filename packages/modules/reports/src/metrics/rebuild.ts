import { findEventTx } from '@yayatoh/events';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { z } from 'zod';
import { rebuildEventMetricsTx } from './projector.ts';

/**
 * Recompute one event's metric projections from the source tables (M3.1). The result equals what
 * the projector converges to; running projections wait on the event's locks and then apply on
 * top. Nothing leaves the platform and no money moves: organizers with `events:write` may run it.
 */
export const rebuildEventMetricsCommand = tenantCommand({
  name: 'reports.rebuildEventMetrics',
  input: z.object({ eventId: z.uuid() }),
  output: z.object({ snapshotRows: z.int().nonnegative(), seriesPoints: z.int().nonnegative() }),
  entitlement: 'reports',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    return rebuildEventMetricsTx(tx, requireOrg(ctx), event.id, ctx.now);
  },
  audit: (input, r) => ({
    action: 'reports.metrics_rebuild',
    targetType: 'event',
    targetId: input.eventId,
    data: { snapshotRows: r?.snapshotRows, seriesPoints: r?.seriesPoints },
  }),
});
