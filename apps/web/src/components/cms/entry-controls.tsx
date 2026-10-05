'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

type Act = (prev: FormState, form: FormData) => Promise<FormState>;

function StatusButton({
  action,
  label,
  variant,
}: {
  action: Act;
  label: string;
  variant: 'primary' | 'secondary';
}) {
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Button type="submit" variant={variant} disabled={pending}>
        {label}
      </Button>
      {state.code ? <Alert title={te(errorMessageKey(state.code))} /> : null}
    </form>
  );
}

/**
 * Publish / unpublish / archive, and delete behind a confirmation step (keyboard: the confirm
 * button takes focus; Cancel returns it to Delete).
 */
export function EntryControls({
  status,
  title,
  publish,
  unpublish,
  archive,
  remove,
}: {
  status: 'draft' | 'published' | 'archived';
  title: string;
  publish: Act;
  unpublish: Act;
  archive: Act;
  remove: Act;
}) {
  const t = useTranslations('cms');
  const te = useTranslations();
  const [confirming, setConfirming] = useState(false);
  const [state, removeAction, pending] = useActionState(remove, INITIAL_FORM_STATE);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);
  useEffect(() => {
    if (confirming) {
      opened.current = true;
      confirmRef.current?.focus();
    } else if (opened.current) deleteRef.current?.focus();
  }, [confirming]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-2">
        {status !== 'published' ? (
          <StatusButton action={publish} label={t('actions.publish')} variant="primary" />
        ) : null}
        {status === 'published' ? (
          <StatusButton action={unpublish} label={t('actions.unpublish')} variant="secondary" />
        ) : null}
        {status !== 'archived' ? (
          <StatusButton action={archive} label={t('actions.archive')} variant="secondary" />
        ) : null}
        {confirming ? null : (
          <Button ref={deleteRef} type="button" variant="ghost" onClick={() => setConfirming(true)}>
            {t('actions.delete')}
          </Button>
        )}
      </div>
      {confirming ? (
        <section
          aria-labelledby="delete-confirm-title"
          className="flex flex-col gap-3 rounded-card border border-danger bg-surface p-4"
        >
          <h3 id="delete-confirm-title" className="text-body font-medium">
            {t('deleteConfirm.title', { title })}
          </h3>
          <p className="text-body text-ink-2">{t('deleteConfirm.body')}</p>
          <form action={removeAction} className="flex flex-wrap gap-2">
            <Button ref={confirmRef} type="submit" variant="primary" disabled={pending}>
              {t('deleteConfirm.confirm')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              {t('deleteConfirm.cancel')}
            </Button>
          </form>
          {state.code ? <Alert title={te(errorMessageKey(state.code))} /> : null}
        </section>
      ) : null}
    </div>
  );
}
