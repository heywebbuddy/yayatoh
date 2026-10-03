'use client';

import type { StepUpMethod } from '@yayatoh/auth';
import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import {
  createContext,
  type FormEvent,
  type FormHTMLAttributes,
  type ReactNode,
  useActionState,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import {
  beginStepUpAction,
  confirmStepUpAction,
  confirmStepUpAsPersonaAction,
  type StepUpStart,
  type StepUpState,
} from '@/server/step-up-actions.ts';

/**
 * Step-up UI (M1.2c). Commands marked `stepUp` answer `step_up_required` when the session's fresh
 * window (10 minutes) has passed; the form then opens "Confirm it's you", and once confirmed the
 * same submission is sent again. Typed values stay: the form is not reset while the dialog is
 * open, and they are put back if the person cancels.
 */
interface StepUpApi {
  /** Open the dialog; resolves true once confirmed, false if cancelled. */
  confirm(): Promise<boolean>;
}

const StepUpContext = createContext<StepUpApi | null>(null);

export function StepUpProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pending = useRef<((ok: boolean) => void) | null>(null);
  const confirm = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        pending.current?.(false);
        pending.current = resolve;
        setOpen(true);
      }),
    [],
  );
  const done = useCallback((ok: boolean) => {
    setOpen(false);
    pending.current?.(ok);
    pending.current = null;
  }, []);
  const api = useMemo(() => ({ confirm }), [confirm]);
  return (
    <StepUpContext value={api}>
      {children}
      {open ? <StepUpDialog onDone={done} /> : null}
    </StepUpContext>
  );
}

export function useStepUp(): StepUpApi {
  const api = useContext(StepUpContext);
  if (!api) throw new Error('useStepUp needs a <StepUpProvider>');
  return api;
}

function StepUpDialog({ onDone }: { onDone: (ok: boolean) => void }) {
  const t = useTranslations('stepUp');
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const errorId = useId();
  const [method, setMethod] = useState<StepUpMethod | null>(null);
  const [problem, setProblem] = useState<StepUpStart['problem'] | null>(null);
  const [persona, setPersona] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [resent, setResent] = useState(false);
  const [code, setCode] = useState<StepUpState['code']>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  // U3: a failed start (network, an email that could not be sent) says so and can be retried,
  // instead of leaving the dialog on "One moment…" with Confirm disabled.
  useEffect(() => {
    let live = true;
    setProblem(null);
    beginStepUpAction().then(
      (r) => {
        if (!live) return;
        setMethod(r.method);
        setPersona(Boolean(r.persona));
        setProblem(r.ok ? null : (r.problem ?? 'failed'));
      },
      () => {
        if (live) setProblem('failed');
      },
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  // Close first: the browser returns focus to whatever opened the dialog.
  const finish = useCallback(
    (ok: boolean) => {
      ref.current?.close();
      onDone(ok);
    },
    [onDone],
  );

  // A plain submit handler, not a form action: the form that opened this dialog is still inside
  // its own (async) transition, and React holds state from transitions until all of them end.
  // Resolving the confirmation here, outside any transition, lets that form continue.
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !method) return;
    const form = e.currentTarget;
    setBusy(true);
    setResent(false);
    try {
      const r = await confirmStepUpAction({ ok: false, code: null }, new FormData(form));
      if (r.ok) return finish(true);
      setCode(r.code);
      const field = form.querySelector<HTMLInputElement>('input[name="code"], input[name="password"]');
      if (field) {
        field.value = '';
        field.focus();
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmAsPersona() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await confirmStepUpAsPersonaAction();
      if (r.ok) return finish(true);
      setCode(r.code);
    } finally {
      setBusy(false);
    }
  }

  const error =
    code === 'invalid_password'
      ? t('invalidPassword')
      : code === 'rate_limited'
        ? t('rateLimited')
        : code === 'unauthenticated'
          ? t('unauthenticated')
          : code
            ? t('invalidCode')
            : null;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descId}
      onCancel={(e) => {
        e.preventDefault();
        finish(false);
      }}
      className="m-auto w-[min(440px,calc(100vw-2rem))] rounded-panel border border-line bg-surface p-6 text-ink elevation-pop backdrop:bg-scrim"
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <h2 id={titleId} className="text-section">
          {t('title')}
        </h2>
        <div id={descId} className="flex flex-col gap-1.5 text-body text-ink-2">
          <p>{t('why')}</p>
          {method ? (
            <p>{t(`explain.${method}`)}</p>
          ) : problem ? null : (
            <p aria-live="polite">{t('loading')}</p>
          )}
        </div>
        {problem ? (
          <Alert title={t(`problem.${problem}`)}>
            {problem === 'failed' ? (
              <Button variant="secondary" size="sm" className="mt-2" onClick={() => setAttempt((n) => n + 1)}>
                {t('retry')}
              </Button>
            ) : null}
          </Alert>
        ) : null}
        {persona ? (
          <div className="flex flex-col gap-2 rounded-tile border border-line bg-surface-2 px-4 py-3">
            <p className="m-0 text-caption text-ink-2">{t('persona.explain')}</p>
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              disabled={busy}
              onClick={confirmAsPersona}
            >
              {t('persona.confirm')}
            </Button>
          </div>
        ) : null}
        <div id={errorId} aria-live="polite">
          {error ? <Alert title={error} /> : null}
          {resent && !error ? <Alert tone="info" title={t('resent')} /> : null}
        </div>
        {method ? <input type="hidden" name="method" value={method} /> : null}
        {method === 'password' ? (
          <Input
            key="password"
            id="step-up-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            label={t('passwordLabel')}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
        ) : method ? (
          <Input
            key="code"
            id="step-up-code"
            name="code"
            inputMode={method === 'email' ? 'numeric' : 'text'}
            autoComplete="one-time-code"
            required
            autoFocus
            label={t('codeLabel')}
            hint={method === 'totp' ? t('codeHint') : undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={
              [error ? errorId : null, method === 'totp' ? 'step-up-code-hint' : null]
                .filter(Boolean)
                .join(' ') || undefined
            }
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={busy || !method}>
            {t('confirm')}
          </Button>
          <Button variant="secondary" onClick={() => finish(false)}>
            {t('cancel')}
          </Button>
          {method === 'email' ? (
            <Button
              variant="ghost"
              onClick={async () => {
                setCode(null);
                await beginStepUpAction();
                setResent(true);
              }}
            >
              {t('resend')}
            </Button>
          ) : null}
        </div>
      </form>
    </dialog>
  );
}

/** Put submitted values back into a form (after React's reset), so nothing typed is lost. */
function refill(form: HTMLFormElement, fd: FormData) {
  for (const el of Array.from(form.elements)) {
    if (
      !(
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
      ) ||
      !el.name
    )
      continue;
    const values = fd.getAll(el.name).map(String);
    if (el instanceof HTMLInputElement) {
      if (['file', 'hidden', 'submit', 'button', 'password'].includes(el.type)) continue;
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = values.includes(el.value);
      else if (values[0] !== undefined) el.value = values[0];
    } else if (el instanceof HTMLSelectElement && el.multiple) {
      for (const o of Array.from(el.options)) o.selected = values.includes(o.value);
    } else if (values[0] !== undefined) el.value = values[0];
  }
}

/**
 * The error a step-up form shows (U3). `step_up_required` (the dialog was cancelled or closed)
 * says why and offers "Confirm it's you", which sends the same submission again, so there is
 * never a dead end; any other code is a plain alert.
 */
export function StepUpError({
  code,
  formRef,
}: {
  code: string;
  formRef: { readonly current: HTMLFormElement | null };
}) {
  const t = useTranslations();
  return (
    <Alert title={t(errorMessageKey(code))}>
      {code === 'step_up_required' ? (
        <Button
          variant="secondary"
          size="sm"
          className="mt-2"
          onClick={() => formRef.current?.requestSubmit()}
        >
          {t('stepUp.again')}
        </Button>
      ) : null}
    </Alert>
  );
}

/** The error code an action state carries, if any (`{ code }` states, or union states with one). */
const codeOf = (s: unknown): string | null =>
  s && typeof s === 'object' && 'code' in s && typeof s.code === 'string' ? s.code : null;

/**
 * `useActionState` for forms whose Server Action may answer `step_up_required`: the dialog opens
 * and, once confirmed, the same submission is sent again. When the action still answers with a
 * code (cancelled, or another error), what was typed is put back: React resets a form after its
 * action, so the refill runs in an effect after the result is committed. Attach `formRef`.
 */
export function useStepUpActionState<S>(action: (prev: S, form: FormData) => Promise<S>, initial: S) {
  const stepUp = useContext(StepUpContext);
  const formRef = useRef<HTMLFormElement>(null);
  const refillWith = useRef<FormData | null>(null);
  const wrapped = useCallback(
    async (prev: S, form: FormData): Promise<S> => {
      const first = await action(prev, form);
      const result =
        codeOf(first) === 'step_up_required' && stepUp && (await stepUp.confirm())
          ? await action(prev, form)
          : first;
      refillWith.current = codeOf(result) ? form : null;
      return result;
    },
    [action, stepUp],
  );
  // States are plain objects, never promises: Awaited<S> is S.
  type Reducer = (prev: Awaited<S>, form: FormData) => Promise<Awaited<S>>;
  const [state, formAction, pending] = useActionState(wrapped as unknown as Reducer, initial as Awaited<S>);
  // React resets a form after its action; when the action answered with a code (the dialog was
  // cancelled, or refused) the form keeps what was typed and picked instead. The reset event is
  // stopped before any control hears it, so custom controls (U1 Select, pickers) keep their
  // values too. The refill below stays as the fallback for anything reset another way.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const keep = (e: Event) => {
      if (!refillWith.current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    form.addEventListener('reset', keep, { capture: true });
    return () => form.removeEventListener('reset', keep, { capture: true });
  }, []);
  useEffect(() => {
    const fd = refillWith.current;
    if (!fd || !formRef.current || !state) return;
    refillWith.current = null;
    refill(formRef.current, fd);
  }, [state]);
  return [state, formAction, pending, formRef] as const;
}

export type StepUpActionResult = { readonly code: string | null } | undefined;

/**
 * A form for Server Actions that redirect or revalidate on success and answer `{ code }` when
 * they can't: `step_up_required` opens the dialog and resubmits; other codes show an alert.
 */
export function StepUpForm({
  action,
  children,
  ...props
}: {
  action: (form: FormData) => Promise<StepUpActionResult>;
  children: ReactNode;
} & Omit<FormHTMLAttributes<HTMLFormElement>, 'action' | 'children'>) {
  const run = useCallback(
    async (_prev: { code: string | null }, form: FormData) => ({ code: (await action(form))?.code ?? null }),
    [action],
  );
  const [state, formAction, , formRef] = useStepUpActionState(run, { code: null });
  return (
    <form ref={formRef} action={formAction} {...props}>
      {children}
      {state.code ? (
        <div aria-live="polite" className="basis-full">
          <StepUpError code={state.code} formRef={formRef} />
        </div>
      ) : null}
    </form>
  );
}
