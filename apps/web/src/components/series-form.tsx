'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import type { SeriesFormState } from '@/app/[locale]/o/[org]/(org)/series/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

export function SeriesForm({
  action,
}: {
  action: (prev: SeriesFormState, form: FormData) => Promise<SeriesFormState>;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  const nameError =
    state.field === 'slug'
      ? t('series.slugTaken')
      : state.field === 'name'
        ? t('series.nameInvalid')
        : undefined;
  return (
    <form ref={ref} action={formAction} className="grid grid-cols-1 gap-4 md:grid-cols-2" noValidate>
      <Input
        id="series-name"
        name="name"
        required
        minLength={2}
        maxLength={160}
        label={t('series.name')}
        error={nameError}
      />
      <Input
        id="series-description"
        name="description"
        maxLength={2000}
        label={t('series.descriptionField')}
      />
      <div className="flex flex-col gap-2 md:col-span-2">
        <div aria-live="polite">
          {state.ok ? <Alert tone="info" title={t('series.created')} /> : null}
          {state.code && !nameError ? <Alert title={t(errorMessageKey(state.code))} /> : null}
        </div>
        <Button type="submit" disabled={pending} className="self-start">
          {t('series.create')}
        </Button>
      </div>
    </form>
  );
}
