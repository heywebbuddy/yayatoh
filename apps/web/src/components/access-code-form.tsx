'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

/** New access code (M1.4d): what it unlocks, a use limit and an expiry. */
export function AccessCodeForm({
  action,
  hiddenPasses,
  isPrivate,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  hiddenPasses: readonly { id: string; name: string }[];
  isPrivate: boolean;
}) {
  const t = useTranslations('accessCodes');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  const bad = new Set(state.fields ?? []);
  const nothing = bad.has('unlocksEvent');
  return (
    <form ref={ref} action={formAction} onSubmit={keepValues(formAction)} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Input
          name="code"
          label={t('code')}
          hint={t('codeHint')}
          maxLength={32}
          autoCapitalize="characters"
          spellCheck={false}
          error={
            bad.has('code') ? (state.code === 'conflict' ? t('codeTaken') : t('codeInvalid')) : undefined
          }
        />
        <Input name="label" label={t('label')} hint={t('labelHint')} maxLength={120} />
        <Input
          name="maxUses"
          type="number"
          inputMode="numeric"
          min={1}
          label={t('maxUses')}
          hint={t('maxUsesHint')}
          error={bad.has('maxUses') ? t('maxUsesInvalid') : undefined}
        />
        <Input
          name="expiresAt"
          type="datetime-local"
          label={t('expiresAt')}
          hint={t('expiresHint')}
          error={bad.has('expiresAt') ? t('expiresInvalid') : undefined}
        />
      </div>
      <fieldset className="flex flex-col gap-2" aria-describedby={nothing ? 'unlocks-error' : undefined}>
        <legend className="text-caption text-zinc-600">{t('unlocks')}</legend>
        <label className="flex min-h-6 items-center gap-2 text-body">
          <input
            type="checkbox"
            name="unlocksEvent"
            value="1"
            defaultChecked={isPrivate}
            className="size-5"
          />
          {t('unlocksEvent')}
        </label>
        {hiddenPasses.map((p) => (
          <label key={p.id} className="flex min-h-6 items-center gap-2 text-body">
            <input type="checkbox" name="ticketTypeIds" value={p.id} className="size-5" />
            {t('unlocksPass', { name: p.name })}
          </label>
        ))}
        {hiddenPasses.length === 0 ? (
          <p className="text-caption text-zinc-500">{t('noHiddenPasses')}</p>
        ) : null}
        {nothing ? (
          <p id="unlocks-error" className="text-caption text-pink-700">
            {t('unlocksRequired')}
          </p>
        ) : null}
      </fieldset>
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.ok && !pending ? <Alert tone="info" title={t('created')} /> : null}
        {state.code && bad.size === 0 ? <Alert title={te(errorMessageKey(state.code))} /> : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('create')}
      </Button>
    </form>
  );
}
