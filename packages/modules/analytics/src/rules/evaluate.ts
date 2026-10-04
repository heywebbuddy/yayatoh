import type { DailyTotal } from '../warehouse/port.ts';
import type { RuleCondition, RuleMeasure } from './catalog.ts';

/** What a rule compares, pure (M6.2b). */
export interface RuleSpec {
  readonly measure: RuleMeasure;
  readonly condition: RuleCondition;
  readonly threshold: number;
  /** Money measures: the one currency compared ('' for counts). */
  readonly currency: string;
}

/** A measure's value over a set of warehouse rows (one currency for money; counts ignore it). */
export function measureValue(rows: readonly DailyTotal[], measure: RuleMeasure, currency: string): number {
  let v = 0;
  for (const r of rows) {
    if (measure === 'registrations' && r.metric === 'orders') v += r.value;
    else if (measure === 'tickets' && r.metric === 'tickets') v += r.value;
    else if (measure === 'tickets' && r.metric === 'refunded_tickets') v -= r.value;
    else if (measure === 'refunded_tickets' && r.metric === 'refunded_tickets') v += r.value;
    else if (measure === 'checkins' && r.metric === 'checkins') v += r.value;
    else if (r.currency === currency && currency !== '') {
      if ((measure === 'gross' || measure === 'net') && r.metric === 'gross') v += r.value;
      else if (measure === 'refunds' && r.metric === 'refunds') v += r.value;
      else if (measure === 'net' && r.metric === 'refunds') v -= r.value;
    }
  }
  return v;
}

/** Percent change from `previous` to `current`, rounded toward zero (null without a previous value). */
export const changePct = (current: number, previous: number): number | null =>
  previous > 0 ? Math.trunc(((current - previous) * 100) / previous) : null;

/**
 * Does the rule fire? `above`: the window's value is at least the threshold; `below`: it is under
 * it; `rise` / `drop`: it moved by at least the threshold in percent against the window before
 * (never when the window before was zero: no percentage of nothing). Integer maths only.
 */
export function ruleFires(spec: RuleSpec, current: number, previous: number): boolean {
  switch (spec.condition) {
    case 'above':
      return current >= spec.threshold;
    case 'below':
      return current < spec.threshold;
    case 'rise':
      return previous > 0 && (current - previous) * 100 >= spec.threshold * previous;
    case 'drop':
      return previous > 0 && (previous - current) * 100 >= spec.threshold * previous;
  }
}
