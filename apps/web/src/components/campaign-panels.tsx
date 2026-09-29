'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useId, useState } from 'react';
import type { CampaignFormState } from '@/app/[locale]/o/[org]/(org)/campaigns/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

type Action = (prev: CampaignFormState, form: FormData) => Promise<CampaignFormState>;
const INITIAL: CampaignFormState = { ok: false, code: null };
const FIELD = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';

/** The outcome of a form: success in a live region, a failure as an alert with its reason. */
function Outcome({ state, success }: { state: CampaignFormState; success?: string | null }) {
  const t = useTranslations('campaigns');
  const tr = useTranslations();
  const known = new Set([
    'no_recipients',
    'no_audience',
    'content_invalid',
    'messaging_paused',
    'test_limit',
    'test_email_only',
    'audience_missing',
    'audience_too_large',
    'not_draft',
    'sms_body_required',
    'in_past',
    'too_far',
  ]);
  return (
    <>
      <div role="status" aria-live="polite">
        {state.ok && success ? <p className="text-body font-medium">{success}</p> : null}
      </div>
      {!state.ok && state.code && state.code !== 'validation_failed' ? (
        <Alert
          title={
            state.reason && known.has(state.reason)
              ? t(`errors.${state.reason}`)
              : tr(errorMessageKey(state.code))
          }
        />
      ) : null}
    </>
  );
}

export interface PanelSegment {
  readonly id: string;
  readonly name: string;
}
export interface PanelEvent {
  readonly id: string;
  readonly name: string;
  readonly date: string;
}

export function AudiencePanel({
  action,
  segments,
  events,
  current,
}: {
  action: Action;
  segments: readonly PanelSegment[];
  events: readonly PanelEvent[];
  current:
    | { kind: 'segment'; segmentId: string }
    | { kind: 'template'; templateKey: string; eventId: string }
    | null;
}) {
  const t = useTranslations('campaigns');
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [kind, setKind] = useState<'segment' | 'template'>(
    current?.kind ?? (segments.length ? 'segment' : 'template'),
  );
  const errors = state.errors ?? {};
  const uid = useId();
  return (
    <form action={formAction} className="flex flex-col gap-3" aria-label={t('audienceTitle')} noValidate>
      <Outcome state={state} success={state.message === 'audienceSaved' ? t('audienceSaved') : null} />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-caption text-zinc-600">{t('audienceKind')}</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {(['segment', 'template'] as const).map((k) => (
            <label key={k} className="flex min-h-6 items-center gap-2 text-body">
              <input
                type="radio"
                name="kind"
                value={k}
                checked={kind === k}
                onChange={() => setKind(k)}
                className="size-5 accent-zinc-900"
              />
              {t(`audienceKinds.${k}`)}
            </label>
          ))}
        </div>
      </fieldset>
      {kind === 'segment' ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-segment`} className="text-caption text-zinc-600">
            {t('savedAudience')}
          </label>
          <select
            id={`${uid}-segment`}
            name="segmentId"
            defaultValue={current?.kind === 'segment' ? current.segmentId : ''}
            aria-invalid={errors.segmentId ? true : undefined}
            aria-describedby={errors.segmentId ? `${uid}-segment-error` : undefined}
            className={FIELD}
          >
            <option value="">{t('choose')}</option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {errors.segmentId ? (
            <p id={`${uid}-segment-error`} className="text-caption text-pink-700">
              {t('errors.chooseAudience')}
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-template`} className="text-caption text-zinc-600">
              {t('template')}
            </label>
            <select
              id={`${uid}-template`}
              name="templateKey"
              defaultValue={current?.kind === 'template' ? current.templateKey : 'registeredNotCheckedIn'}
              className={FIELD}
            >
              {(['registeredNotCheckedIn', 'lastYearNotThisYear'] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`templates.${k}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-event`} className="text-caption text-zinc-600">
              {t('templateEvent')}
            </label>
            <select
              id={`${uid}-event`}
              name="eventId"
              defaultValue={current?.kind === 'template' ? current.eventId : ''}
              aria-invalid={errors.eventId ? true : undefined}
              aria-describedby={errors.eventId ? `${uid}-event-error` : undefined}
              className={FIELD}
            >
              <option value="">{t('choose')}</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {e.date}
                </option>
              ))}
            </select>
            {errors.eventId ? (
              <p id={`${uid}-event-error`} className="text-caption text-pink-700">
                {t('errors.chooseEvent')}
              </p>
            ) : null}
          </div>
        </>
      )}
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {t('saveAudience')}
      </Button>
    </form>
  );
}

export function TestSendPanel({ action }: { action: Action }) {
  const t = useTranslations('campaigns');
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const err = state.errors?.addresses;
  return (
    <form action={formAction} className="flex flex-col gap-3" aria-label={t('testTitle')} noValidate>
      <Outcome
        state={state}
        success={state.message === 'testSent' ? t('testSent', { count: state.count ?? 0 }) : null}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="test-addresses" className="text-caption text-zinc-600">
          {t('testAddresses')}
        </label>
        <textarea
          id="test-addresses"
          name="addresses"
          rows={2}
          aria-invalid={err ? true : undefined}
          aria-describedby={`test-addresses-hint${err ? ' test-addresses-error' : ''}`}
          className="rounded-card border border-zinc-200 bg-white px-4 py-3 text-body"
        />
        <p id="test-addresses-hint" className="text-caption text-zinc-500">
          {t('testHint')}
        </p>
        {err ? (
          <p id="test-addresses-error" className="text-caption text-pink-700">
            {t(`errors.test_${err}`)}
          </p>
        ) : null}
      </div>
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {t('sendTest')}
      </Button>
    </form>
  );
}

export function SendPanel({
  schedule,
  sendNow,
  timeZone,
  eligible,
}: {
  schedule: Action;
  sendNow: Action;
  timeZone: string;
  eligible: number | null;
}) {
  const t = useTranslations('campaigns');
  const [sState, scheduleAction, scheduling] = useActionState(schedule, INITIAL);
  const [nState, sendAction, sending] = useActionState(sendNow, INITIAL);
  const [confirming, setConfirming] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const atErr = sState.errors?.at;
  return (
    <div className="flex flex-col gap-6">
      <form
        action={scheduleAction}
        className="flex flex-col gap-3"
        aria-label={t('scheduleTitle')}
        noValidate
      >
        <Outcome state={sState} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="schedule-at" className="text-caption text-zinc-600">
            {t('scheduleAt')}
          </label>
          <input
            id="schedule-at"
            name="at"
            type="datetime-local"
            aria-invalid={atErr ? true : undefined}
            aria-describedby={`schedule-at-hint${atErr ? ' schedule-at-error' : ''}`}
            className={FIELD}
          />
          <p id="schedule-at-hint" className="text-caption text-zinc-500">
            {t('scheduleHint', { timeZone })}
          </p>
          {atErr ? (
            <p id="schedule-at-error" className="text-caption text-pink-700">
              {t(`errors.at_${atErr}`)}
            </p>
          ) : null}
        </div>
        <Button type="submit" variant="secondary" disabled={scheduling} className="self-start">
          {t('schedule')}
        </Button>
      </form>
      <form action={sendAction} className="flex flex-col gap-3" aria-label={t('sendNowTitle')}>
        <Outcome state={nState} />
        <input type="hidden" name="key" value={key} />
        {confirming ? (
          <>
            <p className="text-body font-medium" role="status">
              {t('confirmSend', { count: eligible ?? 0 })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={sending}>
                {t('confirmSendButton')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                {t('back')}
              </Button>
            </div>
          </>
        ) : (
          <Button type="button" onClick={() => setConfirming(true)} className="self-start">
            {t('sendNow')}
          </Button>
        )}
      </form>
    </div>
  );
}

/** Unschedule, pause, resume and cancel (the ones the campaign's state allows). */
export function LifecyclePanel({
  action,
  ops,
}: {
  action: Action;
  ops: readonly ('unschedule' | 'pause' | 'resume' | 'cancel')[];
}) {
  const t = useTranslations('campaigns');
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [confirmCancel, setConfirmCancel] = useState(false);
  return (
    <form action={formAction} className="flex flex-col gap-3" aria-label={t('controlsTitle')}>
      <Outcome state={state} success={state.ok && state.message ? t(`done.${state.message}`) : null} />
      <div className="flex flex-wrap gap-2">
        {ops
          .filter((op) => op !== 'cancel')
          .map((op) => (
            <Button key={op} type="submit" name="op" value={op} variant="secondary" disabled={pending}>
              {t(`ops.${op}`)}
            </Button>
          ))}
        {ops.includes('cancel') ? (
          confirmCancel ? (
            <>
              <Button type="submit" name="op" value="cancel" disabled={pending}>
                {t('confirmCancel')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setConfirmCancel(false)}>
                {t('back')}
              </Button>
            </>
          ) : (
            <Button type="button" variant="secondary" onClick={() => setConfirmCancel(true)}>
              {t('ops.cancel')}
            </Button>
          )
        ) : null}
      </div>
    </form>
  );
}

export function NewCampaignForm({ action }: { action: Action }) {
  const t = useTranslations('campaigns');
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const nameErr = state.errors?.name;
  return (
    <form
      action={formAction}
      className="flex flex-wrap items-end gap-3"
      aria-label={t('newTitle')}
      noValidate
    >
      <Outcome state={state} />
      <div className="flex min-w-60 flex-col gap-1.5">
        <label htmlFor="new-campaign-name" className="text-caption text-zinc-600">
          {t('name')}
        </label>
        <input
          id="new-campaign-name"
          name="name"
          maxLength={120}
          aria-invalid={nameErr ? true : undefined}
          aria-describedby={nameErr ? 'new-campaign-name-error' : undefined}
          className={FIELD}
        />
        {nameErr ? (
          <p id="new-campaign-name-error" className="text-caption text-pink-700">
            {t(nameErr === 'conflict' ? 'errors.name_taken' : 'errors.required')}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="new-campaign-channel" className="text-caption text-zinc-600">
          {t('channel')}
        </label>
        <select id="new-campaign-channel" name="channel" defaultValue="email" className={FIELD}>
          {(['email', 'sms', 'whatsapp'] as const).map((c) => (
            <option key={c} value={c}>
              {t(`channels.${c}`)}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={pending}>
        {t('create')}
      </Button>
    </form>
  );
}
