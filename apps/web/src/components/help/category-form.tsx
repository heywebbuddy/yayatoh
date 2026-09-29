'use client';

import { HELP_AUDIENCES, SLUG_MAX } from '@yayatoh/cms/ui';
import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

export interface CategoryValues {
  readonly audience: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly position: number;
  readonly translations: Readonly<Record<string, { title: string; description: string | null }>>;
}

/**
 * Create or edit a help category (M3.11b): audience, English name and description, order, and
 * the name in the other languages (a missing translation shows the English name).
 */
export function CategoryForm({
  action,
  values,
  locales,
  submitLabel,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  values?: CategoryValues;
  /** The other locales (not English), with their names. */
  locales: readonly { code: string; name: string }[];
  submitLabel: string;
}) {
  const t = useTranslations('helpConsole');
  const tc = useTranslations('cms');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const bad = new Set(state.fields ?? []);
  const slugError = bad.has('slug')
    ? state.reason === 'reserved'
      ? t('slugReserved')
      : tc(`slugError.${state.reason === 'taken' || state.reason === 'too_long' ? state.reason : 'format'}`)
    : undefined;
  return (
    <form action={formAction} onSubmit={keepValues(formAction)} className="flex flex-col gap-4" noValidate>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-caption text-zinc-600">{t('fields.audience')}</legend>
        {HELP_AUDIENCES.map((a) => (
          <label key={a} className="flex min-h-6 items-center gap-2 text-body">
            <input
              type="radio"
              name="audience"
              value={a}
              defaultChecked={(values?.audience ?? 'organizers') === a}
              className="size-5"
            />
            {t(`audience.${a}`)}
          </label>
        ))}
      </fieldset>
      <Input
        id="category-title"
        name="title"
        required
        maxLength={80}
        label={t('fields.categoryTitle')}
        defaultValue={values?.title}
        error={bad.has('title') ? t('titleError') : undefined}
      />
      {values ? null : (
        <Input
          id="category-slug"
          name="slug"
          dir="ltr"
          maxLength={SLUG_MAX}
          label={t('fields.slug')}
          hint={t('categorySlugHint')}
          error={slugError}
        />
      )}
      <Input
        id="category-description"
        name="description"
        maxLength={300}
        label={t('fields.description')}
        defaultValue={values?.description}
        error={bad.has('description') ? tc('tooLong', { max: 300 }) : undefined}
      />
      <Input
        id="category-position"
        name="position"
        type="number"
        min={0}
        max={10000}
        inputMode="numeric"
        label={t('fields.position')}
        hint={t('positionHint')}
        defaultValue={values?.position ?? 0}
        error={bad.has('position') ? t('positionError') : undefined}
      />
      <details className="rounded-card border border-zinc-200 p-4">
        <summary className="min-h-6 cursor-pointer text-body">{t('translations')}</summary>
        <div className="mt-4 flex flex-col gap-4">
          {bad.has('translations') ? <Alert title={t('translationsError')} /> : null}
          {locales.map((l) => (
            <fieldset key={l.code} className="flex flex-col gap-2" lang={l.code}>
              <legend className="mb-1 text-caption text-zinc-600">{l.name}</legend>
              <Input
                id={`tr-${l.code}-title`}
                name={`tr.${l.code}.title`}
                maxLength={80}
                label={t('fields.categoryTitle')}
                defaultValue={values?.translations[l.code]?.title}
              />
              <Input
                id={`tr-${l.code}-description`}
                name={`tr.${l.code}.description`}
                maxLength={300}
                label={t('fields.description')}
                defaultValue={values?.translations[l.code]?.description ?? ''}
              />
            </fieldset>
          ))}
        </div>
      </details>
      <div aria-live="polite">
        {state.ok ? <Alert tone="info" title={tc('saved')} /> : null}
        {!state.ok && state.code ? (
          <Alert title={bad.size > 0 ? tc('fixErrors') : te(errorMessageKey(state.code))} />
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {submitLabel}
      </Button>
    </form>
  );
}
