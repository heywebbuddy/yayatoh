'use client';

import { Alert, Button, Checkbox, Input, Textarea } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import { HumanCheckField, type HumanCheckWidget } from '@/components/human-check-field.tsx';
import { HONEYPOT_FIELD } from '@/lib/contact-spam.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

/**
 * U10: the org contact page's form. Name, email, message and the consent line, each with its
 * error next to it; a hidden honeypot and the signed fill-time stamp; the human check when a
 * provider is configured. Success replaces the form with a confirmation that takes focus.
 * Phone-first: full-width fields, 44 px targets.
 */
export function OrgContactForm({
  action,
  orgName,
  stamp,
  submissionKey,
  humanCheck,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  orgName: string;
  stamp: string;
  submissionKey: string;
  humanCheck: HumanCheckWidget | null;
}) {
  const t = useTranslations('orgContact');
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
        className="flex flex-col gap-2 rounded-card border border-line bg-surface-2 p-5"
      >
        <p className="text-body font-bold">{t('sentTitle')}</p>
        <p className="text-body text-ink-2">{t('sentBody', { org: orgName })}</p>
      </div>
    );
  const bad = new Set(state.fields ?? []);
  const err = (f: string) => (bad.has(f) ? t(`errors.${f}`) : undefined);
  return (
    <form
      action={formAction}
      onSubmit={keepValues(formAction)}
      noValidate
      aria-label={t('formLabel', { org: orgName })}
      className="flex flex-col gap-5"
    >
      <input type="hidden" name="stamp" value={stamp} />
      <input type="hidden" name="submissionKey" value={submissionKey} />
      {/* Bots fill every field; people never see this one. */}
      <div aria-hidden="true" className="sr-only">
        <label htmlFor="contact-website">{t('honeypot')}</label>
        <input id="contact-website" name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <Input
        id="contact-name"
        name="name"
        required
        maxLength={120}
        autoComplete="name"
        label={t('fields.name')}
        error={err('name')}
      />
      <Input
        id="contact-email"
        name="email"
        type="email"
        required
        maxLength={254}
        autoComplete="email"
        inputMode="email"
        dir="ltr"
        label={t('fields.email')}
        hint={t('emailHint')}
        error={err('email')}
      />
      <Textarea
        id="contact-message"
        name="message"
        rows={6}
        required
        maxLength={4000}
        label={t('fields.message')}
        hint={t('messageHint')}
        error={err('message')}
      />
      <div className="flex flex-col gap-1.5">
        <Checkbox
          id="contact-consent"
          name="consent"
          value="yes"
          required
          label={t('consent', { org: orgName })}
          aria-invalid={bad.has('consent') || undefined}
          aria-describedby={bad.has('consent') ? 'contact-consent-error' : undefined}
        />
        {bad.has('consent') ? (
          <p id="contact-consent-error" className="text-caption text-danger">
            {t('errors.consent')}
          </p>
        ) : null}
      </div>
      {humanCheck ? (
        <div className="flex flex-col gap-1.5">
          <HumanCheckField widget={humanCheck} />
          {bad.has('human') ? <p className="text-caption text-danger">{t('errors.human')}</p> : null}
        </div>
      ) : null}
      <div aria-live="polite">
        {state.code === 'rate_limited' ? (
          <Alert title={t('rateLimited', { minutes: Number(state.reason ?? 1) })} />
        ) : state.code === 'validation_failed' && state.reason === 'too_fast' ? (
          <Alert title={t('tooFast')} />
        ) : state.code === 'validation_failed' && state.reason === 'expired' ? (
          <Alert title={t('expired')} />
        ) : state.code === 'validation_failed' ? (
          <Alert title={t('fixErrors')} />
        ) : state.code ? (
          <Alert title={te(errorMessageKey(state.code))} />
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="min-h-11 self-stretch sm:self-start">
        {t('submit')}
      </Button>
    </form>
  );
}
