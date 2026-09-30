/** Planning / live / completed phase and days to go, computed in UTC instants. */
export function eventPhase(startIso: string, endIso: string, now = new Date()) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const t = now.getTime();
  if (t < start) return { phase: 'planning' as const, days: Math.ceil((start - t) / 86_400_000) };
  if (t <= end) return { phase: 'live' as const, days: 0 };
  return { phase: 'completed' as const, days: 0 };
}

/** Greeting by local hour in a time zone. */
export function greetingKey(timeZone: string, now = new Date()): 'morning' | 'afternoon' | 'evening' {
  const h = Number(
    new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now),
  );
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}
