'use client';

import { EVENT_MODES, type EventMode } from '@yayatoh/command-center/client';
import { Button, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

export interface ModeView {
  readonly mode: EventMode;
  readonly computed: EventMode;
  readonly override: EventMode | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly nextChangeAt: string | null;
  readonly nextMode: EventMode | null;
  readonly settled: boolean;
  readonly wrapEndsAt: string;
}

/** What comes next and when (in the event's time zone), or the manual note (M3.2a). */
export function useModeNote(mode: ModeView, timeZone: string, locale: string): string | null {
  const t = useTranslations('commandCenter');
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  return mode.override
    ? t('override.manualNote', { mode: t(`mode.${mode.computed}`) })
    : mode.settled
      ? t('next.settled')
      : mode.nextChangeAt && mode.nextMode
        ? t(`next.${mode.nextMode}`, { time: when(mode.nextChangeAt) })
        : mode.nextChangeAt
          ? t('next.none', { time: when(mode.nextChangeAt) })
          : null;
}

/**
 * Set the event's mode by hand or back to automatic (M3.2a), for owners and staff who can edit
 * the event. U4: it sits in the hero strip, with the design-system select (U1).
 */
export function ModeOverrideForm({
  mode,
  action,
}: {
  mode: ModeView;
  action: (prev: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations('commandCenter');
  const te = useTranslations();
  const [state, submit, pending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <form action={submit} className="flex flex-wrap items-end gap-2">
      <Select
        id="cc-mode-override"
        name="mode"
        label={t('override.label')}
        defaultValue={mode.override ?? 'auto'}
        wrapperClassName="min-w-48"
      >
        <option value="auto">{t('override.automatic', { mode: t(`mode.${mode.computed}`) })}</option>
        {EVENT_MODES.map((m) => (
          <option key={m} value={m}>
            {t(`mode.${m}`)}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="secondary" disabled={pending}>
        {t('override.submit')}
      </Button>
      <p role="status" className="basis-full text-caption text-ink-2">
        {state.ok ? t('override.saved') : null}
      </p>
      {state.code ? (
        <p role="alert" className="basis-full text-caption text-danger">
          {te(errorMessageKey(state.code))}
        </p>
      ) : null}
    </form>
  );
}
