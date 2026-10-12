'use client';
import { Alert, Button, Card, Checkbox, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { saveAttendeeProfile } from '@/app/[locale]/attendee/profile-actions.ts';
import { INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

export function AttendeeProfile({
  name,
  email,
  image,
}: {
  name: string;
  email: string;
  image?: string | null;
}) {
  const t = useTranslations('attendeeDashboard');
  const [state, action, pending] = useActionState(saveAttendeeProfile, INITIAL_FORM_STATE);
  return (
    <Card>
      <form action={action} onSubmit={keepValues(action)} className="flex flex-col gap-5">
        {image ? (
          <img
            src={image}
            alt={t('profile.photo')}
            width={96}
            height={96}
            className="size-24 rounded-full object-cover"
          />
        ) : null}
        <Input
          name="name"
          label={t('profile.name')}
          defaultValue={name}
          required
          maxLength={120}
          error={state.fields?.includes('name') ? t('profile.nameError') : undefined}
        />
        <Input label={t('profile.email')} value={email} readOnly hint={t('profile.emailHint')} />
        <Input
          name="photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          label={t('profile.photo')}
          hint={t('profile.photoHint')}
          error={state.fields?.includes('photo') ? t('profile.photoError') : undefined}
        />
        {image ? <Checkbox name="removePhoto" value="1" label={t('profile.removePhoto')} /> : null}
        <div aria-live="polite">
          {state.ok ? (
            <Alert tone="info" title={t('profile.saved')} />
          ) : state.code ? (
            <Alert title={t('profile.error')} />
          ) : null}
        </div>
        <Button type="submit" disabled={pending} className="self-start">
          {t(pending ? 'profile.saving' : 'profile.save')}
        </Button>
      </form>
    </Card>
  );
}
