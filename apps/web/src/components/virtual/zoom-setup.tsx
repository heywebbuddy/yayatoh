'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { startTransition, useActionState, useId } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

type Save = (prev: FormState, form: FormData) => Promise<FormState>;
type Act = (prev: FormState) => Promise<FormState>;

/** Zoom refusals with their own message (`virtual.zoom.errors.*`). */
const ZOOM_REASONS = ['webinar_taken', 'in_person_event', 'zoom_not_connected'] as const;
const known = (r: string | undefined): r is (typeof ZOOM_REASONS)[number] =>
  !!r && (ZOOM_REASONS as readonly string[]).includes(r);

function Outcome({ state, saved }: { state: FormState; saved: string }) {
  const te = useTranslations();
  return (
    <div aria-live="polite">
      {state.ok ? <Alert tone="success" title={saved} /> : null}
      {state.code && !(state.fields ?? []).includes('webinarId') ? (
        <Alert
          title={te(
            known(state.reason) ? `virtual.zoom.errors.${state.reason}` : errorMessageKey(state.code),
          )}
        />
      ) : null}
    </div>
  );
}

/** A session's Zoom webinar: its id from Zoom (the holders with online access are registered). */
export function ZoomWebinarForm({
  title,
  webinarId,
  canEdit,
  save,
}: {
  title: string;
  webinarId: string | null;
  canEdit: boolean;
  save: Save;
}) {
  const t = useTranslations('virtual.zoom');
  const id = useId();
  const [state, action, pending] = useActionState(save, INITIAL_FORM_STATE);
  const bad = !state.ok && ((state.fields ?? []).includes('webinarId') || state.reason === 'webinar_taken');
  return (
    <form action={action} className="flex flex-col gap-2" noValidate aria-label={t('formLabel', { title })}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="sm:min-w-64">
          <Input
            id={`${id}-webinar`}
            name="webinarId"
            inputMode="numeric"
            autoComplete="off"
            label={t('webinarId')}
            hint={t('webinarIdHint')}
            defaultValue={webinarId ?? ''}
            disabled={!canEdit}
            error={
              bad
                ? state.reason === 'webinar_taken'
                  ? t('errors.webinar_taken')
                  : t('webinarIdInvalid')
                : undefined
            }
          />
        </div>
        {canEdit ? (
          <div>
            <Button
              type="submit"
              variant="secondary"
              disabled={pending}
              aria-label={t('linkLabel', { title })}
            >
              {t('link')}
            </Button>
          </div>
        ) : null}
      </div>
      <Outcome state={state} saved={t('linked', { title })} />
    </form>
  );
}

/** Registrants out and attendance reports in, now (a sync of the Zoom connection). */
export function ZoomSyncButton({ sync }: { sync: Act }) {
  const t = useTranslations('virtual.zoom');
  const [state, action, pending] = useActionState(sync, INITIAL_FORM_STATE);
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => startTransition(() => action())}
        >
          {t('syncNow')}
        </Button>
      </div>
      <Outcome state={state} saved={t('syncQueued')} />
    </div>
  );
}
