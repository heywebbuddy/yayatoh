import type { ContactReferenceOwner, MovedRow } from '@yayatoh/crm';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { engagementEvents, networkProfiles } from './schema.ts';

const EVENTS = 'engagement.engagement_events';
const PROFILES = 'engagement.network_profiles';

/**
 * Contact merges (M6.1a, ADR 0023) for engagement's contact columns: a merged duplicate's
 * engagement log entries and networking profiles move to the person who stays, except where the
 * person who stays already has the same entry (one per contact, kind and source) or a profile at
 * the same event (one per event and contact): those stay on the duplicate as history (kept). An
 * undo moves exactly the recorded rows back. Only this module writes its tables.
 *
 * Added with U10 (batch 3u base): engagement (3j) added these columns after M6.1a (3i) required an
 * owner for every contact column, so every fixture's merge refused (`owners_missing`).
 */
export const engagementContactOwner: ContactReferenceOwner = {
  module: 'engagement',
  columns: [`${EVENTS}.contact_id`, `${PROFILES}.contact_id`],
  move: async (tx, _ctx, step) => {
    const events = await tx.execute<{ id: string }>(sql`
      update engagement.engagement_events e set contact_id = ${step.toContactId}
      where e.contact_id = ${step.fromContactId}
        and not exists (
          select 1 from engagement.engagement_events x
          where x.org_id = e.org_id and x.contact_id = ${step.toContactId}
            and x.kind = e.kind and x.source_ref = e.source_ref)
      returning e.id`);
    const profiles = await tx.execute<{ id: string }>(sql`
      update engagement.network_profiles p set contact_id = ${step.toContactId}
      where p.contact_id = ${step.fromContactId}
        and not exists (
          select 1 from engagement.network_profiles x
          where x.org_id = p.org_id and x.event_id = p.event_id and x.contact_id = ${step.toContactId})
      returning p.id`);
    const moved: MovedRow[] = [
      ...events.map((r) => ({ table: EVENTS, id: r.id })),
      ...profiles.map((r) => ({ table: PROFILES, id: r.id })),
    ];
    const count = async (t: typeof engagementEvents | typeof networkProfiles) =>
      (
        await tx.select({ n: sql<number>`count(*)::int` }).from(t).where(eq(t.contactId, step.fromContactId))
      )[0]?.n ?? 0;
    return {
      moved,
      kept: { [EVENTS]: await count(engagementEvents), [PROFILES]: await count(networkProfiles) },
    };
  },
  restore: async (tx, _ctx, step) => {
    const out: MovedRow[] = [];
    const ev = step.rows.filter((r) => r.table === EVENTS).map((r) => r.id);
    if (ev.length > 0) {
      const rows = await tx
        .update(engagementEvents)
        .set({ contactId: step.fromContactId })
        .where(and(eq(engagementEvents.contactId, step.toContactId), inArray(engagementEvents.id, ev)))
        .returning({ id: engagementEvents.id });
      out.push(...rows.map((r) => ({ table: EVENTS, id: r.id })));
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
