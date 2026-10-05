/** One event of a series, as "Create next event in series" sees it (earliest first). */
export interface Edition {
  readonly name: string;
  readonly startsAt: Date;
}

const YEAR = /\b(19|20)\d{2}\b/;

/** The same instant one calendar year later (in UTC; Feb 29 becomes Mar 1). */
function nextYear(at: Date): Date {
  const d = new Date(at);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

/**
 * U7: what the next event of a series should probably be — the latest edition's name (its year
 * moved on, "Fest 2027" → "Fest 2028") starting one step after it. The step is the gap between
 * the last two editions, or a year with only one; the start is moved on by that step until it is
 * in the future. Null for a series with no events. The organizer can change both.
 */
export function suggestNextEdition(
  editions: readonly Edition[],
  now: Date,
): { name: string; startsAt: Date } | null {
  const last = editions.at(-1);
  if (!last) return null;
  const prev = editions.at(-2);
  const gap = prev ? last.startsAt.getTime() - prev.startsAt.getTime() : 0;
  const step = (at: Date) => (gap > 0 ? new Date(at.getTime() + gap) : nextYear(at));
  let startsAt = step(last.startsAt);
  for (let i = 0; i < 500 && startsAt <= now; i++) startsAt = step(startsAt);
  const year = last.name.match(YEAR)?.[0];
  const name =
    year && Number(year) === last.startsAt.getUTCFullYear()
      ? last.name.replace(YEAR, String(startsAt.getUTCFullYear()))
      : last.name;
  return { name, startsAt };
}
