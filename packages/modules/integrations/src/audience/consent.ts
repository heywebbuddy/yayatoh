/**
 * Consent rules for marketing-tool syncs (M6.4d: Mailchimp, Klaviyo, HubSpot), pure and
 * browser-safe. **Consent first:** a contact is sent to a provider as a subscriber only with
 * express email marketing consent in the crm ledger, no marketing unsubscribe, no address
 * suppression (bounce, complaint) and no erasure since that consent. Suppressions win over
 * consent. Nothing here ever grants consent from what a provider says.
 */

/** The facts about one contact that decide whether it may be pushed. */
export interface ConsentFacts {
  /** The latest email marketing consent row (null: none recorded, which means no consent). */
  readonly consent: 'granted' | 'withdrawn' | 'unknown_legacy' | null;
  /** On the marketing unsubscribe list (`suppressions`, any source). */
  readonly unsubscribed: boolean;
  /** The address bounced or complained (`address_suppressions`). */
  readonly suppressed: boolean;
  /** The address was erased platform-wide and no consent was given after that. */
  readonly erased: boolean;
}

/**
 * Where a contact stands for marketing email:
 * - `subscribed`: may be pushed as a subscriber;
 * - `unsubscribed`: said no (withdrawn, unsubscribed, suppressed or erased); a provider that has
 *   the person gets the unsubscribe;
 * - `none`: no consent either way (never asked, or a legacy unknown); never pushed as a subscriber,
 *   and nothing is changed at a provider that already has the person.
 */
export type SubscriptionStatus = 'subscribed' | 'unsubscribed' | 'none';

export function subscriptionStatus(f: ConsentFacts): SubscriptionStatus {
  if (f.erased || f.suppressed || f.unsubscribed || f.consent === 'withdrawn') return 'unsubscribed';
  return f.consent === 'granted' ? 'subscribed' : 'none';
}

/**
 * A list member's status at Mailchimp or Klaviyo (what a push sends), or null when the contact is
 * not sent at all:
 * - in the audience and `subscribed` → `subscribed`;
 * - already on the list (linked) and said no → `unsubscribed` (the consent change propagates);
 * - already on the list and no longer in the audience (or no consent either way) → `archived`
 *   (taken off the list, not unsubscribed);
 * - not on the list and not `subscribed` in the audience → null: **never pushed**.
 */
export type MemberStatus = 'subscribed' | 'unsubscribed' | 'archived';

export function memberStatus(input: {
  readonly status: SubscriptionStatus;
  readonly inAudience: boolean;
  readonly linked: boolean;
}): MemberStatus | null {
  if (input.status === 'unsubscribed') return input.linked ? 'unsubscribed' : null;
  if (input.status === 'subscribed' && input.inAudience) return 'subscribed';
  return input.linked ? 'archived' : null;
}

/**
 * A HubSpot contact push (two-way contact sync): `subscribed` contacts are created or updated;
 * contacts HubSpot already has (linked) are updated, and get the opt-out when they said no;
 * anyone else is never sent.
 */
export function hubspotContactAction(input: {
  readonly status: SubscriptionStatus;
  readonly linked: boolean;
}): 'upsert' | 'update' | 'opt_out' | null {
  if (input.status === 'subscribed') return 'upsert';
  if (!input.linked) return null;
  return input.status === 'unsubscribed' ? 'opt_out' : 'update';
}

/** What a provider told us about a person, as a consent change here (never a grant). */
export type InboundChange = 'unsubscribed' | 'cleaned' | 'complained';
export const INBOUND_CHANGES = [
  'unsubscribed',
  'cleaned',
  'complained',
] as const satisfies readonly InboundChange[];
