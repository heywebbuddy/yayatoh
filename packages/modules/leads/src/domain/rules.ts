/**
 * Pure rules of lead retrieval (M5.6b; decisions P5-4 and P5-8). Shared by the server and the
 * Scan PWA's lead mode (`@yayatoh/leads/rules`), so it imports nothing with side effects.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** P5-4: capture opens 24 h before the event starts and closes 48 h after it ends. */
export const CAPTURE_OPENS_BEFORE_MS = 24 * HOUR;
export const CAPTURE_CLOSES_AFTER_MS = 48 * HOUR;
/** P5-4: notes and export stay open 90 days after the event ends; then lead access ends. */
export const ACCESS_DAYS_AFTER = 90;
/** A device clock may run this far ahead before its capture time is replaced by the server's. */
export const CLOCK_AHEAD_TOLERANCE_MS = 5 * 60_000;

export const RATINGS = ['hot', 'warm', 'cold'] as const;
export type Rating = (typeof RATINGS)[number];

export const MAX_QUALIFIERS = 10;
export const QUALIFIER_MAX = 60;
export const NOTES_MAX = 2000;
/** Scans per sync request (the PWA sends its queue in batches of this size). */
export const SYNC_BATCH_MAX = 200;

/** P5-8: what a scan may ever share. Phone and address are never shared. */
export const SHARED_FIELDS = ['name', 'job_title', 'company', 'email'] as const;
export type SharedField = (typeof SHARED_FIELDS)[number];

/** The wording of the exhibitor lead terms (legal copy; a new wording is a new version). */
export const LEAD_TERMS_VERSION = 1;

export interface CaptureWindow {
  readonly opensAt: Date;
  readonly closesAt: Date;
  readonly accessUntil: Date;
}

export function captureWindow(event: { readonly startsAt: Date; readonly endsAt: Date }): CaptureWindow {
  return {
    opensAt: new Date(event.startsAt.getTime() - CAPTURE_OPENS_BEFORE_MS),
    closesAt: new Date(event.endsAt.getTime() + CAPTURE_CLOSES_AFTER_MS),
    accessUntil: new Date(event.endsAt.getTime() + ACCESS_DAYS_AFTER * DAY),
  };
}

export type CaptureState = 'not_open' | 'open' | 'closed';

/** Whether a scan made at `at` may become a lead (closing time excluded). */
export function captureState(w: CaptureWindow, at: Date): CaptureState {
  if (at.getTime() < w.opensAt.getTime()) return 'not_open';
  if (at.getTime() >= w.closesAt.getTime()) return 'closed';
  return 'open';
}

/** Notes, ratings and export: open until 90 days after the event (then lead access ends). */
export const accessOpen = (w: CaptureWindow, now: Date) => now.getTime() < w.accessUntil.getTime();

/**
 * When an offline scan happened: the device's time, unless it claims to be in the future (a
 * clock running ahead), then the time the server received it. A scan made before capture closed
 * still counts when it syncs later (within the access period).
 */
export function captureTime(deviceAt: Date, receivedAt: Date): Date {
  return deviceAt.getTime() > receivedAt.getTime() + CLOCK_AHEAD_TOLERANCE_MS ? receivedAt : deviceAt;
}

/** The stamp of what a scan shared: the allowlist, plus email only with the attendee's consent. */
export function sharedFields(emailConsent: boolean): SharedField[] {
  return emailConsent ? ['name', 'job_title', 'company', 'email'] : ['name', 'job_title', 'company'];
}

/** Qualifier labels as the exhibitor admin typed them: trimmed, deduplicated (case-insensitive). */
export function normalizeQualifiers(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    const label = raw.trim().replace(/\s+/g, ' ');
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push(label);
  }
  return out;
}

/** The qualifiers of a lead: only labels the exhibitor defined, in the exhibitor's order. */
export function pickQualifiers(defined: readonly string[], chosen: readonly string[]): string[] {
  const want = new Set(chosen.map((c) => c.trim().toLowerCase()));
  return defined.filter((d) => want.has(d.toLowerCase()));
}

/** Notes sent with an offline scan of a lead that already has notes are added on a new line. */
export function mergeNotes(existing: string, added: string | null | undefined): string {
  const a = (added ?? '').trim();
  if (!a) return existing;
  if (!existing.trim()) return a.slice(0, NOTES_MAX);
  if (existing.includes(a)) return existing;
  return `${existing}\n${a}`.slice(0, NOTES_MAX);
}

/**
 * Own vs team: the exhibitor admin sees every lead of the exhibitor; staff see the leads they
 * scanned, or the whole team's when the admin shares them.
 */
export function canSeeLead(input: {
  readonly admin: boolean;
  readonly teamVisibility: boolean;
  readonly scannedByMe: boolean;
}): boolean {
  return input.admin || input.teamVisibility || input.scannedByMe;
}
