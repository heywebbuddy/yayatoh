'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { PreferenceChoices, PreferenceState } from '@/app/[locale]/preferences/[org]/[token]/actions.ts';

const box = 'size-5 accent-zinc-900';
const row = 'flex min-h-6 items-center gap-2 text-body';

/**
 * The preference center form (M3.5a): native checkboxes in fieldsets, a phone field with its
 * hint, and the text-consent disclosure right under the text boxes. Errors are announced and the
 * phone field points at them.
 */
export function PreferenceCenterForm({
  action,
  org,
  email,
  phone,
  initial,
}: {
  action: (prev: PreferenceState, form: FormData) => Promise<PreferenceState>;
  org: string;
  email: string;
  phone: string | null;
  initial: PreferenceChoices;
}) {
  const t = useTranslations('preferenceCenter');
  const [state, formAction, pending] = useActionState(action, {
    saved: false,
    error: null,
    phone: '',
    choices: initial,
  });
  const c = state.choices;
  const phoneError = state.error === 'invalid_phone' || state.error === 'phone_required';
  const described = [phoneError ? 'pc-phone-error' : null, 'pc-phone-hint'].filter(Boolean).join(' ');
  return (
    <form action={formAction} noValidate aria-label={t('metaTitle')} className="flex flex-col gap-6">
      <div role="status" aria-live="polite">
        {state.saved ? <p className="text-body font-medium">{t('saved')}</p> : null}
      </div>
      {state.error && !phoneError ? <Alert title={t(`errors.${state.error}`)} /> : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-body font-medium">{t('emailLegend', { email })}</legend>
        {(['reminders', 'event_updates', 'marketing'] as const).map((k) => (
          <label key={k} className={row}>
            <input
              type="checkbox"
              name={`email.${k}`}
              defaultChecked={c.emailCategories[k]}
              className={box}
            />
            {t(`category.${k}`)}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="pc-phone" className="text-caption text-zinc-600">
          {t('phoneLabel')}
        </label>
        <input
          id="pc-phone"
          name="phone"
          type="tel"
          dir="ltr"
          autoComplete="tel"
          defaultValue={state.phone}
          maxLength={32}
          aria-invalid={phoneError ? true : undefined}
          aria-describedby={described}
          className={`min-h-10 rounded-pill border bg-white px-4 text-body ${phoneError ? 'border-pink-700' : 'border-zinc-200'}`}
        />
        <p id="pc-phone-hint" className="text-caption text-zinc-500">
          {phone ? t('phoneCurrent', { phone }) : t('phoneHint')}
        </p>
        {phoneError ? (
          <p id="pc-phone-error" role="alert" className="text-caption text-pink-700">
            {t(`errors.${state.error}`)}
          </p>
        ) : null}
      </div>
      {(['sms', 'whatsapp'] as const).map((channel) => (
        <fieldset key={channel} className="flex flex-col gap-2" aria-describedby="pc-disclosure">
          <legend className="mb-1 text-body font-medium">{t(`${channel}Legend`)}</legend>
          <label className={row}>
            <input
              type="checkbox"
              name={`${channel}.informational`}
              defaultChecked={c[channel].informational}
              className={box}
            />
            {t('informational')}
          </label>
          <label className={row}>
            <input
              type="checkbox"
              name={`${channel}.marketing`}
              defaultChecked={c[channel].marketing}
              className={box}
            />
            {t('marketingText')}
          </label>
        </fieldset>
      ))}
      <p id="pc-disclosure" className="text-caption text-zinc-600">
        {t('disclosure', { org })}
      </p>
      <Button type="submit" disabled={pending} className="self-start">
        {t('save')}
      </Button>
    </form>
  );
}
