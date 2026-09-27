'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

/** New announcement (M1.4d): public or ticket holders only; publish now or keep as a draft. */
export function AnnouncementForm({
  action,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations('announcements');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  const bad = new Set(state.fields ?? []);
  return (
    <form
      ref={ref}
      action={formAction}
      onSubmit={keepValues(formAction)}
      className="flex flex-col gap-4"
      noValidate
    >
      <Input
        id="announcement-title"
        name="title"
        required
        maxLength={160}
        label={t('title')}
        error={bad.has('title') ? t('titleInvalid') : undefined}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="announcement-body" className="text-caption text-zinc-600">
          {t('body')}
        </label>
        <textarea
          id="announcement-body"
          name="body"
          required
          rows={5}
          aria-invalid={bad.has('body') || undefined}
          aria-describedby={bad.has('body') ? 'announcement-body-error' : 'announcement-body-hint'}
          className={`rounded-card border bg-white px-4 py-2 text-body ${bad.has('body') ? 'border-pink-700' : 'border-zinc-200'}`}
        />
        {bad.has('body') ? (
          <p id="announcement-body-error" className="text-caption text-pink-700">
            {t('bodyInvalid')}
          </p>
        ) : (
          <p id="announcement-body-hint" className="text-caption text-zinc-500">
            {t('bodyHint')}
          </p>
        )}
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-caption text-zinc-600">{t('audience')}</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <label className="flex min-h-6 items-center gap-2 text-body">
            <input type="radio" name="audience" value="public" defaultChecked className="size-5" />
            {t('audiencePublic')}
          </label>
          <label className="flex min-h-6 items-center gap-2 text-body">
            <input type="radio" name="audience" value="holders" className="size-5" />
            {t('audienceHolders')}
          </label>
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex min-h-6 items-center gap-2 text-body">
          <input type="checkbox" name="pinned" value="1" className="size-5" />
          {t('pin')}
        </label>
        <label className="flex min-h-6 items-center gap-2 text-body">
          <input type="checkbox" name="publish" value="1" defaultChecked className="size-5" />
          {t('publishNow')}
        </label>
      </div>
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.ok && !pending ? <Alert tone="info" title={t('created')} /> : null}
        {state.code && !bad.has('title') && !bad.has('body') ? (
          <Alert title={te(errorMessageKey(state.code))} />
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('create')}
      </Button>
    </form>
  );
}
