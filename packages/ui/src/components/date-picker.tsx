'use client';

import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cx } from '../cx.ts';
import {
  addDays,
  addMonths,
  compareYmd,
  displayLocale,
  formatOffset,
  formatTimeText,
  formatYmdText,
  type Hm,
  hmString,
  monthGrid,
  offsetMinutes,
  parseHmString,
  parseLocalValue,
  parseTimeText,
  parseYmdString,
  parseYmdText,
  toAsciiDigits,
  todayIn,
  toLocalValue,
  utcToZoned,
  weekday,
  weekStart,
  type Ymd,
  ymdString,
  zonedToUtc,
} from './dates.ts';
import { PANEL_CLASS, useFloatingPanel } from './floating.ts';
import { FieldMessage, fieldClass } from './input.tsx';
import { Tick } from './select.tsx';
import { useUiLocale } from './ui-locale.tsx';
import { fill } from './ui-strings.ts';

type Kind = 'date' | 'datetime' | 'time';

export interface DatePickerProps {
  id?: string;
  name?: string;
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** The native value: `YYYY-MM-DD`, `HH:MM` or `YYYY-MM-DDTHH:MM` (wall time in `timeZone`). */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Native-format bounds, inclusive. */
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  /** The event's IANA zone: shown next to the field; with `valueFormat="utc"` it converts too. */
  timeZone?: string;
  /** DateTimePicker only: submit the wall time (default, like datetime-local) or the UTC instant. */
  valueFormat?: 'local' | 'utc';
  /** Minutes between the suggested times (default 15). */
  minuteStep?: number;
  fieldSize?: 'sm' | 'md' | 'lg';
  form?: string;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'data-testid'?: string;
}

interface Parsed {
  ymd: Ymd | null;
  time: Hm | null;
}

function parseNative(kind: Kind, v: string | undefined, timeZone: string | undefined, utc: boolean): Parsed {
  if (!v) return { ymd: null, time: null };
  if (kind === 'time') return { ymd: null, time: parseHmString(v) };
  if (kind === 'datetime' && utc && timeZone && /Z|[+-]\d{2}:?\d{2}$/.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return utcToZoned(d, timeZone);
  }
  const p = parseLocalValue(v);
  return { ymd: p?.ymd ?? null, time: p?.time ?? null };
}

function toNative(kind: Kind, p: Parsed, timeZone: string | undefined, utc: boolean): string {
  if (kind === 'time') return p.time ? hmString(p.time) : '';
  if (!p.ymd) return '';
  if (kind === 'date') return ymdString(p.ymd);
  if (!p.time) return '';
  if (utc && timeZone) return zonedToUtc(p.ymd, p.time, timeZone).toISOString();
  return toLocalValue(p.ymd, p.time);
}

function formatText(kind: Kind, p: Parsed, locale: string): string {
  const d = p.ymd ? formatYmdText(p.ymd, locale) : '';
  const t = p.time ? formatTimeText(p.time, locale) : '';
  if (kind === 'date') return d;
  if (kind === 'time') return t;
  return d && t ? `${d} ${t}` : d;
}

/** Typed text → parts. ISO always works; otherwise the locale's own format. */
export function parseText(kind: Kind, text: string, locale: string): Parsed | null {
  const s = toAsciiDigits(text).trim();
  if (!s) return { ymd: null, time: null };
  if (kind === 'time') {
    const time = parseTimeText(s);
    return time ? { ymd: null, time } : null;
  }
  if (kind === 'date') {
    const ymd = parseYmdText(s, locale);
    return ymd ? { ymd, time: null } : null;
  }
  const iso = /^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})(?::\d{2})?$/.exec(s);
  if (iso) {
    const ymd = parseYmdString(iso[1] as string);
    const time = parseHmString(iso[2] as string);
    return ymd && time ? { ymd, time } : null;
  }
  // The date is the first three numbers; the rest is the time.
  const nums = [...s.matchAll(/\d+/g)];
  if (nums.length < 4) return null;
  const third = nums[2] as RegExpMatchArray;
  const end = (third.index ?? 0) + third[0].length;
  const ymd = parseYmdText(s.slice(0, end), locale);
  const time = parseTimeText(s.slice(end).replace(/^[\s,،T]+/, ''));
  return ymd && time ? { ymd, time } : null;
}

function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      <rect x="3.5" y="5" width="17" height="15" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}
function Arrow({ dir }: { dir: 'prev' | 'next' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4 rtl:-scale-x-100"
    >
      <path d={dir === 'prev' ? 'm10 4-4 4 4 4' : 'm6 4 4 4-4 4'} />
    </svg>
  );
}

const ICON_BUTTON =
  'absolute inset-y-0 end-1.5 my-auto inline-grid size-8 cursor-pointer place-items-center rounded-tag text-ink-2 hover:bg-surface-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50';

/** The month grid (WAI-ARIA date picker dialog): arrows, Home/End, PageUp/PageDown (+Shift: years). */
function Calendar({
  selected,
  onPick,
  min,
  max,
  locale,
  today,
  onEscape,
}: {
  selected: Ymd | null;
  onPick: (d: Ymd) => void;
  min: Ymd | null;
  max: Ymd | null;
  locale: string;
  today: Ymd;
  onEscape: () => void;
}) {
  const { strings } = useUiLocale();
  const [focus, setFocus] = useState<Ymd>(selected ?? today);
  const grid = useRef<HTMLTableElement>(null);
  const moved = useRef(false);
  const first = weekStart(locale);
  const days = monthGrid(focus.y, focus.m, first);
  const dl = displayLocale(locale);
  const monthLabel = new Intl.DateTimeFormat(dl, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(focus.y, focus.m - 1, 1, 12)),
  );
  const dayName = (d: Ymd, style: 'narrow' | 'long') =>
    new Intl.DateTimeFormat(dl, { weekday: style, timeZone: 'UTC' }).format(
      new Date(Date.UTC(d.y, d.m - 1, d.d, 12)),
    );
  const longDate = (d: Ymd) =>
    new Intl.DateTimeFormat(dl, { dateStyle: 'full', timeZone: 'UTC' }).format(
      new Date(Date.UTC(d.y, d.m - 1, d.d, 12)),
    );
  const num = new Intl.NumberFormat(dl, { useGrouping: false });
  const outOfRange = (d: Ymd) => Boolean((min && compareYmd(d, min) < 0) || (max && compareYmd(d, max) > 0));

  useEffect(() => {
    if (!moved.current) return;
    grid.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
  });
  // First open: focus the selected (or today's) day.
  useEffect(() => {
    grid.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
  }, []);

  const go = (d: Ymd) => {
    moved.current = true;
    setFocus(d);
  };
  const onKey = (e: KeyboardEvent) => {
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    const map: Record<string, () => Ymd> = {
      ArrowLeft: () => addDays(focus, rtl ? 1 : -1),
      ArrowRight: () => addDays(focus, rtl ? -1 : 1),
      ArrowUp: () => addDays(focus, -7),
      ArrowDown: () => addDays(focus, 7),
      Home: () => addDays(focus, -((weekday(focus) - first + 7) % 7)),
      End: () => addDays(focus, 6 - ((weekday(focus) - first + 7) % 7)),
      PageUp: () => addMonths(focus, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focus, e.shiftKey ? 12 : 1),
    };
    const f = map[e.key];
    if (f) {
      e.preventDefault();
      go(f());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onEscape();
    }
  };
  const headingId = useId();
  const weeks = Array.from({ length: 6 }, (_, w) => days.slice(w * 7, w * 7 + 7));

  return (
    <div className="flex flex-col gap-2 p-1">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label={strings.previousMonth}
          onClick={() => go(addMonths(focus, -1))}
          className="inline-grid size-9 cursor-pointer place-items-center rounded-tag text-ink-2 hover:bg-surface-3 hover:text-ink"
        >
          <Arrow dir="prev" />
        </button>
        <h2 id={headingId} aria-live="polite" className="text-body font-bold text-ink">
          {monthLabel}
        </h2>
        <button
          type="button"
          aria-label={strings.nextMonth}
          onClick={() => go(addMonths(focus, 1))}
          className="inline-grid size-9 cursor-pointer place-items-center rounded-tag text-ink-2 hover:bg-surface-3 hover:text-ink"
        >
          <Arrow dir="next" />
        </button>
      </div>
      {/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the APG date picker dialog is a table with role=grid */}
      <table ref={grid} role="grid" aria-labelledby={headingId} onKeyDown={onKey} className="border-collapse">
        <thead>
          <tr>
            {(weeks[0] ?? []).map((d) => (
              <th
                key={ymdString(d)}
                scope="col"
                abbr={dayName(d, 'long')}
                className="size-9 text-center text-caption font-bold text-ink-2"
              >
                {dayName(d, 'narrow')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={ymdString(week[0] as Ymd)}>
              {week.map((d) => {
                const inMonth = d.m === focus.m;
                const isSel = Boolean(selected && compareYmd(d, selected) === 0);
                const isFocus = compareYmd(d, focus) === 0;
                const isToday = compareYmd(d, today) === 0;
                const off = outOfRange(d);
                return (
                  // biome-ignore lint/a11y/useAriaPropsSupportedByRole: in a role=grid table each td is a gridcell, which supports aria-selected
                  <td key={ymdString(d)} aria-selected={isSel} className="p-0.5 text-center">
                    <button
                      type="button"
                      tabIndex={isFocus ? 0 : -1}
                      aria-label={longDate(d)}
                      aria-current={isToday ? 'date' : undefined}
                      aria-disabled={off || undefined}
                      data-date={ymdString(d)}
                      onClick={() => !off && onPick(d)}
                      onFocus={() => compareYmd(d, focus) !== 0 && setFocus(d)}
                      className={cx(
                        'inline-grid size-9 cursor-pointer place-items-center rounded-tag text-body font-semibold tabular-nums focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
                        isSel ? 'bg-primary text-on-primary' : 'hover:bg-surface-3',
                        !isSel && (inMonth ? 'text-ink' : 'text-ink-2'),
                        isToday && !isSel && 'ring-1 ring-primary ring-inset',
                        off && 'cursor-not-allowed line-through opacity-40',
                      )}
                    >
                      {num.format(d.d)}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Suggested times as a listbox (TimePicker and DateTimePicker). */
function TimeList({
  selected,
  onPick,
  step,
  locale,
  label,
  onEscape,
  autoFocus,
}: {
  selected: Hm | null;
  onPick: (t: Hm) => void;
  step: number;
  locale: string;
  label: string;
  onEscape: () => void;
  autoFocus?: boolean;
}) {
  const times = useMemo(() => {
    const out: Hm[] = [];
    for (let m = 0; m < 24 * 60; m += Math.max(1, step)) out.push({ h: Math.floor(m / 60), mi: m % 60 });
    if (selected && !out.some((t) => t.h === selected.h && t.mi === selected.mi)) {
      out.push(selected);
      out.sort((a, b) => a.h * 60 + a.mi - (b.h * 60 + b.mi));
    }
    return out;
  }, [step, selected]);
  const selIdx = selected ? times.findIndex((t) => t.h === selected.h && t.mi === selected.mi) : -1;
  const [active, setActive] = useState(selIdx >= 0 ? selIdx : times.findIndex((t) => t.h >= 9));
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (autoFocus) list.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, id]);
  const onKey = (e: KeyboardEvent) => {
    const n = times.length;
    const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 4, PageUp: -4 }[e.key];
    if (step) {
      e.preventDefault();
      setActive((a) => Math.min(n - 1, Math.max(0, a + step)));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActive(e.key === 'Home' ? 0 : n - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const t = times[active];
      if (t) onPick(t);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onEscape();
    }
  };
  return (
    <div
      ref={list}
      role="listbox"
      tabIndex={0}
      aria-label={label}
      aria-activedescendant={times[active] ? `${id}-${active}` : undefined}
      onKeyDown={onKey}
      className="flex max-h-72 min-w-28 flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-tag p-0.5 focus-visible:outline-2 focus-visible:outline-focus"
    >
      {times.map((t, i) => {
        const sel = i === selIdx;
        return (
          // biome-ignore lint/a11y/useFocusableInteractive: options are reached through aria-activedescendant (APG)
          // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox handles the keys
          <div
            key={hmString(t)}
            id={`${id}-${i}`}
            role="option"
            aria-selected={sel}
            data-value={hmString(t)}
            data-active={i === active || undefined}
            onPointerMove={() => setActive(i)}
            onClick={() => onPick(t)}
            className={cx(
              'flex min-h-9 cursor-pointer items-center justify-between gap-2 rounded-tag px-3 text-body tabular-nums',
              'data-active:bg-surface-3',
              sel ? 'font-bold text-ink' : 'font-medium text-ink',
            )}
          >
            <span>{formatTimeText(t, locale)}</span>
            {sel ? <Tick className="mt-0" /> : null}
          </div>
        );
      })}
    </div>
  );
}

function zoneNote(timeZone: string, locale: string): string {
  const city = timeZone.split('/').pop()?.replace(/_/g, ' ') ?? timeZone;
  let off = '';
  try {
    off = formatOffset(offsetMinutes(new Date(), timeZone));
  } catch {
    return timeZone;
  }
  void locale;
  return `${city} · ${off}`;
}

function Picker({ kind, ...p }: DatePickerProps & { kind: Kind }) {
  const {
    id,
    name,
    label,
    hint,
    error,
    value: controlled,
    defaultValue,
    onValueChange,
    min,
    max,
    required,
    disabled,
    timeZone,
    valueFormat = 'local',
    minuteStep = 15,
    fieldSize = 'md',
    form,
    placeholder,
    className,
    autoFocus,
  } = p;
  const { locale, strings } = useUiLocale();
  const auto = useId();
  const inputId = id ?? name ?? `date-${auto}`;
  const utc = kind === 'datetime' && valueFormat === 'utc';
  const [inner, setInner] = useState(defaultValue ?? '');
  const value = controlled ?? inner;
  const parsed = useMemo(() => parseNative(kind, value, timeZone, utc), [kind, value, timeZone, utc]);
  const [text, setText] = useState(() => formatText(kind, parsed, locale));
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const editing = useRef(false);
  const wrap = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const today = todayIn(timeZone);

  const minP = useMemo(() => parseNative(kind, min, timeZone, false), [kind, min, timeZone]);
  const maxP = useMemo(() => parseNative(kind, max, timeZone, false), [kind, max, timeZone]);

  // Follow outside changes of a controlled value, and the locale.
  useEffect(() => {
    if (!editing.current) setText(formatText(kind, parsed, locale));
  }, [kind, parsed, locale]);

  const example = formatText(kind, { ymd: today, time: { h: 19, mi: 30 } }, locale);
  const rangeProblem = (q: Parsed): string | null => {
    const v = toNative(kind, q, timeZone, false);
    if (!v) return null;
    const lo = min ? toNative(kind, minP, timeZone, false) : '';
    const hi = max ? toNative(kind, maxP, timeZone, false) : '';
    if (lo && v < lo) return fill(strings.tooEarly, { date: formatText(kind, minP, locale) });
    if (hi && v > hi) return fill(strings.tooLate, { date: formatText(kind, maxP, locale) });
    return null;
  };

  const commit = (q: Parsed) => {
    const next = toNative(kind, q, timeZone, utc);
    if (controlled === undefined) setInner(next);
    if (next !== value) onValueChange?.(next);
  };

  const setValidity = (msg: string | null) => {
    setProblem(msg);
    inputRef.current?.setCustomValidity(msg ?? '');
  };

  const onType = (t: string) => {
    editing.current = true;
    setText(t);
    const q = parseText(kind, t, locale);
    if (q && (q.ymd || q.time || !t.trim())) {
      const range = rangeProblem(q);
      inputRef.current?.setCustomValidity(range ?? '');
      if (!range) setProblem(null);
      commit(q);
    } else {
      // Not a date yet: nothing submits, and the form refuses it until it is one.
      inputRef.current?.setCustomValidity(
        fill(kind === 'time' ? strings.invalidTime : strings.invalidDate, { example }),
      );
      commit({ ymd: null, time: null });
    }
  };

  const onBlur = () => {
    editing.current = false;
    const q = parseText(kind, text, locale);
    if (!text.trim()) {
      setValidity(null);
      return;
    }
    if (!q || (kind !== 'time' && !q.ymd) || (kind !== 'date' && !q.time)) {
      setValidity(fill(kind === 'time' ? strings.invalidTime : strings.invalidDate, { example }));
      return;
    }
    setValidity(rangeProblem(q));
    setText(formatText(kind, q, locale));
  };

  const close = useCallback((focus = true) => {
    setOpen(false);
    if (focus) button.current?.focus();
  }, []);
  const dismiss = useCallback(() => close(false), [close]);
  useFloatingPanel(open, wrap, panel, dismiss, { matchWidth: false });

  const pickDay = (d: Ymd) => {
    const q = { ymd: d, time: parsed.time ?? (kind === 'datetime' ? { h: 9, mi: 0 } : null) };
    commit(q);
    setText(formatText(kind, q, locale));
    setValidity(rangeProblem(q));
    if (kind === 'date') close();
  };
  const pickTime = (t: Hm) => {
    const q = { ymd: kind === 'datetime' ? (parsed.ymd ?? today) : null, time: t };
    commit(q);
    setText(formatText(kind, q, locale));
    setValidity(rangeProblem(q));
    close();
  };

  // Keep the visible text in step after a form reset.
  useLayoutEffect(() => {
    const f = inputRef.current?.form;
    if (!f) return;
    const onReset = () => {
      setInner(defaultValue ?? '');
      setText(formatText(kind, parseNative(kind, defaultValue, timeZone, utc), locale));
      setValidity(null);
    };
    f.addEventListener('reset', onReset);
    return () => f.removeEventListener('reset', onReset);
  });

  const zoneId = `${inputId}-zone`;
  const describedBy =
    [
      p['aria-describedby'],
      error || problem ? `${inputId}-error` : hint ? `${inputId}-hint` : null,
      timeZone ? zoneId : null,
    ]
      .filter(Boolean)
      .join(' ') || undefined;
  const shownError = error ?? problem ?? undefined;
  const buttonLabel = kind === 'time' ? strings.chooseTime : strings.chooseDate;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {label ? (
        <label htmlFor={inputId} className="text-[13px] font-bold text-ink">
          {label}
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div ref={wrap} className="relative min-w-0 grow">
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            autoComplete="off"
            spellCheck={false}
            inputMode={kind === 'date' ? 'numeric' : undefined}
            value={text}
            placeholder={placeholder}
            required={required}
            disabled={disabled}
            // biome-ignore lint/a11y/noAutofocus: passed through from the call site, as on a native input
            autoFocus={autoFocus}
            aria-invalid={shownError ? true : undefined}
            aria-describedby={describedBy}
            aria-label={p['aria-label']}
            data-testid={p['data-testid']}
            data-value={value}
            data-kind={kind}
            onChange={(e) => onType(e.target.value)}
            onBlur={onBlur}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && e.altKey) {
                e.preventDefault();
                setOpen(true);
              }
            }}
            className={fieldClass(fieldSize, cx('field-trailing w-full tabular-nums', className))}
          />
          <button
            ref={button}
            type="button"
            aria-label={buttonLabel}
            aria-haspopup="dialog"
            aria-expanded={open}
            disabled={disabled}
            onClick={() => (open ? close() : setOpen(true))}
            className={ICON_BUTTON}
          >
            {kind === 'time' ? <ClockIcon /> : <CalendarIcon />}
          </button>
          <input
            type="hidden"
            name={name}
            form={form}
            value={utc ? toNative(kind, parsed, timeZone, true) : value}
            disabled={disabled}
          />
        </div>
        {timeZone ? (
          <span
            id={zoneId}
            className="inline-flex min-h-7 shrink-0 items-center rounded-tag border border-line px-2 text-caption font-semibold text-ink-2"
          >
            <span className="sr-only">{fill(strings.timeZoneNote, { zone: timeZone })} </span>
            <span aria-hidden="true">{zoneNote(timeZone, locale)}</span>
          </span>
        ) : null}
      </div>
      {open ? (
        <div
          ref={panel}
          popover="manual"
          role="dialog"
          aria-label={buttonLabel}
          className={cx(PANEL_CLASS, 'w-auto p-2')}
        >
          <div className="flex items-start gap-2">
            {kind !== 'time' ? (
              <Calendar
                selected={parsed.ymd}
                onPick={pickDay}
                min={minP.ymd}
                max={maxP.ymd}
                locale={locale}
                today={today}
                onEscape={() => close()}
              />
            ) : null}
            {kind !== 'date' ? (
              <TimeList
                selected={parsed.time}
                onPick={pickTime}
                step={minuteStep}
                locale={locale}
                label={strings.chooseTime}
                onEscape={() => close()}
                autoFocus={kind === 'time'}
              />
            ) : null}
          </div>
        </div>
      ) : null}
      <FieldMessage id={inputId} error={shownError} hint={hint} />
    </div>
  );
}

/** DatePicker (U1): typed entry in the locale's format (ISO always works) plus our calendar. */
export const DatePicker = (p: DatePickerProps) => <Picker kind="date" {...p} />;
/** DateTimePicker (U1): date and time in the event's zone; submits datetime-local wall time. */
export const DateTimePicker = (p: DatePickerProps) => <Picker kind="datetime" {...p} />;
/** TimePicker (U1): typed time (24 h or am/pm) plus suggested times. */
export const TimePicker = (p: DatePickerProps) => <Picker kind="time" {...p} />;
