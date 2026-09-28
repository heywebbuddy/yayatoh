import type { TenantTx } from '@yayatoh/db';
import { type Ctx, requireOrg } from '@yayatoh/kernel';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { eventParticipation } from './schema.ts';

/** One contact × event, computed by the live projector (M3.6) from its sources. */
export interface ParticipationFacts {
  readonly contactId: string;
  readonly registered: boolean;
  readonly tickets: number;
  readonly ticketTypeIds: readonly string[];
  readonly hasSeat: boolean;
  readonly checkedIn: boolean;
  readonly orders: number;
  readonly spendMinor: number;
  readonly registeredAt: Date;
  readonly labels: readonly string[];
}

const MAX_ROW_LABELS = 60;

/**
 * Replace the participation of these contacts (or, with `contactIds: null`, of everyone) at one
 * event with freshly computed facts: rows are upserted (`source = 'live'`), and rows of contacts in
 * scope that no longer take part are deleted. Idempotent: the same facts give the same rows.
 * Returns every contact whose row was written or removed (their profiles need a refresh).
 */
export async function replaceParticipationTx(
  tx: TenantTx,
  ctx: Ctx,
  input: {
    readonly eventId: string;
    readonly currency: string;
    readonly contactIds: readonly string[] | null;
    readonly rows: readonly ParticipationFacts[];
  },
): Promise<string[]> {
  const orgId = requireOrg(ctx);
  const keep = input.rows.map((r) => r.contactId);
  const scope =
    input.contactIds === null ? undefined : inArray(eventParticipation.contactId, [...input.contactIds]);
  if (input.contactIds !== null && input.contactIds.length === 0) return [];
  const removed = await tx
    .delete(eventParticipation)
    .where(
      and(
        eq(eventParticipation.eventId, input.eventId),
        scope,
        keep.length ? notInArray(eventParticipation.contactId, keep) : undefined,
      ),
    )
    .returning({ contactId: eventParticipation.contactId });
  if (input.rows.length) {
    await tx
      .insert(eventParticipation)
      .values(
        input.rows.map((r) => ({
          orgId,
          contactId: r.contactId,
          eventId: input.eventId,
          ticketTypeIds: [...new Set(r.ticketTypeIds)].sort(),
          tickets: r.tickets,
          hasSeat: r.hasSeat,
          checkedIn: r.checkedIn,
          registeredAt: r.registeredAt,
          spendMinor: r.spendMinor,
          currency: input.currency,
          source: 'live',
          registered: r.registered,
          orders: r.orders,
          labels: [...new Set(r.labels)].sort().slice(0, MAX_ROW_LABELS),
        })),
      )
      .onConflictDoUpdate({
        target: [eventParticipation.orgId, eventParticipation.contactId, eventParticipation.eventId],
        set: {
          ticketTypeIds: sql`excluded.ticket_type_ids`,
          tickets: sql`excluded.tickets`,
          hasSeat: sql`excluded.has_seat`,
          checkedIn: sql`excluded.checked_in`,
          registeredAt: sql`excluded.registered_at`,
          spendMinor: sql`excluded.spend_minor`,
          currency: sql`excluded.currency`,
          source: sql`excluded.source`,
          registered: sql`excluded.registered`,
          orders: sql`excluded.orders`,
          labels: sql`excluded.labels`,
          updatedAt: ctx.now,
        },
      });
  }
  return [...new Set([...keep, ...removed.map((r) => r.contactId)])];
}

/** Contacts with a participation row at this event (whole-event refreshes start from them). */
export async function participantContactIdsTx(tx: TenantTx, eventId: string): Promise<string[]> {
  const rows = await tx
    .select({ contactId: eventParticipation.contactId })
    .from(eventParticipation)
    .where(eq(eventParticipation.eventId, eventId));
  return rows.map((r) => r.contactId);
}

/**
 * Rebuild `contact_profile` for these contacts (or all, with null) from participation and the
 * consent ledger (the `crm.refresh_contact_profiles` SQL function, shared with the backfill).
 */
export async function refreshContactProfilesTx(
  tx: TenantTx,
  ctx: Ctx,
  contactIds: readonly string[] | null,
): Promise<number> {
  const orgId = requireOrg(ctx);
  if (contactIds !== null && contactIds.length === 0) return 0;
  const ids =
    contactIds === null
      ? sql`null::uuid[]`
      : sql`ARRAY[${sql.join(
          [...new Set(contactIds)].map((id) => sql`${id}`),
          sql`, `,
        )}]::uuid[]`;
  const [row] = await tx.execute<{ n: number }>(
    sql`select crm.refresh_contact_profiles(${orgId}::uuid, ${ids}) as n`,
  );
  return Number(row?.n ?? 0);
}
