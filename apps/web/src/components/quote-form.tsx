'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

/** Public quote request for a directory venue (M1.4c). */
export function QuoteForm({ action }: { action: (prev: FormState, form: FormData) => Promise<FormState> }) {
  const t = useTranslations('quote');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  const bad = new Set(state.fields ?? []);
  return (
    <form
      ref={ref}
      action={formAction}
      onSubmit={keepValues(formAction)}
      className="grid grid-cols-1 gap-4 md:grid-cols-2"
      noValidate
    >
      <Input
        name="name"
        required
        autoComplete="name"
        label={t('name')}
        error={bad.has('name') ? t('errors.name') : undefined}
      />
      <Input
        name="email"
        type="email"
        required
        autoComplete="email"
        label={t('email')}
        error={bad.has('email') ? t('errors.email') : undefined}
      />
      <Input name="phone" type="tel" autoComplete="tel" label={t('phone')} />
      <Input
        name="eventDate"
        type="date"
        label={t('eventDate')}
        error={bad.has('eventDate') ? t('errors.eventDate') : undefined}
      />
      <Input
        name="guests"
        type="number"
        inputMode="numeric"
        min={1}
        label={t('guests')}
        error={bad.has('guests') ? t('errors.guests') : undefined}
      />
      {/* Honeypot: hidden from people and assistive tech; bots that fill it are ignored. */}
      <div aria-hidden="true" className="absolute -start-[9999px] size-px overflow-hidden">
        <label htmlFor="quote-website">{t('honeypot')}</label>
        <input id="quote-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="flex flex-col gap-1.5 md:col-span-2">
        <label htmlFor="quote-message" className="text-caption text-zinc-600">
          {t('message')}
        </label>
        <textarea
          id="quote-message"
          name="message"
          required
          rows={5}
          maxLength={4000}
          aria-invalid={bad.has('message') || undefined}
          aria-describedby={bad.has('message') ? 'quote-message-error' : 'quote-message-hint'}
          className={`rounded-card border bg-white px-4 py-2 text-body ${bad.has('message') ? 'border-pink-700' : 'border-zinc-200'}`}
        />
        {bad.has('message') ? (
          <p id="quote-message-error" className="text-caption text-pink-700">
            {t('errors.message')}
          </p>
        ) : (
          <p id="quote-message-hint" className="text-caption text-zinc-500">
            {t('messageHint')}
          </p>
        )}
      </div>
      <div aria-live="polite" className="flex flex-col gap-2 md:col-span-2">
        {state.ok && !pending ? <Alert tone="info" title={t('sent')} /> : null}
        {state.code ? (
          <Alert
            title={
              state.code === 'rate_limited'
                ? t('errors.rateLimited')
                : state.code === 'validation_failed'
                  ? t('errors.summary')
                  : te(errorMessageKey(state.code))
            }
          />
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('submit')}
      </Button>
    </form>
  );
}
