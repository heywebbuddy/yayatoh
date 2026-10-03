'use client';

import { Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useId, useState } from 'react';
import type { DayOfState } from '@/app/[locale]/o/[org]/e/[event]/day-of/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

type Action = (prev: DayOfState, form: FormData) => Promise<DayOfState>;
const IDLE: DayOfState = { ok: false, code: null };

/**
 * One button that runs a day-of action (check in, undo, stop a kiosk) and says what happened
 * next to it, politely, so keyboard and screen reader users hear the result.
 */
export function DayOfActionButton({
  action,
  label,
  ariaLabel,
  done,
  variant = 'secondary',
}: {
  action: Action;
  label: string;
  ariaLabel?: string;
  done: string;
  variant?: 'primary' | 'secondary';
}) {
  const tr = useTranslations();
  const [state, formAction, pending] = useActionState(action, IDLE);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <Button type="submit" variant={variant} disabled={pending} aria-label={ariaLabel} className="min-h-11">
        {label}
      </Button>
      <span role="status" className="text-caption">
        {state.ok ? <span className="text-success">{done}</span> : null}
        {!state.ok && state.code ? (
          <span className="text-danger">{tr(errorMessageKey(state.code))}</span>
        ) : null}
      </span>
    </form>
  );
}

/** Make a device the guest kiosk or the A–Z board: what it shows and the staff PIN to leave it. */
export function KioskStartForm({ action, device }: { action: Action; device: string }) {
  const t = useTranslations('dayOf');
  const tr = useTranslations();
  const id = useId();
  const [state, formAction, pending] = useActionState(action, IDLE);
  const [clientError, setClientError] = useState(false);
  const pinError = clientError || (!state.ok && state.field === 'pin');
  return (
    <form
      action={formAction}
      noValidate
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        const pin = String(new FormData(e.currentTarget).get('pin') ?? '').trim();
        const bad = !/^\d{4,8}$/.test(pin);
        setClientError(bad);
        if (bad) e.preventDefault();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-kind`} className="text-[13px] font-bold text-ink">
          {t('kioskKind', { device })}
        </label>
        <select id={`${id}-kind`} name="kind" defaultValue="guests" className="field">
          <option value="guests">{t('kindGuests')}</option>
          <option value="board">{t('kindBoard')}</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-pin`} className="text-[13px] font-bold text-ink">
          {t('kioskPin', { device })}
        </label>
        <input
          id={`${id}-pin`}
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={pinError ? true : undefined}
          aria-describedby={`${id}-pin-msg`}
          className="field w-40"
        />
        <p id={`${id}-pin-msg`} className={pinError ? 'text-caption text-danger' : 'text-caption text-ink-2'}>
          {pinError ? t('pinInvalid') : t('pinHint')}
        </p>
      </div>
      <Button type="submit" disabled={pending}>
        {t('kioskStart')}
      </Button>
      <span role="status" className="basis-full text-caption">
        {state.ok ? <span className="text-success">{t('kioskStarted', { device })}</span> : null}
        {!state.ok && state.code && state.field !== 'pin' ? (
          <span className="text-danger">{tr(errorMessageKey(state.code))}</span>
        ) : null}
      </span>
    </form>
  );
}
