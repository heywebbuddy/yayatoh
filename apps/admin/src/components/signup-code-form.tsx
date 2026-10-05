'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { createSignupCodeAction, type NewCodeState } from '@/app/signup-codes/actions.ts';

const INITIAL: NewCodeState = {
  code: null,
  expiresAt: null,
  errors: {},
  values: { maxUses: '1', days: '14', note: '' },
};

/**
 * Create a signup code: uses, days and a note. The new code is shown once, in this response only
 * (it is never stored or put in a URL): after a reload only its note is listed.
 */
export function SignupCodeForm() {
  const t = useTranslations('signupCodes');
  const [state, formAction, pending] = useActionState(createSignupCodeAction, INITIAL);
  const err = (k: keyof NewCodeState['errors']) => (state.errors[k] ? t(`errors.${k}`) : undefined);
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate aria-label={t('create.title')}>
      <div aria-live="polite">
        {state.code ? (
          <section
            aria-label={t('created.label')}
            className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4"
          >
            <p className="text-body">{t('created.intro')}</p>
            <p className="font-mono text-section select-all">{state.code}</p>
            <p className="text-caption text-ink-2">
              {t('created.expires', {
                date: new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(
                  new Date(state.expiresAt ?? 0),
                ),
              })}
            </p>
          </section>
        ) : Object.keys(state.errors).length > 0 ? (
          <Alert title={t('errors.summary')} />
        ) : null}
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <div className="w-32">
          <Input
            key={`uses-${state.code ?? ''}`}
            id="code-uses"
            name="maxUses"
            type="number"
            inputMode="numeric"
            min={1}
            max={1000}
            defaultValue={state.values.maxUses}
            label={t('create.uses')}
            error={err('maxUses')}
          />
        </div>
        <div className="w-32">
          <Input
            key={`days-${state.code ?? ''}`}
            id="code-days"
            name="days"
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            defaultValue={state.values.days}
            label={t('create.days')}
            error={err('days')}
          />
        </div>
        <div className="min-w-60 flex-1">
          <Input
            key={`note-${state.code ?? ''}`}
            id="code-note"
            name="note"
            maxLength={200}
            defaultValue={state.values.note}
            label={t('create.note')}
            hint={t('create.noteHint')}
            error={err('note')}
          />
        </div>
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('create.submit')}
      </Button>
    </form>
  );
}
