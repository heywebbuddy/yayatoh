'use client';

import { Alert, Button, Checkbox, Input, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import type { SessionDoorFormState } from '@/app/[locale]/o/[org]/e/[event]/onsite/sessions/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

/** M5.6a: add a door for one session; its gates follow the session (and the room). */
export function SessionDoorForm({
  sessions,
  action,
}: {
  sessions: readonly { id: string; label: string }[];
  action: (prev: SessionDoorFormState, form: FormData) => Promise<SessionDoorFormState>;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  const fieldError = (f: SessionDoorFormState['field']) =>
    state.field === f
      ? t(
          f === 'name'
            ? state.code === 'conflict'
              ? 'sessionCheckin.nameTaken'
              : 'sessionCheckin.nameRequired'
            : f === 'sessionId'
              ? 'sessionCheckin.sessionRequired'
              : 'checkpoints.capacityError',
        )
      : undefined;
  return (
    <form
      ref={ref}
      action={formAction}
      noValidate
      aria-labelledby="session-door-form-heading"
      className="grid grid-cols-1 gap-4 md:grid-cols-2"
    >
      <h3 id="session-door-form-heading" className="text-card md:col-span-2">
        {t('sessionCheckin.addTitle')}
      </h3>
      <Input
        name="name"
        maxLength={60}
        required
        label={t('sessionCheckin.doorName')}
        hint={t('sessionCheckin.doorNameHint')}
        error={fieldError('name')}
      />
      <Select
        name="sessionId"
        required
        label={t('sessionCheckin.session')}
        error={fieldError('sessionId')}
        defaultValue=""
      >
        <option value="">{t('sessionCheckin.chooseSession')}</option>
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </Select>
      <Input
        name="capacity"
        inputMode="numeric"
        label={t('sessionCheckin.capacity')}
        hint={t('sessionCheckin.capacityHint')}
        error={fieldError('capacity')}
      />
      <Checkbox
        name="selfCheckin"
        label={t('sessionCheckin.selfCheckin')}
        hint={t('sessionCheckin.selfCheckinHint')}
      />
      <div className="flex flex-col gap-2 md:col-span-2">
        <div aria-live="polite">
          {state.ok ? <Alert tone="success" title={t('sessionCheckin.added')} /> : null}
          {state.code && !state.field ? <Alert title={t(errorMessageKey(state.code))} /> : null}
        </div>
        <Button type="submit" disabled={pending} className="self-start">
          {t('sessionCheckin.add')}
        </Button>
      </div>
    </form>
  );
}
