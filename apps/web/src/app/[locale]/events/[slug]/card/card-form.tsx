'use client';

import { Alert, Button, Checkbox, FieldMessage, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, startTransition, useActionState, useEffect, useRef } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import type { CardState } from './actions.ts';

type Action = (prev: CardState, form: FormData) => Promise<CardState>;
const fields = ['name', 'email', 'consent'] as const;
const giveCard = 'flex flex-col gap-4 rounded-panel border border-line bg-surface p-5 elevation-card glass';

/**
 * Save a card for tonight's giving (M4.8e, P4-14): the guest's name and email and the
 * authorization box (required, never pre-ticked). Native inputs; the first field to fix gets
 * focus and its message; nothing typed is lost on a refused submit.
 */
export function CardForm({ action, org, event }: { action: Action; org: string; event: string }) {
  const t = useTranslations('savedCard');
  const tr = useTranslations();
  const [state, formAction, pending] = useActionState(action, { code: null } as CardState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.field) ref.current?.querySelector<HTMLElement>(`[name="${state.field}"]`)?.focus();
  }, [state]);
  const fieldError = (name: (typeof fields)[number]) =>
    state.field === name ? t(`errors.${name}`) : undefined;
  const general =
    state.code === null || (state.field && (fields as readonly string[]).includes(state.field))
      ? null
      : state.code === 'rate_limited'
        ? tr('errors.rateLimitedRetry', { minutes: state.retryMinutes ?? 1 })
        : state.reason && t.has(`errors.${state.reason}`)
          ? t(`errors.${state.reason}`)
          : tr(errorMessageKey(state.code));
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };
  const consentError = fieldError('consent');
  return (
    <form ref={ref} onSubmit={submit} noValidate className={giveCard} aria-label={t('formLabel')}>
      <h2 className="m-0 text-card text-ink">{t('formTitle')}</h2>
      {general ? <Alert title={general} /> : null}
      <Input
        name="name"
        label={t('name')}
        autoComplete="name"
        required
        fieldSize="lg"
        error={fieldError('name')}
      />
      <Input
        name="email"
        type="email"
        label={t('email')}
        hint={t('emailHint')}
        autoComplete="email"
        required
        fieldSize="lg"
        error={fieldError('email')}
      />
      <div className="flex flex-col gap-1">
        <Checkbox
          id="consent"
          name="consent"
          label={t('consentLabel')}
          hint={t('consent', { org, event })}
          aria-invalid={consentError ? true : undefined}
          aria-describedby={consentError ? 'consent-hint consent-error' : 'consent-hint'}
        />
        <FieldMessage id="consent" error={consentError} />
      </div>
      <p className="m-0 text-caption text-ink-2">{t('privacy')}</p>
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? t('saving') : t('save')}
      </Button>
    </form>
  );
}
