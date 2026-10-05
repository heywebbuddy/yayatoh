import type { ApiKeyScope } from '@yayatoh/tenancy';

/**
 * The Zapier app (M6.4c, `apps/zapier`): what it offers and the API key scope each part needs.
 * The console's Zapier page shows these; the app's own test checks that its triggers and actions
 * are exactly these. Zapier authenticates with an org API key (Settings → API keys), so there is
 * no OAuth connection to store: the key's scopes are the whole grant.
 */

export interface ZapierPart {
  /** The key in the Zapier app definition. */
  readonly key: string;
  readonly scope: ApiKeyScope;
}

/** REST-hook triggers: one public event type each (see the webhook catalog). */
export const ZAPIER_TRIGGERS: readonly (ZapierPart & { readonly event: string })[] = [
  { key: 'order_paid', event: 'order.paid', scope: 'webhooks:subscribe' },
  { key: 'ticket_admitted', event: 'ticket.admitted', scope: 'webhooks:subscribe' },
  { key: 'registration_submitted', event: 'form.registration_submitted', scope: 'webhooks:subscribe' },
  { key: 'event_published', event: 'event.published', scope: 'webhooks:subscribe' },
];

/** Actions on /v1. */
export const ZAPIER_ACTIONS: readonly ZapierPart[] = [
  { key: 'create_registration', scope: 'attendees:write' },
  { key: 'add_contact', scope: 'contacts:write' },
  { key: 'check_in', scope: 'checkin:scan' },
];

/** The hidden trigger behind the event picker (lists the org's events). */
export const ZAPIER_EVENT_PICKER: ZapierPart = { key: 'event_list', scope: 'events:read' };

/** Every scope a key needs for the whole app (the console suggests exactly these). */
export const ZAPIER_SCOPES: readonly ApiKeyScope[] = [
  ...new Set([...ZAPIER_TRIGGERS, ...ZAPIER_ACTIONS, ZAPIER_EVENT_PICKER].map((p) => p.scope)),
];
