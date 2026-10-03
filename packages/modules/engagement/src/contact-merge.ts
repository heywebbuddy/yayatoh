import type { ContactReferenceOwner, MovedRow } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import type { Ctx } from '@yayatoh/kernel';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { engagementEvents, networkProfiles } from './schema.ts';
import { rescoreTx } from './scores.ts';

const EVENTS = 'engagement.engagement_events';
const PROFILES = 'engagement.network_profiles';

/** Recompute both people's engagement scores at the events whose log rows moved. */
async function rescoreBothTx(tx: TenantTx, ctx: Ctx, eventIds: readonly string[], contacts: string[]) {
  for (const eventId of new Set(eventIds)) await rescoreTx(tx, ctx, eventId, contacts);
}

/**
 * Contact merges (M6.1a, ADR 0023; wired at the batch 3u merge for M5.7b and M5.8a): a merged
 * duplicate's engagement log rows (M5.7b scores) and networking profiles (M5.8a) move to the person
 * who stays, and both people's scores are recomputed from the log (crm's `event_engagement` stays a
 * projection). A log row the other record already has (same kind and source) and a profile at an
 * event where the other record has one (one profile per person per event) stay on the duplicate
 * (kept). An undo moves exactly the recorded rows back and rescores. Only this module writes its
 * tables.
 */
export const engagementContactOwner: ContactReferenceOwner = {
  module: 'engagement',
  columns: [`${EVENTS}.contact_id`, `${PROFILES}.contact_id`],
  move: async (tx, ctx, step) => {
    const events = await tx.execute<{ id: string; event_id: string }>(sql`
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
      events.map((e) => e.event_id),
      [step.fromContactId, step.toContactId],
    );
    const count = async (t: typeof engagementEvents | typeof networkProfiles) =>
      (
        await tx.select({ n: sql<number>`count(*)::int` }).from(t).where(eq(t.contactId, step.fromContactId))
      )[0]?.n ?? 0;
    return {
      moved: [
        ...events.map((r): MovedRow => ({ table: EVENTS, id: r.id })),
        ...profiles.map((r): MovedRow => ({ table: PROFILES, id: r.id })),
      ],
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
        .set({ contactId: step.fromContactId, updatedAt: ctx.now })
        .where(and(eq(networkProfiles.contactId, step.toContactId), inArray(networkProfiles.id, pr)))
        .returning({ id: networkProfiles.id });
      out.push(...rows.map((r) => ({ table: PROFILES, id: r.id })));
    }
    return out;
  },
};
