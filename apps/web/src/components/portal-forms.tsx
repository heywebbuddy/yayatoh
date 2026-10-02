'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, startTransition, useActionState, useEffect, useId, useState } from 'react';
import type {
  PortalLinkState,
  PortalSignInState,
  PortalSignOutState,
} from '@/app/[locale]/event-portal/actions.ts';
import { GuestCodeFields } from '@/components/guest-code-fields.tsx';
import { errorMessageKey } from '@/lib/errors.ts';

/** Once signed in or out, a full load of the next page. */
function useGoWhenDone(done: string | null | undefined) {
  useEffect(() => {
    if (done) window.location.assign(done);
  }, [done]);
}

function errorText(t: ReturnType<typeof useTranslations>, code: string | null, retryMinutes?: number) {
  if (!code) return null;
  if (code === 'rate_limited') return t('errors.rateLimitedRetry', { minutes: retryMinutes ?? 1 });
  if (code === 'forbidden') return t('portalSignIn.refused');
  return t(errorMessageKey(code));
}

/** An invitation's sign-in: email me a code (and link) → enter the code → the portal. */
export function PortalSignInForm({
  action,
  email,
}: {
  action: (prev: PortalSignInState, form: FormData) => Promise<PortalSignInState>;
  email: string;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { step: 'start', code: null });
  useGoWhenDone(state.done);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const data = new FormData(e.currentTarget, submitter);
    startTransition(() => formAction(data));
  };
  const error = errorText(t, state.code, state.retryMinutes);
  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {state.step === 'start' ? (
        <div>
          <Button type="submit" disabled={pending}>
            {t('portalSignIn.sendCode')}
          </Button>
        </div>
      ) : state.status ? (
        <>
          <GuestCodeFields
            email={email}
            status={state.status}
            attemptsLeft={state.attemptsLeft}
            resendAt={state.resendAt}
            submitLabel={t('portalSignIn.signIn')}
            pending={pending || Boolean(state.done)}
            idPrefix="portal-sign-in"
          />
          <p className="text-caption text-zinc-600">{t('portalSignIn.orLink')}</p>
        </>
      ) : null}
      <div aria-live="assertive">{error ? <Alert title={error} /> : null}</div>
    </form>
  );
}

/** The magic link in the browser that asked for it: one button signs in. */
export function PortalOpenLinkForm({
  action,
}: {
  action: (prev: PortalLinkState) => Promise<PortalLinkState>;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { code: null });
  useGoWhenDone(state.done);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div>
        <Button type="submit" disabled={pending || Boolean(state.done)}>
          {t('portalSignIn.continue')}
        </Button>
      </div>
      <div aria-live="assertive">
        {state.status ? <Alert title={t('portalSignIn.linkInvalidTitle')} /> : null}
      </div>
    </form>
  );
}

/** A magic link opened in another browser: the code from the same email signs in here. */
export function PortalLinkCodeForm({
  action,
}: {
  action: (prev: PortalLinkState, form: FormData) => Promise<PortalLinkState>;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { code: null });
  useGoWhenDone(state.done);
  const message =
    state.status === 'wrong'
      ? t('guestVerify.wrong', { count: state.attemptsLeft ?? 0 })
      : state.status === 'locked'
        ? t('guestVerify.locked')
        : state.status
          ? t('guestVerify.expired')
          : undefined;
  const error = errorText(t, state.code, state.retryMinutes);
  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="sm:w-56">
        <Input
          key={`${state.status ?? ''}-${state.attemptsLeft ?? ''}`}
          id="portal-link-code"
          name="verifyCode"
          label={t('guestVerify.codeLabel')}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          error={message}
        />
      </div>
      <Button type="submit" disabled={pending || Boolean(state.done)}>
        {t('portalSignIn.signIn')}
      </Button>
      <div aria-live="assertive">{error ? <Alert title={error} /> : null}</div>
    </form>
  );
}

export function PortalSignOutButton({
  action,
}: {
  action: (prev: PortalSignOutState) => Promise<PortalSignOutState>;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { done: null });
  useGoWhenDone(state.done);
  return (
    <form action={formAction}>
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {t('speakerPortal.signOut')}
      </Button>
    </form>
  );
}

/**
 * A file for the portal (a task's answer or a proposed photo): posted to `/api/portal/files`,
 * which sniffs and caps it and runs the portal command. The field has a visible label, the
 * accepted types in its hint, and a rejected file's reason as its error.
 */
export function PortalFileUpload({
  purpose,
  assigneeId,
  label,
  hint,
  accept,
  submitLabel,
  successLabel,
  errors,
  maxBytes,
}: {
  purpose: 'task_answer' | 'speaker_photo';
  assigneeId?: string;
  label: string;
  hint: string;
  accept: string;
  submitLabel: string;
  successLabel: string;
  /** Reason (`too_large`, `unsupported_type`, `no_file`, …) or code → message. */
  errors: Readonly<Record<string, string>>;
  maxBytes: number;
}) {
  const t = useTranslations();
  const router = useRouter();
  const id = useId();
  const [state, setState] = useState<{ ok: boolean; error: string | null }>({ ok: false, error: null });
  const [pending, setPending] = useState(false);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const file = (form.elements.namedItem('file') as HTMLInputElement | null)?.files?.[0];
    if (!file) return setState({ ok: false, error: errors.no_file ?? t('errors.validation_failed') });
    if (file.size > maxBytes)
      return setState({ ok: false, error: errors.too_large ?? t('errors.validation_failed') });
    const data = new FormData();
    data.set('purpose', purpose);
    if (assigneeId) data.set('assigneeId', assigneeId);
    data.set('file', file);
    setPending(true);
    try {
      const res = await fetch('/api/portal/files', { method: 'POST', body: data });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; code?: string; reason?: string };
      if (body.ok) {
        setState({ ok: true, error: null });
        form.reset();
        router.refresh();
      } else
        setState({
          ok: false,
          error:
            (body.reason && errors[body.reason]) ||
            (body.code && errors[body.code]) ||
            t(errorMessageKey(body.code ?? 'internal')),
        });
    } catch {
      setState({ ok: false, error: t('errors.internal') });
    } finally {
      setPending(false);
    }
  }
  const fieldId = `${id}-file`;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className="text-caption text-zinc-600">
          {label}
        </label>
        <input
          id={fieldId}
          name="file"
          type="file"
          accept={accept}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? `${fieldId}-error` : `${fieldId}-hint`}
          className="min-h-10 rounded-card border border-zinc-200 bg-white px-3 py-2 text-body"
        />
        {state.error ? (
          <p id={`${fieldId}-error`} className="text-caption text-pink-700">
            {state.error}
          </p>
        ) : (
          <p id={`${fieldId}-hint`} className="text-caption text-zinc-500">
            {hint}
          </p>
        )}
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {submitLabel}
        </Button>
      </div>
      <div aria-live="polite">{state.ok && !pending ? <Alert tone="info" title={successLabel} /> : null}</div>
    </form>
  );
}

/** Signed in already (or just now): load the portal (a plain link too, should scripts be off). */
export function GoToPortal({ href, label }: { href: string; label: string }) {
  useGoWhenDone(href);
  return (
    <a href={href} className="text-body underline underline-offset-2">
      {label}
    </a>
  );
}
