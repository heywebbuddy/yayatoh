import { type ColumnId, privateColumnList } from './registry.ts';

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
  // The access archive (M6.1c) is the person's own data from every module: their personal and holder
  // values, plus the organizer's labels about them. Never a secret or another internal column.
  dsar: [
    ...privateColumnList()
      .filter((c) => c.rule.class === 'personal' || c.rule.class === 'holder')
      .map((c) => c.id),
    'attendees.attendees.labels',
    'crm.event_participation.labels',
    'crm.contact_profile.labels',
    // The wedding sub-events the guest is invited to: their RSVP page shows them the same names.
    'guests.sub_events.name',
  ],
  // The activity log for owners and admins: who did it and to what.
  audit: ['platform.audit_events.actor', 'platform.audit_events.target_id'],
  // An audience (M3.6a): the contact's name and email; counts, dates and consent codes only.
  audience: ['crm.contacts.name', 'crm.contacts.email'],
} as const satisfies Record<string, readonly ColumnId[]>;

/**
 * M4.5a: a guest website once the visitor proved its password: the hosts' own content and the
 * program (sub-event names and places, venues are public). Never a guest, a party, an answer or
 * a contact detail (P4-3); the locked gate is a public page (no canary at all).
 */
export const GUEST_SITE_ALLOW: readonly ColumnId[] = [
  'guests.sites.title',
  'guests.sites.intro',
  'guests.site_blocks.heading',
  'guests.site_blocks.content',
  'guests.sub_events.name',
  'guests.sub_events.place',
];

/**
 * Batch 3j merge: what a party's own pages (reached by its signed link: the guest hub M4.7a, the
 * seat page M4.4a, the card page M4.8e) may show — the party's names and envelope, its guests'
 * names (and, on the seat page, the host-typed names of tablemates, P4-3 d), their meal choices,
 * the program they are invited to and the menu, and on the hub the party's own tickets (holder and
 * short code, as on its order page). Never contacts, private answers, notes or tags.
 */
export const PARTY_ALLOW: readonly ColumnId[] = [
  'guests.parties.name',
  'guests.parties.envelope_name',
  'guests.guests.first_name',
  'guests.guests.last_name',
  'guests.guests.meal',
  'guests.sub_events.name',
  'guests.sub_events.place',
  'guests.menu_options.label',
  'ticketing.tickets.holder_name',
  'ticketing.tickets.short_code',
];
