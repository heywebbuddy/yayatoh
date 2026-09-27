'use client';

import { SECTION_KINDS, type SectionKind } from '@yayatoh/events/ui';
import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

export interface SectionValues {
  readonly title: string;
  readonly visible: boolean;
  /** Field name → text, as the form edits it (see the events module's text formats). */
  readonly fields: Readonly<Record<string, string>>;
}

const area = 'rounded-card border bg-white px-4 py-2 font-mono text-body';

/** Add a section (kind chosen here) or edit one (kind fixed). */
export function SectionForm({
  action,
  kind: fixedKind,
  values,
  idPrefix,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  kind?: SectionKind;
  values?: SectionValues;
  idPrefix: string;
}) {
  const t = useTranslations('content');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const [kind, setKind] = useState<SectionKind>(fixedKind ?? 'text');
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && !fixedKind) ref.current?.reset();
  }, [state, fixedKind]);
  const bad = new Set(state.fields ?? []);
  const contentError = bad.has('content')
    ? state.reason && state.line
      ? t(`textErrors.${state.reason as 'schedule_time'}`, { line: state.line })
      : t('contentInvalid')
    : undefined;
  const textArea = (name: string, label: string, hint: string, rows = 6) => {
    const id = `${idPrefix}-${name}`;
    const error = contentError && name !== 'directions' && name !== 'address' ? contentError : undefined;
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-caption text-zinc-600">
          {label}
        </label>
        <textarea
          id={id}
          name={name}
          rows={rows}
          defaultValue={values?.fields[name] ?? ''}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : `${id}-hint`}
          className={`${area} ${error ? 'border-pink-700' : 'border-zinc-200'}`}
        />
        {error ? (
          <p id={`${id}-error`} className="text-caption text-pink-700">
            {error}
          </p>
        ) : (
          <p id={`${id}-hint`} className="text-caption text-zinc-500">
            {hint}
          </p>
        )}
      </div>
    );
  };
  return (
    <form
      ref={ref}
      action={formAction}
      onSubmit={keepValues(formAction)}
      className="flex flex-col gap-4"
      noValidate
    >
      {fixedKind ? null : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${idPrefix}-kind`} className="text-caption text-zinc-600">
            {t('kind')}
          </label>
          <select
            id={`${idPrefix}-kind`}
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as SectionKind)}
            className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
          >
            {SECTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </select>
        </div>
      )}
      <Input
        id={`${idPrefix}-title`}
        name="title"
        required
        maxLength={120}
        label={t('sectionTitle')}
        defaultValue={values?.title}
        error={bad.has('title') ? t('titleInvalid') : undefined}
      />
      {kind === 'text' ? textArea('markdown', t('fields.markdown'), t('hints.markdown'), 8) : null}
      {kind === 'faq' ? textArea('faq', t('fields.faq'), t('hints.faq'), 8) : null}
      {kind === 'schedule' ? textArea('schedule', t('fields.schedule'), t('hints.schedule')) : null}
      {kind === 'links' ? textArea('links', t('fields.links'), t('hints.links')) : null}
      {kind === 'location' ? (
        <>
          {textArea('address', t('fields.address'), t('hints.address'), 3)}
          {textArea('directions', t('fields.directions'), t('hints.markdown'), 4)}
          <Input
            id={`${idPrefix}-mapUrl`}
            name="mapUrl"
            type="url"
            label={t('fields.mapUrl')}
            defaultValue={values?.fields.mapUrl}
            error={contentError}
          />
        </>
      ) : null}
      {fixedKind ? (
        <label className="flex min-h-6 items-center gap-2 text-body">
          <input
            type="checkbox"
            name="visible"
            value="1"
            defaultChecked={values?.visible ?? true}
            className="size-5"
          />
          {t('visible')}
        </label>
      ) : null}
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.ok && !pending ? (
          <Alert tone="info" title={fixedKind ? t('sectionSaved') : t('sectionAdded')} />
        ) : null}
        {state.code && !contentError && !bad.has('title') ? (
          <Alert title={te(errorMessageKey(state.code))} />
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {fixedKind ? t('saveSection') : t('addSection')}
      </Button>
    </form>
  );
}
