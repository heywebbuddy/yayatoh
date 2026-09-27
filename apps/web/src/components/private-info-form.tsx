'use client';

import type { PrivateInfoDto } from '@yayatoh/events';
import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

/** Private info and the online join link (M1.4d): shown to verified ticket holders only. */
export function PrivateInfoForm({
  action,
  info,
  online,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  info: PrivateInfoDto;
  online: boolean;
}) {
  const t = useTranslations('privateInfo');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const bad = new Set(state.fields ?? []);
  return (
    <form action={formAction} onSubmit={keepValues(formAction)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="private-body" className="text-caption text-zinc-600">
          {t('body')}
        </label>
        <textarea
          id="private-body"
          name="body"
          rows={8}
          defaultValue={info.body}
          aria-describedby="private-body-hint"
          className="rounded-card border border-zinc-200 bg-white px-4 py-2 font-mono text-body"
        />
        <p id="private-body-hint" className="text-caption text-zinc-500">
          {t('bodyHint')}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Input
          name="joinUrl"
          type="url"
          label={t('joinUrl')}
          hint={online ? t('joinUrlHint') : t('joinUrlInPerson')}
          defaultValue={info.joinUrl ?? ''}
          error={bad.has('joinUrl') ? t('joinUrlInvalid') : undefined}
        />
        <Input
          name="joinOpensMinutes"
          type="number"
          inputMode="numeric"
          min={0}
          max={1440}
          label={t('joinOpens')}
          hint={t('joinOpensHint')}
          defaultValue={info.joinOpensMinutes}
          error={bad.has('joinOpensMinutes') ? t('joinOpensInvalid') : undefined}
        />
      </div>
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.ok && !pending ? <Alert tone="info" title={t('saved')} /> : null}
        {state.code && bad.size === 0 ? <Alert title={te(errorMessageKey(state.code))} /> : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('save')}
      </Button>
    </form>
  );
}
