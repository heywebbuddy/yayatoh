'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import type { GuestState } from '@/app/[locale]/o/[org]/e/[event]/attendees/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

/** Add one person to the guest list (no ticket). */
export function GuestForm({ action }: { action: (prev: GuestState, form: FormData) => Promise<GuestState> }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Input name="name" required maxLength={200} autoComplete="off" label={t('guests.name')} />
      <Input
        name="email"
        type="email"
        required
        maxLength={254}
        autoComplete="off"
        label={t('guests.email')}
      />
      <Input name="label" maxLength={40} autoComplete="off" label={t('guests.label')} />
      <div className="flex flex-col gap-2 md:col-span-3">
        <div aria-live="polite">
          {state.ok ? <Alert tone="info" title={t('guests.added')} /> : null}
          {state.code ? <Alert title={t(errorMessageKey(state.code))} /> : null}
        </div>
        <Button type="submit" disabled={pending} className="self-start">
          {t('guests.add')}
        </Button>
      </div>
    </form>
  );
}
