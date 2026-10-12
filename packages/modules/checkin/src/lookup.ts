import { eventDay, LOOKUP_LIMIT, lookupKind, normalizeName, phoneKey } from '@yayatoh/checkin-engine';
import { contactEmailsByPhoneTailTx } from '@yayatoh/crm';
import { findEventTx } from '@yayatoh/events';
import { DomainError } from '@yayatoh/kernel';
import { tenantQuery } from '@yayatoh/platform';
import { ticketHoldersForLookupTx } from '@yayatoh/ticketing';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { admissions } from './schema.ts';

export const TicketHolderMatchDto = z.object({
  ticketId: z.uuid(),
  shortCode: z.string(),
  holderName: z.string(),
  typeName: z.string(),
  status: z.enum(['active', 'void']),
  /** Admitted today (the event's day), at any door. */
  admittedToday: z.boolean(),
});
export type TicketHolderMatchDto = z.infer<typeof TicketHolderMatchDto>;

/**
 * Find ticket holders at the door by name, email or phone (agreement §8), for staff whose guest's
 * code won't scan: the console's online twin of the Scan PWA's offline lookup. Email matches the
 * holder email exactly; a phone number matches the org's contacts by its last eight digits.
 */
export const findTicketHoldersQuery = tenantQuery({
  name: 'checkin.findTicketHolders',
  input: z.object({ eventId: z.uuid(), query: z.string().trim().min(1).max(200) }),
  output: z.object({
    kind: z.enum(['name', 'email', 'phone']),
    matches: z.array(TicketHolderMatchDto),
  }),
  entitlement: 'checkin',
  permission: 'checkin:scan',
  handler: async ({ input, ctx, tx }) => {
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const kind = lookupKind(input.query);
    let found: Awaited<ReturnType<typeof ticketHoldersForLookupTx>> = [];
    if (kind === 'email') found = await ticketHoldersForLookupTx(tx, event.id, { emails: [input.query] });
    else if (kind === 'phone') {
      const key = phoneKey(input.query);
      const emails = key ? await contactEmailsByPhoneTailTx(tx, key) : [];
      found = emails.length ? await ticketHoldersForLookupTx(tx, event.id, { emails }, LOOKUP_LIMIT) : [];
    } else {
      const words = normalizeName(input.query).split(' ').filter(Boolean);
      if (words.join('').length >= 2)
        found = await ticketHoldersForLookupTx(
          tx,
          event.id,
          { words: input.query.trim().split(/\s+/).filter(Boolean) },
          LOOKUP_LIMIT,
        );
    }
    const day = eventDay(ctx.now, event.timezone);
    const admitted = found.length
      ? new Set(
          (
            await tx
              .select({ ticketId: admissions.ticketId })
              .from(admissions)
              .where(
                and(
                  eq(admissions.eventId, event.id),
                  eq(admissions.day, day),
                  isNull(admissions.undoneAt),
                  inArray(
                    admissions.ticketId,
                    found.map((t) => t.id),
                  ),
                ),
              )
          ).map((r) => r.ticketId),
        )
      : new Set<string>();
    return {
      kind,
      matches: found.map((t) => ({
        ticketId: t.id,
        shortCode: t.shortCode,
        holderName: t.holderName,
        typeName: t.typeName,
        status: t.status,
        admittedToday: admitted.has(t.id),
      })),
    };
  },
});
