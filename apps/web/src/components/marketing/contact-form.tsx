'use client';

import { CONTACT_TOPICS } from '@yayatoh/cms/ui';
import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import { HumanCheckField, type HumanCheckWidget } from '@/components/human-check-field.tsx';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

const area = 'rounded-card border bg-white px-4 py-2 text-body';

/**
 * The contact / sales form (M3.11b). Field errors sit next to their fields; the human check
 * shows when a provider is configured; a success replaces the form with a confirmation that
 * takes focus.
 */
export function ContactForm({
  action,
  humanCheck,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  humanCheck: HumanCheckWidget | null;
}) {
  const t = useTranslations('marketing.contact');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const done = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.ok) done.current?.focus();
  }, [state.ok]);
  if (state.ok)
    return (
      <div
        ref={done}
        tabIndex={-1}
        role="status"
        className="flex flex-col gap-2 rounded-card border border-zinc-200 p-5"
      >
        <p className="text-body font-medium">{t('sentTitle')}</p>
        <p className="text-body text-zinc-600">{t('sentBody')}</p>
      </div>
    );
  const bad = new Set(state.fields ?? []);
  const err = (f: string, key: string) => (bad.has(f) ? t(`errors.${key}`) : undefined);
  return (
    <form action={formAction} onSubmit={keepValues(formAction)} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="contact-topic" className="text-caption text-zinc-600">
          {t('fields.topic')}
        </label>
        <select
          id="contact-topic"
          name="topic"
          defaultValue="sales"
          aria-invalid={bad.has('topic') || undefined}
          className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
        >
          {CONTACT_TOPICS.map((k) => (
            <option key={k} value={k}>
              {t(`topics.${k}`)}
            </option>
          ))}
        </select>
      </div>
      <Input
        id="contact-name"
        name="name"
        required
        maxLength={120}
        autoComplete="name"
        label={t('fields.name')}
        error={err('name', 'name')}
      />
      <Input
        id="contact-email"
        name="email"
        type="email"
        required
        maxLength={254}
        autoComplete="email"
        dir="ltr"
        label={t('fields.email')}
        error={err('email', 'email')}
      />
      <Input
        id="contact-company"
        name="company"
        maxLength={160}
        autoComplete="organization"
        label={t('fields.company')}
        hint={t('optional')}
        error={err('company', 'company')}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="contact-message" className="text-caption text-zinc-600">
          {t('fields.message')}
        </label>
        <textarea
          id="contact-message"
          name="message"
          rows={6}
          required
          maxLength={4000}
          aria-invalid={bad.has('message') || undefined}
          aria-describedby={bad.has('message') ? 'contact-message-error' : 'contact-message-hint'}
          className={`${area} ${bad.has('message') ? 'border-pink-700' : 'border-zinc-200'}`}
        />
        {bad.has('message') ? (
          <p id="contact-message-error" className="text-caption text-pink-700">
            {t('errors.message')}
          </p>
        ) : (
          <p id="contact-message-hint" className="text-caption text-zinc-500">
            {t('messageHint')}
          </p>
        )}
      </div>
      {humanCheck ? (
        <div className="flex flex-col gap-1.5">
          <HumanCheckField widget={humanCheck} />
          {bad.has('human') ? <p className="text-caption text-pink-700">{t('errors.human')}</p> : null}
        </div>
      ) : null}
      <p className="text-caption text-zinc-500">{t('privacy')}</p>
      <div aria-live="polite">
        {state.code === 'rate_limited' ? (
          <Alert title={t('rateLimited', { minutes: Number(state.reason ?? 1) })} />
        ) : state.code === 'validation_failed' ? (
          <Alert title={t('fixErrors')} />
        ) : state.code ? (
          <Alert title={te(errorMessageKey(state.code))} />
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('submit')}
      </Button>
    </form>
  );
}
