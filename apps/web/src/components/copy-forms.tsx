'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, startTransition, useActionState } from 'react';
import type { CopyFormState } from '@/app/[locale]/o/[org]/e/[event]/copy/actions.ts';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';

type Action = (prev: CopyFormState, form: FormData) => Promise<CopyFormState>;

function useForm(action: Action) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null });
  // Keep what was typed when the server refuses.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };
  const message =
    state.code === null
      ? null
      : state.code === 'conflict' && state.field === 'name'
        ? t('copy.nameTaken')
        : state.code === 'validation_failed' && state.field
          ? t('copy.invalid')
          : t(errorMessageKey(state.code));
  return { state, pending, onSubmit, message };
}

/** Duplicate an event, or create an event from a template: a name and a start. */
export function CopyEventForm({
  action,
  defaults,
  submitLabel,
  idPrefix,
}: {
  action: Action;
  defaults: { name: string; startsAt: string };
  submitLabel: string;
  idPrefix: string;
}) {
  const t = useTranslations('copy');
  const { pending, onSubmit, message, state } = useForm(action);
  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2" noValidate>
      <Input
        id={`${idPrefix}-name`}
        name="name"
        required
        minLength={2}
        maxLength={160}
        defaultValue={defaults.name}
        label={t('newName')}
        error={state.field === 'name' ? (message ?? undefined) : undefined}
      />
      <Input
        id={`${idPrefix}-startsAt`}
        name="startsAt"
        type="datetime-local"
        required
        defaultValue={defaults.startsAt}
        label={t('startsAt')}
        hint={t('startsAtHint')}
        error={state.field === 'startsAt' ? (message ?? undefined) : undefined}
      />
      <div className="flex flex-col gap-2 md:col-span-2">
        <div aria-live="polite">
          {message && state.field !== 'name' && state.field !== 'startsAt' ? <Alert title={message} /> : null}
        </div>
        <Button type="submit" disabled={pending} className="self-start">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function SaveTemplateForm({
  action,
  defaultName,
  org,
}: {
  action: Action;
  defaultName: string;
  org: string;
}) {
  const t = useTranslations('copy');
  const { pending, onSubmit, message, state } = useForm(action);
  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2" noValidate>
      <Input
        id="template-name"
        name="name"
        required
        minLength={2}
        maxLength={120}
        defaultValue={defaultName}
        label={t('templateName')}
        error={state.field === 'name' ? (message ?? undefined) : undefined}
      />
      <Input id="template-description" name="description" maxLength={500} label={t('templateDescription')} />
      <div className="flex flex-col gap-2 md:col-span-2">
        <div aria-live="polite">
          {state.ok ? (
            <Alert tone="info" title={t('templateSaved')}>
              <Link href={`/o/${org}/templates`} className="underline">
                {t('openTemplates')}
              </Link>
            </Alert>
          ) : null}
          {message && state.field !== 'name' ? <Alert title={message} /> : null}
        </div>
        <Button type="submit" disabled={pending} className="self-start">
          {t('saveTemplate')}
        </Button>
      </div>
    </form>
  );
}
