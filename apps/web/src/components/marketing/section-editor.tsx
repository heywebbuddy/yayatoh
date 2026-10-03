'use client';

import { SITE_PLACEMENTS, SLUG_MAX } from '@yayatoh/cms/ui';
import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useId, useState } from 'react';
import { Markdown } from '@/components/markdown.tsx';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

export interface SectionValues {
  readonly placement: string;
  readonly locale: string;
  readonly slug: string;
  readonly eyebrow: string;
  readonly heading: string;
  readonly body: string;
  readonly ctaLabel: string;
  readonly ctaHref: string;
  readonly position: number;
}

const area = 'rounded-card border bg-surface px-4 py-2 text-body';
const select = 'field';

/**
 * Create or edit a marketing section (M3.11b). The page and language are chosen once; a
 * translation uses the same key in another language. "Preview" renders the text as the site.
 */
export function SectionEditor({
  action,
  values,
  locales,
  submitLabel,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  values?: SectionValues;
  /** Create only: page and language choices. */
  locales: readonly { code: string; name: string }[] | null;
  submitLabel: string;
}) {
  const t = useTranslations('siteConsole');
  const tc = useTranslations('cms');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const [body, setBody] = useState(values?.body ?? '');
  const [preview, setPreview] = useState(false);
  const previewId = useId();
  const bad = new Set(state.fields ?? []);
  return (
    <form action={formAction} onSubmit={keepValues(formAction)} className="flex flex-col gap-4" noValidate>
      {locales ? (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="section-placement" className="text-[13px] font-bold text-ink">
              {t('fields.placement')}
            </label>
            <select
              id="section-placement"
              name="placement"
              defaultValue={values?.placement ?? 'home'}
              className={select}
            >
              {SITE_PLACEMENTS.map((p) => (
                <option key={p} value={p}>
                  {t(`placement.${p}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="section-locale" className="text-[13px] font-bold text-ink">
              {t('fields.locale')}
            </label>
            <select
              id="section-locale"
              name="locale"
              defaultValue={values?.locale ?? 'en'}
              className={select}
            >
              {locales.map((l) => (
                <option key={l.code} value={l.code} lang={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : null}
      <Input
        id="section-eyebrow"
        name="eyebrow"
        maxLength={60}
        label={t('fields.eyebrow')}
        hint={t('optional')}
        defaultValue={values?.eyebrow}
        error={bad.has('eyebrow') ? tc('tooLong', { max: 60 }) : undefined}
      />
      <Input
        id="section-heading"
        name="heading"
        required
        maxLength={120}
        label={t('fields.heading')}
        defaultValue={values?.heading}
        error={bad.has('heading') ? t('headingError') : undefined}
      />
      <Input
        id="section-slug"
        name="slug"
        dir="ltr"
        maxLength={SLUG_MAX}
        label={t('fields.slug')}
        hint={t('slugHint')}
        defaultValue={values?.slug}
        error={
          bad.has('slug')
            ? tc(
                `slugError.${state.reason === 'taken' || state.reason === 'too_long' ? state.reason : 'format'}`,
              )
            : undefined
        }
      />
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="section-body" className="text-[13px] font-bold text-ink">
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
          id="section-body"
          name="body"
          rows={8}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-invalid={bad.has('body') || undefined}
          aria-describedby="section-body-hint"
          className={`${area} font-mono ${bad.has('body') ? 'field-invalid' : ''}`}
        />
        <p id="section-body-hint" className="text-caption text-ink-2">
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
      <fieldset className="flex flex-col gap-4 rounded-card border border-line p-4">
        <legend className="px-1 text-[13px] font-bold text-ink">{t('ctaLegend')}</legend>
        <Input
          id="section-cta-label"
          name="ctaLabel"
          maxLength={40}
          label={t('fields.ctaLabel')}
          defaultValue={values?.ctaLabel}
          error={bad.has('ctaLabel') ? t('ctaLabelError') : undefined}
        />
        <Input
          id="section-cta-href"
          name="ctaHref"
          dir="ltr"
          maxLength={300}
          label={t('fields.ctaHref')}
          hint={t('ctaHrefHint')}
          defaultValue={values?.ctaHref}
          error={bad.has('ctaHref') ? t('ctaHrefError') : undefined}
        />
      </fieldset>
      <Input
        id="section-position"
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
