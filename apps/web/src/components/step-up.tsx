'use client';

import type { StepUpMethod } from '@yayatoh/auth';
import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import {
  createContext,
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
import { beginStepUpAction, confirmStepUpAction, type StepUpState } from '@/server/step-up-actions.ts';

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
  const [method, setMethod] = useState<StepUpMethod | null>(null);
  const [resent, setResent] = useState(false);
  const [state, formAction, pending] = useActionState<StepUpState, FormData>(confirmStepUpAction, {
    ok: false,
    code: null,
  });

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    let live = true;
    void beginStepUpAction().then((r) => {
      if (live) setMethod(r.method);
    });
    return () => {
      live = false;
    };
  }, []);

  // Close first: the browser returns focus to whatever opened the dialog.
  const finish = useCallback(
    (ok: boolean) => {
      ref.current?.close();
      onDone(ok);
    },
    [onDone],
  );

  useEffect(() => {
    if (state.ok) finish(true);
  }, [state.ok, finish]);

  const error =
    state.code === 'invalid_password'
      ? t('invalidPassword')
      : state.code === 'rate_limited'
        ? t('rateLimited')
        : state.code === 'unauthenticated'
          ? t('unauthenticated')
          : state.code
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
      className="m-auto w-[min(440px,calc(100vw-2rem))] rounded-panel border border-zinc-200 bg-white p-6 text-zinc-900 shadow-xl backdrop:bg-zinc-900/40"
    >
      <form action={formAction} className="flex flex-col gap-4">
        <h2 id={titleId} className="text-section">
          {t('title')}
        </h2>
        <div id={descId} className="flex flex-col gap-1.5 text-body text-zinc-600">
          <p>{t('why')}</p>
          {method ? <p>{t(`explain.${method}`)}</p> : <p aria-live="polite">{t('loading')}</p>}
        </div>
        <div aria-live="polite">
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
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending || !method}>
            {t('confirm')}
          </Button>
          <Button variant="secondary" onClick={() => finish(false)}>
            {t('cancel')}
          </Button>
          {method === 'email' ? (
            <Button
              variant="ghost"
              onClick={async () => {
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

function useRefill() {
  const formRef = useRef<HTMLFormElement>(null);
  const [restore, setRestore] = useState<FormData | null>(null);
  useEffect(() => {
    if (restore && formRef.current) {
      refill(formRef.current, restore);
      setRestore(null);
    }
  }, [restore]);
  return { formRef, setRestore };
}

type Coded = { readonly code: string | null };

/**
 * For `useActionState` forms: wraps the Server Action so a `step_up_required` answer opens the
 * dialog and, once confirmed, retries with the same values. Attach `formRef` to the form.
 */
export function useStepUpAction<S extends Coded>(action: (prev: S, form: FormData) => Promise<S>) {
  const stepUp = useContext(StepUpContext);
  const { formRef, setRestore } = useRefill();
  const wrapped = useCallback(
    async (prev: S, form: FormData): Promise<S> => {
      const first = await action(prev, form);
      if (first.code !== 'step_up_required' || !stepUp) return first;
      const result = (await stepUp.confirm()) ? await action(prev, form) : first;
      if (result.code) setRestore(form);
      return result;
    },
    [action, stepUp, setRestore],
  );
  return { action: wrapped, formRef };
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
  const t = useTranslations();
  const stepUp = useContext(StepUpContext);
  const { formRef, setRestore } = useRefill();
  const [code, setCode] = useState<string | null>(null);
  const run = async (form: FormData) => {
    setCode(null);
    let r = await action(form);
    if (r?.code === 'step_up_required' && stepUp && (await stepUp.confirm())) r = await action(form);
    if (r?.code) {
      setRestore(form);
      setCode(r.code);
    }
  };
  return (
    <form ref={formRef} action={run} {...props}>
      {children}
      {code ? (
        <div aria-live="polite" className="basis-full">
          <Alert title={t(errorMessageKey(code))} />
        </div>
      ) : null}
    </form>
  );
}
