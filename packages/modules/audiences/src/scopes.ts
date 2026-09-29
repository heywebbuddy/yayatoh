import {
  type CompileOptions,
  compileSegment,
  type SegmentDefinition,
  type SegmentScope,
  scopeKey,
  segmentScopes,
  usesProfileConditions,
} from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { eventIdsStartingBetweenTx, findEventTx, previousEditionTx, seriesEditionsTx } from '@yayatoh/events';
import { DomainError, zonedTimeToUtc } from '@yayatoh/kernel';
import { organizationDefaultsTx } from '@yayatoh/tenancy';

const nextDay = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Resolve every scope of a definition to event ids for this org, and compile it (M3.6).
 *
 * With `restrictToEventId` (a member whose permission comes from an event role), the audience is
 * that event's people only, and the definition may look at that event only: "any event" means
 * this event, another event, a series, an edition or a date range is refused, and so are the
 * org-wide profile conditions (totals, first/last seen) — they would describe other events.
 */
export async function compileForOrgTx(
  tx: TenantTx,
  orgId: string,
  def: SegmentDefinition,
  restrictToEventId: string | null,
) {
  const defaults = await organizationDefaultsTx(tx, orgId);
  const timezone = defaults?.timezone ?? 'UTC';
  if (restrictToEventId) {
    if (!(await findEventTx(tx, restrictToEventId))) throw new DomainError('not_found', 'Event not found');
    if (usesProfileConditions(def))
      throw new DomainError('forbidden', 'Totals and first/last seen look beyond this event', {
        reason: 'event_scope',
      });
  }
  const scopes = new Map<string, readonly string[] | null>();
  for (const scope of segmentScopes(def)) {
    const key = scopeKey(scope);
    if (!scopes.has(key)) scopes.set(key, await resolveScopeTx(tx, scope, timezone, restrictToEventId));
  }
  const opts: CompileOptions = { scopes, timezone, restrictToEventId };
  return compileSegment(def, opts);
}

async function resolveScopeTx(
  tx: TenantTx,
  scope: SegmentScope,
  timezone: string,
  restrict: string | null,
): Promise<readonly string[] | null> {
  if (restrict) {
    if (scope.kind === 'any') return [restrict];
    if (scope.kind === 'event' && scope.eventId === restrict) return [restrict];
    throw new DomainError('forbidden', 'This audience may only look at your event', {
      reason: 'event_scope',
    });
  }
  switch (scope.kind) {
    case 'any':
      return null;
    case 'event':
      // An id from another org simply matches nothing (RLS hides its rows).
      return [scope.eventId];
    case 'series':
      return (await seriesEditionsTx(tx, scope.seriesId)).map((e) => e.eventId);
    case 'previousEdition': {
      const prev = await previousEditionTx(tx, scope.eventId);
      return prev ? [prev] : [];
    }
    case 'eventsBetween':
      return eventIdsStartingBetweenTx(
        tx,
        zonedTimeToUtc(`${scope.from}T00:00`, timezone),
        zonedTimeToUtc(`${nextDay(scope.to)}T00:00`, timezone),
      );
  }
}
