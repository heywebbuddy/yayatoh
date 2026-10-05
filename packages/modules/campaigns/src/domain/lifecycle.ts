import { defineStateMachine } from '@yayatoh/kernel';

export const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'sending', 'paused', 'sent', 'cancelled'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/**
 * A campaign's lifecycle (M3.6b): draft → scheduled → sending → sent, with pause/resume while
 * sending and cancel before it is done. Editing is for drafts only.
 */
export const campaignLifecycle = defineStateMachine({
  name: 'campaign',
  states: CAMPAIGN_STATUSES,
  initial: 'draft',
  events: {
    schedule: { from: ['draft'], to: 'scheduled' },
    unschedule: { from: ['scheduled'], to: 'draft' },
    start: { from: ['draft', 'scheduled'], to: 'sending' },
    pause: { from: ['sending'], to: 'paused' },
    resume: { from: ['paused'], to: 'sending' },
    complete: { from: ['sending'], to: 'sent' },
    cancel: { from: ['scheduled', 'sending', 'paused'], to: 'cancelled' },
  },
});
export type CampaignEvent = keyof typeof campaignLifecycle.events;

/**
 * Why a contact in the audience is not sent the campaign, checked in this order at the snapshot
 * (the dispatcher's policy gate checks consent, suppressions and unsubscribes again at send time).
 */
export const EXCLUSION_REASONS = [
  'no_address',
  'erased',
  'suppressed',
  'unsubscribed',
  'consent_withdrawn',
  'consent_missing',
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export interface ReachFacts {
  /** The contact's address for the channel (email, or an E.164 number for texts). */
  readonly address: string | null;
  /** The latest marketing consent for the channel in the crm ledger (null: none recorded). */
  readonly consent: 'granted' | 'withdrawn' | 'unknown_legacy' | null;
  /** A bounce or complaint on the address (or the organizer was blocked). */
  readonly suppressed: boolean;
  /** Unsubscribed from the org's marketing. */
  readonly unsubscribed: boolean;
  /** The address was erased platform-wide and no new consent was given since. */
  readonly erased: boolean;
}

/** The snapshot rule: null means the contact gets the campaign. Only express consent counts. */
export function exclusionReason(f: ReachFacts): ExclusionReason | null {
  if (!f.address) return 'no_address';
  if (f.erased) return 'erased';
  if (f.suppressed) return 'suppressed';
  if (f.unsubscribed) return 'unsubscribed';
  if (f.consent === 'withdrawn') return 'consent_withdrawn';
  if (f.consent !== 'granted') return 'consent_missing';
  return null;
}
