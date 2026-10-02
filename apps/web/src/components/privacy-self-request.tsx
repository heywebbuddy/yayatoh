'use client';

import { Alert, Button, Input, Radio } from '@yayatoh/ui';
import { useFormatter, useTranslations } from 'next-intl';
import { useActionState, useEffect, useId } from 'react';
import type { SelfRequestState } from '@/app/[locale]/privacy-request/[org]/actions.ts';

/**
 * The person's own data-subject request (M6.1c): choose a copy or erasure, prove the address with
 * the emailed code, get a reference and the date the org will answer by. Phone-first: one column,
 * 44 px targets, focus moves to each new step.
 */
export function SelfRequestForm({
  action,
  org,
}: {
  action: (prev: SelfRequestState, form: FormData) => Promise<SelfRequestState>;
  org: string;
}) {
  const t = useTranslations('privacyRequest');
  const format = useFormatter();
  const [state, formAction, pending] = useActionState(action, { step: 'start' });
  const id = useId();
  useEffect(() => {
    if (state.step === 'code') document.getElementById(`${id}-code`)?.focus();
    if (state.step === 'done') document.getElementById(`${id}-done`)?.focus();
  }, [state, id]);

  if (state.step === 'done')
    return (
      <div id={`${id}-done`} tabIndex={-1} className="outline-none">
        <Alert tone="success" title={t('doneTitle')}>
          <p>
            {t(state.existing ? 'existingBody' : 'doneBody', {
              org,
              date: format.dateTime(new Date(state.dueAt), { dateStyle: 'long' }),
              reference: state.reference,
            })}
          </p>
        </Alert>
      </div>
    );

  const error = (code: string | undefined) =>
    code === 'invalid_email'
      ? t('errors.invalidEmail')
      : code === 'kind_required'
        ? t('errors.kindRequired')
        : code === 'rate_limited'
          ? t('errors.rateLimited', { minutes: state.step === 'start' ? (state.retryMinutes ?? 1) : 1 })
          : code === 'code_format'
            ? t('errors.codeFormat')
            : code === 'wrong'
              ? t('errors.wrong', { count: state.step === 'code' ? (state.attemptsLeft ?? 0) : 0 })
              : code === 'locked'
                ? t('errors.locked')
                : code === 'expired' || code === 'used'
                  ? t('errors.expired')
                  : code
                    ? t('errors.generic')
                    : undefined;

  if (state.step === 'code')
    return (
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <p className="text-body" aria-live="polite">
          {t(state.resent ? 'resent' : 'sent', { email: state.email })}
        </p>
        <Input
          key={`${state.code ?? ''}-${state.attemptsLeft ?? ''}`}
          id={`${id}-code`}
          name="verifyCode"
          label={t('codeLabel')}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          error={error(state.code)}
        />
        <Button type="submit" size="lg" disabled={pending}>
          {t('confirm')}
        </Button>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" name="intent" value="resend" variant="secondary" formNoValidate disabled={pending}>
            {t('resend')}
          </Button>
          <Button type="submit" name="intent" value="restart" variant="ghost" formNoValidate disabled={pending}>
            {t('changeEmail')}
          </Button>
        </div>
      </form>
    );

  const startError = error(state.code);
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <fieldset className="flex flex-col" aria-describedby={state.code === 'kind_required' ? `${id}-kind-error` : undefined}>
        <legend className="text-body font-semibold">{t('kindLegend')}</legend>
        <Radio id={`${id}-access`} name="kind" value="access" label={t('access')} hint={t('accessHint')} />
        <Radio id={`${id}-erasure`} name="kind" value="erasure" label={t('erasure')} hint={t('erasureHint', { org })} />
      </fieldset>
      {state.code === 'kind_required' ? (
        <p id={`${id}-kind-error`} role="alert" className="text-body text-danger">
          {startError}
        </p>
      ) : null}
      <Input
        id={`${id}-email`}
        name="email"
        type="email"
        autoComplete="email"
        required
        maxLength={320}
        label={t('email')}
        hint={t('emailHint')}
        error={state.code === 'invalid_email' ? startError : undefined}
      />
      {state.code && !['invalid_email', 'kind_required'].includes(state.code) ? (
        <Alert title={startError ?? ''} />
      ) : null}
      <Button type="submit" size="lg" disabled={pending}>
        {t('submit')}
      </Button>
    </form>
  );
}
