'use client';

import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cx } from '../cx.ts';
import { PANEL_CLASS, useFloatingPanel } from './floating.ts';
import { FieldMessage, fieldClass } from './input.tsx';
import { filterOptions, type ListKey, type ListOption, moveActive } from './listbox.ts';
import { Tick } from './select.tsx';
import { useUiLocale } from './ui-locale.tsx';
import { fill } from './ui-strings.ts';

export interface ComboboxProps {
  id?: string;
  name?: string;
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Static options, filtered as the person types. */
  options?: readonly ListOption[];
  /** Async options for a query (debounced; the latest answer wins). */
  loadOptions?: (query: string) => Promise<readonly ListOption[]>;
  /** Several values, shown as removable chips; each submits under `name`. */
  multiple?: boolean;
  value?: string | readonly string[];
  defaultValue?: string | readonly string[];
  onValueChange?: (value: string[]) => void;
  /** Offers "Create “query”" when nothing matches exactly; returns the new option. */
  onCreate?: (query: string) => ListOption | Promise<ListOption>;
  /** Options already known for the initial values (async lists). */
  selectedOptions?: readonly ListOption[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  fieldSize?: 'sm' | 'md' | 'lg';
  form?: string;
  className?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

/**
 * Stable defaults: a fresh `[]` per render would re-run the effect that merges known options on
 * every render, and its state update would render again (React error 185, "maximum update
 * depth", after any re-render).
 */
const NO_OPTIONS: readonly ListOption[] = [];

/**
 * The options the box knows (to label chips and the input), with `incoming` merged in. It returns
 * the same map when nothing changed, so React bails out of the update: a caller passing a fresh
 * array on every render (`options={items.map(…)}`) re-runs the merging effect, and a new map each
 * time would render again, forever (U7's Series field; U9's coupon events). With the stable
 * defaults above this is the one guard against that loop.
 */
export function mergeKnown(
  known: ReadonlyMap<string, ListOption>,
  incoming: readonly ListOption[],
): Map<string, ListOption> {
  // Rich labels and hints are new elements on every render: they count as changed only when
  // they are plain values (the option's `text` carries the words either way).
  const differs = (a: unknown, b: unknown) => a !== b && (typeof a !== 'object' || typeof b !== 'object');
  const changed = incoming.some((o) => {
    const k = known.get(o.value);
    return (
      k === undefined ||
      (k !== o &&
        (k.text !== o.text ||
          k.disabled !== o.disabled ||
          k.group !== o.group ||
          k.keywords !== o.keywords ||
          differs(k.label, o.label) ||
          differs(k.hint, o.hint)))
    );
  });
  if (!changed) return known as Map<string, ListOption>;
  const next = new Map(known);
  for (const o of incoming) next.set(o.value, o);
  return next;
}

const asArray = (v: string | readonly string[] | undefined): string[] =>
  v === undefined ? [] : typeof v === 'string' ? (v ? [v] : []) : [...v];

const NAV: Record<string, ListKey> = {
  ArrowDown: 'ArrowDown',
  ArrowUp: 'ArrowUp',
  PageDown: 'PageDown',
  PageUp: 'PageUp',
};

/**
 * Combobox (U1): an editable WAI-ARIA combobox with list autocomplete. Searchable, static or async
 * options, single or multiple (chips with a remove button each; Backspace on an empty box removes
 * the last), and an optional "create new" option. Values submit through hidden inputs named
 * `name`, one per value, like a native multiple select.
 */
export function Combobox({
  id,
  name,
  label,
  hint,
  error,
  options = NO_OPTIONS,
  loadOptions,
  multiple = false,
  value: controlled,
  defaultValue,
  onValueChange,
  onCreate,
  selectedOptions = NO_OPTIONS,
  placeholder,
  required,
  disabled,
  fieldSize = 'md',
  form,
  className,
  ...rest
}: ComboboxProps) {
  const { strings } = useUiLocale();
  const auto = useId();
  const inputId = id ?? `combo-${auto}`;
  const listId = `${inputId}-list`;
  const labelId = `${inputId}-label`;
  const [inner, setInner] = useState<string[]>(() => asArray(defaultValue));
  const values = controlled === undefined ? inner : asArray(controlled);
  const [known, setKnown] = useState<Map<string, ListOption>>(
    () => new Map([...options, ...selectedOptions].map((o) => [o.value, o])),
  );
  const [query, setQuery] = useState('');
  const [typing, setTyping] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loaded, setLoaded] = useState<readonly ListOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    setKnown((m) => mergeKnown(m, [...options, ...selectedOptions]));
  }, [options, selectedOptions]);

  // A form reset returns to the default values.
  const defaultsRef = useRef(asArray(defaultValue));
  defaultsRef.current = asArray(defaultValue);
  useEffect(() => {
    const f = input.current?.form;
    if (!f) return;
    const onReset = () => {
      setInner(defaultsRef.current);
      setQuery('');
    };
    f.addEventListener('reset', onReset);
    return () => f.removeEventListener('reset', onReset);
  }, []);

  // Async options, debounced; an older answer never overwrites a newer one.
  useEffect(() => {
    if (!loadOptions || !open) return;
    const mine = ++seq.current;
    setLoading(true);
    const timer = setTimeout(() => {
      loadOptions(query)
        .then((list) => {
          if (mine !== seq.current) return;
          setLoaded(list);
          setKnown((m) => new Map([...m, ...list.map((o) => [o.value, o] as const)]));
          setActive(moveActive(list, -1, 'Home'));
        })
        .catch(() => mine === seq.current && setLoaded([]))
        .finally(() => mine === seq.current && setLoading(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [loadOptions, query, open]);

  const source = loadOptions ? (loaded ?? []) : filterOptions(options, typing ? query : '');
  const shownBase = multiple ? source.filter((o) => !values.includes(o.value)) : source;
  const trimmed = query.trim();
  const exact = shownBase.some((o) => o.text.toLowerCase() === trimmed.toLowerCase());
  const createRow: ListOption | null =
    onCreate && trimmed && !exact
      ? { value: `\u0000create`, label: fill(strings.create, { query: trimmed }), text: trimmed }
      : null;
  const shown = useMemo(() => (createRow ? [...shownBase, createRow] : shownBase), [shownBase, createRow]);

  const setValues = (next: string[]) => {
    if (controlled === undefined) setInner(next);
    onValueChange?.(next);
  };
  const close = useCallback(() => {
    setOpen(false);
    setTyping(false);
    setQuery('');
  }, []);
  useFloatingPanel(open, wrap, panel, close);

  const choose = async (o: ListOption | undefined) => {
    if (!o || o.disabled) return;
    let picked = o;
    if (o.value === '\u0000create' && onCreate) {
      picked = await onCreate(trimmed);
      setKnown((m) => new Map(m).set(picked.value, picked));
    }
    if (multiple) {
      setValues(values.includes(picked.value) ? values : [...values, picked.value]);
      setQuery('');
      setTyping(false);
      setActive(-1);
      input.current?.focus();
    } else {
      setValues([picked.value]);
      close();
    }
  };

  const remove = (v: string) => {
    setValues(values.filter((x) => x !== v));
    input.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const nav = NAV[e.key];
    if (nav) {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(moveActive(shown, -1, e.key === 'ArrowUp' ? 'End' : 'Home'));
      } else setActive((a) => moveActive(shown, a, nav));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      void choose(shown[active]);
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (query) setQuery('');
    } else if (e.key === 'Backspace' && multiple && !query && values.length) {
      remove(values[values.length - 1] as string);
    } else if (e.key === 'Tab') close();
  };

  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, listId]);

  const single = !multiple ? known.get(values[0] ?? '') : undefined;
  const inputValue = multiple || typing ? query : (single?.text ?? '');
  const activeId = open && shown[active] ? `${listId}-${active}` : undefined;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {label ? (
        <label id={labelId} htmlFor={inputId} className="text-[13px] font-bold text-ink">
          {label}
        </label>
      ) : null}
      <div
        ref={wrap}
        data-testid={rest['data-testid']}
        className={fieldClass(
          fieldSize,
          cx(
            'field-chevron group relative flex h-auto w-full flex-wrap items-center gap-1.5 py-1.5 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-focus',
            Boolean(error) && 'field-invalid',
            disabled && 'cursor-not-allowed bg-surface-2',
            className,
          ),
        )}
        data-open={open || undefined}
      >
        {multiple
          ? values.map((v) => {
              const o = known.get(v);
              const text = o?.text ?? v;
              return (
                <span
                  key={v}
                  className="inline-flex min-h-7 max-w-full items-center gap-1 rounded-pill bg-primary-soft ps-2.5 pe-1 text-caption font-semibold text-primary-ink"
                >
                  <span className="min-w-0 break-words">{o?.label ?? v}</span>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={fill(strings.remove, { label: text })}
                    onClick={() => remove(v)}
                    className="inline-grid size-6 shrink-0 cursor-pointer place-items-center rounded-full hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 16 16"
                      className="size-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <path d="m4 4 8 8M12 4l-8 8" />
                    </svg>
                  </button>
                </span>
              );
            })
          : null}
        <input
          ref={input}
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          aria-label={rest['aria-label']}
          aria-required={required || undefined}
          autoComplete="off"
          disabled={disabled}
          placeholder={multiple && values.length ? undefined : placeholder}
          value={inputValue}
          onChange={(e) => {
            setQuery(e.target.value);
            setTyping(true);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => !disabled && setOpen(true)}
          onClick={() => !disabled && setOpen(true)}
          onKeyDown={onKey}
          className="min-h-7 min-w-24 flex-1 bg-transparent text-inherit outline-none placeholder:text-ink-3 disabled:cursor-not-allowed"
        />
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute inset-y-0 end-3 my-auto size-4 text-ink-2 transition-transform duration-150 group-data-open:rotate-180 motion-reduce:transition-none"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
        {(multiple ? values : values.slice(0, 1)).map((v) => (
          <input key={v} type="hidden" name={name} form={form} value={v} disabled={disabled} />
        ))}
        {required && !values.length ? (
          <input
            tabIndex={-1}
            aria-hidden="true"
            required
            value=""
            onChange={() => {}}
            onFocus={() => input.current?.focus()}
            className="pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-0"
          />
        ) : null}
      </div>
      {open ? (
        <div ref={panel} popover="manual" className={cx(PANEL_CLASS, 'w-full')}>
          <div
            id={listId}
            role="listbox"
            aria-multiselectable={multiple || undefined}
            aria-labelledby={label ? labelId : undefined}
            aria-label={label ? undefined : rest['aria-label']}
            className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain"
          >
            {shown.map((o, i) => {
              const selected = values.includes(o.value);
              return (
                // biome-ignore lint/a11y/useFocusableInteractive: options are reached through aria-activedescendant (APG)
                // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox input handles the keys
                <div
                  key={o.value}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={o.disabled || undefined}
                  data-value={o.value === '\u0000create' ? undefined : o.value}
                  data-create={o.value === '\u0000create' || undefined}
                  data-active={i === active || undefined}
                  onPointerMove={() => i !== active && setActive(i)}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => void choose(o)}
                  className={cx(
                    'flex min-h-10 cursor-pointer items-start gap-2.5 rounded-tag px-3 py-2 text-body font-medium break-words text-ink',
                    'data-active:bg-surface-3',
                    o.value === '\u0000create' && 'font-bold text-primary-ink',
                    o.disabled && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <span className="flex min-w-0 grow flex-col gap-0.5">
                    <span>{o.label}</span>
                    {o.hint ? <span className="text-caption text-ink-2">{o.hint}</span> : null}
                  </span>
                  {selected ? <Tick /> : null}
                </div>
              );
            })}
            {!shown.length ? (
              <p role="status" className="px-3 py-2.5 text-body text-ink-2">
                {loading ? strings.loading : strings.noResults}
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <div id={listId} role="listbox" hidden />
      )}
      <FieldMessage id={inputId} error={error} hint={hint} />
    </div>
  );
}
