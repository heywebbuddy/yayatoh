/**
 * M6.1b contact stats: the documented, explainable formulas (pure; shared by the projector, the
 * tests and the pages that explain a number). No machine learning: every score can be recomputed
 * by hand from the counts it shows next to it.
 */

/**
 * No-show propensity: the share of a person's past registrations they did not check in to,
 * smoothed toward a prior of one no-show in five registrations (20 %), so one missed event does
 * not brand someone a no-show and someone we know nothing about counts as 20 %:
 *
 *   propensity = (noShows + 1) / (pastRegistrations + 5)
 *
 * A past registration is a registration (on the list) for an event that has ended and was not
 * cancelled; a no-show is one without a check-in. Upcoming events do not count yet.
 */
export const NO_SHOW_PRIOR = { noShows: 1, registrations: 5 } as const;

/** In basis points (0–10 000), rounded half up: 1 429 bps is 14.29 %. */
export function noShowPropensityBps(pastRegistrations: number, noShows: number): number {
  if (!Number.isInteger(pastRegistrations) || !Number.isInteger(noShows))
    throw new RangeError('counts must be integers');
  if (pastRegistrations < 0 || noShows < 0 || noShows > pastRegistrations)
    throw new RangeError('0 ≤ noShows ≤ pastRegistrations');
  const num = 10_000 * (noShows + NO_SHOW_PRIOR.noShows);
  const den = pastRegistrations + NO_SHOW_PRIOR.registrations;
  return Math.floor((2 * num + den) / (2 * den));
}

/** The prior alone (nobody's history yet): 2 000 bps. */
export const NO_SHOW_PRIOR_BPS = noShowPropensityBps(0, 0);

/**
 * Engagement score (0–100). M5.7b's engagement score (scans, polls, Q&A, feedback, enrollments,
 * org-adjustable weights) is not merged yet: this is the documented placeholder over the same
 * kinds of input, with the inputs M5.7b adds weighted in already (they are zero until it lands).
 *
 *   points = 10 × events attended (door scans) + 5 × sessions attended (session scans)
 *          + 2 × campaigns opened + 3 × poll and Q&A answers + 3 × feedback responses
 *          + 2 × session enrollments
 *   score  = round(100 × points / (points + 25))
 *
 * The curve saturates: 25 points is a score of 50, and nobody reaches 100.
 */
export const ENGAGEMENT_WEIGHTS = {
  eventsAttended: 10,
  sessionsAttended: 5,
  campaignsOpened: 2,
  pollAnswers: 3,
  feedback: 3,
  enrollments: 2,
} as const;
export const ENGAGEMENT_HALF_POINTS = 25;

export type EngagementInputs = { readonly [K in keyof typeof ENGAGEMENT_WEIGHTS]?: number };

export function engagementPoints(inputs: EngagementInputs): number {
  let points = 0;
  for (const [k, w] of Object.entries(ENGAGEMENT_WEIGHTS)) {
    const v = inputs[k as keyof typeof ENGAGEMENT_WEIGHTS] ?? 0;
    if (!Number.isInteger(v) || v < 0) throw new RangeError(`${k} must be a count`);
    points += w * v;
  }
  return points;
}

export function engagementScore(inputs: EngagementInputs): number {
  const p = engagementPoints(inputs);
  // round(100p / (p + K)) in integers, half up.
  const den = p + ENGAGEMENT_HALF_POINTS;
  return Math.floor((200 * p + den) / (2 * den));
}

/**
 * RFM quintiles per org (1 = lowest fifth, 5 = top fifth), among the org's contacts who took
 * part in at least one event. A contact's quintile is 1 + ⌊5 × below / population⌋, where `below`
 * counts contacts with a strictly lower value: ties share a quintile, and the result never
 * depends on row order. Recency ranks the last seen time (more recent is higher), frequency the
 * events taken part in, monetary the lifetime value in the org's currency.
 * The SQL in `rfm.ts` computes the same with `rank()`.
 */
export function quintile(below: number, population: number): number | null {
  if (population <= 0) return null;
  if (below < 0 || below >= population) throw new RangeError('0 ≤ below < population');
  return Math.min(5, 1 + Math.floor((5 * below) / population));
}

/** Quintile of each value among `values` (same order); for tests and explanations. */
export function quintiles(values: readonly number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const below = (v: number) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((sorted[mid] as number) < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return values.map((v) => quintile(below(v), values.length) as number);
}

/** Display bands for the org distributions (inclusive lower bounds). */
export const ENGAGEMENT_BANDS = [0, 20, 40, 60, 80] as const;
/** No-show propensity bands, in percent (inclusive lower bounds). */
export const NO_SHOW_BANDS = [0, 10, 20, 35, 50] as const;
/** Events taken part in. */
export const FREQUENCY_BANDS = [1, 2, 3, 6] as const;
/** Days since last seen (upper bounds, inclusive); beyond the last: "older". */
export const RECENCY_DAYS = [30, 90, 365] as const;

/** The index of the band `value` falls in (bands are ascending lower bounds). */
export function bandOf(value: number, bands: readonly number[]): number {
  let i = 0;
  for (let k = 0; k < bands.length; k++) if (value >= (bands[k] as number)) i = k;
  return i;
}
