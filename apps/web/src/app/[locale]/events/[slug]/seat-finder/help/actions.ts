'use server';

import { GUEST_REASONS, guestRequestCommand, LOCATION_MAX, NOTE_MAX } from '@yayatoh/assistance';
import { checkoutTarget } from '@yayatoh/events';
import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { ports } from '@/server/ports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';

export type GuestHelpError =
  | 'reason'
  | 'noteTooLong'
  | 'locationTooLong'
  | 'invalidTicket'
  | 'tooMany'
  | 'rateLimited'
  | 'closed'
  | 'internal';

export interface GuestHelpState {
  readonly error?: GuestHelpError;
  readonly retryMinutes?: number;
  /** What the guest typed, so an error never clears it. */
  readonly reason?: string;
  readonly note?: string;
  readonly location?: string;
}

/**
 * "Need help" (M3.3b): a guest with a ticket's help link asks the event's staff for help. No
 * account; the org and event come from the slug, the ticket from its signed link (checked by the
 * command for this event only). Rate-limited per device, per ticket and per IP (M1.14 limiter),
 * and a ticket may have only a few open requests. Success goes to the request's status page.
 */
export async function askForHelpAction(
  slug: string,
  ticketToken: string,
  _prev: GuestHelpState,
  form: FormData,
): Promise<GuestHelpState> {
  const reason = String(form.get('reason') ?? '');
  const note = String(form.get('note') ?? '').trim();
  const location = String(form.get('location') ?? '').trim();
  const typed = { reason, note, location };
  const target = await checkoutTarget(slug);
  if (!target) return { ...typed, error: 'closed' };
  if (!(GUEST_REASONS as readonly string[]).includes(reason)) return { ...typed, error: 'reason' };
  if (note.length > NOTE_MAX) return { ...typed, error: 'noteTooLong' };
  if (location.length > LOCATION_MAX) return { ...typed, error: 'locationTooLong' };
  const limit = await limitAction('assistanceRequest', {
    identity: ticketToken.split('~')[0] ?? ticketToken,
    scope: `assistance:${target.eventId}`,
  });
  if (!limit.allowed) return { ...typed, error: 'rateLimited', retryMinutes: retryAfterMinutes(limit) };
  const locale = await getLocale();
  let statusToken: string;
  try {
    ({ statusToken } = await executeCommand(
      guestRequestCommand,
      { eventId: target.eventId, ticketToken, reason: reason as never, note, location },
      createCtx({ orgId: target.orgId, locale }),
      ports,
    ));
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const error: GuestHelpError =
      err.code === 'not_found'
        ? 'invalidTicket'
        : err.code === 'conflict'
          ? 'tooMany'
          : err.code === 'invalid_state' || err.code === 'module_not_enabled'
            ? 'closed'
            : err.code === 'validation_failed'
              ? 'reason'
              : 'internal';
    return { ...typed, error };
  }
  return redirect({ href: `/events/${slug}/seat-finder/help/${encodeURIComponent(statusToken)}`, locale });
}
