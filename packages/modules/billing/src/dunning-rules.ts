import type { SubscriptionStatus } from './provider/port.ts';

/**
 * Dunning (M6.6b, P6-7): a failed renewal never deletes anything. The org first gets a grace
 * period with every write working (and a banner saying the payment failed); after it, or as soon
 * as the provider stops retrying, the org is read-only until it pays: reads, exports and door
 * scans keep working, writes are refused with a clear message, nothing is deleted.
 */
export const DUNNING_GRACE_DAYS = 14;

/** Where an org stands with its subscription payments. */
export type BillingStanding = 'good' | 'grace' | 'read_only';

export interface DunningState {
  readonly dunningStartedAt: Date | null;
  readonly graceEndsAt: Date | null;
  readonly readOnlyAt: Date | null;
}

export const NO_DUNNING: DunningState = { dunningStartedAt: null, graceEndsAt: null, readOnlyAt: null };

/** The org's standing at `now` (the grace period ends on its own: no job has to flip it). */
export function billingStanding(s: DunningState, now: Date): BillingStanding {
  if (!s.dunningStartedAt) return 'good';
  if (s.readOnlyAt && s.readOnlyAt <= now) return 'read_only';
  if (s.graceEndsAt && s.graceEndsAt <= now) return 'read_only';
  return 'grace';
}

/** When the org became (or becomes) read-only: the earlier of the hard stop and the grace end. */
export function readOnlySince(s: DunningState): Date | null {
  if (!s.dunningStartedAt) return null;
  const times = [s.readOnlyAt, s.graceEndsAt].filter((d): d is Date => d !== null);
  return times.length ? new Date(Math.min(...times.map((d) => d.getTime()))) : null;
}

export type DunningChange = 'started' | 'hardened' | 'resolved' | null;

/**
 * The dunning state after a subscription event (the provider's event time `at`):
 * - `past_due`: the renewal failed; grace starts (once: a retry that fails again changes nothing);
 * - `unpaid`: the provider stopped retrying, read-only now;
 * - `canceled` / `incomplete_expired` while in dunning: the subscription ended unpaid, read-only
 *   until the org pays (a cancellation by the org itself, while paid up, changes nothing);
 * - `active` / `trialing`: paid, everything clears.
 */
export function nextDunning(
  prev: DunningState,
  status: SubscriptionStatus,
  at: Date,
  graceDays = DUNNING_GRACE_DAYS,
): { state: DunningState; change: DunningChange } {
  const inDunning = prev.dunningStartedAt !== null;
  if (status === 'active' || status === 'trialing')
    return inDunning ? { state: NO_DUNNING, change: 'resolved' } : { state: prev, change: null };
  if (status === 'past_due') {
    if (inDunning) return { state: prev, change: null };
    return {
      state: {
        dunningStartedAt: at,
        graceEndsAt: new Date(at.getTime() + graceDays * 86_400_000),
        readOnlyAt: null,
      },
      change: 'started',
    };
  }
  const hard =
    status === 'unpaid' || (inDunning && (status === 'canceled' || status === 'incomplete_expired'));
  if (!hard) return { state: prev, change: null };
  if (inDunning && prev.readOnlyAt) return { state: prev, change: null };
  return {
    state: {
      dunningStartedAt: prev.dunningStartedAt ?? at,
      graceEndsAt: prev.graceEndsAt ?? at,
      readOnlyAt: at,
    },
    change: 'hardened',
  };
}

/**
 * Commands a read-only org's members may still run: paying and changing the plan (the way out),
 * personal and safety actions, and the door (scans of tickets already sold). Exports are allowed
 * by category: the organizer can always take their data out.
 */
export const READ_ONLY_ALLOWED: ReadonlySet<string> = new Set([
  'billing.payOutstanding',
  'billing.changePlan',
  'notifications.markInboxRead',
  'notifications.setMyPreferences',
  'notifications.registerPushToken',
  'notifications.unsubscribe',
  'notifications.resubscribe',
  'messaging.contactBlock',
  'messaging.contactReport',
  'checkin.scanTicket',
  'checkin.undoAdmission',
  'checkin.syncScans',
  'checkin.heartbeat',
]);

export interface ReadOnlySubject {
  readonly standing: BillingStanding;
  /** `user`, `api_key`, `system`, `portal`, `anonymous`. */
  readonly actorType: string;
  /** The user's role in the org (null: not a member, e.g. a ticket buyer). */
  readonly memberRole: string | null;
  readonly command: string;
  readonly category?: string;
}

/**
 * Whether a write is refused because the org is read-only for billing. Only the org's own side is
 * read-only: its members and its API keys. Ticket buyers, guests, speakers and exhibitors in
 * their portals, door devices and the platform (webhooks, the worker, staff) carry on, so a
 * billing problem between the organizer and the platform never strands their attendees.
 */
export function billingWriteRefused(s: ReadOnlySubject): boolean {
  if (s.standing !== 'read_only') return false;
  if (READ_ONLY_ALLOWED.has(s.command) || s.category === 'export') return false;
  if (s.actorType === 'api_key') return true;
  if (s.actorType === 'user') return s.memberRole !== null;
  return false;
}
