'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { AlertActionState } from '@/app/[locale]/o/[org]/(org)/alerts/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

type Act = (prev: AlertActionState, form: FormData) => Promise<AlertActionState>;

const SNOOZE = [60, 240, 1440] as const;

/**
 * Acknowledge or snooze one alert (M3.2b). Plain forms (keyboard: Tab to a control, Enter or
 * Space to submit); the outcome is announced politely and stays after the list re-renders (the
 * page keys this by the alert, and the controls follow the alert's new state).
 */
export function AlertActions({
  alertId,
  title,
  canAcknowledge,
  canSnooze,
  timeZone,
  action,
}: {
  alertId: string;
  /** The alert's text, for the buttons' accessible names. */
  title: string;
  canAcknowledge: boolean;
  canSnooze: boolean;
  timeZone: string;
  action: Act;
}) {
  const t = useTranslations('alerts');
  const te = useTranslations();
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(action, { kind: 'idle' });
  const until = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
      new Date(iso),
    );
  return (
    <div className="flex flex-col gap-2">
      {canAcknowledge || canSnooze ? (
        <div className="flex flex-wrap items-end gap-2">
          {canAcknowledge ? (
            <form action={formAction}>
              <input type="hidden" name="op" value="acknowledge" />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={pending}
                aria-label={t('acknowledgeLabel', { title })}
              >
                {t('acknowledge')}
              </Button>
            </form>
          ) : null}
          {canSnooze ? (
            <form action={formAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="op" value="snooze" />
              <div className="flex flex-col gap-1">
                <label htmlFor={`snooze-${alertId}`} className="text-caption text-zinc-600">
                  {t('snoozeLabel')}
                </label>
                <select
                  id={`snooze-${alertId}`}
                  name="minutes"
                  defaultValue="60"
                  className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
                >
                  {SNOOZE.map((m) => (
                    <option key={m} value={m}>
                      {t(`snoozeFor.m${m}`)}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                disabled={pending}
                aria-label={t('snoozeButtonLabel', { title })}
              >
                {t('snooze')}
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
      <div aria-live="polite">
        {state.kind === 'acknowledged' ? <Alert tone="info" title={t('done.acknowledged')} /> : null}
        {state.kind === 'snoozed' ? (
          <Alert tone="info" title={t('done.snoozed', { until: until(state.until) })} />
        ) : null}
        {state.kind === 'error' ? (
          <Alert
            title={
              state.code === 'forbidden'
                ? t('errors.forbidden')
                : state.code === 'conflict' || state.code === 'invalid_state'
                  ? t('errors.conflict')
                  : state.code === 'not_found'
                    ? t('errors.notFound')
                    : state.code === 'validation_failed'
                      ? t('errors.invalid')
                      : te(errorMessageKey(state.code))
            }
          />
        ) : null}
      </div>
    </div>
  );
}
