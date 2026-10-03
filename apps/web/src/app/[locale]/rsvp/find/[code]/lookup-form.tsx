'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { startTransition, useActionState, useEffect, useRef } from 'react';
import { HumanCheckField, type HumanCheckWidget } from '@/components/human-check-field.tsx';
import type { LookupState } from './actions.ts';

/**
 * Find an invitation by the full name on it and the PIN printed beside it (M4.1d). Native inputs,
 * 44 px targets; the human check appears once this device used its budget.
 */
export function RsvpLookupForm({
  action,
  challenge,
}: {
  action: (prev: LookupState, form: FormData) => Promise<LookupState>;
  challenge: HumanCheckWidget | null;
}) {
  const t = useTranslations('rsvpFind');
  const [state, formAction, pending] = useActionState(action, {} as LookupState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state.stamp) return;
    const target =
      state.error === 'invalidName'
        ? '[name="name"]'
        : state.error === 'invalidPin' || state.error === 'noMatch'
          ? '[name="pin"]'
          : state.challenge
            ? '[name="human"], [data-rsvp-error]'
            : '[data-rsvp-error]';
    ref.current?.querySelector<HTMLElement>(target)?.focus();
  }, [state]);
  const general =
    state.error === 'noMatch' ||
    state.error === 'challengeFailed' ||
    state.error === 'challengeUnavailable' ||
    state.error === 'rateLimited' ||
    state.error === 'closed'
      ? t(`errors.${state.error}`, { minutes: state.retryMinutes ?? 1 })
      : null;
  return (
    <form
      ref={ref}
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        startTransition(() => formAction(form));
      }}
      noValidate
      aria-label={t('formLabel')}
      className="flex flex-col gap-4"
    >
      <Input
        id="rsvp-name"
        name="name"
        label={t('name')}
        hint={t('nameHint')}
        defaultValue={state.name ?? ''}
        key={`name-${state.stamp ?? 0}`}
        autoComplete="name"
        maxLength={170}
        required
        className="min-h-11"
        error={state.error === 'invalidName' ? t('errors.invalidName') : undefined}
      />
      <Input
        id="rsvp-pin"
        name="pin"
        label={t('pin')}
        hint={t('pinHint')}
        inputMode="numeric"
        autoComplete="off"
        maxLength={7}
        required
        className="min-h-11 font-mono tracking-[0.3em]"
        error={state.error === 'invalidPin' ? t('errors.invalidPin') : undefined}
      />
      {state.challenge && challenge ? (
        <fieldset className="flex flex-col gap-2 rounded-card border border-line p-4">
          <legend className="px-1 text-body font-medium">{t('challengeTitle')}</legend>
          <p className="text-caption text-ink-2">{t('challengeHint')}</p>
          <HumanCheckField widget={challenge} />
        </fieldset>
      ) : null}
      <div aria-live="polite">
        {general ? (
          <div data-rsvp-error tabIndex={-1}>
            <Alert title={general} />
          </div>
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="min-h-11 self-stretch sm:self-start">
        {t('submit')}
      </Button>
    </form>
  );
}
