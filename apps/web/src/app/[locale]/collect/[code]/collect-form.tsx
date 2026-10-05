'use client';

import { Alert, Button, Input, Textarea } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import { HumanCheckField, type HumanCheckWidget } from '@/components/human-check-field.tsx';
import type { CollectState } from './actions.ts';

const MAX_MEMBERS = 12;
/** The public pages' card (ADR 0022, as on the public event page). */
const CARD =
  'm-0 flex min-w-0 flex-col gap-4 rounded-panel border border-line bg-surface p-5 elevation-card glass';

/**
 * The household's contact details (M4.1f): its name, the people in it (one row each, "Add
 * another person" and "Remove" are plain buttons), the postal address, email and phone, and a
 * note for the hosts. Native inputs, 44 px targets, phone first. The human check appears once
 * this device used its budget. Values survive any error; the first problem gets the focus.
 */
export function CollectForm({
  action,
  challenge,
}: {
  action: (prev: CollectState, form: FormData) => Promise<CollectState>;
  challenge: HumanCheckWidget | null;
}) {
  const t = useTranslations('collector');
  const [state, formAction, pending] = useActionState(action, {} as CollectState);
  const ref = useRef<HTMLFormElement>(null);
  const next = useRef(1);
  const [rows, setRows] = useState<number[]>([0]);
  const [focusRow, setFocusRow] = useState<number | null>(null);
  const v = state.values;

  // Rows follow what came back (the same count, fresh keys so the values show).
  useEffect(() => {
    if (!state.values) return;
    const n = state.values.members.length;
    setRows(Array.from({ length: n }, (_, i) => i));
    next.current = n;
  }, [state.values]);

  useEffect(() => {
    if (!state.stamp) return;
    const target =
      state.error === 'household'
        ? '[name="household"]'
        : state.error === 'member'
          ? `[name="m:${state.row ?? 0}:first"]`
          : state.error === 'invalidEmail' || state.error === 'contactRequired'
            ? '[name="email"]'
            : state.error === 'invalidPhone'
              ? '[name="phone"]'
              : state.done
                ? '[data-collect-done]'
                : state.challenge && !state.error
                  ? '[name="human"], [data-collect-error]'
                  : '[data-collect-error]';
    // After React re-rendered the rows.
    requestAnimationFrame(() => ref.current?.parentElement?.querySelector<HTMLElement>(target)?.focus());
  }, [state]);

  useEffect(() => {
    if (focusRow === null) return;
    ref.current?.querySelector<HTMLElement>(`[name="m:${focusRow}:first"]`)?.focus();
    setFocusRow(null);
  }, [focusRow]);

  if (state.done)
    return (
      <div data-collect-done tabIndex={-1} className="outline-none">
        <Alert tone="success" title={t('doneTitle')}>
          {t('doneBody')}
        </Alert>
      </div>
    );

  const general =
    state.error === 'challengeFailed' ||
    state.error === 'rateLimited' ||
    state.error === 'closed' ||
    state.error === 'full' ||
    state.error === 'contactRequired'
      ? t(`errors.${state.error}`, { minutes: state.retryMinutes ?? 1 })
      : null;
  const key = state.stamp ?? 0;

  return (
    <form
      ref={ref}
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        startTransition(() => formAction(form));
      }}
      noValidate
      aria-label={t('formLabel')}
      className="flex flex-col gap-5"
    >
      <div className={CARD}>
        <Input
          id="collect-household"
          name="household"
          label={t('household')}
          hint={t('householdHint')}
          defaultValue={v?.household ?? ''}
          key={`household-${key}`}
          maxLength={120}
          required
          error={state.error === 'household' ? t('errors.household') : undefined}
        />
      </div>

      <fieldset className={CARD}>
        <legend className="float-start w-full text-card text-ink">{t('membersLegend')}</legend>
        <p className="m-0 -mt-2 text-caption text-ink-2">{t('membersHint')}</p>
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {rows.map((row, i) => {
            const value = v?.members[row];
            const bad = state.error === 'member' && state.row === i;
            return (
              <li key={`${row}-${key}`}>
                <fieldset className="m-0 flex flex-col gap-3 rounded-tile border border-line bg-surface-2 p-4">
                  <legend className="px-1 text-[13px] font-bold text-ink">{t('person', { n: i + 1 })}</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      id={`collect-m-${i}-first`}
                      name={`m:${i}:first`}
                      label={t('firstName')}
                      defaultValue={value?.firstName ?? ''}
                      autoComplete={i === 0 ? 'given-name' : 'off'}
                      maxLength={80}
                      required
                      error={bad ? t('errors.member') : undefined}
                    />
                    <Input
                      id={`collect-m-${i}-last`}
                      name={`m:${i}:last`}
                      label={t('lastName')}
                      defaultValue={value?.lastName ?? ''}
                      autoComplete={i === 0 ? 'family-name' : 'off'}
                      maxLength={80}
                    />
                  </div>
                  {rows.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="self-start"
                      onClick={() => {
                        // Rows keep their own inputs (stable keys), so what was typed stays.
                        setRows((r) => r.filter((x) => x !== row));
                        setFocusRow(Math.max(0, i - 1));
                      }}
                    >
                      {t('removePerson', { n: i + 1 })}
                    </Button>
                  ) : null}
                </fieldset>
              </li>
            );
          })}
        </ol>
        {rows.length < MAX_MEMBERS ? (
          <Button
            type="button"
            variant="secondary"
            className="self-start"
            onClick={() => {
              const id = next.current++;
              setRows((r) => [...r, id]);
              setFocusRow(rows.length);
            }}
          >
            {t('addPerson')}
          </Button>
        ) : null}
      </fieldset>

      <fieldset className={CARD}>
        <legend className="float-start w-full text-card text-ink">{t('contactLegend')}</legend>
        <p className="m-0 -mt-2 text-caption text-ink-2">{t('contactHint')}</p>
        <Textarea
          id="collect-address"
          name="address"
          label={t('address')}
          rows={3}
          maxLength={500}
          autoComplete="street-address"
          defaultValue={v?.address ?? ''}
          key={`address-${key}`}
        />
        <Input
          id="collect-email"
          name="email"
          type="email"
          label={t('email')}
          defaultValue={v?.email ?? ''}
          key={`email-${key}`}
          autoComplete="email"
          maxLength={254}
          error={state.error === 'invalidEmail' ? t('errors.invalidEmail') : undefined}
        />
        <Input
          id="collect-phone"
          name="phone"
          type="tel"
          label={t('phone')}
          hint={t('phoneHint')}
          defaultValue={v?.phone ?? ''}
          key={`phone-${key}`}
          autoComplete="tel"
          maxLength={40}
          error={state.error === 'invalidPhone' ? t('errors.invalidPhone') : undefined}
        />
        <Textarea
          id="collect-note"
          name="note"
          label={t('note')}
          hint={t('noteHint')}
          rows={3}
          maxLength={500}
          defaultValue={v?.note ?? ''}
          key={`note-${key}`}
        />
      </fieldset>

      {state.challenge && challenge ? (
        <fieldset className="m-0 flex flex-col gap-2 rounded-tile border border-line bg-surface-2 p-4">
          <legend className="px-1 text-body font-bold text-ink">{t('challengeTitle')}</legend>
          <p className="m-0 text-caption text-ink-2">{t('challengeHint')}</p>
          <HumanCheckField widget={challenge} />
        </fieldset>
      ) : null}
      <div aria-live="polite">
        {general ? (
          <div data-collect-error tabIndex={-1}>
            <Alert title={general} />
          </div>
        ) : null}
      </div>
      <p className="m-0 text-caption text-ink-2">{t('privacy')}</p>
      <Button type="submit" size="lg" disabled={pending} className="self-stretch sm:self-start">
        {t('submit')}
      </Button>
    </form>
  );
}
