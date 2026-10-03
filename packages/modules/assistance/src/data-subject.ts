import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  defineDataSubjectContributor,
  ERASED_NAME,
  REDACT,
  refsOf,
  type SubjectErasure,
  type SubjectExport,
  type SubjectRefs,
} from '@yayatoh/platform';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { activity, requests } from './schema.ts';

/** Help requests the person sent from their own ticket's link (guest requests carry the ticket). */
async function requestIdsTx(tx: TenantTx, s: DataSubject): Promise<string[]> {
  const tickets = refsOf(s, 'ticket');
  const rows = tickets.length
    ? await tx.select({ id: requests.id }).from(requests).where(inArray(requests.ticketId, tickets))
    : [];
  // Resolved earlier: a ticket erased before this contributor runs clears `ticket_id` (SET NULL).
  return [...new Set([...rows.map((r) => r.id), ...refsOf(s, 'assistance_request')])];
}

/**
 * assistance's part of a data-subject request (M3.3b, M6.1c). Requests the person sent from
 * their ticket are redacted in place (the event's numbering and response-time figures depend on
 * them): their note and location are cleared and the ticket link removed; staff notes on those
 * requests are replaced. Staff-raised requests (from a scanner device) are not about a guest.
 */
export const assistanceDataSubjects = defineDataSubjectContributor({
  module: 'assistance',
  tables: {
    'assistance.requests': REDACT,
    'assistance.activity': REDACT,
  },
  async resolve(tx, s): Promise<SubjectRefs> {
    const ids = await requestIdsTx(tx, s);
    return ids.length ? { assistance_request: ids } : {};
  },
  async export(tx, s): Promise<SubjectExport> {
    const ids = await requestIdsTx(tx, s);
    if (ids.length === 0) return { sections: {} };
    const rows = await tx
      .select({
        id: requests.id,
        eventId: requests.eventId,
        number: requests.number,
        reason: requests.reason,
        priority: requests.priority,
        state: requests.state,
        note: requests.note,
        location: requests.location,
        createdAt: requests.createdAt,
        closedAt: requests.closedAt,
      })
      .from(requests)
      .where(inArray(requests.id, ids))
      .orderBy(asc(requests.createdAt));
    // What happened to each request (kinds and times; staff notes' text is the staff's).
    const steps = await tx
      .select({ requestId: activity.requestId, kind: activity.kind, at: activity.createdAt })
      .from(activity)
      .where(inArray(activity.requestId, ids))
      .orderBy(asc(activity.createdAt));
    const number = new Map(rows.map((r) => [r.id, r.number]));
    return {
      sections: {
        requests: rows.map(({ id: _id, ...r }) => r),
        activity: steps.map((a) => ({ request: number.get(a.requestId) ?? null, kind: a.kind, at: a.at })),
      },
    };
  },
  async erase(tx, s, ctx): Promise<SubjectErasure> {
    const ids = await requestIdsTx(tx, s);
    if (ids.length === 0) return { erased: {} };
    const notes = await tx
      .update(activity)
      .set({ body: ERASED_NAME, updatedAt: ctx.now })
      .where(and(inArray(activity.requestId, ids), eq(activity.kind, 'note')))
      .returning({ id: activity.id });
    const other = await tx
      .update(activity)
      .set({ body: '', updatedAt: ctx.now })
      .where(and(inArray(activity.requestId, ids), ne(activity.kind, 'note'), ne(activity.body, '')))
      .returning({ id: activity.id });
    const rows = await tx
      .update(requests)
      .set({ note: '', location: '', ticketId: null, updatedAt: ctx.now })
      .where(inArray(requests.id, ids))
      .returning({ id: requests.id });
    return {
      erased: {
        'assistance.requests': rows.length,
        'assistance.activity': notes.length + other.length,
      },
    };
  },
});
