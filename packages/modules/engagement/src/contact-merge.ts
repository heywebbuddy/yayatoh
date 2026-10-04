import type { ContactReferenceOwner, MovedRow } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import type { Ctx } from '@yayatoh/kernel';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { engagementEvents, networkProfiles } from './schema.ts';
import { rescoreTx } from './scores.ts';

const EVENTS = 'engagement.engagement_events';
const PROFILES = 'engagement.network_profiles';

/** Rescore both people at every event a move touched (scores are recomputed from the log). */
async function rescoreBothTx(tx: TenantTx, ctx: Ctx, eventIds: readonly string[], who: readonly string[]) {
  for (const eventId of new Set(eventIds)) await rescoreTx(tx, ctx, eventId, [...who]);
}

/**
 * Contact merges (M6.1a, ADR 0023; batch 3j merge for M5.7b and M5.8a). A merged duplicate's
 * engagement facts move to the person who stays, except a fact both already have (the same kind
 * and source counts once): it stays on the duplicate (kept). Their scores are recomputed at the
 * events concerned. A networking profile moves unless the person who stays already has one at
 * that event (one profile per person and event): then it stays on the duplicate (kept). An undo
 * moves exactly the recorded rows back and rescores. Only this module writes its tables.
 */
export const engagementContactOwner: ContactReferenceOwner = {
  module: 'engagement',
  columns: [`${EVENTS}.contact_id`, `${PROFILES}.contact_id`],
  move: async (tx, ctx, step) => {
    const facts = await tx.execute<{ id: string; event_id: string }>(sql`
      update engagement.engagement_events e set contact_id = ${step.toContactId}
      where e.contact_id = ${step.fromContactId}
        and not exists (
          select 1 from engagement.engagement_events x
          where x.org_id = e.org_id and x.contact_id = ${step.toContactId}
            and x.kind = e.kind and x.source_ref = e.source_ref)
      returning e.id, e.event_id`);
    const profiles = await tx.execute<{ id: string }>(sql`
      update engagement.network_profiles p set contact_id = ${step.toContactId}
      where p.contact_id = ${step.fromContactId}
        and not exists (
          select 1 from engagement.network_profiles x
          where x.org_id = p.org_id and x.event_id = p.event_id and x.contact_id = ${step.toContactId})
      returning p.id`);
    await rescoreBothTx(
      tx,
      ctx,
      facts.map((f) => f.event_id),
      [step.fromContactId, step.toContactId],
    );
    const count = async (t: typeof engagementEvents | typeof networkProfiles) =>
      (
        await tx.select({ n: sql<number>`count(*)::int` }).from(t).where(eq(t.contactId, step.fromContactId))
      )[0]?.n ?? 0;
    const moved: MovedRow[] = [
      ...facts.map((r) => ({ table: EVENTS, id: r.id })),
      ...profiles.map((r) => ({ table: PROFILES, id: r.id })),
    ];
    return {
      moved,
      kept: { [EVENTS]: await count(engagementEvents), [PROFILES]: await count(networkProfiles) },
    };
  },
  restore: async (tx, ctx, step) => {
    const out: MovedRow[] = [];
    const ev = step.rows.filter((r) => r.table === EVENTS).map((r) => r.id);
    if (ev.length > 0) {
      const rows = await tx
        .update(engagementEvents)
        .set({ contactId: step.fromContactId })
        .where(and(eq(engagementEvents.contactId, step.toContactId), inArray(engagementEvents.id, ev)))
        .returning({ id: engagementEvents.id, eventId: engagementEvents.eventId });
      out.push(...rows.map((r) => ({ table: EVENTS, id: r.id })));
      await rescoreBothTx(
        tx,
        ctx,
        rows.map((r) => r.eventId),
        [step.fromContactId, step.toContactId],
      );
    }
    const pr = step.rows.filter((r) => r.table === PROFILES).map((r) => r.id);
    if (pr.length > 0) {
      const rows = await tx
        .update(networkProfiles)
        .set({ contactId: step.fromContactId })
        .where(and(eq(networkProfiles.contactId, step.toContactId), inArray(networkProfiles.id, pr)))
        .returning({ id: networkProfiles.id });
      out.push(...rows.map((r) => ({ table: PROFILES, id: r.id })));
    }
    return out;
  },
};
