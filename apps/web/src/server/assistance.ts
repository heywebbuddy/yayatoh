import 'server-only';
import { assistanceTicketToken, assistanceTicketTx } from '@yayatoh/assistance';
import { withTenant } from '@yayatoh/db';
import { checkoutTarget, findEventTx } from '@yayatoh/events';
import { createCtx } from '@yayatoh/kernel';

/**
 * Guest assistance on the web (M3.3b). The org and event always come from the URL's slug (or the
 * order's manage link), never from the request; the ticket's help link proves the rest.
 */
const systemCtx = (orgId: string) => createCtx({ orgId, actor: { type: 'system', name: 'assistance.web' } });

/** The seat finder URL that carries a ticket's help link ("Need help" then works for that ticket). */
export async function helpLinksForOrder(
  target: { orgId: string; eventId: string },
  ticketIds: readonly string[],
): Promise<Map<string, string>> {
  const ev = await withTenant(systemCtx(target.orgId), (tx) => findEventTx(tx, target.eventId));
  if (!ev) return new Map();
  return new Map(
    ticketIds.map((id) => [
      id,
      `/events/${ev.slug}/seat-finder?ticket=${encodeURIComponent(assistanceTicketToken(id))}`,
    ]),
  );
}

/**
 * Whether a help link belongs to a valid ticket of the slug's event. `null` when the event takes
 * no requests here (unknown slug, not public), else the check's answer.
 */
export async function checkHelpTicket(
  slug: string,
  token: string,
): Promise<{ orgId: string; eventId: string; valid: boolean } | null> {
  const target = await checkoutTarget(slug);
  if (!target) return null;
  const ticket = token
    ? await withTenant(systemCtx(target.orgId), (tx) => assistanceTicketTx(tx, target.eventId, token))
    : null;
  return { ...target, valid: !!ticket };
}
