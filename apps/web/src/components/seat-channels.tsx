'use client';

import { CHANNEL_KINDS } from '@yayatoh/seating/client';
import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, startTransition, useActionState, useEffect, useId, useRef } from 'react';
import type {
  AllotState,
  ChannelFormState,
  RestoreState,
} from '@/app/[locale]/o/[org]/e/[event]/seating/channel-actions.ts';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';

const field = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';
const fieldError = 'text-caption font-medium text-pink-700';

/** Submit without React's form reset, so a refused value stays as typed. */
function useSubmit(formAction: (data: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };
}

/**
 * A sales channel (M6.11b): its kind, name, code (sponsors and promoters) and the time its unsold
 * seats go back to every channel. Every refusal is shown at its field.
 */
export function ChannelForm({
  action,
  initial = null,
  timeZone,
  cancelHref = null,
}: {
  action: (prev: ChannelFormState, form: FormData) => Promise<ChannelFormState>;
  /** Editing: the channel's values (`releaseAt` as wall-clock `YYYY-MM-DDTHH:mm` in the event's zone). */
  initial?: { kind: string; name: string; code: string | null; releaseAt: string } | null;
  timeZone: string;
  cancelHref?: string | null;
}) {
  const t = useTranslations('seating.channels');
  const te = useTranslations();
  const id = useId();
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null });
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);
  const message = (f: NonNullable<ChannelFormState['field']>) =>
    state.field !== f
      ? null
      : f === 'code'
        ? t(
            `errors.${state.reason === 'code_required' || state.reason === 'code_not_allowed' || state.reason === 'code_taken' ? state.reason : 'code_format'}`,
          )
        : f === 'kind'
          ? t(state.reason === 'kind_taken' ? 'errors.kind_taken' : 'errors.kind')
          : t(`errors.${f}`);
  const input = (f: NonNullable<ChannelFormState['field']>) => ({
    id: `${id}-${f}`,
    'aria-invalid': state.field === f || undefined,
    'aria-describedby': state.field === f ? `${id}-${f}-error` : `${id}-${f}-hint`,
  });
  const err = (f: NonNullable<ChannelFormState['field']>) =>
    state.field === f ? (
      <p id={`${id}-${f}-error`} className={fieldError}>
        {message(f)}
      </p>
    ) : null;
  return (
    <form ref={form} onSubmit={useSubmit(formAction)} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-kind`} className="text-caption text-zinc-600">
            {t('kindLabel')}
          </label>
          <select name="kind" defaultValue={initial?.kind ?? 'promoter'} className={field} {...input('kind')}>
            {CHANNEL_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kind.${k}`)}
              </option>
            ))}
          </select>
          <p id={`${id}-kind-hint`} className="text-caption text-zinc-500">
            {t('kindHint')}
          </p>
          {err('kind')}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-name`} className="text-caption text-zinc-600">
            {t('nameLabel')}
          </label>
          <input
            name="name"
            required
            maxLength={80}
            defaultValue={initial?.name ?? ''}
            className={field}
            {...input('name')}
          />
          <p id={`${id}-name-hint`} className="text-caption text-zinc-500">
            {t('nameHint')}
          </p>
          {err('name')}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-code`} className="text-caption text-zinc-600">
            {t('codeLabel')}
          </label>
          <input
            name="code"
            maxLength={40}
            autoCapitalize="characters"
            spellCheck={false}
            defaultValue={initial?.code ?? ''}
            className={field}
            {...input('code')}
          />
          <p id={`${id}-code-hint`} className="text-caption text-zinc-500">
            {t('codeHint')}
          </p>
          {err('code')}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-releaseAt`} className="text-caption text-zinc-600">
            {t('releaseLabel')}
          </label>
          <input
            name="releaseAt"
            type="datetime-local"
            defaultValue={initial?.releaseAt ?? ''}
            className={field}
            {...input('releaseAt')}
          />
          <p id={`${id}-releaseAt-hint`} className="text-caption text-zinc-500">
            {t('releaseHint', { timeZone })}
          </p>
          {err('releaseAt')}
        </div>
      </div>
      <div aria-live="polite">
        {state.ok ? <Alert tone="info" title={t('added')} /> : null}
        {state.field ? <Alert title={t('fixErrors')} /> : null}
        {state.code && !state.field ? <Alert title={te(errorMessageKey(state.code))} /> : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {initial ? t('save') : t('add')}
        </Button>
        {cancelHref ? (
          <Link
            href={cancelHref}
            className="inline-flex min-h-10 items-center text-body underline underline-offset-2"
          >
            {t('cancel')}
          </Link>
        ) : null}
      </div>
    </form>
  );
}

export interface AllotItem {
  readonly id: string;
  readonly kind: 'row' | 'table';
  readonly label: string;
  readonly seats: number;
  /** Seats of it in each channel, by channel name. */
  readonly allotted: readonly { readonly name: string; readonly count: number }[];
}

/**
 * Allot seats (M6.11b), the keyboard-first alternative to picking on the map: a channel (or back
 * to every channel), rows and tables by checkbox, and optionally only some seat numbers of them.
 */
export function AllotForm({
  channels,
  items,
  action,
}: {
  channels: readonly { readonly id: string; readonly name: string }[];
  items: readonly AllotItem[];
  action: (prev: AllotState, form: FormData) => Promise<AllotState>;
}) {
  const t = useTranslations('seating.channels');
  const te = useTranslations();
  const id = useId();
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null });
  return (
    <form onSubmit={useSubmit(formAction)} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-channel`} className="text-caption text-zinc-600">
          {t('allotTo')}
        </label>
        <select
          id={`${id}-channel`}
          name="channelId"
          defaultValue={channels[0]?.id ?? ''}
          aria-invalid={state.field === 'channel' || undefined}
          className={`${field} md:max-w-sm`}
        >
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="">{t('everyChannel')}</option>
        </select>
      </div>
      <fieldset
        className="flex flex-col gap-1.5"
        aria-invalid={state.field === 'seats' || undefined}
        aria-describedby={state.field === 'seats' ? `${id}-seats-error` : undefined}
      >
        <legend className="mb-1.5 text-caption text-zinc-600">{t('which')}</legend>
        <div className="grid gap-x-5 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((i) => (
            <label key={i.id} className="flex min-h-6 items-start gap-2 text-body">
              <input type="checkbox" name="itemId" value={i.id} className="mt-0.5 size-5 shrink-0" />
              <span>
                {t(`item.${i.kind}`, { label: i.label, seats: i.seats })}
                {i.allotted.length ? (
                  <span className="block text-caption text-zinc-600">
                    {i.allotted.map((a) => t('itemAllotted', { count: a.count, name: a.name })).join(' · ')}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-numbers`} className="text-caption text-zinc-600">
          {t('seatNumbers')}
        </label>
        <input
          id={`${id}-numbers`}
          name="seatNumbers"
          maxLength={400}
          aria-describedby={`${id}-numbers-hint`}
          className={`${field} md:max-w-sm`}
        />
        <p id={`${id}-numbers-hint`} className="text-caption text-zinc-500">
          {t('seatNumbersHint')}
        </p>
      </div>
      <div aria-live="polite">
        {state.ok ? (
          <Alert
            tone="info"
            title={
              state.freed
                ? t('freed', { count: state.count ?? 0 })
                : t('allotted', { count: state.count ?? 0 })
            }
          />
        ) : null}
        {state.field === 'seats' ? (
          <p id={`${id}-seats-error`} className={fieldError}>
            {t('errors.seats')}
          </p>
        ) : null}
        {state.code && state.field !== 'seats' ? <Alert title={te(errorMessageKey(state.code))} /> : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('allot')}
      </Button>
    </form>
  );
}

/** Restore a layout revision (M6.11b); a refusal says why (held or sold seats in the way). */
export function RestoreForm({
  number,
  action,
}: {
  number: number;
  action: (prev: RestoreState, form: FormData) => Promise<RestoreState>;
}) {
  const t = useTranslations('seating.revisions');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null });
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div aria-live="polite">
        {state.code ? (
          <Alert
            title={
              state.reason === 'restore_conflicts' ? t('conflictsRefused') : te(errorMessageKey(state.code))
            }
          />
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('restore', { number })}
      </Button>
    </form>
  );
}
