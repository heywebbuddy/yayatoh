'use client';

import { Alert, Button, Input, TimeZonePicker } from '@yayatoh/ui';
import type { VenueDto } from '@yayatoh/venues';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

const FIELD_ERRORS = ['name', 'country', 'latitude', 'longitude', 'timezone', 'capacity', 'mapUrl'] as const;

/** Create or edit an org venue (M1.4c). Server-side validation errors land on their fields. */
export function VenueForm({
  action,
  venue,
  defaultTimezone,
  disabled = false,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  venue?: VenueDto;
  defaultTimezone: string;
  disabled?: boolean;
}) {
  const t = useTranslations('venues');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const bad = new Set(state.fields ?? []);
  const err = (f: (typeof FIELD_ERRORS)[number]) => (bad.has(f) ? t(`errors.${f}`) : undefined);
  const selectClass = 'field';
  return (
    <form action={formAction} onSubmit={keepValues(formAction)} className="flex flex-col gap-4" noValidate>
      <fieldset disabled={disabled} className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <legend className="sr-only">{venue ? t('editLegend') : t('createLegend')}</legend>
        <Input
          name="name"
          required
          maxLength={160}
          label={t('name')}
          defaultValue={venue?.name}
          error={err('name')}
        />
        <Input
          name="capacity"
          type="number"
          inputMode="numeric"
          min={1}
          label={t('capacity')}
          defaultValue={venue?.capacity ?? undefined}
          error={err('capacity')}
        />
        <Input
          name="addressLine1"
          maxLength={200}
          autoComplete="address-line1"
          label={t('addressLine1')}
          defaultValue={venue?.addressLine1 ?? undefined}
        />
        <Input
          name="addressLine2"
          maxLength={200}
          autoComplete="address-line2"
          label={t('addressLine2')}
          defaultValue={venue?.addressLine2 ?? undefined}
        />
        <Input
          name="city"
          maxLength={120}
          autoComplete="address-level2"
          label={t('city')}
          defaultValue={venue?.city ?? undefined}
        />
        <Input
          name="region"
          maxLength={120}
          autoComplete="address-level1"
          label={t('region')}
          defaultValue={venue?.region ?? undefined}
        />
        <Input
          name="postalCode"
          maxLength={20}
          autoComplete="postal-code"
          label={t('postalCode')}
          defaultValue={venue?.postalCode ?? undefined}
        />
        <Input
          name="country"
          required
          maxLength={2}
          autoComplete="country"
          autoCapitalize="characters"
          spellCheck={false}
          label={t('country')}
          hint={t('countryHint')}
          defaultValue={venue?.country}
          error={err('country')}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="venue-timezone" className="text-[13px] font-bold text-ink">
            {t('timezone')}
          </label>
          <TimeZonePicker
            id="venue-timezone"
            name="timezone"
            defaultValue={venue?.timezone ?? defaultTimezone}
            aria-invalid={bad.has('timezone') || undefined}
            aria-describedby={bad.has('timezone') ? 'venue-timezone-error' : undefined}
            className={`${selectClass} ${bad.has('timezone') ? 'field-invalid' : ''}`}
          />
          {bad.has('timezone') ? (
            <p id="venue-timezone-error" className="text-caption text-danger">
              {t('errors.timezone')}
            </p>
          ) : null}
        </div>
        <Input
          name="mapUrl"
          type="url"
          maxLength={500}
          label={t('mapUrl')}
          hint={t('mapUrlHint')}
          defaultValue={venue?.mapUrl ?? undefined}
          error={err('mapUrl')}
        />
        <Input
          name="latitude"
          inputMode="decimal"
          label={t('latitude')}
          hint={t('geoHint')}
          defaultValue={venue?.latitude ?? undefined}
          error={err('latitude')}
        />
        <Input
          name="longitude"
          inputMode="decimal"
          label={t('longitude')}
          defaultValue={venue?.longitude ?? undefined}
          error={err('longitude')}
        />
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <label htmlFor="accessibilityNotes" className="text-[13px] font-bold text-ink">
            {t('accessibilityNotes')}
          </label>
          <textarea
            id="accessibilityNotes"
            name="accessibilityNotes"
            rows={3}
            maxLength={2000}
            defaultValue={venue?.accessibilityNotes ?? ''}
            className="rounded-card border border-line bg-surface px-4 py-2 text-body"
          />
        </div>
        <label className="flex min-h-6 items-center gap-2 text-body md:col-span-2">
          <input
            type="checkbox"
            name="directoryListed"
            value="1"
            defaultChecked={venue?.directoryListed ?? false}
            className="size-5"
          />
          {t('directoryListed')}
        </label>
      </fieldset>
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.ok && !pending ? <Alert tone="info" title={t('saved')} /> : null}
        {state.code ? (
          <Alert
            title={state.code === 'validation_failed' ? t('errors.summary') : te(errorMessageKey(state.code))}
          />
        ) : null}
      </div>
      {disabled ? null : (
        <Button type="submit" disabled={pending} className="self-start">
          {venue ? t('save') : t('create')}
        </Button>
      )}
    </form>
  );
}
