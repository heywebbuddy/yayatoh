/** Planning / live / completed phase and days to go, computed in UTC instants. */
export function eventPhase(startIso: string, endIso: string, now = new Date()) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const t = now.getTime();
  if (t < start) return { phase: 'planning' as const, days: Math.ceil((start - t) / 86_400_000) };
  if (t <= end) return { phase: 'live' as const, days: 0 };
  return { phase: 'completed' as const, days: 0 };
}

/**
 * Statuses that already say where the event stands: no "days to go" or "date passed" after them
 * (a postponed event's dates are the old ones until it is rescheduled).
 */
const SETTLED = new Set(['postponed', 'completed', 'cancelled', 'archived']);

/**
 * An event's status line (QA #30): the lifecycle status first, then the timing while it still
 * adds something ("Published · 2 days to go", "Draft · Date passed"). A postponed, completed,
 * cancelled or archived event shows its status alone, so the line never repeats or contradicts itself.
 */
export function eventStatusLine(
  status: string,
  phase: ReturnType<typeof eventPhase>,
  label: { status: (status: string) => string; phase: (phase: string, days: number) => string },
): string {
  const s = label.status(status);
  return SETTLED.has(status) ? s : `${s} · ${label.phase(phase.phase, phase.days)}`;
}

/** Greeting by local hour in a time zone. */
export function greetingKey(timeZone: string, now = new Date()): 'morning' | 'afternoon' | 'evening' {
  const h = Number(
    new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now),
  );
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}
