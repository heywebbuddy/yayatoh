'use client';

import {
  cloneElement,
  createContext,
  type ElementType,
  isValidElement,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cx } from '../cx.ts';

/* ───────────────────────────── Menu ───────────────────────────── */

export interface MenuItem {
  readonly key: string;
  readonly label: ReactNode;
  /** Shown before the label (24 px grid icon). */
  readonly icon?: ReactNode;
  readonly onSelect?: () => void;
  /** A link item. */
  readonly href?: string;
  /** For radio menus (theme: Light / Dark / System). */
  readonly checked?: boolean;
  readonly danger?: boolean;
  readonly disabled?: boolean;
}

/**
 * Menu button (WAI-ARIA menu pattern): Enter/Space/ArrowDown open it on the first item, arrows,
 * Home and End move, Esc closes and returns focus to the button, Tab closes. `radio` makes the
 * items `menuitemradio` with `aria-checked`.
 */
export function Menu({
  label,
  trigger,
  items,
  align = 'end',
  radio = false,
  triggerClassName,
  link: LinkC = 'a',
  testId,
}: {
  /** The button's accessible name. */
  label: string;
  /** The button's visible content (an icon, or text). */
  trigger: ReactNode;
  items: readonly MenuItem[];
  align?: 'start' | 'end';
  radio?: boolean;
  triggerClassName?: string;
  link?: ElementType;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const itemsEls = () => [
    ...(list.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? []),
  ];

  const close = useCallback((focusButton = true) => {
    setOpen(false);
    if (focusButton) button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const openAt = (which: 'first' | 'last') => {
    setOpen(true);
    requestAnimationFrame(() => {
      const els = itemsEls();
      (which === 'first' ? els[0] : els[els.length - 1])?.focus();
    });
  };

  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openAt('first');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openAt('last');
    }
  };

  const onListKey = (e: KeyboardEvent) => {
    const els = itemsEls();
    const i = els.indexOf(document.activeElement as HTMLElement);
    const move = (n: number) => els[(n + els.length) % els.length]?.focus();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(i + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(i - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      move(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      move(els.length - 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const itemClass = (it: MenuItem) =>
    cx(
      'flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-tag px-3 text-start text-body font-semibold outline-none',
      'hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus',
      it.danger ? 'text-danger' : 'text-ink',
      it.disabled && 'cursor-not-allowed opacity-50',
      '[&_svg]:size-[18px] [&_svg]:shrink-0',
    );

  return (
    <div className="relative inline-flex" data-testid={testId}>
      <button
        ref={button}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? setOpen(false) : openAt('first'))}
        onKeyDown={onButtonKey}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open ? (
        <div
          ref={list}
          id={id}
          role="menu"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={onListKey}
          className={cx(
            'absolute top-full z-50 mt-2 flex min-w-52 flex-col gap-0.5 rounded-tile border border-line bg-surface-solid p-1.5 elevation-pop',
            align === 'end' ? 'end-0' : 'start-0',
          )}
        >
          {items.map((it) => {
            const role = radio ? 'menuitemradio' : 'menuitem';
            const common = {
              role,
              tabIndex: -1,
              'aria-checked': radio ? Boolean(it.checked) : undefined,
              'aria-disabled': it.disabled || undefined,
              className: itemClass(it),
            };
            const content = (
              <>
                {it.icon}
                <span className="grow">{it.label}</span>
                {radio && it.checked ? (
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-primary-ink"
                  >
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                ) : null}
              </>
            );
            return it.href && !it.disabled ? (
              <LinkC key={it.key} href={it.href} {...common} onClick={() => setOpen(false)}>
                {content}
              </LinkC>
            ) : (
              <button
                key={it.key}
                type="button"
                {...common}
                onClick={() => {
                  if (it.disabled) return;
                  it.onSelect?.();
                  close();
                }}
              >
                {content}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ───────────────────────── Modal and Sheet ───────────────────────── */

function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    d.addEventListener('cancel', onCancel);
    return () => d.removeEventListener('cancel', onCancel);
  }, [onClose]);
  return ref;
}

/**
 * Modal dialog on the native <dialog> (focus trapped and restored by the browser, Esc closes).
 * Clicking the backdrop closes it too. Destructive confirmations use a `danger` action.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  closeLabel,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** The close button's name, e.g. "Close". */
  closeLabel: string;
}) {
  const ref = useDialog(open, onClose);
  const titleId = useId();
  const descId = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      onKeyDown={() => undefined}
      className="m-auto w-[min(520px,calc(100vw-2rem))] rounded-panel border border-line bg-surface-solid p-0 text-ink elevation-pop backdrop:bg-scrim backdrop:backdrop-blur-sm"
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-start gap-3">
          <div className="flex grow flex-col gap-1">
            <h2 id={titleId} className="m-0 text-card text-ink">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="m-0 text-body text-ink-2">
                {description}
              </p>
            ) : null}
          </div>
          <CloseButton label={closeLabel} onClick={onClose} />
        </div>
        {children}
        {footer ? <div className="flex flex-wrap justify-end gap-2.5 pt-2">{footer}</div> : null}
      </div>
    </dialog>
  );
}

/** Side sheet (drawer) from the end edge: filters, details, the mobile menu. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  closeLabel,
  side = 'end',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  closeLabel: string;
  side?: 'start' | 'end';
}) {
  const ref = useDialog(open, onClose);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      onKeyDown={() => undefined}
      className={cx(
        'fixed inset-y-0 m-0 h-dvh max-h-dvh w-[min(420px,100vw)] max-w-none border-line bg-surface-solid p-0 text-ink elevation-pop backdrop:bg-scrim',
        side === 'end' ? 'ms-auto me-0 border-s' : 'ms-0 me-auto border-e',
      )}
    >
      <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
        <div className="flex items-center gap-3">
          <h2 id={titleId} className="m-0 grow text-card text-ink">
            {title}
          </h2>
          <CloseButton label={closeLabel} onClick={onClose} />
        </div>
        {children}
      </div>
    </dialog>
  );
}

function CloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-10 shrink-0 items-center justify-center rounded-control text-ink-2 hover:bg-surface-3 hover:text-ink"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </button>
  );
}

/* ───────────────────────────── Toast ───────────────────────────── */

export interface ToastInput {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly tone?: 'success' | 'info' | 'danger';
  /** An action such as "Undo" (closes the toast when chosen). */
  readonly action?: { label: string; onSelect: () => void };
  /** ms before it goes; 0 keeps it until closed. Default 6 s. */
  readonly duration?: number;
}
interface ToastEntry extends ToastInput {
  readonly id: number;
}
const ToastContext = createContext<((t: ToastInput) => void) | null>(null);

/** `toast({ title: 'Saved' })` from any client component under a <ToastProvider>. */
export function useToast(): (t: ToastInput) => void {
  const ctx = useContext(ToastContext);
  return ctx ?? (() => undefined);
}

/**
 * Toast region (polite live region, bottom end). Toasts pause while hovered or focused, and each
 * has a close button; success toasts confirm saves, an action can undo.
 */
export function ToastProvider({ children, closeLabel }: { children: ReactNode; closeLabel: string }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const push = useCallback((t: ToastInput) => {
    const id = next.current++;
    setToasts((ts) => [...ts.slice(-2), { ...t, id }]);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <section
        aria-live="polite"
        aria-relevant="additions"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-end gap-2 sm:inset-x-auto sm:end-4"
      >
        {toasts.map((t) => (
          <ToastView key={t.id} toast={t} onClose={() => dismiss(t.id)} closeLabel={closeLabel} />
        ))}
      </section>
    </ToastContext.Provider>
  );
}

function ToastView({
  toast,
  onClose,
  closeLabel,
}: {
  toast: ToastEntry;
  onClose: () => void;
  closeLabel: string;
}) {
  const [paused, setPaused] = useState(false);
  const duration = toast.duration ?? 6000;
  useEffect(() => {
    if (paused || duration === 0) return;
    const h = setTimeout(onClose, duration);
    return () => clearTimeout(h);
  }, [paused, duration, onClose]);
  const tone = toast.tone ?? 'success';
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover and focus only pause the timer (WCAG 2.2.1)
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-tile border border-line bg-surface-solid p-3.5 text-ink elevation-pop"
    >
      <span
        aria-hidden="true"
        className={cx(
          'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full',
          tone === 'success' && 'bg-success-dot text-black',
          tone === 'info' && 'bg-primary text-on-primary',
          tone === 'danger' && 'bg-danger-dot text-black',
        )}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {tone === 'success' ? <path d="m5 12.5 4.5 4.5L19 7.5" /> : <path d="M12 7v6M12 17h.01" />}
        </svg>
      </span>
      <div className="flex grow flex-col gap-0.5">
        <p className="m-0 text-body font-bold">{toast.title}</p>
        {toast.description ? <p className="m-0 text-caption text-ink-2">{toast.description}</p> : null}
      </div>
      {toast.action ? (
        <button
          type="button"
          onClick={() => {
            toast.action?.onSelect();
            onClose();
          }}
          className="min-h-8 rounded-tag px-2.5 text-body font-bold text-primary-ink hover:bg-surface-3"
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label={closeLabel}
        onClick={onClose}
        className="flex size-8 shrink-0 items-center justify-center rounded-tag text-ink-2 hover:bg-surface-3"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}

/* ──────────────────────────── Tooltip ──────────────────────────── */

/**
 * Tooltip on hover and keyboard focus, dismissible with Esc (WCAG 1.4.13). The child must be a
 * focusable element; it gets `aria-describedby`. Never put essential information only here.
 */
export function Tooltip({
  label,
  children,
  side = 'top',
}: {
  label: string;
  children: ReactElement;
  side?: 'top' | 'bottom';
}) {
  const id = useId();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setShown(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shown]);
  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, { 'aria-describedby': id })
    : children;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover/focus listeners only mirror the child's own focus
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShown(true)}
      onMouseLeave={() => setShown(false)}
      onFocus={() => setShown(true)}
      onBlur={() => setShown(false)}
    >
      {child}
      <span
        id={id}
        role="tooltip"
        className={cx(
          'pointer-events-none absolute start-1/2 z-50 w-max max-w-64 -translate-x-1/2 rounded-tag bg-tag px-2.5 py-1.5 text-caption font-semibold text-tag-ink transition-opacity duration-150 rtl:translate-x-1/2 dark:bg-surface-solid dark:text-ink dark:elevation-pop',
          side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
          shown ? 'opacity-100' : 'invisible opacity-0',
        )}
      >
        {label}
      </span>
    </span>
  );
}
