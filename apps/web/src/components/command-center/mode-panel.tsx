'use client';

import { EVENT_MODES, type EventMode } from '@yayatoh/command-center/client';
import { Button, Card, Label, Select, StatusPill } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useId } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

const DOT = { planning: 'neutral', pre_show: 'warning', live: 'success', wrap: 'info' } as const;
const PILL = { neutral: 'neutral', warning: 'waiting', success: 'success', info: 'info' } as const;

export interface ModeView {
  readonly mode: EventMode;
  readonly computed: EventMode;
  readonly override: EventMode | null;
  readonly nextChangeAt: string | null;
  readonly nextMode: EventMode | null;
  readonly settled: boolean;
  readonly wrapEndsAt: string;
}

/**
 * The event's mode (M3.2a): what it is, what comes next and when (in the event's time zone), and
 * for owners and staff who can edit the event a form to set it by hand or back to automatic.
 */
export function ModePanel({
  mode,
  timeZone,
  locale,
  canOverride,
  action,
}: {
  mode: ModeView;
  timeZone: string;
  locale: string;
  canOverride: boolean;
  action: (prev: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations('commandCenter');
  const te = useTranslations();
  const [state, submit, pending] = useActionState(action, INITIAL_FORM_STATE);
  const id = useId();
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  const next = mode.override
    ? t('override.manualNote', { mode: t(`mode.${mode.computed}`) })
    : mode.settled
      ? t('next.settled')
      : mode.nextChangeAt && mode.nextMode
        ? t(`next.${mode.nextMode}`, { time: when(mode.nextChangeAt) })
        : mode.nextChangeAt
          ? t('next.none', { time: when(mode.nextChangeAt) })
          : null;
  return (
    <Card
      className="flex flex-wrap items-end justify-between gap-4"
      data-next-change={mode.nextChangeAt ?? ''}
    >
      <div className="flex flex-col gap-1.5">
        <Label>{t('mode.label')}</Label>
        <p className="flex items-center gap-2" data-testid="cc-mode">
          <StatusPill
            tone={PILL[DOT[mode.mode]]}
            label={t(`mode.${mode.mode}`)}
            live={mode.mode === 'live'}
            className="px-3 py-1.5 text-body"
          />
        </p>
        {next ? <p className="text-caption text-ink-2">{next}</p> : null}
        <p className="text-caption text-ink-2">{t('override.autoNote', { timeZone })}</p>
      </div>
      {canOverride ? (
        <form action={submit} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={id} className="text-[13px] font-bold text-ink">
              {t('override.label')}
            </label>
            <Select id={id} name="mode" defaultValue={mode.override ?? 'auto'} className="field">
              <option value="auto">{t('override.automatic', { mode: t(`mode.${mode.computed}`) })}</option>
              {EVENT_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(`mode.${m}`)}
                </option>
              ))}
            </Select>
          </div>
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
      ) : null}
    </Card>
  );
}
