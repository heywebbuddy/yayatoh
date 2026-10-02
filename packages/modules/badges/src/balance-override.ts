import { DomainError } from '@yayatoh/kernel';
import { signLinkToken, tenantCommand, verifyLinkToken } from '@yayatoh/platform';
import { badgeTicketsTx } from '@yayatoh/ticketing';
import { z } from 'zod';

/**
 * Print a badge for a registration whose invoice still has a balance (M5.1d, P5-5): the desk staff
 * give a reason, which is audited, and get a short-lived signed permission (10 minutes, this
 * ticket only) to print that one badge. Batches never include such tickets.
 */
const PURPOSE = 'badges.balance-override';
export const OVERRIDE_MINUTES = 10;

/** `<expiry ms>_<ticketId>~<hmac>`: the expiry is part of what is signed (the purpose). */
const sign = (ticketId: string, exp: number) => `${exp}_${signLinkToken(`${PURPOSE}:${exp}`, ticketId)}`;

/** Does `token` allow printing this ticket now? */
export function overrideAllows(token: string | undefined, ticketId: string, now: Date): boolean {
  if (!token) return false;
  const sep = token.indexOf('_');
  const exp = Number(token.slice(0, sep));
  if (sep <= 0 || !Number.isSafeInteger(exp) || exp <= now.getTime()) return false;
  return verifyLinkToken(`${PURPOSE}:${exp}`, token.slice(sep + 1)) === ticketId;
}

export const overrideBalanceDueCommand = tenantCommand({
  name: 'badges.overrideBalanceDue',
  input: z.object({ eventId: z.uuid(), ticketId: z.uuid(), note: z.string().trim().min(3).max(300) }),
  output: z.object({ token: z.string() }),
  entitlement: 'badges',
  permission: 'attendees:write',
  handler: async ({ input, ctx, tx }) => {
    const [t] = await badgeTicketsTx(tx, { eventId: input.eventId, ticketIds: [input.ticketId] });
    if (!t) throw new DomainError('not_found', 'Ticket not found');
    if (!t.paymentDue)
      throw new DomainError('invalid_state', 'Nothing is due on this ticket', { reason: 'no_balance_due' });
    const exp = ctx.now.getTime() + OVERRIDE_MINUTES * 60_000;
    return { token: sign(t.id, exp) };
  },
  audit: (input) => ({
    action: 'badges.balance_override',
    targetType: 'ticket',
    targetId: input.ticketId,
    data: { eventId: input.eventId, note: input.note },
  }),
});
