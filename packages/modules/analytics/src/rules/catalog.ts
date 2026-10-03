/**
 * Organizer-authored alert rules (M6.2b) on the M3.2b alert engine: a measure over a window of
 * whole days in the org's time zone (the last N days, today included), compared with a threshold
 * (`above`: at least; `below`: under) or with the N days before (`rise` / `drop`: by at least the
 * threshold in percent). Money measures need `finance:read` and one currency.
 */
export const RULE_MEASURES = [
  'registrations',
  'tickets',
  'refunded_tickets',
  'checkins',
  'gross',
  'refunds',
  'net',
] as const;
export type RuleMeasure = (typeof RULE_MEASURES)[number];
export const RULE_MONEY_MEASURES: readonly RuleMeasure[] = ['gross', 'refunds', 'net'];
export const RULE_CONDITIONS = ['above', 'below', 'rise', 'drop'] as const;
export type RuleCondition = (typeof RULE_CONDITIONS)[number];
export const RULE_WINDOWS = [1, 7, 14, 30] as const;
export const RULE_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type RuleSeverity = (typeof RULE_SEVERITIES)[number];
export const RULE_STATES = ['ok', 'firing'] as const;
export type RuleState = (typeof RULE_STATES)[number];
/** At most this many rules per org (each is evaluated every few minutes). */
export const MAX_RULES_PER_ORG = 50;
export const MAX_THRESHOLD = 1_000_000_000_000;

export const isRuleMoney = (m: RuleMeasure) => RULE_MONEY_MEASURES.includes(m);
