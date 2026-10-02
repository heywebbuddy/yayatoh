'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, startTransition, useActionState, useId, useState } from 'react';
import type { LibraryState, StartEventState } from '@/app/[locale]/o/[org]/(org)/seating-library/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

const field = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';
const fieldError = 'text-caption font-medium text-pink-700';
type Field = NonNullable<StartEventState['field']>;

/**
 * Start a new event from a saved plan (M6.11b): which plan, the event's name, kind, time zone and
 * times. One submit creates the event with its own copy of the plan (idempotent per form).
 */
export function StartEventForm({
  layouts,
  profiles,
  zones,
  defaults,
  action,
}: {
  layouts: readonly { readonly id: string; readonly name: string; readonly seatCount: number }[];
  profiles: readonly string[];
  zones: readonly string[];
  defaults: { layoutId: string; profile: string; timezone: string };
  action: (prev: StartEventState, form: FormData) => Promise<StartEventState>;
}) {
  const t = useTranslations('seatingLibrary');
  const tr = useTranslations();
  const id = useId();
  const [state, formAction, pending] = useActionState(action, { code: null });
  const [requestKey] = useState(() => `library-event:${crypto.randomUUID()}`);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };
  const bad = (f: Field) => state.field === f || (f === 'name' && state.field === 'slug');
  const attrs = (f: Field) => ({
    id: `${id}-${f}`,
    name: f,
    'aria-invalid': bad(f) || undefined,
    'aria-describedby': bad(f) ? `${id}-${f}-error` : undefined,
  });
  const err = (f: Field) =>
    bad(f) ? (
      <p id={`${id}-${f}-error`} className={fieldError}>
        {t(`errors.${state.field === 'slug' ? 'slug' : f}`)}
      </p>
    ) : null;
  const label = (f: Field, text: string) => (
    <label htmlFor={`${id}-${f}`} className="text-caption text-zinc-600">
      {text}
    </label>
  );
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="requestKey" value={requestKey} />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5 md:col-span-2">
          {label('layoutId', t('layout'))}
          <select defaultValue={defaults.layoutId} className={field} {...attrs('layoutId')}>
            {layouts.map((l) => (
              <option key={l.id} value={l.id}>
                {t('layoutOption', { name: l.name, seats: l.seatCount })}
              </option>
            ))}
          </select>
          {err('layoutId')}
        </div>
        <div className="flex flex-col gap-1.5">
          {label('name', t('eventName'))}
          <input required minLength={2} maxLength={160} className={field} {...attrs('name')} />
          {err('name')}
        </div>
        <div className="flex flex-col gap-1.5">
          {label('profile', t('profile'))}
          <select defaultValue={defaults.profile} className={field} {...attrs('profile')}>
            {profiles.map((p) => (
              <option key={p} value={p}>
                {tr(`profiles.${p}`)}
              </option>
            ))}
          </select>
          {err('profile')}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-timezone`} className="text-caption text-zinc-600">
            {t('timezone')}
          </label>
          <select id={`${id}-timezone`} name="timezone" defaultValue={defaults.timezone} className={field}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
        <div className="hidden md:block" />
        <div className="flex flex-col gap-1.5">
          {label('startsAt', t('startsAt'))}
          <input type="datetime-local" required className={field} {...attrs('startsAt')} />
          {err('startsAt')}
        </div>
        <div className="flex flex-col gap-1.5">
          {label('endsAt', t('endsAt'))}
          <input type="datetime-local" required className={field} {...attrs('endsAt')} />
          {err('endsAt')}
        </div>
      </div>
      <div aria-live="polite">
        {state.field ? <Alert title={t('fixErrors')} /> : null}
        {state.code && !state.field ? <Alert title={tr(errorMessageKey(state.code))} /> : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('start')}
      </Button>
    </form>
  );
}

/** Rename a plan of the library (M6.11b). */
export function RenameLayoutForm({
  name,
  action,
}: {
  name: string;
  action: (prev: LibraryState, form: FormData) => Promise<LibraryState>;
}) {
  const t = useTranslations('seatingLibrary');
  const tr = useTranslations();
  const id = useId();
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null });
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-name`} className="text-caption text-zinc-600">
          {t('renameLabel', { name })}
        </label>
        <input
          id={`${id}-name`}
          name="name"
          required
          maxLength={120}
          defaultValue={name}
          aria-invalid={state.code === 'validation_failed' || undefined}
          aria-describedby={state.code === 'validation_failed' ? `${id}-error` : undefined}
          className={`${field} w-56`}
        />
      </div>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {t('rename')}
      </Button>
      <div aria-live="polite" className="w-full">
        {state.ok ? <p className="text-caption text-zinc-700">{t('renamed')}</p> : null}
        {state.code === 'validation_failed' ? (
          <p id={`${id}-error`} className={fieldError}>
            {t('errors.layoutName')}
          </p>
        ) : state.code ? (
          <p className={fieldError}>{tr(errorMessageKey(state.code))}</p>
        ) : null}
      </div>
    </form>
  );
}
