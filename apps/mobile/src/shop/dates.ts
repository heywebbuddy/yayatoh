/**
 * The date range of Discover (M7.3c): quick choices and typed dates. The API reads `from` and `to`
 * as dates (`2027-05-01`): `from` the start of that UTC day, `to` the end of it. The phone sends the
 * person's own calendar dates, so "this weekend" is the weekend on their calendar.
 */

export interface DateRange {
  readonly from: string | null;
  readonly to: string | null;
}

export type DatePreset = 'today' | 'weekend' | 'week' | 'month';
export const DATE_PRESETS: readonly DatePreset[] = ['today', 'weekend', 'week', 'month'];

const pad = (n: number) => String(n).padStart(2, '0');
/** `2027-05-01` from the local calendar date of `d`. */
export const isoDay = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function presetRange(preset: DatePreset, now: Date): DateRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (preset) {
    case 'today':
      return { from: isoDay(today), to: isoDay(today) };
    case 'weekend': {
      // Friday to Sunday; from today when today already is one of them.
      const dow = today.getDay(); // 0 Sunday … 6 Saturday
      const from = dow === 0 || dow >= 5 ? today : addDays(today, 5 - dow);
      return { from: isoDay(from), to: isoDay(addDays(today, dow === 0 ? 0 : 7 - dow)) };
    }
    case 'week':
      return { from: isoDay(today), to: isoDay(addDays(today, 7)) };
    case 'month':
      return { from: isoDay(today), to: isoDay(new Date(today.getFullYear(), today.getMonth() + 1, 0)) };
  }
}

/** Which preset the range is, if any (so its chip shows as chosen). */
export function presetOf(range: DateRange, now: Date): DatePreset | null {
  if (!range.from || !range.to) return null;
  return DATE_PRESETS.find((p) => {
    const r = presetRange(p, now);
    return r.from === range.from && r.to === range.to;
  }) ?? null;
}

/** True for a real calendar date written `YYYY-MM-DD` (`2027-02-30` is not one). */
export function isIsoDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export type RangeError = 'from_format' | 'to_format' | 'order';

/** What is wrong with typed dates (empty is fine: an open end). */
export function rangeErrors(from: string, to: string): RangeError[] {
  const out: RangeError[] = [];
  const f = from.trim();
  const t = to.trim();
  if (f && !isIsoDate(f)) out.push('from_format');
  if (t && !isIsoDate(t)) out.push('to_format');
  if (out.length === 0 && f && t && f > t) out.push('order');
  return out;
}
