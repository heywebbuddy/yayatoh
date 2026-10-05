import { defineStateMachine } from '@yayatoh/kernel';
import type { AlertState, Severity } from './config.ts';

/**
 * An alert instance's lifecycle (roadmap §5.2, M3.2b). One row per rule and scope (the event, or
 * the org): the same condition coming back reopens it instead of piling up duplicates.
 * - The engine opens it when the condition fires, resolves it when the condition clears, and
 *   reopens it when it fires again.
 * - People acknowledge it (it stays until the condition clears) or snooze it for a while.
 * - An acknowledgement times out while the condition still holds (60 min, 10 when live-critical):
 *   the alert opens again and is sent again. A snooze ends the same way.
 */
export const alertLifecycle = defineStateMachine({
  name: 'alert',
  states: ['open', 'acknowledged', 'snoozed', 'resolved'],
  initial: 'open',
  events: {
    acknowledge: { from: ['open'], to: 'acknowledged' },
    snooze: { from: ['open', 'acknowledged'], to: 'snoozed' },
    wake: { from: ['snoozed'], to: 'open' },
    ackTimeout: { from: ['acknowledged'], to: 'open' },
    resolve: { from: ['open', 'acknowledged', 'snoozed'], to: 'resolved' },
    reopen: { from: ['resolved'], to: 'open' },
  },
});
export type AlertEvent = keyof typeof alertLifecycle.events;

/** What the engine knows about a stored alert when it re-evaluates it. */
export interface StoredAlert {
  readonly state: AlertState;
  readonly severity: Severity;
  readonly count: number;
  readonly acknowledgedAt: Date | null;
  readonly snoozedUntil: Date | null;
}

/** A condition that holds right now. */
export interface Firing {
  readonly severity: Severity;
  /** The measured number the message is about (people, tickets, payments, devices, percent). */
  readonly count: number;
  /** Numbers only (thresholds, percentages); never names or ids. */
  readonly params: Readonly<Record<string, number>>;
  /** Critical during an event's live window: acknowledgements time out sooner. */
  readonly liveCritical: boolean;
}

export type PlanAction =
  | { readonly kind: 'none' }
  /** A new alert. */
  | { readonly kind: 'fire' }
  /** Still firing; the number or severity changed. `escalated` = became more severe (sent again). */
  | { readonly kind: 'update'; readonly escalated: boolean }
  | { readonly kind: 'resolve' }
  | { readonly kind: 'reopen' }
  | { readonly kind: 'wake' }
  | { readonly kind: 'ackTimeout' };

const RANK: Readonly<Record<Severity, number>> = { info: 0, warning: 1, critical: 2 };

/**
 * Decide what happens to one rule + scope after an evaluation (pure). `firing` is null when the
 * condition does not hold. Resolution is automatic and wins over everything else; a snooze that
 * ended or an acknowledgement that timed out on a condition that still holds opens it again.
 */
export function planAlert(
  stored: StoredAlert | null,
  firing: Firing | null,
  now: Date,
  ackTimeoutMs: number,
): PlanAction {
  if (!stored) return firing ? { kind: 'fire' } : { kind: 'none' };
  if (!firing) return stored.state === 'resolved' ? { kind: 'none' } : { kind: 'resolve' };
  if (stored.state === 'resolved') return { kind: 'reopen' };
  if (stored.state === 'snoozed' && stored.snoozedUntil && stored.snoozedUntil.getTime() <= now.getTime())
    return { kind: 'wake' };
  if (
    stored.state === 'acknowledged' &&
    stored.acknowledgedAt &&
    now.getTime() - stored.acknowledgedAt.getTime() >= ackTimeoutMs
  )
    return { kind: 'ackTimeout' };
  if (stored.count !== firing.count || stored.severity !== firing.severity)
    return { kind: 'update', escalated: RANK[firing.severity] > RANK[stored.severity] };
  return { kind: 'none' };
}

/** Whether a plan sends the alert to people (new, back again, or more severe). */
export function planNotifies(plan: PlanAction): boolean {
  return (
    plan.kind === 'fire' ||
    plan.kind === 'reopen' ||
    plan.kind === 'wake' ||
    plan.kind === 'ackTimeout' ||
    (plan.kind === 'update' && plan.escalated)
  );
}

/** The state an alert is in after a plan (unchanged for `none` and `update`). */
export function stateAfter(stored: AlertState | null, plan: PlanAction): AlertState | null {
  switch (plan.kind) {
    case 'fire':
      return 'open';
    case 'resolve':
      return alertLifecycle.next(stored ?? 'open', 'resolve');
    case 'reopen':
      return alertLifecycle.next(stored ?? 'resolved', 'reopen');
    case 'wake':
      return alertLifecycle.next(stored ?? 'snoozed', 'wake');
    case 'ackTimeout':
      return alertLifecycle.next(stored ?? 'acknowledged', 'ackTimeout');
    default:
      return stored;
  }
}
