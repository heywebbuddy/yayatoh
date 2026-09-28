'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

/**
 * Delete behind a confirmation step (keyboard: the confirm button takes focus; Cancel returns it
 * to Delete). `refusal` maps a refusal reason to a message (e.g. a category that has articles).
 */
export function DeleteControl({
  action,
  title,
  refusals = {},
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  title: string;
  refusals?: Readonly<Record<string, string>>;
}) {
  const t = useTranslations('cms');
  const te = useTranslations();
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);
  useEffect(() => {
    if (confirming) {
      opened.current = true;
      confirmRef.current?.focus();
    } else if (opened.current) deleteRef.current?.focus();
  }, [confirming]);
  const refusal = state.reason ? refusals[state.reason] : undefined;
  return (
    <div className="flex flex-col gap-3">
      {confirming ? (
        <section
          aria-labelledby="delete-confirm-title"
          className="flex flex-col gap-3 rounded-card border border-pink-700 bg-white p-4"
        >
          <h3 id="delete-confirm-title" className="text-body font-medium">
            {t('deleteConfirm.title', { title })}
          </h3>
          <p className="text-body text-zinc-600">{t('deleteConfirm.body')}</p>
          <form action={formAction} className="flex flex-wrap gap-2">
            <Button ref={confirmRef} type="submit" variant="primary" disabled={pending}>
              {t('deleteConfirm.confirm')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              {t('deleteConfirm.cancel')}
            </Button>
          </form>
        </section>
      ) : (
        <Button
          ref={deleteRef}
          type="button"
          variant="ghost"
          className="self-start"
          onClick={() => setConfirming(true)}
        >
          {t('actions.delete')}
        </Button>
      )}
      {state.code ? <Alert title={refusal ?? te(errorMessageKey(state.code))} /> : null}
    </div>
  );
}
