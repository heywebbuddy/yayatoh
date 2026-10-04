import type { EventMode } from './modes.ts';
import type { CcRole } from './roles.ts';

/**
 * The Command Center's hero strip (U4, UX principle 7 "dashboards have a hero"): how long until
 * the event starts (or ends), the mode, and the single next action. Pure and browser-safe: the
 * page feeds it what the member's own widget loaders returned, so it never knows more than the
 * member may see (the door's alerts are door alerts only, and no hero action names money).
 */

export type Severity = 'info' | 'warning' | 'critical';

export interface HeroAlert {
  readonly rule: string;
  readonly severity: Severity;
  readonly count: number;
  /** Org-relative console path that fixes it. */
  readonly href: string | null;
}

export interface HeroReadinessItem {
  readonly key: string;
  readonly path: string;
  readonly field: string | null;
}

export type NextAction =
  | {
      readonly kind: 'alert';
      readonly rule: string;
      readonly severity: Severity;
      readonly count: number;
      readonly href: string | null;
    }
  | {
      readonly kind: 'readiness';
      readonly key: string;
      readonly path: string;
      readonly field: string | null;
      readonly blocking: boolean;
    }
  | { readonly kind: 'scanner' }
  | { readonly kind: 'publicPage' }
  | { readonly kind: 'report' }
  | { readonly kind: 'none' };

export interface NextActionInput {
  readonly mode: EventMode;
  readonly role: CcRole;
  /** The alerts the member's alerts widget returned (null when they have none to read). */
  readonly alerts: readonly HeroAlert[] | null;
  /** The readiness widget's open items (null when the role or mode has no readiness). */
  readonly readiness: {
    readonly blocking: readonly HeroReadinessItem[];
    readonly todo: readonly HeroReadinessItem[];
  } | null;
  /** The member may scan tickets (the scanner is their tool on the day). */
  readonly canScan: boolean;
  /** The member may read the event's money (the wrap-up's report). */
  readonly revenue: boolean;
}

const RANK: Readonly<Record<Severity, number>> = { critical: 0, warning: 1, info: 2 };

function worst(alerts: readonly HeroAlert[], severity: Severity): HeroAlert | null {
  return (
    [...alerts].sort((a, b) => RANK[a.severity] - RANK[b.severity]).find((a) => a.severity === severity) ??
    null
  );
}

const alertAction = (a: HeroAlert): NextAction => ({
  kind: 'alert',
  rule: a.rule,
  severity: a.severity,
  count: a.count,
  href: a.href,
});

/**
 * The one thing to do now, first match wins:
 * 1. a critical alert;
 * 2. (planning, pre-show) the first blocking readiness item;
 * 3. a warning alert;
 * 4. (live) open the scanner, for members who scan;
 * 5. (planning, pre-show) the first other readiness item;
 * 6. otherwise by mode: look at the public page before the show, the report after it (money
 *    roles only), nothing to do otherwise.
 */
export function nextAction(input: NextActionInput): NextAction {
  const alerts = input.alerts ?? [];
  const before = input.mode === 'planning' || input.mode === 'pre_show';
  const critical = worst(alerts, 'critical');
  if (critical) return alertAction(critical);
  const blocking = before ? input.readiness?.blocking[0] : undefined;
  if (blocking) return { kind: 'readiness', ...blocking, blocking: true };
  const warning = worst(alerts, 'warning');
  if (warning) return alertAction(warning);
  if (input.mode === 'live' && input.canScan) return { kind: 'scanner' };
  const todo = before ? input.readiness?.todo[0] : undefined;
  if (todo) return { kind: 'readiness', ...todo, blocking: false };
  if (before && input.role !== 'door') return { kind: 'publicPage' };
  if (input.mode === 'wrap' && input.revenue) return { kind: 'report' };
  return { kind: 'none' };
}

export type CountdownKind = 'startsIn' | 'endsIn' | 'ended';

export interface Countdown {
  readonly kind: CountdownKind;
  /** The instant counted to (the start, the end) or from (the end, once over). */
  readonly at: Date;
}

/** What the hero counts down to: the start, then the end; after the end, how long ago it ended. */
export function countdown(window: { startsAt: Date; endsAt: Date }, now: Date): Countdown {
  if (now < window.startsAt) return { kind: 'startsIn', at: window.startsAt };
  if (now < window.endsAt) return { kind: 'endsIn', at: window.endsAt };
  return { kind: 'ended', at: window.endsAt };
}

export type DurationUnit = 'day' | 'hour' | 'minute';

/**
 * A duration as its two largest whole units (`3 days 4 hours`, `4 hours 12 minutes`, `12 minutes`),
 * rounded down; under a minute is `0 minutes`. The page words each unit with `Intl` in the
 * reader's locale.
 */
export function durationParts(ms: number): { unit: DurationUnit; value: number }[] {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const mins = minutes % 60;
  if (days > 0)
    return hours > 0
      ? [
          { unit: 'day', value: days },
          { unit: 'hour', value: hours },
        ]
      : [{ unit: 'day', value: days }];
  if (hours > 0)
    return mins > 0
      ? [
          { unit: 'hour', value: hours },
          { unit: 'minute', value: mins },
        ]
      : [{ unit: 'hour', value: hours }];
  return [{ unit: 'minute', value: mins }];
}
