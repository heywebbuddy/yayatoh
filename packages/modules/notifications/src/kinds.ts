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
  // The org's complaint rate went over the limit and optional messaging paused itself (M3.5a).
  'messaging.auto_paused': {
    category: 'transactional',
    channels: ['in_app', 'email'],
    urgent: true,
    audience: ['owner', 'admin'],
    params: ['rateBps'],
  },
  'notifications.test': {
    category: 'transactional',
    channels: ['in_app', 'push'],
    urgent: true,
    params: [],
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
