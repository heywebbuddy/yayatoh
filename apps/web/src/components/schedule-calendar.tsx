'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';

/** What "Update now" and "Stop syncing" return (M6.5c personal calendar push). */
export interface CalendarActionState {
  readonly ok: boolean;
  readonly code: string | null;
  /** `queued` / `already` (update now) or `stopped`. */
  readonly done?: 'queued' | 'already' | 'stopped';
  readonly stamp?: number;
}

const INITIAL: CalendarActionState = { ok: false, code: null };

type Action = (prev: CalendarActionState, form: FormData) => Promise<CalendarActionState>;

/**
 * The connected state's two actions on "My schedule": update now, and stop syncing (entries
 * already in their calendar stay). Feedback is announced politely and stays after the page
 * refreshes. Buttons are 48 px (phone-first).
 */
export function CalendarControls({ action, syncing }: { action: Action; syncing: boolean }) {
  const t = useTranslations('mySchedule.calendar');
  const te = useTranslations();
  const [result, formAction, pending] = useActionState(action, INITIAL);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="lg" name="intent" value="sync" disabled={pending || syncing}>
          {syncing ? t('syncing') : t('syncNow')}
        </Button>
        <Button type="submit" size="lg" variant="secondary" name="intent" value="stop" disabled={pending}>
          {t('stop')}
        </Button>
      </div>
      <div aria-live="polite" className="flex flex-col gap-3">
        {result.ok && result.done ? (
          <Alert tone={result.done === 'stopped' ? 'info' : 'success'} title={t(`done.${result.done}`)} />
        ) : null}
        {!result.ok && result.code ? <Alert title={te(errorMessageKey(result.code))} /> : null}
      </div>
    </form>
  );
}
