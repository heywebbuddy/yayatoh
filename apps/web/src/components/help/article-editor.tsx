'use client';

import { SLUG_MAX } from '@yayatoh/cms/ui';
import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useId, useState } from 'react';
import { Markdown } from '@/components/markdown.tsx';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

export interface ArticleValues {
  readonly categoryId: string;
  readonly locale: string;
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  readonly keywords: string;
  readonly position: number;
  readonly seoTitle: string;
  readonly seoDescription: string;
}

export interface CategoryOption {
  readonly id: string;
  readonly title: string;
  readonly audienceLabel: string;
}

const area = 'rounded-card border bg-surface px-4 py-2 text-body';
const select = 'field';

/**
 * Create or edit a help article (M3.11b). A translation is the same address in another language;
 * "Preview" renders the text exactly as the public article.
 */
export function ArticleEditor({
  action,
  categories,
  locales,
  values,
  slugFrozen,
  submitLabel,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  categories: readonly CategoryOption[];
  /** Locale choices (create only; an article's language never changes). */
  locales: readonly { code: string; name: string }[] | null;
  values?: ArticleValues;
  slugFrozen: boolean;
  submitLabel: string;
}) {
  const t = useTranslations('helpConsole');
  const tc = useTranslations('cms');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const [body, setBody] = useState(values?.body ?? '');
  const [preview, setPreview] = useState(false);
  const previewId = useId();
  const bad = new Set(state.fields ?? []);
  const slugError = bad.has('slug')
    ? tc(
        `slugError.${state.reason === 'taken' || state.reason === 'frozen' || state.reason === 'too_long' ? state.reason : 'format'}`,
      )
    : undefined;
  const fieldErrors = bad.size > 0;
  return (
    <form action={formAction} onSubmit={keepValues(formAction)} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="article-category" className="text-[13px] font-bold text-ink">
          {t('fields.category')}
        </label>
        <select
          id="article-category"
          name="categoryId"
          defaultValue={values?.categoryId}
          aria-invalid={bad.has('categoryId') || undefined}
          className={select}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} · {c.audienceLabel}
            </option>
          ))}
        </select>
      </div>
      {locales ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="article-locale" className="text-[13px] font-bold text-ink">
            {t('fields.locale')}
          </label>
          <select id="article-locale" name="locale" defaultValue={values?.locale ?? 'en'} className={select}>
            {locales.map((l) => (
              <option key={l.code} value={l.code} lang={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <Input
        id="article-title"
        name="title"
        required
        maxLength={160}
        label={t('fields.title')}
        defaultValue={values?.title}
        error={bad.has('title') ? t('titleError') : undefined}
      />
      <Input
        id="article-slug"
        name="slug"
        dir="ltr"
        maxLength={SLUG_MAX}
        label={t('fields.slug')}
        defaultValue={values?.slug}
        readOnly={slugFrozen}
        hint={slugFrozen ? t('slugFrozen') : t('slugHint')}
        error={slugError}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="article-summary" className="text-[13px] font-bold text-ink">
          {t('fields.summary')}
        </label>
        <textarea
          id="article-summary"
          name="summary"
          rows={2}
          maxLength={300}
          defaultValue={values?.summary}
          aria-invalid={bad.has('summary') || undefined}
          className={`${area} ${bad.has('summary') ? 'field-invalid' : ''}`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="article-body" className="text-[13px] font-bold text-ink">
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
            {preview ? tc('hidePreview') : tc('showPreview')}
          </Button>
        </div>
        <textarea
          id="article-body"
          name="body"
          rows={14}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-invalid={bad.has('body') || undefined}
          aria-describedby="article-body-hint"
          className={`${area} font-mono ${bad.has('body') ? 'field-invalid' : ''}`}
        />
        <p id="article-body-hint" className="text-caption text-ink-2">
          {tc('bodyHint')}
        </p>
        <section
          id={previewId}
          aria-label={tc('previewLabel')}
          hidden={!preview}
          className="rounded-card border border-dashed border-line-strong bg-surface p-4"
        >
          {body.trim() ? (
            <Markdown source={body} />
          ) : (
            <p className="text-body text-ink-2">{tc('previewEmpty')}</p>
          )}
        </section>
      </div>
      <Input
        id="article-keywords"
        name="keywords"
        maxLength={300}
        label={t('fields.keywords')}
        hint={t('keywordsHint')}
        defaultValue={values?.keywords}
        error={bad.has('keywords') ? tc('tooLong', { max: 300 }) : undefined}
      />
      <Input
        id="article-position"
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
      <fieldset className="flex flex-col gap-4 rounded-card border border-line p-4">
        <legend className="px-1 text-[13px] font-bold text-ink">{tc('seoLegend')}</legend>
        <Input
          id="article-seo-title"
          name="seoTitle"
          maxLength={70}
          label={tc('fields.seoTitle')}
          defaultValue={values?.seoTitle}
          error={bad.has('seoTitle') ? tc('tooLong', { max: 70 }) : undefined}
        />
        <Input
          id="article-seo-description"
          name="seoDescription"
          maxLength={160}
          label={tc('fields.seoDescription')}
          defaultValue={values?.seoDescription}
          error={bad.has('seoDescription') ? tc('tooLong', { max: 160 }) : undefined}
        />
      </fieldset>
      <div aria-live="polite">
        {state.ok ? <Alert tone="info" title={tc('saved')} /> : null}
        {!state.ok && state.code ? (
          <Alert
            title={
              fieldErrors && (state.code === 'validation_failed' || slugError)
                ? tc('fixErrors')
                : te(errorMessageKey(state.code))
            }
          />
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {submitLabel}
      </Button>
    </form>
  );
}
