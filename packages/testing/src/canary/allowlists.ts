import type { ColumnId } from './registry.ts';

/**
 * What each org-scoped or door-scoped response may show of the org's own private data
 * (roadmap §9: "org-scoped responses may show the org its own data only where the allowlist
 * says so"). Mirrors the wire allowlists (`packages/api-v1/src/resources.ts`, the scanner
 * manifest, the export columns); a canary of any other column fails the crawl. `secret` columns
 * are never allowed, whatever is listed.
 */
const ATTENDEE: ColumnId[] = [
  'attendees.attendees.name',
  'attendees.attendees.email',
  'attendees.attendees.labels',
];
const ORDER: ColumnId[] = [
  'orders.orders.buyer_name',
  'orders.orders.buyer_email',
  'orders.orders.promo_code',
];
const ORDER_TICKET: ColumnId[] = [
  'ticketing.tickets.short_code',
  'ticketing.tickets.holder_name',
  'ticketing.tickets.holder_email',
  'ticketing.tickets.seat_label',
];

/** `/v1` org routes (by pattern) read with the org's own API key. */
export const V1_ALLOW: Readonly<Record<string, readonly ColumnId[]>> = {
  '/orgs/{org}': [],
  '/orgs/{org}/events': [],
  '/orgs/{org}/events/{eventId}': [],
  '/orgs/{org}/events/{eventId}/ticket-types': [],
  '/orgs/{org}/events/{eventId}/orders': ORDER,
  '/orgs/{org}/orders/{orderId}': [...ORDER, ...ORDER_TICKET],
  '/orgs/{org}/events/{eventId}/attendees': ATTENDEE,
  '/orgs/{org}/events/{eventId}/attendees/{attendeeId}': ATTENDEE,
  '/orgs/{org}/attendees/search': ['attendees.attendees.name', 'attendees.attendees.email'],
};

/**
 * The door (a device token's offline manifest): the holder's name, the ticket code and seat to
 * check, and the checkpoint names. Contact details only as salted hashes (roadmap §5.4).
 */
export const DOOR_ALLOW: readonly ColumnId[] = [
  'ticketing.tickets.holder_name',
  'ticketing.tickets.short_code',
  'ticketing.tickets.seat_label',
  'checkin.checkpoints.name',
];

/** Export files (owners, admins and the roles the console lets download them). */
export const EXPORT_ALLOW = {
  attendees: [...ATTENDEE, 'ticketing.tickets.short_code'],
  bookings: ORDER,
  // The access request is the person's own data (their guest record and organizer labels).
  dsar: ATTENDEE,
  // The activity log for owners and admins: who did it and to what.
  audit: ['platform.audit_events.actor', 'platform.audit_events.target_id'],
  // An audience (M3.6a): the contact's name and email; counts, dates and consent codes only.
  audience: ['crm.contacts.name', 'crm.contacts.email'],
} as const satisfies Record<string, readonly ColumnId[]>;
