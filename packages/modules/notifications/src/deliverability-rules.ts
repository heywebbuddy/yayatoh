/**
 * Email deliverability maths (M3.8b), pure and browser-safe (`@yayatoh/notifications/deliverability`).
 * The thresholds are the alert engine's (M3.2b `deliverability` rule, roadmap defaults pending the
 * owner): over the last 7 days and from 100 emails sent, bounces at or above 5 % or complaints at
 * or above 0.1 % raise the alert. The same rule is applied to the org, to each sending domain and
 * to each campaign.
 */
export const DELIVERABILITY_THRESHOLDS = {
  windowMs: 7 * 86_400_000,
  minSent: 100,
  bounceBps: 500,
  complaintBps: 10,
} as const;

export type DeliverabilityThresholds = {
  readonly windowMs: number;
  readonly minSent: number;
  readonly bounceBps: number;
  readonly complaintBps: number;
};

/** `part / whole` in basis points, rounded down (0 when nothing was sent). */
export function rateBps(part: number, whole: number): number {
  if (!(whole > 0) || !(part > 0)) return 0;
  return Math.floor((Math.min(part, whole) * 10_000) / whole);
}

export interface DeliverabilityVerdict {
  readonly bounceBps: number;
  readonly complaintBps: number;
  /** Enough email was sent for the rates to count. */
  readonly enough: boolean;
  readonly bounceOver: boolean;
  readonly complaintOver: boolean;
  /** Either rate is at or over its threshold, with enough email sent. */
  readonly over: boolean;
}

export function deliverabilityVerdict(
  t: { readonly sent: number; readonly bounced: number; readonly complained: number },
  th: DeliverabilityThresholds = DELIVERABILITY_THRESHOLDS,
): DeliverabilityVerdict {
  const bounceBps = rateBps(t.bounced, t.sent);
  const complaintBps = rateBps(t.complained, t.sent);
  const enough = t.sent >= th.minSent;
  const bounceOver = enough && bounceBps >= th.bounceBps;
  const complaintOver = enough && complaintBps >= th.complaintBps;
  return { bounceBps, complaintBps, enough, bounceOver, complaintOver, over: bounceOver || complaintOver };
}
