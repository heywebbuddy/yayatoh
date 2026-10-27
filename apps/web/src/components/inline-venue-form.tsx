'use client';

import { Alert, Button, CountryPicker, Input, TimeZonePicker } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import type { InlineVenueResult } from '@/app/[locale]/o/[org]/(org)/venues/actions.ts';

export type InlineVenueInput = {
  name: string;
  addressLine1: string;
  city: string;
  country: string;
  timezone: string;
  capacity: string;
  contactEmail: string;
  contactPhone: string;
  websiteUrl: string;
};

const EMPTY = {
  name: '',
  addressLine1: '',
  city: '',
  country: '',
  capacity: '',
  contactEmail: '',
  contactPhone: '',
  websiteUrl: '',
};

/**
 * "Add a new venue" inside the event wizard. It is not a `<form>` (the wizard already is one): the
 * Save button calls a server action that creates the saved venue, then hands it back to be selected.
 */
export function InlineVenueForm({
  create,
  defaultTimezone,
  onCreated,
  onCancel,
}: {
  create: (input: InlineVenueInput) => Promise<InlineVenueResult>;
  defaultTimezone: string;
  onCreated: (venue: { id: string; name: string; city: string | null }) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('wizard.newVenue');
  const tv = useTranslations('venues');
  const [v, setV] = useState({ ...EMPTY, timezone: defaultTimezone });
  const [bad, setBad] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV((p) => ({ ...p, [k]: e.target.value }));
  const err = (k: 'name' | 'country' | 'capacity' | 'contactEmail' | 'websiteUrl') =>
    bad.has(k) ? tv(`errors.${k}`) : undefined;

  const save = () => {
    const missing = new Set<string>();
    if (v.name.trim().length < 2) missing.add('name');
    if (!v.country) missing.add('country');
    if (!v.timezone) missing.add('timezone');
    setBad(missing);
    setFailed(false);
    if (missing.size) return;
    start(async () => {
      const r = await create(v);
      if (r.ok) {
        onCreated(r.venue);
        return;
      }
      setBad(new Set(r.fields));
      setFailed(true);
    });
  };

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface-2 p-4 sm:col-span-2">
      <legend className="px-1 text-card font-extrabold">{t('title')}</legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          name="newVenueName"
          label={tv('name')}
          maxLength={160}
          value={v.name}
          onChange={set('name')}
          error={err('name')}
        />
        <Input
          name="newVenueAddress"
          label={tv('addressLine1')}
          maxLength={200}
          value={v.addressLine1}
          onChange={set('addressLine1')}
        />
        <Input name="newVenueCity" label={tv('city')} maxLength={120} value={v.city} onChange={set('city')} />
        <CountryPicker
          name="newVenueCountry"
          label={tv('country')}
          value={v.country}
          onValueChange={(value: string) => setV((p) => ({ ...p, country: value }))}
          error={err('country')}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-venue-timezone" className="text-[13px] font-bold text-ink">
            {tv('timezone')}
          </label>
          <TimeZonePicker
            id="new-venue-timezone"
            name="newVenueTimezone"
            value={v.timezone}
            onValueChange={(value: string) => setV((p) => ({ ...p, timezone: value }))}
            className="field"
          />
        </div>
        <Input
          name="newVenueCapacity"
          type="number"
          inputMode="numeric"
          min={1}
          label={tv('capacity')}
          value={v.capacity}
          onChange={set('capacity')}
          error={err('capacity')}
        />
        <Input
          name="newVenueEmail"
          type="email"
          label={tv('contactEmail')}
          maxLength={254}
          value={v.contactEmail}
          onChange={set('contactEmail')}
          error={err('contactEmail')}
        />
        <Input
          name="newVenuePhone"
          type="tel"
          label={tv('contactPhone')}
          maxLength={40}
          value={v.contactPhone}
          onChange={set('contactPhone')}
        />
        <Input
          name="newVenueWebsite"
          type="url"
          label={tv('websiteUrl')}
          maxLength={500}
          value={v.websiteUrl}
          onChange={set('websiteUrl')}
          error={err('websiteUrl')}
        />
      </div>
      <div aria-live="polite">{failed ? <Alert title={tv('errors.summary')} /> : null}</div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={save} disabled={pending}>
          {t('save')}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
          {t('cancel')}
        </Button>
      </div>
    </fieldset>
  );
}
