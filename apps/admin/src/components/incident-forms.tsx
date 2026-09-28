'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { IncidentFormState } from '@/app/incidents/actions.ts';

const INITIAL: IncidentFormState = { ok: false, errors: [], stamp: 0 };
const area = 'rounded-card border bg-white px-4 py-2 text-body';
const select = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';

/** Post an incident (M3.11b): title, impact, affected components and the first update. */
export function NewIncidentForm({
  action,
  impacts,
  components,
}: {
  action: (prev: IncidentFormState, form: FormData) => Promise<IncidentFormState>;
  impacts: readonly string[];
  components: readonly string[];
}) {
  const t = useTranslations('incidents');
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const bad = new Set(state.errors);
  return (
    <form
      key={state.ok ? state.stamp : 'form'}
      action={formAction}
      noValidate
      aria-label={t('new.title')}
      className="flex flex-col gap-4"
    >
      <div aria-live="polite">
        {state.ok ? <Alert tone="info" title={t('new.posted')} /> : null}
        {!state.ok && bad.size > 0 ? <Alert title={t('errors.summary')} /> : null}
      </div>
      <Input
        id="incident-title"
        name="title"
        maxLength={160}
        label={t('new.titleField')}
        error={bad.has('title') ? t('errors.title') : undefined}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="incident-impact" className="text-caption text-zinc-600">
          {t('new.impact')}
        </label>
        <select id="incident-impact" name="impact" defaultValue="minor" className={select}>
          {impacts.map((i) => (
            <option key={i} value={i}>
              {t(`impact.${i}`)}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-caption text-zinc-600">{t('new.components')}</legend>
        {components.map((c) => (
          <label key={c} className="flex min-h-6 items-center gap-2 text-body">
            <input type="checkbox" name="components" value={c} className="size-5" />
            {t(`component.${c}`)}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="incident-body" className="text-caption text-zinc-600">
          {t('new.body')}
        </label>
        <textarea
          id="incident-body"
          name="body"
          rows={4}
          maxLength={2000}
          aria-invalid={bad.has('body') || undefined}
          aria-describedby={bad.has('body') ? 'incident-body-error' : undefined}
          className={`${area} ${bad.has('body') ? 'border-pink-700' : 'border-zinc-200'}`}
        />
        {bad.has('body') ? (
          <p id="incident-body-error" className="text-caption text-pink-700">
            {t('errors.body')}
          </p>
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('new.submit')}
      </Button>
    </form>
  );
}

/** Add an update to one open incident (new status + message). */
export function IncidentUpdateForm({
  action,
  title,
  statuses,
  id,
}: {
  action: (prev: IncidentFormState, form: FormData) => Promise<IncidentFormState>;
  title: string;
  statuses: readonly string[];
  id: string;
}) {
  const t = useTranslations('incidents');
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const bad = new Set(state.errors);
  return (
    <form
      action={formAction}
      noValidate
      aria-label={t('update.label', { title })}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`status-${id}`} className="text-caption text-zinc-600">
          {t('update.status')}
        </label>
        <select id={`status-${id}`} name="status" className={select}>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`body-${id}`} className="text-caption text-zinc-600">
          {t('update.body')}
        </label>
        <textarea
          id={`body-${id}`}
          name="body"
          rows={3}
          maxLength={2000}
          aria-invalid={bad.has('body') || undefined}
          className={`${area} ${bad.has('body') ? 'border-pink-700' : 'border-zinc-200'}`}
        />
        {bad.has('body') ? <p className="text-caption text-pink-700">{t('errors.body')}</p> : null}
      </div>
      <div aria-live="polite">{bad.has('closed') ? <Alert title={t('errors.closed')} /> : null}</div>
      <Button type="submit" variant="secondary" size="sm" disabled={pending} className="self-start">
        {t('update.submit')}
      </Button>
    </form>
  );
}
