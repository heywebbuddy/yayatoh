'use client';

import { SURVEY_FIELD_TYPES } from '@yayatoh/forms/ui';
import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, startTransition, useActionState, useEffect, useId, useRef, useState } from 'react';
import type { SendState } from '@/app/[locale]/o/[org]/e/[event]/marketing/surveys/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import type { FormState } from '@/lib/form-state.ts';

type Action = (prev: FormState, form: FormData) => Promise<FormState>;
const INITIAL: FormState = { ok: false, code: null };
const field = 'min-h-10 rounded-pill border bg-white px-4 text-body text-zinc-900';

/**
 * Submit through the action without React's automatic form reset, so what the person typed stays
 * when the server says something needs fixing (forms reset themselves on success instead).
 */
function keepValues(dispatch: (form: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => dispatch(form));
  };
}

/** A reason-specific message when there is one (surveys.errors.*), else the generic code message. */
function useMessage() {
  const t = useTranslations();
  return (state: FormState) =>
    state.reason && t.has(`surveys.errors.${state.reason}`)
      ? t(`surveys.errors.${state.reason}`)
      : t(errorMessageKey(state.code));
}

/** "Create the post-event survey" (one per event). */
export function CreatePostEventForm({ action }: { action: Action }) {
  const t = useTranslations('surveys');
  const message = useMessage();
  const [state, formAction, pending] = useActionState(action, INITIAL);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="kind" value="post_event" />
      <Button type="submit" disabled={pending} className="self-start">
        {t('createPostEvent')}
      </Button>
      <div aria-live="polite">{state.code ? <Alert title={message(state)} /> : null}</div>
    </form>
  );
}

/** Feedback for one program session: pick the session, then create. */
export function CreateSessionForm({
  action,
  sessions,
}: {
  action: Action;
  sessions: readonly { id: string; title: string }[];
}) {
  const t = useTranslations('surveys');
  const message = useMessage();
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const id = useId();
  const bad = state.fields?.includes('sessionId');
  return (
    <form action={formAction} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <input type="hidden" name="kind" value="session_feedback" />
      <div className="flex flex-1 flex-col gap-1.5">
        <label htmlFor={`${id}-session`} className="text-caption text-zinc-600">
          {t('session')}
        </label>
        <select
          id={`${id}-session`}
          name="sessionId"
          defaultValue=""
          aria-invalid={bad ? true : undefined}
          aria-describedby={bad ? `${id}-error` : undefined}
          className={`${field} ${bad ? 'border-pink-700' : 'border-zinc-200'}`}
        >
          <option value="">{t('chooseSession')}</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        {bad ? (
          <p id={`${id}-error`} className="text-caption text-pink-700">
            {t('errors.sessionRequired')}
          </p>
        ) : null}
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>
        {t('createSession')}
      </Button>
      {state.code && !bad ? (
        <div aria-live="polite" className="basis-full">
          <Alert title={message(state)} />
        </div>
      ) : null}
    </form>
  );
}

/** Title and introduction shown at the top of the survey page and in the email subject. */
export function SurveyDetailsForm({
  action,
  title,
  intro,
  disabled,
}: {
  action: Action;
  title: string;
  intro: string;
  disabled: boolean;
}) {
  const t = useTranslations('surveys');
  const message = useMessage();
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const id = useId();
  const bad = state.fields?.includes('title');
  return (
    <form
      onSubmit={keepValues(formAction)}
      noValidate
      aria-label={t('detailsTitle')}
      className="flex flex-col gap-3"
    >
      <Input
        id={`${id}-title`}
        name="title"
        defaultValue={title}
        maxLength={120}
        required
        disabled={disabled}
        label={t('titleLabel')}
        error={bad ? t('errors.titleRequired') : undefined}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-intro`} className="text-caption text-zinc-600">
          {t('intro')}
        </label>
        <textarea
          id={`${id}-intro`}
          name="intro"
          defaultValue={intro}
          maxLength={500}
          rows={2}
          disabled={disabled}
          className="rounded-card border border-zinc-200 bg-white px-4 py-2.5 text-body text-zinc-900"
        />
      </div>
      <div aria-live="polite">
        {state.ok ? <Alert tone="info" title={t('saved')} /> : null}
        {state.code && !bad ? <Alert title={message(state)} /> : null}
      </div>
      {disabled ? null : (
        <Button type="submit" variant="secondary" disabled={pending} className="self-start">
          {t('save')}
        </Button>
      )}
    </form>
  );
}

/** Add a question: the type decides whether options are asked for. */
export function AddSurveyQuestionForm({ action }: { action: Action }) {
  const t = useTranslations('surveys');
  const message = useMessage();
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [type, setType] = useState<string>('short_text');
  const ref = useRef<HTMLFormElement>(null);
  const id = useId();
  useEffect(() => {
    if (state.ok) {
      ref.current?.reset();
      setType('short_text');
    }
  }, [state]);
  const choice = type === 'select' || type === 'multi_select';
  const badLabel = state.fields?.includes('label');
  const badOptions = state.fields?.includes('options');
  return (
    <form
      ref={ref}
      onSubmit={keepValues(formAction)}
      noValidate
      aria-label={t('addTitle')}
      className="grid grid-cols-1 gap-4 md:grid-cols-2"
    >
      <Input
        id={`${id}-label`}
        name="label"
        maxLength={200}
        required
        label={t('label')}
        error={badLabel ? t('errors.labelRequired') : undefined}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-type`} className="text-caption text-zinc-600">
          {t('type')}
        </label>
        <select
          id={`${id}-type`}
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          className={`${field} border-zinc-200`}
        >
          {SURVEY_FIELD_TYPES.map((ft) => (
            <option key={ft} value={ft}>
              {t(`questionType.${ft}`)}
            </option>
          ))}
        </select>
      </div>
      {choice ? (
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <label htmlFor={`${id}-options`} className="text-caption text-zinc-600">
            {t('options')}
          </label>
          <textarea
            id={`${id}-options`}
            name="options"
            rows={3}
            maxLength={2000}
            aria-invalid={badOptions ? true : undefined}
            aria-describedby={`${id}-options-hint`}
            className={`rounded-card border bg-white px-4 py-2.5 text-body ${badOptions ? 'border-pink-700' : 'border-zinc-200'}`}
          />
          <p
            id={`${id}-options-hint`}
            className={badOptions ? 'text-caption text-pink-700' : 'text-caption text-zinc-500'}
          >
            {badOptions ? t('errors.optionsRequired') : t('optionsHint')}
          </p>
        </div>
      ) : null}
      <label className="flex min-h-6 items-center gap-2.5 text-body md:col-span-2">
        <input type="checkbox" name="required" value="1" className="size-5 accent-ink" />
        {t('requiredCheckbox')}
      </label>
      <div className="flex flex-col gap-2 md:col-span-2">
        <div aria-live="polite">
          {state.ok ? <Alert tone="info" title={t('added')} /> : null}
          {state.code && !badLabel && !badOptions ? <Alert title={message(state)} /> : null}
        </div>
        <Button type="submit" disabled={pending} className="self-start">
          {t('add')}
        </Button>
      </div>
    </form>
  );
}

/**
 * Send the survey. The Idempotency-Key is minted when the page renders, so a double submit (or a
 * retry after a network error) sends once; a new render mints the next one.
 */
export function SendSurveyForm({
  action,
  idempotencyKey,
}: {
  action: (prev: SendState, form: FormData) => Promise<SendState>;
  idempotencyKey: string;
}) {
  const t = useTranslations('surveys');
  const message = useMessage();
  const [state, formAction, pending] = useActionState(action, INITIAL as SendState);
  const id = useId();
  const badReminder = state.fields?.includes('reminderDays');
  const badLink = state.fields?.includes('linkDays');
  return (
    <form
      onSubmit={keepValues(formAction)}
      noValidate
      aria-label={t('sendTitle')}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="key" value={idempotencyKey} />
      <fieldset className="flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-caption text-zinc-600">{t('audience')}</legend>
        <label className="flex min-h-6 items-center gap-2.5 text-body">
          <input type="radio" name="audience" value="all" defaultChecked className="size-5 accent-ink" />
          {t('audienceAll')}
        </label>
        <label className="flex min-h-6 items-center gap-2.5 text-body">
          <input type="radio" name="audience" value="checked_in" className="size-5 accent-ink" />
          {t('audienceCheckedIn')}
        </label>
      </fieldset>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          id={`${id}-reminder`}
          name="reminderDays"
          type="number"
          inputMode="numeric"
          min={1}
          max={30}
          label={t('reminder')}
          hint={t('reminderHint')}
          error={badReminder ? t('errors.reminderRange') : undefined}
        />
        <Input
          id={`${id}-link`}
          name="linkDays"
          type="number"
          inputMode="numeric"
          min={1}
          max={90}
          defaultValue={30}
          label={t('linkDays')}
          error={badLink ? t('errors.linkDaysRange') : undefined}
        />
      </div>
      <div aria-live="polite">
        {state.ok && state.sent !== undefined ? (
          <Alert tone="info" title={t('sent', { count: state.sent })} />
        ) : null}
        {state.code && !badReminder && !badLink ? <Alert title={message(state)} /> : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('send')}
      </Button>
    </form>
  );
}

/** Close or reopen the survey. */
export function CloseSurveyForm({
  action,
  closed,
}: {
  action: (prev: FormState) => Promise<FormState>;
  closed: boolean;
}) {
  const t = useTranslations('surveys');
  const message = useMessage();
  const [state, formAction, pending] = useActionState(action, INITIAL);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {closed ? t('reopen') : t('close')}
      </Button>
      <div aria-live="polite">
        {state.ok ? <Alert tone="info" title={closed ? t('closedDone') : t('reopenedDone')} /> : null}
        {state.code ? <Alert title={message(state)} /> : null}
      </div>
    </form>
  );
}
