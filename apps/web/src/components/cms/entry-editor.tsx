'use client';

import { SLUG_MAX } from '@yayatoh/cms/ui';
import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useId, useState } from 'react';
import { Markdown } from '@/components/markdown.tsx';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

export interface EntryValues {
  readonly title: string;
  readonly slug: string;
  readonly excerpt: string;
  readonly body: string;
  readonly seoTitle: string;
  readonly seoDescription: string;
}

const area = 'rounded-card border bg-surface px-4 py-2 text-body';

/**
 * Create or edit a page or post (M1.4g). "Preview" renders the body exactly as the public page
 * will (the same Markdown subset and renderer), without saving.
 */
export function EntryEditor({
  action,
  kind,
  values,
  slugFrozen,
  submitLabel,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  kind: 'page' | 'post';
  values?: EntryValues;
  slugFrozen: boolean;
  submitLabel: string;
}) {
  const t = useTranslations('cms');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const [body, setBody] = useState(values?.body ?? '');
  const [preview, setPreview] = useState(false);
  const previewId = useId();
  const bad = new Set(state.fields ?? []);
  const slugError = bad.has('slug')
    ? t(
        `slugError.${state.reason === 'taken' || state.reason === 'frozen' || state.reason === 'too_long' ? state.reason : 'format'}`,
      )
    : undefined;
  const titleError = bad.has('title') ? t('titleError') : undefined;
  const fieldErrors = Boolean(slugError || titleError || bad.size);
  const prefix = kind === 'page' ? '/pages/' : '/blogs/';
  return (
    <form action={formAction} onSubmit={keepValues(formAction)} className="flex flex-col gap-4" noValidate>
      <Input
        id="entry-title"
        name="title"
        required
        maxLength={160}
        label={t('fields.title')}
        defaultValue={values?.title}
        error={titleError}
      />
      <Input
        id="entry-slug"
        name="slug"
        dir="ltr"
        maxLength={SLUG_MAX}
        label={t('fields.slug')}
        defaultValue={values?.slug}
        readOnly={slugFrozen}
        hint={
          slugFrozen ? t('slugFrozen', { path: `${prefix}${values?.slug ?? ''}` }) : t('slugHint', { prefix })
        }
        error={slugError}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="entry-excerpt" className="text-caption text-ink-2">
          {t('fields.excerpt')}
        </label>
        <textarea
          id="entry-excerpt"
          name="excerpt"
          rows={2}
          maxLength={300}
          defaultValue={values?.excerpt}
          aria-invalid={bad.has('excerpt') || undefined}
          aria-describedby="entry-excerpt-hint"
          className={`${area} ${bad.has('excerpt') ? 'border-danger' : 'border-line'}`}
        />
        <p id="entry-excerpt-hint" className="text-caption text-ink-2">
          {t('excerptHint')}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="entry-body" className="text-caption text-ink-2">
            {t('fields.body')}
          </label>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-pressed={preview}
            aria-controls={previewId}
            onClick={() => setPreview((p) => !p)}
          >
            {preview ? t('hidePreview') : t('showPreview')}
          </Button>
        </div>
        <textarea
          id="entry-body"
          name="body"
          rows={14}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-invalid={bad.has('body') || undefined}
          aria-describedby="entry-body-hint"
          className={`${area} font-mono ${bad.has('body') ? 'border-danger' : 'border-line'}`}
        />
        <p id="entry-body-hint" className="text-caption text-ink-2">
          {t('bodyHint')}
        </p>
        <section
          id={previewId}
          aria-label={t('previewLabel')}
          hidden={!preview}
          className="rounded-card border border-dashed border-line-strong bg-surface p-4"
        >
          {body.trim() ? (
            <Markdown source={body} />
          ) : (
            <p className="text-body text-ink-2">{t('previewEmpty')}</p>
          )}
        </section>
      </div>
      <fieldset className="flex flex-col gap-4 rounded-card border border-line p-4">
        <legend className="px-1 text-caption text-ink-2">{t('seoLegend')}</legend>
        <Input
          id="entry-seo-title"
          name="seoTitle"
          maxLength={70}
          label={t('fields.seoTitle')}
          hint={t('seoTitleHint')}
          defaultValue={values?.seoTitle}
          error={bad.has('seoTitle') ? t('tooLong', { max: 70 }) : undefined}
        />
        <Input
          id="entry-seo-description"
          name="seoDescription"
          maxLength={160}
          label={t('fields.seoDescription')}
          hint={t('seoDescriptionHint')}
          defaultValue={values?.seoDescription}
          error={bad.has('seoDescription') ? t('tooLong', { max: 160 }) : undefined}
        />
      </fieldset>
      <div aria-live="polite">
        {state.ok ? <Alert tone="info" title={t('saved')} /> : null}
        {state.code && !(fieldErrors && state.code === 'validation_failed') && !slugError ? (
          <Alert title={te(errorMessageKey(state.code))} />
        ) : null}
        {fieldErrors && !state.ok && state.code === 'validation_failed' ? (
          <Alert title={t('fixErrors')} />
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {submitLabel}
      </Button>
    </form>
  );
}
