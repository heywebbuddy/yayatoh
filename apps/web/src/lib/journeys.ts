/**
 * Journey step wording shared by the console pages and the step editor (M3.7a): the translator is
 * the `journeys` namespace (server `getTranslations('journeys')` or client `useTranslations`).
 */
type T = (key: string, values?: Record<string, string | number>) => string;

export interface WaitLike {
  readonly anchor: 'trigger' | 'event_start' | 'event_end' | 'invoice_due';
  readonly offsetDays: number;
  readonly offsetMinutes: number;
  readonly atTime: string | null;
}

/** "2 days, 3 hours" in the locale (unit list), from absolute days and minutes. */
export function durationText(t: T, locale: string, days: number, minutes: number): string {
  const parts: string[] = [];
  const d = Math.abs(days);
  const m = Math.abs(minutes);
  if (d) parts.push(t('duration.days', { count: d }));
  if (Math.floor(m / 60)) parts.push(t('duration.hours', { count: Math.floor(m / 60) }));
  if (m % 60) parts.push(t('duration.minutes', { count: m % 60 }));
  return new Intl.ListFormat(locale, { style: 'long', type: 'unit' }).format(parts);
}

/** "7 days before the event starts", "On the event day, at 09:00", "Right away"… */
export function describeWait(t: T, locale: string, w: WaitLike): string {
  const anchor =
    w.anchor === 'trigger'
      ? 'Trigger'
      : w.anchor === 'event_start'
        ? 'Start'
        : w.anchor === 'invoice_due'
          ? 'Due'
          : 'End';
  if (w.atTime) {
    const time = formatTime(locale, w.atTime);
    const dir = w.offsetDays < 0 ? 'before' : w.offsetDays > 0 ? 'after' : 'same';
    const base = t(`wait.day${anchor}`, { dir, days: Math.abs(w.offsetDays), time });
    if (!w.offsetMinutes) return base;
    return t('wait.thenOffset', {
      base,
      offset: durationText(t, locale, 0, w.offsetMinutes),
      dir: w.offsetMinutes < 0 ? 'before' : 'after',
    });
  }
  if (!w.offsetDays && !w.offsetMinutes) return t(`wait.at${anchor}`);
  const offset = durationText(t, locale, w.offsetDays, w.offsetMinutes);
  const before = w.offsetDays < 0 || w.offsetMinutes < 0;
  return t(`wait.${before ? 'before' : 'after'}${anchor}`, { offset });
}

/** `09:00` as the locale writes a time of day. */
export function formatTime(locale: string, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2000, 0, 1, h ?? 0, m ?? 0)),
  );
}

/** Outcome codes the history can explain; anything else shows as the generic "Other". */
export const OUTCOMES = [
  'queued',
  'already_queued',
  'label_added',
  'invited',
  'too_late',
  'condition_not_met',
  'no_phone',
  'no_device',
  'no_address',
  'not_attending',
  'too_many_labels',
  'no_survey',
  'closed',
  'no_questions',
  'already_invited',
  'order_refunded',
  'ticket_cancelled',
  'event_cancelled',
  'event_postponed',
  'journey_disabled',
  'step_removed',
  'run_ended',
  'event_missing',
  'error',
  // M5.1d: invoice reminders.
  'invoice_paid',
  'invoice_void',
  'invoice_settled',
] as const;

export const outcomeKey = (code: string | null) =>
  code && (OUTCOMES as readonly string[]).includes(code) ? `outcomes.${code}` : 'outcomes.other';
