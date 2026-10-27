/** Wall-clock `YYYY-MM-DDTHH:MM` plus hours (no time zone involved), or '' when it is not one. */
export function plusHours(local: string, hours: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return '';
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const t = new Date(Date.UTC(y, mo - 1, d, h + hours, mi));
  return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 16);
}

/** The end to suggest when the start changes: unchanged when the end is already after it. */
export function defaultEnd(start: string, end: string, hours = 2): string {
  return start && (!end || end <= start) ? plusHours(start, hours) || end : end;
}
