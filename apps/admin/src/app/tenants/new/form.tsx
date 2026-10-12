'use client';

import { buttonClass, Card, CountryPicker, CurrencyPicker, Select, TimeZonePicker } from '@yayatoh/ui';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { type CreateTenantState, createTenantAction } from './actions.ts';

export function NewTenantForm() {
  const t = useTranslations('newTenant');
  const [state, action, pending] = useActionState(createTenantAction, { error: null } as CreateTenantState);
  const fieldError = (key: string) => (state.fields?.includes(key) ? t(`fieldErrors.${key}`) : undefined);
  const [values, setValues] = useState<Record<string, string>>({
    name: '',
    slug: '',
    ownerEmail: '',
    timezone: 'Asia/Kolkata',
    country: 'IN',
    currency: 'INR',
    kind: 'organizer',
    reason: '',
  });
  const fields = [
    ['name', 'text', ''],
    ['slug', 'text', ''],
    ['ownerEmail', 'email', ''],
  ] as const;
  return (
    <Card className="w-full min-w-0">
      <form action={action} className="flex flex-col gap-5">
        {state.error ? (
          <p role="alert" className="text-body text-danger">
            {t(`errors.${state.error}`)}
          </p>
        ) : null}
        <div className="grid items-start gap-5 sm:grid-cols-2">
          {fields.map(([key, type, value]) => (
            <div key={key} className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={key} className="text-caption font-bold">
                {t(key)}
              </label>
              <input
                id={key}
                name={key}
                type={type}
                value={values[key] ?? value}
                onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                required
                className="field w-full"
                maxLength={key === 'name' ? 120 : key === 'slug' ? 63 : 254}
                minLength={key === 'slug' ? 2 : undefined}
                pattern={key === 'slug' ? '[a-z0-9]([a-z0-9-]*[a-z0-9])?' : undefined}
                placeholder={key === 'slug' ? 'your-slug' : undefined}
                aria-invalid={Boolean(fieldError(key)) || undefined}
                aria-describedby={fieldError(key) ? `${key}-error` : undefined}
              />
              {fieldError(key) ? (
                <p id={`${key}-error`} className="text-caption text-danger">
                  {fieldError(key)}
                </p>
              ) : null}
              {key === 'ownerEmail' || key === 'slug' ? (
                <p className="text-caption text-ink-2">{t(`${key}Hint`)}</p>
              ) : null}
            </div>
          ))}
          <TimeZonePicker
            id="timezone"
            name="timezone"
            label={t('timezone')}
            required
            value={values.timezone}
            onValueChange={(timezone) => setValues((current) => ({ ...current, timezone }))}
            error={fieldError('timezone')}
          />
          <CountryPicker
            id="country"
            name="country"
            label={t('country')}
            required
            value={values.country}
            onValueChange={(country) => setValues((current) => ({ ...current, country }))}
            error={fieldError('country')}
          />
          <CurrencyPicker
            id="currency"
            name="currency"
            label={t('currency')}
            required
            value={values.currency}
            onValueChange={(currency) => setValues((current) => ({ ...current, currency }))}
            error={fieldError('currency')}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="kind" className="text-caption font-bold">
              {t('kind')}
            </label>
            <Select
              id="kind"
              name="kind"
              className="field"
              value={values.kind}
              onValueChange={(kind) => setValues((current) => ({ ...current, kind }))}
              error={fieldError('kind')}
            >
              <option value="organizer">{t('organizer')}</option>
              <option value="agency">{t('agency')}</option>
              <option value="venue">{t('venue')}</option>
            </Select>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reason" className="text-caption font-bold">
            {t('reason')}
          </label>
          <textarea
            id="reason"
            name="reason"
            required
            minLength={3}
            maxLength={500}
            rows={3}
            value={values.reason}
            onChange={(event) => setValues((current) => ({ ...current, reason: event.target.value }))}
            className="field w-full"
            aria-invalid={Boolean(fieldError('reason')) || undefined}
            aria-describedby={fieldError('reason') ? 'reason-error' : undefined}
          />
          {fieldError('reason') ? (
            <p id="reason-error" className="text-caption text-danger">
              {fieldError('reason')}
            </p>
          ) : null}
        </div>
        <p className="text-caption text-ink-2">{t('hint')}</p>
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={pending} className={buttonClass('primary')}>
            {t(pending ? 'saving' : 'save')}
          </button>
          <Link href="/tenants" className={buttonClass('secondary')}>
            {t('cancel')}
          </Link>
        </div>
      </form>
    </Card>
  );
}
