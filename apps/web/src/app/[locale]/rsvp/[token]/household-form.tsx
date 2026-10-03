'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { startTransition, useActionState, useEffect, useRef } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import type { RsvpFormState } from './actions.ts';

export interface HouseholdGuest {
  readonly id: string;
  /** What the page calls them ("Luis López", or "Luis's guest" for an unnamed plus-one). */
  readonly label: string;
}

export interface HouseholdSubEvent {
  readonly id: string;
  readonly name: string;
  /** Already formatted in the event's time zone, with the place. */
  readonly when: string;
  readonly guestIds: readonly string[];
}

export interface HouseholdPlusOne {
  readonly guestId: string;
  readonly hostName: string;
  readonly firstName: string;
  readonly lastName: string;
}

/** A choice as a large pill: 44 px tall, arrow keys move within the guest's pair. */
const PILL =
  'flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-pill border border-line bg-surface px-4 text-body text-ink has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-white has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink';

/**
 * One person answers for the whole household (M4.1d): each sub-event the party is invited to,
 * each invited guest, attending or not, and names for a plus-one. Native radios and inputs
 * (keyboard: Tab between guests, arrows within a pair); the server checks everything again and
 * its answer decides which guest is marked and focused.
 */
export function HouseholdForm({
  action,
  guests,
  subEvents,
  answers,
  plusOnes,
}: {
  action: (prev: RsvpFormState, form: FormData) => Promise<RsvpFormState>;
  guests: readonly HouseholdGuest[];
  subEvents: readonly HouseholdSubEvent[];
  /** `${subEventId}:${guestId}` → the current answer. */
  answers: Readonly<Record<string, 'attending' | 'declined'>>;
  plusOnes: readonly HouseholdPlusOne[];
}) {
  const t = useTranslations('rsvp');
  const tr = useTranslations();
  const [state, formAction, pending] = useActionState(action, { code: null } as RsvpFormState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state.stamp) return;
    const el =
      (state.guestId &&
        (ref.current?.querySelector<HTMLElement>(`[name="p:${state.guestId}:first"]`) ??
          ref.current?.querySelector<HTMLElement>(`[data-guest="${state.guestId}"] input`))) ||
      ref.current?.querySelector<HTMLElement>('[data-rsvp-error]');
    el?.focus();
  }, [state]);
  const nameOf = new Map(guests.map((g) => [g.id, g.label]));
  const message = state.code
    ? t.has(`errors.${state.code}`)
      ? t(`errors.${state.code}`, { name: (state.guestId && nameOf.get(state.guestId)) || '' })
      : tr(errorMessageKey(state.code))
    : null;
  const nameError = state.code === 'plus_one_name_required' ? state.guestId : undefined;
  const answerError = state.code === 'missing_answer' ? state.guestId : undefined;

  return (
    <form
      ref={ref}
      // Keep every choice made when something needs fixing (no automatic reset).
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        startTransition(() => formAction(form));
      }}
      noValidate
      aria-label={t('formLabel')}
      className="flex flex-col gap-6"
    >
      {plusOnes.length ? (
        <section aria-labelledby="rsvp-plus-ones" className="flex flex-col gap-4">
          <h2 id="rsvp-plus-ones" className="text-section">
            {t('plusOnesTitle')}
          </h2>
          <p className="text-body text-ink-2">{t('plusOnesHint')}</p>
          {plusOnes.map((p) => (
            <fieldset key={p.guestId} className="flex flex-col gap-3 border-0 p-0">
              <legend className="mb-2 text-body font-medium">{t('plusOneOf', { name: p.hostName })}</legend>
              <Input
                id={`p-${p.guestId}-first`}
                name={`p:${p.guestId}:first`}
                label={t('firstName')}
                defaultValue={p.firstName}
                maxLength={80}
                autoComplete="off"
                className="min-h-11"
                error={nameError === p.guestId ? t('errors.nameRequired') : undefined}
              />
              <Input
                id={`p-${p.guestId}-last`}
                name={`p:${p.guestId}:last`}
                label={t('lastName')}
                defaultValue={p.lastName}
                maxLength={80}
                autoComplete="off"
                className="min-h-11"
              />
            </fieldset>
          ))}
        </section>
      ) : null}

      {subEvents.map((s) => (
        <fieldset
          key={s.id}
          className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:p-6"
        >
          <legend className="float-start w-full text-section">{s.name}</legend>
          <p className="text-caption text-ink-2">{s.when}</p>
          {s.guestIds.map((guestId) => {
            const key = `${s.id}:${guestId}`;
            const name = nameOf.get(guestId) ?? '';
            const current = answers[key];
            const bad = answerError === guestId && !current;
            return (
              <fieldset
                key={key}
                data-guest={guestId}
                aria-invalid={bad ? true : undefined}
                className="flex flex-col gap-2 border-0 border-t border-line p-0 pt-3"
              >
                <legend className="mb-2 text-body font-medium">
                  {t('guestAt', { name, event: s.name })}
                </legend>
                <input type="hidden" name="expect" value={key} />
                <div className="flex gap-2">
                  <label className={PILL}>
                    <input
                      type="radio"
                      name={`a:${key}`}
                      value="attending"
                      defaultChecked={current === 'attending'}
                      className="sr-only"
                    />
                    {t('attending')}
                  </label>
                  <label className={PILL}>
                    <input
                      type="radio"
                      name={`a:${key}`}
                      value="declined"
                      defaultChecked={current === 'declined'}
                      className="sr-only"
                    />
                    {t('declined')}
                  </label>
                </div>
              </fieldset>
            );
          })}
        </fieldset>
      ))}

      <div aria-live="polite">
        {message ? (
          <div data-rsvp-error tabIndex={-1}>
            <Alert title={message} />
          </div>
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="min-h-11 self-stretch sm:self-start">
        {t('submit')}
      </Button>
    </form>
  );
}
