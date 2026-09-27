import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AttendeeDto, attendeeSerializer } from './dto.ts';
import { type ATTENDEE_SOURCES, attendees } from './schema.ts';

export interface NewAttendee {
  readonly eventId: string;
  readonly contactId: string;
  readonly source: (typeof ATTENDEE_SOURCES)[number];
  readonly ticketId?: string | null;
  readonly name: string;
  readonly email: string;
}

/** Create attendees inside the caller's transaction (ticket issue, import, comps). */
export async function createAttendeesTx(
  tx: TenantTx,
  ctx: Ctx,
  rows: readonly NewAttendee[],
): Promise<{ id: string; ticketId: string | null }[]> {
  if (rows.length === 0) return [];
  const orgId = requireOrg(ctx);
  const out = await tx
    .insert(attendees)
    .values(rows.map((r) => ({ orgId, ...r, ticketId: r.ticketId ?? null })))
    .returning({ id: attendees.id, ticketId: attendees.ticketId });
  if (out.length !== rows.length) throw new DomainError('internal');
  return out;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const listAttendeesQuery = tenantQuery({
  name: 'attendees.listAttendees',
  input: z.object({
    eventId: z.uuid(),
    search: z.string().trim().max(200).optional(),
    limit: z.int().min(1).max(500).default(200),
  }),
  output: z.object({ items: z.array(AttendeeDto), total: z.int() }),
  entitlement: 'attendees',
  permission: 'attendees:read',
  handler: async ({ input, tx }) => {
    const q = input.search ? `%${escapeLike(input.search)}%` : null;
    const where = and(
      eq(attendees.eventId, input.eventId),
      q ? or(ilike(attendees.name, q), ilike(attendees.email, q)) : undefined,
    );
    const rows = await tx
      .select()
      .from(attendees)
      .where(where)
      .orderBy(desc(attendees.createdAt), desc(attendees.id))
      .limit(input.limit);
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(attendees).where(where);
    return { items: rows.map((r) => attendeeSerializer.serialize(r)), total: count?.n ?? 0 };
  },
});
