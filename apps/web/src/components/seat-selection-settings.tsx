'use client';

import type { SelectionPageDto } from '@yayatoh/seating';
import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, startTransition, useActionState, useState } from 'react';
import type { SelectionState } from '@/app/[locale]/o/[org]/e/[event]/seating/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

const field = 'min-h-10 w-24 rounded-pill border border-line bg-surface-solid px-4 text-body';

/**
 * Best available (M6.11a): offer it to buyers and the box office, and score sections (higher
 * first; blank = by distance to the stage). A refused score is marked and explained.
 */
export function BestAvailableSettingsForm({
  settings,
  sections,
  action,
}: {
  settings: SelectionPageDto['settings'];
  sections: SelectionPageDto['sections'];
  action: (prev: SelectionState, form: FormData) => Promise<SelectionState>;
}) {
  const t = useTranslations('seating.selection');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null });
  // Keep what was typed when the server refuses a value.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <label className="flex min-h-6 items-center gap-2 text-body">
          <input
            type="checkbox"
            name="bestAvailable"
            defaultChecked={settings.bestAvailable}
            aria-describedby="best-on-hint"
            className="size-5"
          />
          {t('bestOn')}
        </label>
        <p id="best-on-hint" className="ps-7 text-caption text-ink-2">
          {t('bestHint')}
        </p>
      </div>
      {sections.length ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-body font-medium">{t('scoresTitle')}</legend>
          <p className="text-caption text-ink-2">{t('scoresHint')}</p>
          {sections.map((s) => {
            const name = `score:${s.id}`;
            const bad = state.field === name;
            return (
              <div key={s.id} className="flex flex-col gap-1.5">
                <label htmlFor={`score-${s.id}`} className="text-caption text-ink-2">
                  {t('scoreLabel', { section: s.label })}
                </label>
                <input
                  id={`score-${s.id}`}
                  name={name}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  defaultValue={settings.sectionScores[s.id] ?? ''}
                  aria-invalid={bad || undefined}
                  aria-describedby={bad ? `score-${s.id}-error` : undefined}
                  className={field}
                />
                {bad ? (
                  <p id={`score-${s.id}-error`} className="text-caption font-medium text-danger">
                    {t('scoreError')}
                  </p>
                ) : null}
              </div>
            );
          })}
        </fieldset>
      ) : (
        <p className="text-caption text-ink-2">{t('noSections')}</p>
      )}
      <div aria-live="polite">
        {state.ok ? <Alert tone="info" title={t('savedBest')} /> : null}
        {state.field ? <Alert title={t('fixErrors')} /> : null}
        {state.code && !state.field ? (
          <Alert title={state.code === 'forbidden' ? t('readOnly') : te(errorMessageKey(state.code))} />
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('saveBest')}
      </Button>
    </form>
  );
}

/**
 * Companion seats (M6.11a): in every row or table with an accessible seat, tick the seats kept
 * for the people who come with a wheelchair user. "Tick the seats next to accessible seats" fills
 * in the engine's suggestion; nothing is saved until the organizer saves.
 */
export function CompanionSeatsForm({
  groups,
  action,
}: {
  groups: SelectionPageDto['groups'];
  action: (prev: SelectionState, form: FormData) => Promise<SelectionState>;
}) {
  const t = useTranslations('seating.selection');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null });
  const [ticked, setTicked] = useState<ReadonlySet<string>>(
    () => new Set(groups.flatMap((g) => g.seats.filter((s) => s.companion).map((s) => s.seatUuid))),
  );
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };
  const toggle = (id: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const suggest = () =>
    setTicked(
      (prev) =>
        new Set([
          ...prev,
          ...groups.flatMap((g) => g.seats.filter((s) => s.suggested).map((s) => s.seatUuid)),
        ]),
    );
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <Button type="button" variant="ghost" size="sm" onClick={suggest} className="self-start">
        {t('suggest')}
      </Button>
      {groups.map((g) => (
        <fieldset key={g.itemId} className="flex flex-col gap-1.5">
          <legend className="mb-1 text-body font-medium">{t(`group.${g.kind}`, { label: g.label })}</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            {g.seats.map((s) =>
              s.accessible ? (
                <p key={s.seatUuid} className="flex min-h-6 items-center text-body text-ink-2">
                  {t('seatAccessible', { seat: s.label })}
                </p>
              ) : (
                <label key={s.seatUuid} className="flex min-h-6 items-center gap-2 text-body">
                  <input
                    type="checkbox"
                    name="companion"
                    value={s.seatUuid}
                    checked={ticked.has(s.seatUuid)}
                    onChange={() => toggle(s.seatUuid)}
                    className="size-5"
                  />
                  {t('seatCompanion', { seat: s.label })}
                  {s.suggested ? <span className="text-caption text-ink-2">{t('suggested')}</span> : null}
                </label>
              ),
            )}
          </div>
        </fieldset>
      ))}
      <div aria-live="polite">
        {state.ok ? <Alert tone="info" title={t('savedCompanions', { count: state.count ?? 0 })} /> : null}
        {state.code ? (
          <Alert
            title={
              state.code === 'forbidden'
                ? t('readOnly')
                : state.reason === 'companion_far' || state.reason === 'companion_is_accessible'
                  ? t('companionError')
                  : te(errorMessageKey(state.code))
            }
          />
        ) : null}
      </div>
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {t('saveCompanions')}
      </Button>
    </form>
  );
}
