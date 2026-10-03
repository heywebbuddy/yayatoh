'use client';

import { Alert, Button, Card, DateTimePicker, Input, Select, TimeZonePicker } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import type { CreateEventState } from '@/app/[locale]/o/[org]/(org)/events/new/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { seriesErrorKey } from './series-errors.ts';
import { SeriesField } from './series-field.tsx';

const PROFILES = ['conference', 'gala', 'concert', 'wedding', 'community', 'agency', 'other'] as const;

export function CreateEventForm({
  action,
  defaults,
  series,
}: {
  action: (prev: CreateEventState, form: FormData) => Promise<CreateEventState>;
  /** `series`: the series picked in advance (U7, "Create event in this series"). */
  defaults: { profile: string; timezone: string; series?: string };
  /** U7: the org's series for the Series field (omitted without access to them). */
  series?: readonly { id: string; name: string }[];
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { code: null });
  // One key per form: a double submit returns the same event instead of "name already taken".
  const [requestKey] = useState(() => `create-event:${crypto.randomUUID()}`);
  const selectClass = 'field';
  return (
    <Card size="panel" className="max-w-2xl">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="requestKey" value={requestKey} />
        {state.code ? (
          <Alert
            title={
              state.field === 'slug'
                ? t('newEvent.slugTaken')
                : state.field === 'series'
                  ? t(seriesErrorKey(state.code))
                  : t(errorMessageKey(state.code))
            }
          />
        ) : null}
        <Input name="name" required minLength={2} maxLength={160} label={t('newEvent.name')} />
        {series ? (
          <SeriesField
            id="series"
            series={series}
            defaultValue={defaults.series ?? ''}
            error={state.field === 'series' && state.code ? t(seriesErrorKey(state.code)) : undefined}
          />
        ) : null}
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
            <TimeZonePicker
              id="timezone"
              name="timezone"
              defaultValue={defaults.timezone}
              className={selectClass}
            />
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
