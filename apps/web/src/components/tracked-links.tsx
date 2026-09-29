'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

const DESTINATION_REASONS = [
  'destination_not_a_path',
  'destination_too_long',
  'destination_invalid_characters',
] as const;

/** Create a tracked link (M3.8a): source, medium and campaign; optional label, content, term, page. */
export function TrackedLinkForm({ action, eventPath }: { action: Action; eventPath: string }) {
  const t = useTranslations('trackedLinks');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  const bad = (field: string) => (!state.ok && state.fields?.includes(field) ? true : undefined);
  const required = (field: string) => (bad(field) ? t('errors.required') : undefined);
  const destinationError = bad('destinationPath')
    ? (DESTINATION_REASONS as readonly string[]).includes(state.reason ?? '')
      ? t(`errors.${state.reason as (typeof DESTINATION_REASONS)[number]}`)
      : t('errors.destination_invalid_characters')
    : undefined;
  const general = state.code && !state.fields?.length ? te(errorMessageKey(state.code)) : null;
  return (
    <form
      ref={ref}
      action={formAction}
      onSubmit={keepValues(formAction)}
      className="grid grid-cols-1 gap-4 md:grid-cols-3"
    >
      <Input
        name="source"
        required
        maxLength={100}
        label={t('source')}
        hint={t('sourceHint')}
        error={required('source')}
        autoCapitalize="none"
        spellCheck={false}
      />
      <Input
        name="medium"
        required
        maxLength={100}
        label={t('medium')}
        hint={t('mediumHint')}
        error={required('medium')}
        autoCapitalize="none"
        spellCheck={false}
      />
      <Input
        name="campaign"
        required
        maxLength={100}
        label={t('campaign')}
        hint={t('campaignHint')}
        error={required('campaign')}
        autoCapitalize="none"
        spellCheck={false}
      />
      <Input name="label" maxLength={80} label={t('label')} hint={t('labelHint')} />
      <Input name="content" maxLength={100} label={t('content')} autoCapitalize="none" spellCheck={false} />
      <Input name="term" maxLength={100} label={t('term')} autoCapitalize="none" spellCheck={false} />
      <div className="md:col-span-3">
        <Input
          name="destinationPath"
          maxLength={300}
          dir="ltr"
          label={t('destination')}
          hint={t('destinationHint', { example: `${eventPath}/seat-finder` })}
          error={destinationError}
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>
      <div className="flex flex-col gap-2 md:col-span-3">
        <div aria-live="polite">
          {state.ok && !pending ? <Alert tone="info" title={t('created')} /> : null}
          {general ? <Alert title={general} /> : null}
          {!state.ok && state.fields?.length ? <Alert title={t('errors.fix')} /> : null}
        </div>
        <Button type="submit" disabled={pending} className="self-start">
          {t('create')}
        </Button>
      </div>
    </form>
  );
}

/** The org's attribution window in days (1–90). */
export function AttributionWindowForm({ action, windowDays }: { action: Action; windowDays: number }) {
  const t = useTranslations('trackedLinks');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const error = state.code
    ? state.code === 'validation_failed'
      ? t('errors.window')
      : te(errorMessageKey(state.code))
    : undefined;
  return (
    <form action={formAction} onSubmit={keepValues(formAction)} className="flex flex-col gap-3">
      <div className="max-w-xs">
        <Input
          name="windowDays"
          type="number"
          inputMode="numeric"
          min={1}
          max={90}
          required
          defaultValue={windowDays}
          label={t('window')}
          hint={t('windowHint')}
          error={error}
        />
      </div>
      <div aria-live="polite">
        {state.ok && !pending ? <Alert tone="info" title={t('windowSaved')} /> : null}
      </div>
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {t('windowSave')}
      </Button>
    </form>
  );
}

/** Copies a link; the button's accessible name says which one. */
export function CopyLinkButton({ url, name }: { url: string; name: string }) {
  const t = useTranslations('trackedLinks');
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={async () => {
          await navigator.clipboard.writeText(url).catch(() => undefined);
          setCopied(true);
        }}
      >
        {t('copy')}
        <span className="sr-only"> {name}</span>
      </Button>
      <span aria-live="polite" className="text-caption text-zinc-600">
        {copied ? t('copied') : ''}
      </span>
    </span>
  );
}
