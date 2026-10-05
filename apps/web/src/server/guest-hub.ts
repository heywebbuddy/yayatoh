import 'server-only';
import { DEFAULT_LOCALE } from '@yayatoh/contracts';
import {
  fakeGuestPassProvider,
  type GuestPassProvider,
  markRsvpViewedCommand,
  type PartyHubDto,
  partyHubQuery,
  rsvpLinkRef,
} from '@yayatoh/guests';
import { createCtx, executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import { partySeatsTx } from '@yayatoh/seating';
import { partyTicketsTx } from '@yayatoh/ticketing';
import { ports } from './ports.ts';

/**
 * The party guest hub (M4.7a): the guests module's hub query with seating's and ticketing's
 * readers, and the wallet pass provider. Apple and Google need the owner's accounts (M1.5e2), so
 * every environment uses the fake adapter until they exist (owner inbox).
 */
export const partyHub = partyHubQuery({ seats: partySeatsTx, tickets: partyTicketsTx });

export const guestPassProvider: GuestPassProvider = fakeGuestPassProvider();

/** A path in a locale (the default locale has no prefix: `as-needed`). */
export const localePath = (path: string, locale?: string) =>
  `${locale && locale !== DEFAULT_LOCALE ? `/${locale}` : ''}${path}`;

/** The hub's path for a token. */
export const hubPath = (token: string, locale?: string) =>
  localePath(`/hub/${encodeURIComponent(token)}`, locale);

/**
 * The party behind a hub token, in its org (the tenant comes from the signed token, never a
 * header), or null for any bad, reset or foreign link and for an org without the guests module.
 */
export async function loadPartyHub(
  token: string,
  locale: string,
  opts: { markViewed?: boolean } = {},
): Promise<PartyHubDto | null> {
  const ref = await rsvpLinkRef(token);
  if (!ref) return null;
  const ctx = createCtx({ orgId: ref.orgId, locale });
  const hub = await executeQuery(partyHub, { token }, ctx, ports).catch((err) => {
    if (isDomainError(err) && (err.code === 'not_found' || err.code === 'module_not_enabled')) return null;
    throw err;
  });
  // Opening the hub is opening the invitation: `viewed` on the first open, like the RSVP page. A
  // read-only freeze (or any refusal) never stops the page.
  if (hub?.state === 'ok' && !hub.viewed && opts.markViewed)
    await executeCommand(markRsvpViewedCommand, { token }, ctx, ports).catch((err) => {
      if (!isDomainError(err)) throw err;
    });
  return hub;
}
