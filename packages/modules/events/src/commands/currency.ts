import { CurrencyCode } from '@yayatoh/contracts';
import { isForeignKeyViolation } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { EventDto } from '../dto.ts';
import { events } from '../schema.ts';

export const SetEventCurrencyInput = z.object({ eventId: z.uuid(), currency: CurrencyCode });

/** Why a currency change was refused: the event already has an order (U9, UX-6). */
export const CURRENCY_LOCKED = 'currency_locked';

/**
 * U9 (UX-6): change the event's currency until its first sale. The database holds the lock: every
 * order references (org, event, currency) with a foreign key, so the change fails once any
 * order exists, even one racing this command; the event's ticket types and promo codes follow the
 * new currency through ON UPDATE CASCADE (prices keep their minor units).
 */
export const setEventCurrencyCommand = tenantCommand({
  name: 'events.setEventCurrency',
  input: SetEventCurrencyInput,
  output: EventDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const [current] = await tx.select().from(events).where(eq(events.id, input.eventId)).for('update');
    if (!current) throw new DomainError('not_found');
    if (current.currency === input.currency) return EventDto.parse(current);
    let row: typeof current | undefined;
    try {
      [row] = await tx
        .update(events)
        .set({ currency: input.currency, updatedAt: ctx.now })
        .where(eq(events.id, input.eventId))
        .returning();
    } catch (err) {
      if (isForeignKeyViolation(err, 'orders_event_currency_fk'))
        throw new DomainError('invalid_state', 'The currency is locked after the first sale', {
          reason: CURRENCY_LOCKED,
          field: 'currency',
        });
      throw err;
    }
    if (!row) throw new DomainError('internal');
    emit({
      type: 'event.updated',
      version: 1,
      aggregateType: 'event',
      aggregateId: input.eventId,
      payload: { orgId: requireOrg(ctx), eventId: input.eventId, fields: ['currency'] },
    });
    return EventDto.parse(row);
  },
  audit: (input) => ({
    action: 'event.currency',
    targetType: 'event',
    targetId: input.eventId,
    data: { currency: input.currency },
  }),
});
