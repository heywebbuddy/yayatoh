'use client';

import {
  type AriaAttributes,
  Children,
  type FocusEvent,
  Fragment,
  isValidElement,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
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
import {
  AUTO_SEARCH_ABOVE,
  filterOptions,
  initialValue,
  type ListKey,
  type ListOption,
  moveActive,
  typeahead,
} from './listbox.ts';
import { useUiLocale } from './ui-locale.tsx';

export type { ListOption as SelectOption } from './listbox.ts';

/** Plain text of a React node (for type-ahead, search and the hidden value). */
export function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

interface ParsedOptions {
  readonly list: ListOption[];
  /** `<option hidden>` placeholders: shown when selected, never listed. */
  readonly hidden: ListOption[];
  readonly selected?: string;
}

/** `<option>` / `<optgroup>` children (the native markup) as options, so call sites barely change. */
export function optionsFromChildren(children: ReactNode, group?: string, out?: ParsedOptions): ParsedOptions {
  const acc: ParsedOptions = out ?? { list: [], hidden: [] };
  let selected = acc.selected;
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<Record<string, unknown> & { children?: ReactNode }>;
    if (el.type === 'option') {
      const p = el.props;
      const text = textOf(p.children);
      const opt: ListOption = {
        value: p.value === undefined ? text : String(p.value),
        label: p.children ?? text,
        text,
        disabled: Boolean(p.disabled),
        group,
      };
      if (p.hidden) acc.hidden.push(opt);
      else acc.list.push(opt);
      if (p.selected) selected = opt.value;
    } else if (el.type === 'optgroup') {
      const r = optionsFromChildren(el.props.children, String(el.props.label ?? ''), acc);
      if (r.selected !== undefined) selected = r.selected;
    } else if (el.type === Fragment) {
      const r = optionsFromChildren(el.props.children, group, acc);
      if (r.selected !== undefined) selected = r.selected;
    }
  });
  return { ...acc, selected };
}

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      data-chevron=""
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="pointer-events-none absolute inset-y-0 end-3 my-auto size-4 shrink-0 text-ink-2 transition-transform duration-150 group-aria-expanded:rotate-180 motion-reduce:transition-none"
    >
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

export function Tick({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx('mt-0.5 size-4 shrink-0 text-primary-ink', className)}
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="pointer-events-none absolute inset-y-0 start-2.5 my-auto size-4 text-ink-3"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

/** The trigger's look: our chevron inside the field, centred, 12 px from the end (UX principle 1). */
export function selectTriggerClass(size: 'sm' | 'md' | 'lg' = 'md', className?: string): string {
  // Classes carried over from a native select may not undo the chevron's room: inline padding
  // stays ours, and a width of the caller's replaces our full width.
  const own = (className ?? '').split(/\s+/).filter((c) => c && !/^(?:[\w-]+:)*(?:px|pe|pr|pl|ps)-/.test(c));
  const width = own.some((c) => /^(?:[\w-]+:)*w-/.test(c));
  return fieldClass(
    size,
    cx(
      'field-chevron group relative flex cursor-pointer appearance-none items-center text-start',
      !width && 'w-full',
      'disabled:cursor-not-allowed',
      own.join(' '),
    ),
  );
}

type DataAttributes = { [key: `data-${string}`]: string | number | boolean | undefined };

export interface SelectProps
  extends Omit<AriaAttributes, 'aria-expanded' | 'aria-controls' | 'aria-haspopup'>,
    DataAttributes {
  id?: string;
  name?: string;
  /** Visible label, associated with the trigger. */
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Controlled value (numbers are submitted as their string, as on a native select). */
  value?: string | number;
  defaultValue?: string | number;
  onValueChange?: (value: string) => void;
  /** Submit the enclosing form after a choice (the "change → submit" filters). */
  submitOnChange?: boolean;
  /** Options; or pass native `<option>`/`<optgroup>` children. */
  options?: readonly ListOption[];
  children?: ReactNode;
  /** Shown when the value matches no option. */
  placeholder?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  /** sm 32 px, md 44 px (default), lg 56 px. */
  fieldSize?: 'sm' | 'md' | 'lg';
  /** Search box in the open list: on above 8 options by default. */
  searchable?: boolean;
  /** The `form` attribute, for a control outside its form. */
  form?: string;
  /** Classes for the trigger (width, margins). */
  className?: string;
  /** Classes for the wrapper. */
  wrapperClassName?: string;
  autoFocus?: boolean;
  title?: string;
  /** The trigger (to move focus to the field). */
  ref?: Ref<HTMLButtonElement>;
}

/**
 * Select (U1): a single-choice styled listbox that replaces the native `<select>`. WAI-ARIA
 * select-only combobox: the trigger keeps focus and points at the active option
 * (`aria-activedescendant`); arrows, Home/End, PageUp/PageDown, type-ahead, Enter/Space choose,
 * Esc closes, Tab chooses and moves on. Above eight options the list gets a search box. A hidden
 * input carries `name`, so forms and server actions submit exactly what the native select did.
 */
export function Select({
  id,
  name,
  label,
  hint,
  error,
  value: controlledRaw,
  defaultValue: defaultRaw,
  onValueChange,
  submitOnChange,
  options: given,
  children,
  placeholder,
  required,
  disabled,
  fieldSize = 'md',
  searchable,
  form,
  className,
  wrapperClassName,
  autoFocus,
  title,
  ref,
  ...aria
}: SelectProps) {
  const { strings } = useUiLocale();
  const controlled =
    controlledRaw === undefined || controlledRaw === null ? undefined : String(controlledRaw);
  const defaultValue = defaultRaw === undefined || defaultRaw === null ? undefined : String(defaultRaw);
  const auto = useId();
  const triggerId = id ?? name ?? `select-${auto}`;
  const listId = `${triggerId}-list`;
  const labelId = `${triggerId}-label`;
  const parsed = useMemo(
    () => (given ? { list: [...given], hidden: [], selected: undefined } : optionsFromChildren(children)),
    [given, children],
  );
  const all = parsed.list;
  const [inner, setInner] = useState(() =>
    initialValue(all, undefined, defaultValue ?? parsed.selected ?? parsed.hidden[0]?.value),
  );
  const value = controlled ?? inner;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [invalid, setInvalid] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const valueInput = useRef<HTMLInputElement>(null);
  const typed = useRef({ buffer: '', at: 0 });
  const pendingSubmit = useRef(false);

  const withSearch = searchable ?? all.length > AUTO_SEARCH_ABOVE;
  const shown = useMemo(
    () => (withSearch && query ? filterOptions(all, query) : all),
    [all, query, withSearch],
  );
  const current = all.find((o) => o.value === value) ?? parsed.hidden.find((o) => o.value === value);

  const close = useCallback((focus = true) => {
    setOpen(false);
    setQuery('');
    if (focus) trigger.current?.focus();
  }, []);
  const dismiss = useCallback(() => close(false), [close]);
  useFloatingPanel(open, trigger, panel, dismiss);

  const choose = (o: ListOption | undefined, focus = true) => {
    if (!o || o.disabled) return;
    if (o.value !== value) {
      if (controlled === undefined) setInner(o.value);
      onValueChange?.(o.value);
      if (submitOnChange) pendingSubmit.current = true;
    }
    setInvalid(false);
    close(focus);
  };

  // Submit after React has written the new value into the hidden input.
  useEffect(() => {
    if (!pendingSubmit.current) return;
    pendingSubmit.current = false;
    valueInput.current?.form?.requestSubmit();
  });

  const openList = (at?: 'first' | 'last' | number) => {
    if (disabled) return;
    const selectedIdx = all.findIndex((o) => o.value === value);
    const idx =
      typeof at === 'number'
        ? at
        : at === 'first'
          ? moveActive(all, -1, 'Home')
          : at === 'last'
            ? moveActive(all, -1, 'End')
            : selectedIdx >= 0
              ? selectedIdx
              : moveActive(all, -1, 'Home');
    setActive(idx);
    setOpen(true);
    if (withSearch) requestAnimationFrame(() => search.current?.focus());
  };

  // Keep the active option visible.
  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, listId]);

  const onTypeahead = (key: string, list: readonly ListOption[], from: number) => {
    const now = Date.now();
    const t = typed.current;
    t.buffer = now - t.at > 700 ? key : t.buffer + key;
    t.at = now;
    return typeahead(list, t.buffer, from);
  };

  const navKeys: Record<string, ListKey> = {
    ArrowDown: 'ArrowDown',
    ArrowUp: 'ArrowUp',
    Home: 'Home',
    End: 'End',
    PageDown: 'PageDown',
    PageUp: 'PageUp',
  };

  const onKey = (e: KeyboardEvent, fromSearch: boolean) => {
    const nav = navKeys[e.key];
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openList();
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        openList(e.key === 'Home' ? 'first' : 'last');
      } else if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Closed: type-ahead chooses directly, as a native select does (open the list to search).
        e.preventDefault();
        const i = onTypeahead(
          e.key,
          all,
          all.findIndex((o) => o.value === value),
        );
        if (i >= 0) choose(all[i]);
      }
      return;
    }
    if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      choose(shown[active]);
    } else if (nav) {
      if (fromSearch && (e.key === 'Home' || e.key === 'End')) return; // move the caret
      e.preventDefault();
      setActive((a) => moveActive(shown, a, nav));
    } else if (e.key === 'Enter' || (e.key === ' ' && !fromSearch)) {
      e.preventDefault();
      choose(shown[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      if (shown[active]) choose(shown[active], false);
      else close(false);
    } else if (!fromSearch && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const i = onTypeahead(e.key, shown, active);
      if (i >= 0) setActive(i);
    }
  };

  const describedBy =
    [aria['aria-describedby'], error ? `${triggerId}-error` : hint ? `${triggerId}-hint` : null]
      .filter(Boolean)
      .join(' ') || undefined;
  const activeId = open && active >= 0 && shown[active] ? `${listId}-${active}` : undefined;
  const showInvalid = Boolean(error) || invalid;

  // Group headings: contiguous options of the same group.
  const rows: ReactNode[] = [];
  let lastGroup: string | undefined;
  let groupRows: ReactNode[] = [];
  const flush = (g: string | undefined, key: string) => {
    if (!groupRows.length) return;
    if (g) {
      rows.push(
        // biome-ignore lint/a11y/useSemanticElements: an option group inside a listbox (no fieldset in ARIA listboxes)
        <div key={key} role="group" aria-labelledby={`${key}-h`} className="flex flex-col gap-0.5 py-0.5">
          <div id={`${key}-h`} className="px-3 pb-0.5 pt-2 text-label tracking-[0.08em] text-ink-2 uppercase">
            {g}
          </div>
          {groupRows}
        </div>,
      );
    } else rows.push(...groupRows);
    groupRows = [];
  };
  shown.forEach((o, i) => {
    if (o.group !== lastGroup) {
      flush(lastGroup, `${listId}-g${i}`);
      lastGroup = o.group;
    }
    const selected = o.value === value;
    groupRows.push(
      // biome-ignore lint/a11y/useFocusableInteractive: listbox options are reached through aria-activedescendant (APG)
      // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox handles the keys
      <div
        key={o.value}
        id={`${listId}-${i}`}
        role="option"
        aria-selected={selected}
        aria-disabled={o.disabled || undefined}
        data-value={o.value}
        data-active={i === active || undefined}
        onPointerMove={() => !o.disabled && i !== active && setActive(i)}
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => choose(o)}
        className={cx(
          'flex min-h-10 cursor-pointer items-start gap-2.5 rounded-tag px-3 py-2 text-start text-body break-words whitespace-normal',
          'data-active:bg-surface-3 active:bg-surface-2',
          selected ? 'font-bold text-ink' : 'font-medium text-ink',
          o.disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span className="flex min-w-0 grow flex-col gap-0.5">
          <span>{o.label}</span>
          {o.hint ? <span className="text-caption font-medium text-ink-2">{o.hint}</span> : null}
        </span>
        {selected ? <Tick /> : <span aria-hidden="true" className="size-4 shrink-0" />}
      </div>,
    );
  });
  flush(lastGroup, `${listId}-gend`);

  const shownText = current ? current.text : textOf(placeholder);

  return (
    <div className={cx('relative flex flex-col gap-1.5', wrapperClassName)}>
      {label ? (
        <label id={labelId} htmlFor={triggerId} className="text-[13px] font-bold text-ink">
          {label}
        </label>
      ) : null}
      <div className="relative">
        <button
          {...aria}
          ref={(el) => {
            trigger.current = el;
            if (typeof ref === 'function') ref(el);
            else if (ref) ref.current = el;
          }}
          id={triggerId}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={withSearch ? undefined : activeId}
          aria-invalid={
            showInvalid || aria['aria-invalid'] === true || aria['aria-invalid'] === 'true' || undefined
          }
          aria-required={required || undefined}
          aria-describedby={describedBy}
          data-value={value}
          data-name={name}
          title={title ?? (shownText || undefined)}
          disabled={disabled}
          // biome-ignore lint/a11y/noAutofocus: passed through from the call site, as on a native select
          autoFocus={autoFocus}
          onClick={() => (open ? close() : openList())}
          onKeyDown={(e) => onKey(e, false)}
          className={selectTriggerClass(fieldSize, className)}
        >
          <span className={cx('min-w-0 grow truncate', !current && 'text-ink-3')}>
            {current ? current.label : placeholder}
          </span>
          <Chevron />
        </button>
        {name !== undefined || required ? (
          required ? (
            <input
              ref={valueInput}
              tabIndex={-1}
              aria-hidden="true"
              name={name}
              form={form}
              value={value}
              required
              disabled={disabled}
              onChange={() => {}}
              onInvalid={() => setInvalid(true)}
              onFocus={(e: FocusEvent) => {
                e.preventDefault();
                trigger.current?.focus();
              }}
              className="pointer-events-none absolute inset-x-0 bottom-0 h-px w-full opacity-0"
            />
          ) : (
            <input ref={valueInput} type="hidden" name={name} form={form} value={value} disabled={disabled} />
          )
        ) : (
          <input ref={valueInput} type="hidden" form={form} value={value} disabled />
        )}
      </div>
      {open ? (
        <div ref={panel} popover="manual" className={cx(PANEL_CLASS, 'w-full')} data-select-panel="">
          {withSearch ? (
            <div className="relative shrink-0 pb-1.5">
              <SearchIcon />
              <input
                ref={search}
                type="text"
                role="combobox"
                aria-label={strings.search}
                aria-expanded="true"
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={activeId}
                placeholder={strings.search}
                autoComplete="off"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  const next = filterOptions(all, e.target.value);
                  setActive(moveActive(next, -1, 'Home'));
                }}
                onKeyDown={(e) => onKey(e, true)}
                className={fieldClass('sm', 'w-full ps-8')}
              />
            </div>
          ) : null}
          <div
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={label ? labelId : aria['aria-labelledby']}
            aria-label={label || aria['aria-labelledby'] ? undefined : aria['aria-label']}
            className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain"
          >
            {rows.length ? (
              rows
            ) : (
              <p role="status" className="px-3 py-2.5 text-body text-ink-2">
                {strings.noResults}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div id={listId} role="listbox" hidden />
      )}
      <FieldMessage id={triggerId} error={error} hint={hint} />
    </div>
  );
}
