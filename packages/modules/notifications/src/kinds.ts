import type { NotificationChannel } from '@yayatoh/platform';
import type { OrgRole } from '@yayatoh/tenancy';
import type { WhatsAppCategory } from './policy/rules.ts';
import type { CATEGORIES, PREFERENCE_CHANNELS } from './schema.ts';

export type Category = (typeof CATEGORIES)[number];
export type PreferenceChannel = (typeof PREFERENCE_CHANNELS)[number];

export interface KindDefinition {
  readonly category: Category;
  /** Channels used when the intent does not name its own. */
  readonly channels: readonly NotificationChannel[];
  /** Urgent messages ignore quiet hours (a ticket link the buyer is waiting for). */
  readonly urgent: boolean;
  /** Member notifications: who in the org gets them (by role). */
  readonly audience?: readonly OrgRole[];
  /** Params that must be present for the template to render. */
  readonly params: readonly string[];
  /** Meta's template category on WhatsApp (M3.5a); defaults from the category (`whatsappCategoryOf`). */
  readonly whatsapp?: WhatsAppCategory;
}

const SALES_TEAM: readonly OrgRole[] = ['owner', 'admin', 'manager', 'finance', 'box_office'];
const MESSAGES_TEAM: readonly OrgRole[] = ['owner', 'admin', 'manager', 'marketing', 'box_office'];
/** Who can triage fraud signals (`events:write`). */
const SECURITY_TEAM: readonly OrgRole[] = ['owner', 'admin', 'manager'];

/**
 * The message kinds registry (M1.10). Every message the platform sends is one of these; the
 * template, category (unsubscribe and preference scope) and quiet-hours rule come from here.
 */
export const KINDS = {
  'orders.tickets': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['url', 'name', 'eventName', 'count'],
  },
  'orders.refund': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['url', 'name', 'eventName', 'amountMinor', 'currency', 'fully'],
  },
  // M3.10b: a buyer asked for a refund (owners, admins and finance answer it within the SLA), the
  // organizer declined one (the buyer gets the reason), an event was postponed (tickets stay valid).
  'orders.refund-requested': {
    category: 'sales',
    channels: ['in_app', 'email'],
    urgent: true,
    audience: ['owner', 'admin', 'finance'],
    params: ['name', 'eventName', 'count'],
  },
  'orders.refund-declined': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['url', 'name', 'eventName', 'reason'],
  },
  // M3.10c support tools: a credit note (store credit code or recorded refund), a support macro's
  // reply, an approaching dispute evidence deadline (finance), and ticket transfers (the claim link
  // to the recipient, then the outcome to both sides).
  'orders.credit-note': {
    category: 'transactional',
    channels: ['email'],
    urgent: false,
    params: ['url', 'name', 'eventName', 'number', 'amountMinor', 'currency', 'storeCredit', 'code'],
  },
  // M5.1d: a pay-later invoice (number, amount, due date; the link views, downloads and pays it).
  'orders.invoice': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['url', 'name', 'eventName', 'number', 'amountMinor', 'currency', 'dueOn'],
  },
  'orders.support-reply': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['url', 'name', 'eventName', 'subject', 'body'],
  },
  'payments.dispute-deadline': {
    category: 'sales',
    channels: ['in_app', 'email'],
    urgent: true,
    audience: ['owner', 'admin', 'finance'],
    params: ['eventName', 'amountMinor', 'currency', 'hours'],
  },
  'ticketing.transfer-offered': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['url', 'name', 'fromName', 'eventName'],
  },
  'ticketing.transfer-completed': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['name', 'toName', 'eventName'],
  },
  'ticketing.transfer-received': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['url', 'name', 'fromName', 'eventName'],
  },
  // M4.2b gala tables: a table's claim link to its buyer (after payment, on request, or the
  // host's naming reminder: `reminder` = 1).
  'orders.table-naming': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['url', 'name', 'eventName', 'tableName', 'size', 'missing', 'reminder'],
  },
  'events.postponed': {
    category: 'transactional',
    channels: ['email'],
    urgent: false,
    params: ['url', 'name', 'eventName'],
  },
  'events.reminder': {
    category: 'reminders',
    channels: ['email', 'push'],
    urgent: false,
    params: ['url', 'name', 'eventName', 'startsAt', 'timeZone', 'venue'],
  },
  'tenancy.invitation': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['url', 'role', 'orgName'],
  },
  // M4.2a: an invitation to one event as co-host or planner.
  'tenancy.event-invitation': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['url', 'role', 'orgName', 'eventName'],
  },
  'ticketing.claim-link': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['url', 'eventName'],
  },
  'ticketing.holder-link': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['url', 'eventName'],
  },
  // Organizer actions on tickets (M1.8f bulk actions): a resent ticket, a cancelled one.
  'ticketing.tickets-resent': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['url', 'name', 'eventName', 'code'],
  },
  'ticketing.ticket-cancelled': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['name', 'eventName', 'code'],
  },
  'seating.finder-code': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['code', 'eventName', 'url', 'minutes'],
  },
  /** M1.5f: sent at once by the web app (never queued: the code is never stored). */
  'guest.checkout-code': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['code', 'minutes'],
  },
  'guest.sign-in': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['code', 'url', 'minutes', 'linkMinutes', 'site'],
  },
  // M5.3a portal accounts (P5-7): the invitation (queued) and the sign-in code with its magic link
  // (sent at once by the web app, never queued, like guest.sign-in).
  'portal.invite': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['url', 'eventName', 'role'],
  },
  'portal.sign-in': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['code', 'url', 'minutes', 'linkMinutes', 'eventName'],
  },
  // M5.3a: "remind whoever is missing X" and the scheduled reminder before a task is due.
  'program.task-reminder': {
    category: 'transactional',
    channels: ['email'],
    urgent: false,
    params: ['url', 'eventName', 'title', 'until', 'timeZone'],
  },
  // M6.1c data-subject requests: the self-service confirmation code (sent at once by the web app,
  // never queued, like guest.sign-in), then the archive link or the erasure receipt link.
  'privacy.request-code': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['code', 'minutes', 'kind'],
  },
  'privacy.archive-ready': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['url', 'days'],
  },
  'privacy.erasure-done': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['url'],
  },
  'guest.waitlist-code': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['code', 'minutes', 'eventName'],
  },
  'orders.waitlist-joined': {
    category: 'transactional',
    channels: ['email'],
    urgent: false,
    params: ['url', 'name', 'eventName', 'passName', 'count', 'position'],
  },
  'orders.waitlist-offer': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['url', 'name', 'eventName', 'passName', 'count', 'until', 'timeZone'],
  },
  'orders.waitlist-expired': {
    category: 'transactional',
    channels: ['email'],
    urgent: false,
    params: ['url', 'name', 'eventName', 'passName'],
  },
  // Session waitlist promotion (M5.2b, P5-9): enrolled at once, or offered a place until a time.
  'registration.session-enrolled': {
    category: 'transactional',
    channels: ['email'],
    urgent: false,
    params: ['url', 'name', 'eventName', 'sessionTitle', 'startsAt', 'timeZone'],
  },
  'registration.session-offer': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['url', 'name', 'eventName', 'sessionTitle', 'startsAt', 'until', 'timeZone'],
  },
  // Registration form save and resume (M5.1b): the person asked for their link.
  'forms.resume': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['url', 'name', 'eventName', 'days'],
  },
  // Apply-to-attend decisions (M5.1c): the applicant's link (pay step or confirmation), the reason.
  'registration.approved': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['url', 'name', 'eventName', 'typeName', 'body'],
  },
  'registration.denied': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['url', 'name', 'eventName', 'typeName', 'body'],
  },
  'orders.order-link': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['url', 'name', 'eventName', 'reason'],
  },
  'attendees.message': {
    category: 'event_updates',
    channels: ['email'],
    urgent: false,
    params: ['subject', 'body', 'name', 'eventName'],
  },
  'messaging.announcement': {
    category: 'event_updates',
    channels: ['email', 'push'],
    urgent: false,
    params: ['subject', 'body', 'name', 'eventName', 'replyUrl'],
  },
  'messaging.reply': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['body', 'name', 'replyUrl'],
  },
  // Surveys (M3.9a): event_updates, not marketing. They ask the people who came to one event
  // about that event, from its organizer (a relationship message, like guest emails and
  // announcements): no marketing consent is needed, but the recipient can switch event updates
  // off or unsubscribe, and quiet hours apply. Never transactional: nobody asked for them.
  'surveys.invite': {
    category: 'event_updates',
    channels: ['email'],
    urgent: false,
    params: ['url', 'name', 'eventName', 'title'],
  },
  'surveys.reminder': {
    category: 'event_updates',
    channels: ['email'],
    urgent: false,
    params: ['url', 'name', 'eventName', 'title'],
  },
  // Journeys (M3.7a): a step's message, written by the organizer (subject and body), sent on the
  // step's own channel (email, SMS, WhatsApp or push) to one person about one event. Reminders:
  // the person can switch them off, texts need informational consent, quiet hours apply.
  // M4.1f: a wedding party's invitation (the host's wording, the party's RSVP link) and the RSVP
  // deadline reminders of its journey. Transactional (P4-3: guests are never marketing; no
  // consent or contact needed), not urgent: quiet hours apply in the event's timezone.
  'guests.invitation': {
    category: 'transactional',
    channels: ['email'],
    urgent: false,
    params: ['url', 'subject', 'message', 'eventName'],
  },
  'guests.rsvp-reminder': {
    category: 'transactional',
    channels: ['email'],
    urgent: false,
    params: ['url', 'name', 'eventName', 'deadline'],
  },
  'automations.message': {
    category: 'reminders',
    channels: ['email'],
    urgent: false,
    params: ['subject', 'body', 'name', 'eventName'],
  },
  'sales.order_paid': {
    category: 'sales',
    channels: ['in_app', 'email', 'push'],
    urgent: true,
    audience: SALES_TEAM,
    params: ['name', 'eventName', 'count', 'amountMinor', 'currency'],
  },
  'messaging.contact_replied': {
    category: 'messages',
    channels: ['in_app', 'email', 'push'],
    urgent: true,
    audience: MESSAGES_TEAM,
    params: ['name', 'eventName'],
  },
  // A payout account was connected or its bank changed (M1.2c): the owners hear about it at once,
  // so a takeover is noticed inside the 24 h hold before any money moves to it.
  'payments.destination-changed': {
    category: 'transactional',
    channels: ['in_app', 'email'],
    urgent: true,
    audience: ['owner'],
    params: ['url', 'reason', 'holdUntil', 'timeZone'],
  },
  // Platform staff started acting as a member (M1.2e, decision D14): the owners hear at once,
  // with the reason and when it ends.
  'tenancy.staff-access': {
    category: 'transactional',
    channels: ['in_app', 'email'],
    urgent: true,
    audience: ['owner'],
    params: ['url', 'member', 'reason', 'until', 'timeZone'],
  },
  // Staff suspended, reactivated or closed the org (M1.3f): the owners hear at once. The staff
  // note is not included.
  'tenancy.org-status': {
    category: 'transactional',
    channels: ['in_app', 'email'],
    urgent: true,
    audience: ['owner'],
    params: ['url', 'status'],
  },
  // A high-severity fraud signal (M1.9e: door scans, checkout risk, chat reports). Not urgent: the
  // email waits out the member's quiet hours; in-app is immediate. One per subject per hour.
  'security.fraud_signal': {
    category: 'security',
    channels: ['in_app', 'email', 'push'],
    urgent: false,
    audience: SECURITY_TEAM,
    params: ['signal', 'eventName'],
  },
  // Promotional news to contacts who opted in (M3.5a; campaigns send it from M3.6b). Needs
  // marketing consent on every channel; WhatsApp marketing to US numbers is blocked (D16).
  'marketing.message': {
    category: 'marketing',
    channels: ['email'],
    urgent: false,
    whatsapp: 'marketing',
    params: ['subject', 'body', 'name'],
  },
  // A campaign test send (M3.6b) to up to five addresses the sender typed: clearly marked, never
  // counted in the campaign's results, sent at once (the sender is waiting for it). The body is
  // the campaign's stored content; transactional so the consent gate (marketing) doesn't apply.
  'campaigns.test': {
    category: 'transactional',
    channels: ['email'],
    urgent: true,
    params: ['subject'],
  },
  // The org's complaint rate went over the limit and optional messaging paused itself (M3.5a).
  'messaging.auto_paused': {
    category: 'transactional',
    channels: ['in_app', 'email'],
    urgent: true,
    audience: ['owner', 'admin'],
    params: ['rateBps'],
  },
  // M3.2b: Command Center alerts, sent to the members the alerts module's per-role routing
  // reaches. In-app, email and push go out at once; a text goes to the member's own alert number
  // as `alerts.alert-text`, which waits out quiet hours.
  'alerts.alert': {
    category: 'transactional',
    channels: ['in_app', 'email', 'push'],
    urgent: true,
    params: ['rule', 'count', 'severity', 'eventName'],
  },
  'alerts.alert-text': {
    category: 'transactional',
    channels: ['sms'],
    urgent: false,
    params: ['rule', 'count', 'severity', 'eventName'],
  },
  // M3.3a live-critical escalation: the same text to a member on duty at the event's doors, sent
  // at once (devices offline, capacity reached, a payment outage while the doors are open).
  'alerts.alert-urgent-text': {
    category: 'transactional',
    channels: ['sms'],
    urgent: true,
    params: ['rule', 'count', 'severity', 'eventName'],
  },
  'notifications.test': {
    category: 'transactional',
    channels: ['in_app', 'push'],
    urgent: true,
    params: [],
  },
  // M4.8b: a donation receipt (one per payment) and the year-end giving statement, to the donor
  // only. The receipt's own wording (`body`) is the donations module's legal-copy template.
  'donations.receipt': {
    category: 'transactional',
    channels: ['email'],
    urgent: false,
    params: ['url', 'name', 'eventName', 'amountMinor', 'currency', 'deductible', 'body'],
  },
  'donations.year-end-statement': {
    category: 'transactional',
    channels: ['email'],
    urgent: false,
    params: ['url', 'name', 'year', 'amountMinor', 'currency', 'body'],
  },
} as const satisfies Record<string, KindDefinition>;

export type MessageKind = keyof typeof KINDS;
export const MESSAGE_KINDS = Object.keys(KINDS) as MessageKind[];
/** Kinds rendered as emails (everything a customer can receive). */
export const EMAIL_KINDS = MESSAGE_KINDS.filter((k) =>
  (KINDS[k].channels as readonly string[]).includes('email'),
);

export function isMessageKind(v: string): v is MessageKind {
  return Object.hasOwn(KINDS, v);
}

/** The WhatsApp template category of a kind: its own, else marketing for marketing, else utility. */
export function whatsappCategoryOf(kind: string): WhatsAppCategory {
  const def = kindOf(kind);
  return def.whatsapp ?? (def.category === 'marketing' ? 'marketing' : 'utility');
}

export function kindOf(kind: string): KindDefinition {
  if (!isMessageKind(kind)) throw new Error(`Unknown message kind: ${kind}`);
  return KINDS[kind];
}

/** Categories a person can switch off (never transactional). */
export const OPTIONAL_CATEGORIES = [
  'reminders',
  'event_updates',
  'marketing',
  'sales',
  'messages',
  'security',
] as const;
export type OptionalCategory = (typeof OPTIONAL_CATEGORIES)[number];

/** Categories shown on a member's preferences page. */
export const MEMBER_CATEGORIES = ['sales', 'messages', 'security', 'marketing'] as const;

/**
 * Defaults when a person has no row: in-app everything; email and push for conversations;
 * SMS off; marketing off everywhere (consent is never invented, roadmap §7.5).
 */
export function defaultPreference(category: Category, channel: PreferenceChannel): boolean {
  if (category === 'transactional') return true;
  if (category === 'marketing') return false;
  if (channel === 'sms') return false;
  if (channel === 'in_app') return true;
  if (category === 'sales') return false;
  return true;
}
