'use client';

import { Alert, Button, Card, Input } from '@yayatoh/ui';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, startTransition, useActionState, useEffect } from 'react';
import type {
  LinkCodeState,
  OrderLinksState,
  SignInState,
  SignOutState,
} from '@/app/[locale]/my-tickets/actions.ts';
import { GuestCodeFields } from '@/components/guest-code-fields.tsx';
import { errorMessageKey } from '@/lib/errors.ts';

/** Submit without React's form reset, so the address stays typed between the two steps. */
function useKeepValues(formAction: (data: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const data = new FormData(e.currentTarget, submitter);
    startTransition(() => formAction(data));
  };
}

function errorText(t: ReturnType<typeof useTranslations>, code: string | null, retryMinutes?: number) {
  if (!code) return null;
  if (code === 'rate_limited') return t('errors.rateLimitedRetry', { minutes: retryMinutes ?? 1 });
  if (code === 'validation_failed') return t('attendeeSignIn.emailInvalid');
  return t(errorMessageKey(code));
}

/** Email → code (or the emailed link) → signed in. */
export function SignInForm({
  action,
}: {
  action: (prev: SignInState, form: FormData) => Promise<SignInState>;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { step: 'email', code: null });
  const onSubmit = useKeepValues(formAction);
  const error = errorText(t, state.code, state.retryMinutes);
  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input
            id="sign-in-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            label={t('attendeeSignIn.email')}
          />
        </div>
        {state.step === 'email' ? (
          <Button type="submit" disabled={pending}>
            {t('attendeeSignIn.sendCode')}
          </Button>
        ) : null}
      </div>
      {state.step === 'code' && state.email && state.status ? (
        <>
          <GuestCodeFields
            email={state.email}
            status={state.status}
            attemptsLeft={state.attemptsLeft}
            resendAt={state.resendAt}
            submitLabel={t('attendeeSignIn.signIn')}
            pending={pending}
            idPrefix="sign-in"
          />
          <p className="text-caption text-zinc-600">{t('attendeeSignIn.orLink')}</p>
        </>
      ) : null}
      <div aria-live="assertive">{error ? <Alert title={error} /> : null}</div>
    </form>
  );
}

/** Once signed in or out, a full load of the next page (through the proxy, like any visit). */
function useGoWhenDone(done: string | null | undefined) {
  useEffect(() => {
    if (done) window.location.assign(done);
  }, [done]);
}

/** Signed in on a sign-in link's page: load My tickets (a plain link too, should scripts be off). */
export function GoToMyTickets({ label }: { label: string }) {
  const locale = useLocale();
  const href = `${locale === 'en' ? '' : `/${locale}`}/my-tickets`;
  useGoWhenDone(href);
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-12 md:px-6">
      <a href={href} className="text-body underline underline-offset-2">
        {label}
      </a>
    </main>
  );
}

/** The magic link in the browser that asked for it: one button signs in. */
export function OpenLinkForm({ action }: { action: (prev: LinkCodeState) => Promise<LinkCodeState> }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { code: null });
  useGoWhenDone(state.done);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div>
        <Button type="submit" disabled={pending || Boolean(state.done)}>
          {t('attendeeSignIn.continue')}
        </Button>
      </div>
      <div aria-live="assertive">
        {state.status ? <Alert title={t('attendeeSignIn.linkInvalidTitle')} /> : null}
      </div>
    </form>
  );
}

/** Sign out here, or on every device. */
export function SignOutButtons({
  action,
  everywhere,
}: {
  action: (prev: SignOutState) => Promise<SignOutState>;
  everywhere: (prev: SignOutState) => Promise<SignOutState>;
}) {
  const t = useTranslations();
  const [one, oneAction, onePending] = useActionState(action, { done: null });
  const [all, allAction, allPending] = useActionState(everywhere, { done: null });
  useGoWhenDone(one.done ?? all.done);
  return (
    <div className="flex flex-wrap gap-3">
      <form action={oneAction}>
        <Button type="submit" variant="secondary" disabled={onePending || allPending}>
          {t('attendeeSignIn.signOut')}
        </Button>
      </form>
      <form action={allAction}>
        <Button type="submit" variant="secondary" disabled={onePending || allPending}>
          {t('attendeeSignIn.signOutEverywhere')}
        </Button>
      </form>
    </div>
  );
}

/** A magic link opened in another browser: prove it with the code from the same email. */
export function LinkCodeForm({
  action,
}: {
  action: (prev: LinkCodeState, form: FormData) => Promise<LinkCodeState>;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { code: null });
  useGoWhenDone(state.done);
  const onSubmit = useKeepValues(formAction);
  const failed = state.status && state.status !== 'sent' && state.status !== 'cooldown';
  const message =
    state.status === 'wrong'
      ? t('guestVerify.wrong', { count: state.attemptsLeft ?? 0 })
      : state.status === 'locked'
        ? t('guestVerify.locked')
        : failed
          ? t('guestVerify.expired')
          : undefined;
  const error = errorText(t, state.code, state.retryMinutes);
  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="sm:w-56">
        <Input
          key={`${state.status ?? ''}-${state.attemptsLeft ?? ''}`}
          id="link-code"
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
      <Button type="submit" disabled={pending}>
        {t('attendeeSignIn.signIn')}
      </Button>
      <div aria-live="assertive">{error ? <Alert title={error} /> : null}</div>
    </form>
  );
}

/** "Email me my order links again": always the same answer. */
export function OrderLinksForm({
  action,
}: {
  action: (prev: OrderLinksState, form: FormData) => Promise<OrderLinksState>;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { sent: false, code: null });
  const error = errorText(t, state.code, state.retryMinutes);
  return (
    <Card className="flex flex-col gap-3">
      <section aria-labelledby="order-links-title" className="flex flex-col gap-3">
        <h2 id="order-links-title" className="text-section">
          {t('orderLinks.title')}
        </h2>
        <p className="text-body text-zinc-600">{t('orderLinks.description')}</p>
        <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Input
              id="order-links-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              label={t('orderLinks.email')}
            />
          </div>
          <Button type="submit" variant="secondary" disabled={pending}>
            {t('orderLinks.submit')}
          </Button>
        </form>
        <div aria-live="polite">
          {state.sent ? <Alert tone="info" title={t('orderLinks.sent')} /> : null}
          {error ? <Alert title={error} /> : null}
        </div>
      </section>
    </Card>
  );
}
