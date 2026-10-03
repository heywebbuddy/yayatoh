'use client';

import { Alert, Button, Card, DateTimePicker, Input, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import type { CreateEventState } from '@/app/[locale]/o/[org]/(org)/events/new/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

const PROFILES = ['conference', 'gala', 'concert', 'wedding', 'community', 'agency', 'other'] as const;
const ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'Europe/London',
  'Europe/Paris',
  'Africa/Lagos',
  'Africa/Accra',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Tokyo',
  'Australia/Sydney',
] as const;

export function CreateEventForm({
  action,
  defaults,
}: {
  action: (prev: CreateEventState, form: FormData) => Promise<CreateEventState>;
  defaults: { profile: string; timezone: string };
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { code: null });
  // One key per form: a double submit returns the same event instead of "name already taken".
  const [requestKey] = useState(() => `create-event:${crypto.randomUUID()}`);
  const zones = ZONES.includes(defaults.timezone as (typeof ZONES)[number])
    ? ZONES
    : [defaults.timezone, ...ZONES];
  const selectClass = 'field';
  return (
    <Card size="panel" className="max-w-2xl">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="requestKey" value={requestKey} />
        {state.code ? (
          <Alert title={state.field === 'slug' ? t('newEvent.slugTaken') : t(errorMessageKey(state.code))} />
        ) : null}
        <Input name="name" required minLength={2} maxLength={160} label={t('newEvent.name')} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="profile" className="text-[13px] font-bold text-ink">
              {t('newEvent.profile')}
            </label>
            <Select id="profile" name="profile" defaultValue={defaults.profile} className={selectClass}>
              {PROFILES.map((p) => (
                <option key={p} value={p}>
                  {t(`profiles.${p}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="timezone" className="text-[13px] font-bold text-ink">
              {t('newEvent.timezone')}
            </label>
            <Select id="timezone" name="timezone" defaultValue={defaults.timezone} className={selectClass}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </div>
          <DateTimePicker
            name="startsAt"
            required
            label={t('newEvent.startsAt')}
            hint={t('newEvent.localTimeHint')}
          />
          <DateTimePicker name="endsAt" required label={t('newEvent.endsAt')} />
          <Input name="venueName" maxLength={160} label={t('newEvent.venue')} />
          <Input name="city" maxLength={120} label={t('newEvent.city')} />
        </div>
        <Button type="submit" disabled={pending} className="self-start">
          {t('newEvent.submit')}
        </Button>
      </form>
    </Card>
  );
}
