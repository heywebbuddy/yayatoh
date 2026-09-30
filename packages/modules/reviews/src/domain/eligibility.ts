import { utcToZonedInput, zonedTimeToUtc } from '@yayatoh/kernel';

/** Reviews stay open this many local calendar days after the (last) ticket date ends. */
export const REVIEW_WINDOW_DAYS = 90;
/** Review text: plain text, at most this many characters. */
export const REVIEW_BODY_MAX = 1000;
/**
 * JSON-LD `aggregateRating` only once an event has at least this many visible reviews (pending
 * owner): a rating from one or two people is noise, and search engines treat thin ratings as spam.
 */
export const MIN_REVIEWS_FOR_RATING = 3;

export type IneligibleReason = 'no_ticket' | 'not_held' | 'not_ended' | 'window_closed' | 'already_reviewed';

export type Eligibility =
  | { readonly ok: true; readonly opensAt: Date; readonly closesAt: Date }
  | {
      readonly ok: false;
      readonly reason: IneligibleReason;
      readonly opensAt: Date | null;
      readonly closesAt: Date | null;
    };

/**
 * When the review window of a date that ends at `endsAt` closes: at the end of the local
 * calendar day, `REVIEW_WINDOW_DAYS` days after the end, in the event's timezone (ADR 0015).
 */
export function reviewClosesAt(endsAt: Date, timeZone: string): Date {
  const localDay = utcToZonedInput(endsAt, timeZone).slice(0, 10);
  const next = new Date(`${localDay}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + REVIEW_WINDOW_DAYS + 1);
  return zonedTimeToUtc(`${next.toISOString().slice(0, 10)}T00:00`, timeZone);
}

/**
 * Who may review (M1.4g): a buyer who still holds a live ticket for an event that took place
 * (not cancelled or postponed), once their ticket's date has **ended** (an instant, so a late
 * evening in Los Angeles is still "not ended" on the next UTC day), until the window closes.
 * Check-in is not required (pending owner): many events never scan, and a no-show still paid.
 */
export function reviewEligibility(i: {
  readonly now: Date;
  readonly eventStatus: string;
  readonly timeZone: string;
  /** When each of the buyer's live tickets' dates ends. */
  readonly ticketEnds: readonly Date[];
  readonly alreadyReviewed: boolean;
}): Eligibility {
  const none = { opensAt: null, closesAt: null };
  if (i.alreadyReviewed) return { ok: false, reason: 'already_reviewed', ...none };
  if (!['published', 'completed', 'archived'].includes(i.eventStatus))
    return { ok: false, reason: 'not_held', ...none };
  if (i.ticketEnds.length === 0) return { ok: false, reason: 'no_ticket', ...none };
  const times = i.ticketEnds.map((d) => d.getTime());
  const opensAt = new Date(Math.min(...times));
  const closesAt = reviewClosesAt(new Date(Math.max(...times)), i.timeZone);
  if (i.now < opensAt) return { ok: false, reason: 'not_ended', opensAt, closesAt };
  if (i.now >= closesAt) return { ok: false, reason: 'window_closed', opensAt, closesAt };
  return { ok: true, opensAt, closesAt };
}

/**
 * The name shown with a public review: the first name and the initial of the last name
 * ("Maria G."), never the full name or the email. Enough to read as a real person, too little to
 * find them.
 */
export function reviewerDisplayName(fullName: string): string | null {
  const parts = fullName
    .normalize('NFC')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
    .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const first = parts[0];
  if (!first) return null;
  const firstName = [...first].slice(0, 30).join('');
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  const initial = last ? [...last][0]?.toLocaleUpperCase() : undefined;
  return initial ? `${firstName} ${initial}.` : firstName;
}
