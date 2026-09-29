/**
 * Messaging policy defaults (M3.5a). The quota and cap numbers are **placeholders pending the
 * owner** (docs/decisions.md 2026-09-28, docs/owner-inbox.md): conservative values so a
 * misconfigured org can't run up SMS/WhatsApp costs before plans exist (M6.6). Staff set per-org
 * quota limits in the console; organizers tune their own frequency caps within `CAP_LIMITS`.
 */
export const QUOTA_CHANNELS = ['email', 'sms', 'whatsapp', 'push'] as const;
export type QuotaChannel = (typeof QUOTA_CHANNELS)[number];

/** Included per org per calendar month (org timezone). SMS counts segments; others messages. */
export const DEFAULT_MONTHLY_QUOTAS: Readonly<Record<QuotaChannel, number>> = {
  email: 10_000,
  sms: 500,
  whatsapp: 500,
  push: 50_000,
};

/** How long a message held for its quota waits before the gate looks again (a limit may rise). */
export const QUOTA_RECHECK_MS = 60 * 60_000;

/** Caps apply to these categories (never transactional or members' own alerts). */
export const CAP_CATEGORIES = ['reminders', 'event_updates', 'marketing'] as const;
export type CapCategory = (typeof CAP_CATEGORIES)[number];
/** `all` caps every optional message to one recipient on one channel from the org. */
export type CapScope = CapCategory | 'all';
export const CAP_SCOPES = [...CAP_CATEGORIES, 'all'] as const satisfies readonly CapScope[];

export interface FrequencyCap {
  readonly maxMessages: number;
  readonly windowHours: number;
}

export const DEFAULT_CAPS: Readonly<Record<CapScope, FrequencyCap>> = {
  reminders: { maxMessages: 3, windowHours: 24 },
  event_updates: { maxMessages: 3, windowHours: 24 },
  marketing: { maxMessages: 2, windowHours: 168 },
  all: { maxMessages: 5, windowHours: 24 },
};

/** Bounds an organizer may set (a cap can't be switched off, nor made silly). */
export const CAP_LIMITS = { maxMessages: { min: 1, max: 20 }, windowHours: { min: 1, max: 720 } } as const;

/**
 * Complaint-rate auto-pause (roadmap M3.5 acceptance: above 0.3 % the org pauses). The rate is
 * complaints ÷ optional (non-transactional) emails sent over the rolling window (and since the
 * last auto-pause, so a lifted org starts clean); it needs a minimum volume to mean anything.
 */
export const COMPLAINT_RATE_LIMIT_BPS = 30; // 0.30 %, in basis points
export const COMPLAINT_WINDOW_DAYS = 30;
export const COMPLAINT_MIN_VOLUME = 100;
