'use client';

import type { PublicCfpDto } from '@yayatoh/program';
import { Alert, Button, Card, Input, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { startTransition, useActionState, useEffect, useRef } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import type { CfpFormState } from './actions.ts';

type Question = NonNullable<PublicCfpDto['form']>['fields'][number];
const AREA = 'rounded-card border bg-surface px-4 py-2.5 text-body text-ink';
const LABEL = 'text-[13px] font-bold text-ink';

/**
 * The public call-for-papers form (M5.3b), phone first: the talk, the submitter, up to N
 * co-speakers (each row optional) and the organizer's questions. Nothing typed is lost when the
 * server marks a field; the marked field gets focus and its message. 44 px targets throughout.
 */
export function CfpForm({
  action,
  call,
}: {
  action: (prev: CfpFormState, form: FormData) => Promise<CfpFormState>;
  call: PublicCfpDto;
}) {
  const t = useTranslations('cfpPublic');
  const tr = useTranslations();
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null } as CfpFormState);
  const ref = useRef<HTMLFormElement>(null);
  const done = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.ok) done.current?.focus();
    else if (state.field) ref.current?.querySelector<HTMLElement>(`[name="${state.field}"]`)?.focus();
  }, [state]);

  if (state.ok)
    return (
      <div ref={done} tabIndex={-1} className="outline-none">
        <Card className="flex flex-col gap-2" role="status">
          <h2 className="m-0 text-section">{t('thanksTitle')}</h2>
          <p className="m-0 text-body text-ink-2">{t('thanksBody')}</p>
        </Card>
      </div>
    );

  const errorFor = (name: string): string | undefined => {
    if (state.field !== name) return undefined;
    // A co-speaker repeating an address (theirs or the submitter's) has its own message.
    if (name.startsWith('co') && state.reason === 'duplicate') return t('errors.coDuplicate');
    const key = `errors.${name.startsWith('q:') ? 'question' : name.replace(/^co\d+/, 'co')}`;
    return t.has(key) ? t(key) : tr('errors.validation_failed');
  };
  const general =
    state.code && !state.field
      ? state.code === 'rate_limited'
        ? t('errors.rateLimited', { minutes: state.retryMinutes ?? 10 })
        : state.reason && t.has(`errors.reasons.${state.reason}`)
          ? t(`errors.reasons.${state.reason}`)
          : tr(errorMessageKey(state.code))
      : null;
  const optional = (label: string) => `${label} ${t('optional')}`;
  const describe = (name: string, error?: string) => (error ? `${name}-error` : undefined);
  const errorText = (name: string, error?: string) =>
    error ? (
      <p id={`${name}-error`} className="text-caption text-danger">
        {error}
      </p>
    ) : null;
  const textarea = (name: string, label: string, rows: number, max: number) => {
    const error = errorFor(name);
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`cfp-${name}`} className={LABEL}>
          {label}
        </label>
        <textarea
          id={`cfp-${name}`}
          name={name}
          rows={rows}
          maxLength={max}
          aria-invalid={error ? true : undefined}
          aria-describedby={describe(`cfp-${name}`, error)}
          className={`${AREA} ${error ? 'field-invalid' : ''}`}
        />
        {errorText(`cfp-${name}`, error)}
      </div>
    );
  };
  const question = (q: Question) => {
    const name = `q:${q.key}`;
    const id = `cfp-q-${q.key}`;
    const error = errorFor(name);
    const title = q.required ? q.label : optional(q.label);
    if (q.type === 'checkbox')
      return (
        <div key={q.key} className="flex flex-col gap-1">
          <label className="flex min-h-11 items-center gap-2.5 text-body">
            <input
              type="checkbox"
              name={name}
              value="1"
              aria-invalid={error ? true : undefined}
              aria-describedby={describe(id, error)}
              className="size-5 shrink-0 accent-primary"
            />
            <span>{title}</span>
          </label>
          {errorText(id, error)}
        </div>
      );
    if (q.type === 'select' || q.type === 'multi_select')
      return (
        <fieldset
          key={q.key}
          aria-describedby={describe(id, error)}
          aria-invalid={error ? true : undefined}
          className="flex flex-col gap-1 border-0 p-0"
        >
          <legend className={`${LABEL} mb-1`}>{title}</legend>
          {q.options.map((o) => (
            <label key={o.value} className="flex min-h-11 items-center gap-2.5 text-body">
              <input
                type={q.type === 'select' ? 'radio' : 'checkbox'}
                name={name}
                value={o.value}
                className="size-5 accent-primary"
              />
              {o.label}
            </label>
          ))}
          {errorText(id, error)}
        </fieldset>
      );
    if (q.type === 'long_text') return <div key={q.key}>{textarea(name, title, 4, 2000)}</div>;
    const numeric = q.type === 'number' || q.type === 'count';
    return (
      <Input
        key={q.key}
        id={id}
        name={name}
        type={numeric ? 'number' : 'text'}
        inputMode={numeric ? 'numeric' : undefined}
        maxLength={numeric ? undefined : 200}
        label={title}
        hint={q.help ?? undefined}
        error={error}
      />
    );
  };

  return (
    <form
      ref={ref}
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        startTransition(() => formAction(form));
      }}
      noValidate
      aria-label={t('formLabel')}
      className="flex flex-col gap-8"
    >
      <fieldset className="flex flex-col gap-4 border-0 p-0">
        <legend className="mb-2 text-section">{t('talkHeading')}</legend>
        <Input id="cfp-title" name="title" label={t('talkTitle')} maxLength={160} error={errorFor('title')} />
        {textarea('abstract', t('abstract'), 6, 5000)}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cfp-durationMinutes" className={LABEL}>
            {t('length')}
          </label>
          <Select
            id="cfp-durationMinutes"
            name="durationMinutes"
            defaultValue={String(call.durations[0] ?? '')}
            aria-invalid={errorFor('durationMinutes') ? true : undefined}
            aria-describedby={describe('cfp-durationMinutes', errorFor('durationMinutes'))}
          >
            {call.durations.map((m) => (
              <option key={m} value={m}>
                {t('minutes', { count: m })}
              </option>
            ))}
          </Select>
          {errorText('cfp-durationMinutes', errorFor('durationMinutes'))}
        </div>
        {call.tracks.length ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cfp-trackId" className={LABEL}>
              {optional(t('track'))}
            </label>
            <Select
              id="cfp-trackId"
              name="trackId"
              defaultValue=""
              aria-invalid={errorFor('trackId') ? true : undefined}
            >
              <option value="">{t('noTrack')}</option>
              {call.tracks.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </fieldset>
      <fieldset className="flex flex-col gap-4 border-0 p-0">
        <legend className="mb-2 text-section">{t('youHeading')}</legend>
        <Input
          id="cfp-speakerName"
          name="speakerName"
          label={t('name')}
          autoComplete="name"
          maxLength={120}
          error={errorFor('speakerName')}
        />
        <Input
          id="cfp-speakerEmail"
          name="speakerEmail"
          type="email"
          label={t('email')}
          hint={t('emailHint')}
          autoComplete="email"
          maxLength={254}
          error={errorFor('speakerEmail')}
        />
        <Input
          id="cfp-speakerTitle"
          name="speakerTitle"
          label={optional(t('jobTitle'))}
          autoComplete="organization-title"
          maxLength={120}
        />
        <Input
          id="cfp-speakerCompany"
          name="speakerCompany"
          label={optional(t('company'))}
          autoComplete="organization"
          maxLength={120}
        />
        {textarea('speakerBio', optional(t('bio')), 4, 4000)}
      </fieldset>
      {call.maxCoSpeakers > 0 ? (
        <fieldset className="flex flex-col gap-4 border-0 p-0">
          <legend className="mb-1 text-section">{t('coHeading')}</legend>
          <p className="m-0 text-caption text-ink-2">{t('coHint', { count: call.maxCoSpeakers })}</p>
          {Array.from({ length: call.maxCoSpeakers }, (_, i) => (
            <div key={i} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                id={`cfp-co${i}Name`}
                name={`co${i}Name`}
                label={t('coName', { n: i + 1 })}
                maxLength={120}
                error={errorFor(`co${i}Name`)}
              />
              <Input
                id={`cfp-co${i}Email`}
                name={`co${i}Email`}
                type="email"
                label={t('coEmail', { n: i + 1 })}
                maxLength={254}
                error={errorFor(`co${i}Email`)}
              />
            </div>
          ))}
        </fieldset>
      ) : null}
      {call.form?.fields.length ? (
        <fieldset className="flex flex-col gap-4 border-0 p-0">
          <legend className="mb-2 text-section">{t('moreHeading')}</legend>
          {call.form.fields.map(question)}
        </fieldset>
      ) : null}
      <div aria-live="polite">{general ? <Alert title={general} /> : null}</div>
      <Button type="submit" size="lg" disabled={pending} className="self-stretch sm:self-start">
        {t('submit')}
      </Button>
    </form>
  );
}
