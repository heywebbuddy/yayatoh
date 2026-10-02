'use client';

import { GUEST_REASONS, LOCATION_MAX, NOTE_MAX } from '@yayatoh/assistance/client';
import { Alert, Button } from '@yayatoh/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useActionState, useState, useTransition } from 'react';
import type { GuestHelpState } from '@/app/[locale]/events/[slug]/seat-finder/help/actions.ts';

type Act = (prev: GuestHelpState, form: FormData) => Promise<GuestHelpState>;

/**
 * The guest's "Need help" form (M3.3b): a reason (radio buttons; choosing medical shows the
 * emergency guidance first, before anything else to fill in), an optional note and where they
 * are. Keyboard: arrows move between reasons, Tab to the fields and the button.
 */
export function GuestHelpForm({ action }: { action: Act }) {
  const t = useTranslations('assistance');
  const [state, formAction, pending] = useActionState(action, {});
  const [reason, setReason] = useState(state.reason ?? '');
  const error = state.error
    ? state.error === 'rateLimited'
      ? t('guest.errors.rateLimited', { minutes: state.retryMinutes ?? 1 })
      : t(`guest.errors.${state.error}`)
    : null;
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {error ? <Alert title={error} /> : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-section">{t('guest.reasonLegend')}</legend>
        {GUEST_REASONS.map((r) => (
          <label
            key={r}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-card border border-zinc-200 px-4 text-body has-[:checked]:border-ink"
          >
            <input
              type="radio"
              name="reason"
              value={r}
              checked={reason === r}
              onChange={() => setReason(r)}
              className="size-5"
              aria-invalid={state.error === 'reason' ? true : undefined}
            />
            {t(`reason.${r}`)}
          </label>
        ))}
      </fieldset>
      {reason === 'medical' ? (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-card border-2 border-pink-700 bg-pink-50 px-4 py-3 text-pink-700"
        >
          <p className="text-body font-medium">{t('guest.emergencyTitle')}</p>
          <p className="text-body">{t('guest.emergencyBody')}</p>
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <label htmlFor="help-location" className="text-body font-medium">
          {t('guest.locationLabel')}
        </label>
        <p id="help-location-hint" className="text-caption text-zinc-600">
          {t('guest.locationHint')}
        </p>
        <input
          id="help-location"
          name="location"
          defaultValue={state.location ?? ''}
          maxLength={LOCATION_MAX}
          aria-describedby="help-location-hint"
          aria-invalid={state.error === 'locationTooLong' ? true : undefined}
          className="min-h-11 rounded-pill border border-zinc-200 bg-white px-4 text-body"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="help-note" className="text-body font-medium">
          {t('guest.noteLabel')}
        </label>
        <textarea
          id="help-note"
          name="note"
          rows={3}
          defaultValue={state.note ?? ''}
          maxLength={NOTE_MAX}
          aria-invalid={state.error === 'noteTooLong' ? true : undefined}
          className="rounded-card border border-zinc-200 bg-white px-4 py-2 text-body"
        />
      </div>
      <p className="text-caption text-zinc-600">{t('guest.privacy')}</p>
      <Button type="submit" disabled={pending} className="self-start">
        {t('guest.submit')}
      </Button>
    </form>
  );
}

/** Re-read the request's status (server render) without leaving the page. */
export function RefreshStatus({ label }: { label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button type="button" disabled={pending} onClick={() => start(() => router.refresh())}>
      {label}
    </Button>
  );
}
