'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

const TITLE_MAX = 70;
const DESCRIPTION_MAX = 200;

/**
 * The event console's SEO panel: the title and description search engines and link previews use,
 * and the event's address (the old address keeps redirecting). A live counter and a search-result
 * preview show what will be used.
 */
export function EventSeoForm({
  action,
  seo,
  fallbackTitle,
  fallbackDescription,
  origin,
  disabled = false,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  seo: { slug: string; seoTitle: string | null; seoDescription: string | null; previousSlugs: string[] };
  fallbackTitle: string;
  fallbackDescription: string;
  origin: string;
  disabled?: boolean;
}) {
  const t = useTranslations('seoPanel');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const [title, setTitle] = useState(seo.seoTitle ?? '');
  const [description, setDescription] = useState(seo.seoDescription ?? '');
  const [slug, setSlug] = useState(seo.slug);
  const bad = new Set(state.fields ?? []);
  const slugChanged = slug.trim() !== seo.slug;
  return (
    <form action={formAction} onSubmit={keepValues(formAction)} className="flex flex-col gap-4" noValidate>
      <fieldset disabled={disabled} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        <legend className="sr-only">{t('title')}</legend>
        <Input
          name="seoTitle"
          label={t('seoTitle')}
          hint={t('seoTitleHint', { count: title.length, max: TITLE_MAX })}
          maxLength={TITLE_MAX}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          error={bad.has('seoTitle') ? t('errors.seoTitle', { max: TITLE_MAX }) : undefined}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="seo-description" className="text-[13px] font-bold text-ink">
            {t('seoDescription')}
          </label>
          <textarea
            id="seo-description"
            name="seoDescription"
            rows={3}
            maxLength={DESCRIPTION_MAX}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="rounded-card border border-line bg-surface px-4 py-2 text-body"
          />
          <p className="m-0 text-caption text-ink-2">
            {t('seoDescriptionHint', { count: description.length, max: DESCRIPTION_MAX })}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <Input
            name="slug"
            label={t('slug')}
            hint={t('slugHint')}
            maxLength={80}
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            error={
              bad.has('slug')
                ? state.code === 'conflict'
                  ? t('errors.slugTaken')
                  : t('errors.slug')
                : undefined
            }
          />
          {slugChanged ? (
            <p className="m-0 text-caption text-ink-2">{t('slugRedirect', { slug: seo.slug })}</p>
          ) : null}
          {seo.previousSlugs.length > 0 ? (
            <p className="m-0 text-caption text-ink-2">
              {t('previousSlugs', { slugs: seo.previousSlugs.join(', ') })}
            </p>
          ) : null}
        </div>
        <section
          aria-label={t('preview')}
          className="flex flex-col gap-1 rounded-card border border-dashed border-line p-4"
        >
          <p className="m-0 text-label font-bold uppercase tracking-wide text-ink-2">{t('preview')}</p>
          <p className="m-0 break-all text-caption text-ink-2">
            {origin}/events/{slug || seo.slug}
          </p>
          <p className="m-0 text-card font-bold text-primary-ink">{title.trim() || fallbackTitle}</p>
          <p className="m-0 text-body text-ink-2">{description.trim() || fallbackDescription}</p>
        </section>
      </fieldset>
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.ok && !pending ? <Alert tone="info" title={t('saved')} /> : null}
        {state.code && !bad.size ? <Alert title={te(errorMessageKey(state.code))} /> : null}
      </div>
      {disabled ? null : (
        <Button type="submit" disabled={pending} className="self-start">
          {t('save')}
        </Button>
      )}
    </form>
  );
}
