'use client';

import { Alert, Button, Card, DateTimePicker, Input, TimeZonePicker } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import type { CreateEventState } from '@/app/[locale]/o/[org]/(org)/events/new/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { type PickerProfile, ProfilePicker } from './profile-picker.tsx';

export function CreateEventForm({
  action,
  defaults,
  profiles,
}: {
  action: (prev: CreateEventState, form: FormData) => Promise<CreateEventState>;
  defaults: { profile: string; timezone: string };
  /** U8: the "What kind of event?" choices with the sections each includes. */
  profiles: readonly PickerProfile[];
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
          <Alert title={state.field === 'slug' ? t('newEvent.slugTaken') : t(errorMessageKey(state.code))} />
        ) : null}
        <Input name="name" required minLength={2} maxLength={160} label={t('newEvent.name')} />
        <ProfilePicker
          id="profile"
          label={t('newEvent.profile')}
          profiles={profiles}
          defaultValue={defaults.profile}
          className={selectClass}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
