import type { TenantTx } from '@yayatoh/db';
import { eventSessionIdsTx } from '@yayatoh/program';
import { orderSiblingsTx } from '@yayatoh/ticketing';
import { and, eq, inArray } from 'drizzle-orm';
import { availableSessions } from './domain/enrollment.ts';
import { admissionItems, itemSessions, sessionEnrollments, typeItems } from './schema.ts';

/**
 * M5.6a: what some tickets may do at an event's session doors, for check-in's gates (plugged in
 * at the composition roots as check-in's `SessionAccessSource`; check-in sits below this tier).
 *
 * - An event without registration cells: every pass is a registrant, given every session, and
 *   enrolled nowhere (nobody can enrol without registration).
 * - Otherwise a registrant is a live admission pass; its items are the pass and the order's
 *   add-ons, which give sessions as `availableSessions` says (the same rule enrollment uses).
 * - `enrolled` lists the sessions the registrant holds a place in (`enrolled`, not offered).
 */
export interface TicketSessionAccess {
  readonly registrant: boolean;
  /** null = every session of the event. */
  readonly sessionIds: readonly string[] | null;
  readonly enrolledSessionIds: readonly string[];
}

export async function sessionAccessTx(
  tx: TenantTx,
  eventId: string,
  ticketIds: readonly string[],
): Promise<Map<string, TicketSessionAccess>> {
  const out = new Map<string, TicketSessionAccess>();
  if (ticketIds.length === 0) return out;
  const cells = await tx
    .select({ ticketTypeId: typeItems.ticketTypeId, itemId: admissionItems.id, kind: admissionItems.kind })
    .from(typeItems)
    .innerJoin(
      admissionItems,
      and(eq(admissionItems.orgId, typeItems.orgId), eq(admissionItems.id, typeItems.admissionItemId)),
    )
    .where(eq(typeItems.eventId, eventId));
  if (cells.length === 0) {
    for (const id of ticketIds) out.set(id, { registrant: true, sessionIds: null, enrolledSessionIds: [] });
    return out;
  }
  const cellOf = new Map(
    cells.map((c) => [c.ticketTypeId, { id: c.itemId, kind: c.kind === 'add_on' ? 'add_on' : 'admission' }]),
  ) as Map<string, { id: string; kind: 'admission' | 'add_on' }>;
  const listed = await tx
    .select({ itemId: itemSessions.admissionItemId, sessionId: itemSessions.sessionId })
    .from(itemSessions)
    .where(eq(itemSessions.eventId, eventId));
  const listedByItem = new Map<string, string[]>();
  for (const l of listed) listedByItem.set(l.itemId, [...(listedByItem.get(l.itemId) ?? []), l.sessionId]);
  const listedFor = (itemId: string) => listedByItem.get(itemId) ?? [];
  const allSessions = await eventSessionIdsTx(tx, eventId);
  const siblings = await orderSiblingsTx(tx, ticketIds);
  const byId = new Map(siblings.map((t) => [t.id, t]));
  const addOnsOf = new Map<string, { id: string; kind: 'add_on' }[]>();
  for (const t of siblings) {
    const c = cellOf.get(t.ticketTypeId);
    if (t.status !== 'active' || c?.kind !== 'add_on') continue;
    const list = addOnsOf.get(t.orderId) ?? [];
    if (!list.some((x) => x.id === c.id)) list.push({ id: c.id, kind: 'add_on' });
    addOnsOf.set(t.orderId, list);
  }
  const registrants = ticketIds.filter((id) => {
    const t = byId.get(id);
    return (
      t?.status === 'active' && t.eventId === eventId && cellOf.get(t.ticketTypeId)?.kind === 'admission'
    );
  });
  const isRegistrant = new Set(registrants);
  const enrolled = registrants.length
    ? await tx
        .select({ registrantId: sessionEnrollments.registrantId, sessionId: sessionEnrollments.sessionId })
        .from(sessionEnrollments)
        .where(
          and(
            inArray(sessionEnrollments.registrantId, registrants),
            eq(sessionEnrollments.status, 'enrolled'),
          ),
        )
    : [];
  const enrolledBy = new Map<string, string[]>();
  for (const e of enrolled)
    enrolledBy.set(e.registrantId, [...(enrolledBy.get(e.registrantId) ?? []), e.sessionId]);
  for (const id of ticketIds) {
    const t = byId.get(id);
    const pass = t ? cellOf.get(t.ticketTypeId) : undefined;
    if (!t || !isRegistrant.has(id) || !pass) {
      out.set(id, { registrant: false, sessionIds: [], enrolledSessionIds: [] });
      continue;
    }
    const items = [pass, ...(addOnsOf.get(t.orderId) ?? [])].map((i) => ({
      kind: i.kind,
      sessionIds: listedFor(i.id),
    }));
    const given = availableSessions(items, allSessions);
    out.set(id, {
      registrant: true,
      sessionIds: given.size === allSessions.length ? null : [...given].sort(),
      enrolledSessionIds: enrolledBy.get(id) ?? [],
    });
  }
  return out;
}

/** Tickets (registrants) holding a place in a session: the offline manifest's signed list. */
export async function enrolledTicketIdsTx(tx: TenantTx, sessionId: string): Promise<string[]> {
  const rows = await tx
    .select({ registrantId: sessionEnrollments.registrantId })
    .from(sessionEnrollments)
    .where(and(eq(sessionEnrollments.sessionId, sessionId), eq(sessionEnrollments.status, 'enrolled')));
  return rows.map((r) => r.registrantId).sort();
}

/** Check-in's `SessionAccessSource`, as the composition roots register it. */
export const registrationSessionAccess = {
  accessTx: sessionAccessTx,
  enrolledTicketIdsTx,
};
