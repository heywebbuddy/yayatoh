'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { startTransition, useActionState, useEffect, useRef } from 'react';
import { HumanCheckField, type HumanCheckWidget } from '@/components/human-check-field.tsx';
import type { UnlockState } from './actions.ts';

/**
 * The guest website's password gate (M4.5a): one field, a 44 px button; the human check appears
 * once this device used its budget. A wrong password moves focus back to the field.
 */
export function SiteGateForm({
  action,
  challenge,
}: {
  action: (prev: UnlockState, form: FormData) => Promise<UnlockState>;
  challenge: HumanCheckWidget | null;
}) {
  const t = useTranslations('guestSite');
  const [state, formAction, pending] = useActionState(action, {} as UnlockState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state.stamp) return;
    const target =
      state.error === 'empty' || state.error === 'wrong'
        ? '[name="password"]'
        : state.challenge
          ? '[name="human"], [data-site-error]'
          : '[data-site-error]';
    ref.current?.querySelector<HTMLElement>(target)?.focus();
  }, [state]);
  const general =
    state.error === 'challengeFailed' || state.error === 'rateLimited' || state.error === 'closed'
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
      className="flex flex-col gap-4 rounded-panel border border-line bg-surface p-5 elevation-card glass"
    >
      <Input
        id="site-password"
        name="password"
        type="password"
        label={t('password')}
        hint={t('passwordHint')}
        autoComplete="off"
        maxLength={288}
        required
        key={`password-${state.stamp ?? 0}`}
        error={
          state.error === 'empty'
            ? t('errors.empty')
            : state.error === 'wrong'
              ? t('errors.wrong')
              : undefined
        }
      />
      {state.challenge && challenge ? (
        <fieldset className="m-0 flex flex-col gap-2 rounded-tile border border-line bg-surface-2 p-4">
          <legend className="px-1 text-body font-bold text-ink">{t('challengeTitle')}</legend>
          <p className="m-0 text-caption text-ink-2">{t('challengeHint')}</p>
          <HumanCheckField widget={challenge} />
        </fieldset>
      ) : null}
      <div aria-live="polite">
        {general ? (
          <div data-site-error tabIndex={-1}>
            <Alert title={general} />
          </div>
        ) : null}
      </div>
      <Button type="submit" size="lg" disabled={pending} className="self-stretch sm:self-start">
        {t('submit')}
      </Button>
    </form>
  );
}
