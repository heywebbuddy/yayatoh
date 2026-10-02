'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import type {
  TemplateEditorState,
  TemplateField,
  TemplatePreview,
} from '@/app/[locale]/o/[org]/(org)/emails/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

const field = 'field';

/**
 * The org's copy for one email kind and language: subject and opening paragraph, with a live
 * preview (debounced, framed from its own URL so the email's styles render under the console's
 * CSP), validation as you type (ICU syntax, allowed placeholders, length), save and reset to the
 * default. Members who can't edit get the same view read-only. Native controls throughout.
 */
export function TemplateEditor({
  action,
  preview,
  initial,
  defaults,
  placeholders,
  canEdit,
}: {
  action: (prev: TemplateEditorState, form: FormData) => Promise<TemplateEditorState>;
  preview: (subject: string, intro: string) => Promise<TemplatePreview>;
  initial: { subject: string; intro: string };
  defaults: { subject: string; intro: string };
  placeholders: readonly string[];
  canEdit: boolean;
}) {
  const t = useTranslations('emailTemplates');
  const tr = useTranslations();
  const [state, formAction, pending] = useActionState(action, {
    saved: null,
    errors: {},
    code: null,
    values: initial,
  });
  const [values, setValues] = useState(initial);
  const [shown, setShown] = useState<TemplatePreview>({ src: null, subject: null, errors: {} });
  const [previewing, startPreview] = useTransition();
  const seq = useRef(0);

  // After a reset the fields show the defaults again (empty = default copy).
  useEffect(() => {
    if (state.saved === 'reset') setValues({ subject: '', intro: '' });
  }, [state]);

  useEffect(() => {
    const n = ++seq.current;
    const timer = setTimeout(
      () =>
        startPreview(async () => {
          const r = await preview(values.subject, values.intro);
          if (n === seq.current) setShown(r);
        }),
      400,
    );
    return () => clearTimeout(timer);
  }, [values, preview]);

  // The last save's errors apply to what was submitted; editing since makes them stale.
  const submitted = state.values.subject === values.subject && state.values.intro === values.intro;
  const errors: Partial<Record<TemplateField, string>> = {
    ...shown.errors,
    ...(submitted ? state.errors : {}),
  };
  const describe = (f: TemplateField) =>
    [errors[f] ? `template-${f}-error` : null, `template-${f}-default`].filter(Boolean).join(' ');
  const input = (f: TemplateField, label: string) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`template-${f}`} className="text-caption text-ink-2">
        {label}
      </label>
      {f === 'subject' ? (
        <input
          id="template-subject"
          name="subject"
          value={values.subject}
          onChange={(e) => setValues((v) => ({ ...v, subject: e.target.value }))}
          readOnly={!canEdit}
          maxLength={200}
          aria-invalid={errors.subject ? true : undefined}
          aria-describedby={describe('subject')}
          className={field}
        />
      ) : (
        <textarea
          id="template-intro"
          name="intro"
          value={values.intro}
          onChange={(e) => setValues((v) => ({ ...v, intro: e.target.value }))}
          readOnly={!canEdit}
          rows={5}
          maxLength={2000}
          aria-invalid={errors.intro ? true : undefined}
          aria-describedby={describe('intro')}
          className="rounded-card border border-line bg-surface px-4 py-3 text-body read-only:bg-surface-2"
        />
      )}
      {errors[f] ? (
        <p id={`template-${f}-error`} className="text-caption text-danger">
          {t(`errors.${errors[f]}`)}
        </p>
      ) : null}
      <p id={`template-${f}-default`} className="text-caption text-ink-2">
        {t('defaultIs', { copy: defaults[f] })}
      </p>
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <form action={formAction} className="flex flex-col gap-4" aria-label={t('formLabel')}>
        {!canEdit ? <Alert tone="info" title={t('readOnly')} /> : null}
        {input('subject', t('subject'))}
        {input('intro', t('intro'))}
        <div className="flex flex-col gap-1">
          <p className="text-caption text-ink-2">{t('placeholdersTitle')}</p>
          <ul className="flex list-none flex-wrap gap-2 p-0">
            {placeholders.map((p) => (
              <li key={p}>
                <code className="rounded-pill bg-surface-3 px-2 py-0.5 text-caption">{`{${p}}`}</code>
              </li>
            ))}
          </ul>
          <p className="text-caption text-ink-2">{t('emptyMeansDefault')}</p>
        </div>
        <div role="status" aria-live="polite">
          {state.saved === 'saved' ? <p className="text-body font-medium">{t('saved')}</p> : null}
          {state.saved === 'reset' ? <p className="text-body font-medium">{t('resetDone')}</p> : null}
        </div>
        {state.code && state.code !== 'validation_failed' ? (
          <Alert title={tr(errorMessageKey(state.code))} />
        ) : null}
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="intent" value="save" disabled={pending}>
              {t('save')}
            </Button>
            <Button type="submit" name="intent" value="reset" variant="secondary" disabled={pending}>
              {t('reset')}
            </Button>
          </div>
        ) : null}
      </form>
      <section aria-labelledby="template-preview-heading" className="flex flex-col gap-2">
        <h2 id="template-preview-heading" className="text-section">
          {t('previewTitle')}
        </h2>
        <p className="text-caption text-ink-2" aria-live="polite">
          {previewing
            ? t('previewUpdating')
            : shown.subject
              ? t('previewSubject', { subject: shown.subject })
              : Object.keys(shown.errors).length
                ? t('previewBlocked')
                : ''}
        </p>
        {shown.src ? (
          <iframe
            title={t('previewFrame', { subject: shown.subject ?? '' })}
            src={shown.src}
            sandbox=""
            className="h-[520px] w-full rounded-card border border-line"
          />
        ) : null}
      </section>
    </div>
  );
}
