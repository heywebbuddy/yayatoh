'use client';

import { type RsvpQuestion, rsvpVisible } from '@yayatoh/forms/ui';
import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import {
  answerOf,
  type FieldMenuOption,
  type FieldQuestion,
  type FieldValue,
  RsvpQuestionField,
} from '@/components/rsvp-question-field.tsx';
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

/** A question of the party's page (M4.1e): the engine's fields minus the write-back target. */
export type HouseholdQuestion = FieldQuestion & {
  readonly subEventId: string | null;
  readonly showIf: unknown;
};

/** One invited guest as the questions see them, with their earlier non-private answers. */
export interface HouseholdQuestionGuest {
  readonly guestId: string;
  readonly ageClass: string;
  readonly isPlusOne: boolean;
  readonly hostGuestId: string | null;
  readonly named: boolean;
  readonly values: Readonly<Record<string, unknown>>;
  readonly kept: readonly string[];
}

export interface HouseholdQuestions {
  readonly questions: readonly HouseholdQuestion[];
  readonly menu: readonly FieldMenuOption[];
  readonly guests: readonly HouseholdQuestionGuest[];
}

/** An earlier answer as the field holds it. */
function fieldValue(q: HouseholdQuestion, v: unknown): FieldValue | undefined {
  if (v === undefined || v === null) return undefined;
  if (q.type === 'checkbox') return v === true;
  if (Array.isArray(v)) return v.map(String);
  return String(v);
}

/** A choice as a large pill: 44 px tall, arrow keys move within the guest's pair. */
const PILL =
  'flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-pill border border-zinc-200 bg-white px-4 text-body text-zinc-900 has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-white has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink';

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
  questions,
}: {
  action: (prev: RsvpFormState, form: FormData) => Promise<RsvpFormState>;
  guests: readonly HouseholdGuest[];
  subEvents: readonly HouseholdSubEvent[];
  /** `${subEventId}:${guestId}` → the current answer. */
  answers: Readonly<Record<string, 'attending' | 'declined'>>;
  plusOnes: readonly HouseholdPlusOne[];
  /** M4.1e: the hosts' questions, asked per guest once they answered attending or not. */
  questions?: HouseholdQuestions;
}) {
  const t = useTranslations('rsvp');
  const tr = useTranslations();
  const [serverState, formAction, pending] = useActionState(action, { code: null } as RsvpFormState);
  // A required question left empty is caught here first (the server checks again).
  const [local, setLocal] = useState<RsvpFormState | null>(null);
  const state = local && (local.stamp ?? 0) > (serverState.stamp ?? 0) ? local : serverState;
  const ref = useRef<HTMLFormElement>(null);
  // What the page has chosen so far: the questions follow it as the person answers.
  const [statuses, setStatuses] = useState<Record<string, string>>({ ...answers });
  const [names, setNames] = useState<Record<string, string>>(
    Object.fromEntries(plusOnes.map((p) => [p.guestId, p.firstName])),
  );
  const qs = questions?.questions ?? [];
  const [values, setValues] = useState<Record<string, Record<string, FieldValue>>>(() =>
    Object.fromEntries(
      (questions?.guests ?? []).map((g) => [
        g.guestId,
        Object.fromEntries(
          qs.flatMap((q) => {
            const v = fieldValue(q, g.values[q.key]);
            return v === undefined ? [] : [[q.key, v]];
          }),
        ),
      ]),
    ),
  );
  useEffect(() => {
    if (!state.stamp) return;
    const el =
      (state.guestId &&
        state.question &&
        ref.current?.querySelector<HTMLElement>(`#q-${state.guestId}-${state.question}`)) ||
      (state.guestId &&
        (ref.current?.querySelector<HTMLElement>(`[name="p:${state.guestId}:first"]`) ??
          ref.current?.querySelector<HTMLElement>(`[data-guest="${state.guestId}"] input`))) ||
      ref.current?.querySelector<HTMLElement>('[data-rsvp-error]');
    el?.focus();
  }, [state]);
  const nameOf = new Map(
    guests.map((g) => {
      const typed = names[g.id]?.trim();
      return [g.id, typed && plusOnes.some((p) => p.guestId === g.id) ? typed : g.label];
    }),
  );
  const message = state.code
    ? t.has(`errors.${state.code}`)
      ? t(`errors.${state.code}`, { name: (state.guestId && nameOf.get(state.guestId)) || '' })
      : tr(errorMessageKey(state.code))
    : null;
  const menu = questions?.menu ?? [];
  const engineMenu = menu.map((m) => ({ id: m.id, label: m.label }));
  const visibleFor = (g: HouseholdQuestionGuest): HouseholdQuestion[] => {
    const invited = subEvents.filter((s) => s.guestIds.includes(g.guestId)).map((s) => s.id);
    const mine = values[g.guestId] ?? {};
    const typed = Object.fromEntries(qs.map((q) => [q.key, answerOf(q, mine[q.key])]));
    const shown = rsvpVisible(
      { questions: qs as unknown as RsvpQuestion[] },
      {
        invited,
        attending: invited.filter((id) => statuses[`${id}:${g.guestId}`] === 'attending'),
        ageClass: g.ageClass,
        isPlusOne: g.isPlusOne,
        named: g.named || !!names[g.guestId]?.trim(),
        plusOneNamed: plusOnes.some(
          (p) =>
            (questions?.guests.find((x) => x.guestId === p.guestId)?.hostGuestId ?? null) === g.guestId &&
            !!names[p.guestId]?.trim(),
        ),
      },
      typed,
      { menu: engineMenu },
    );
    return shown as unknown as HouseholdQuestion[];
  };
  const asked = (questions?.guests ?? [])
    .map((g) => ({ g, shown: visibleFor(g) }))
    .filter((x) => x.shown.length > 0);
  const questionError = (guestId: string, key: string) =>
    state.guestId === guestId && state.question === key && state.code
      ? t.has(`errors.${state.code}`)
        ? t(`errors.${state.code}`, { name: nameOf.get(guestId) ?? '' })
        : tr(errorMessageKey(state.code))
      : undefined;
  /** Track the choices as they change, so the questions below follow them. */
  const track = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const next: Record<string, string> = {};
    const typedNames: Record<string, string> = {};
    for (const [k, v] of data.entries()) {
      if (k.startsWith('a:')) next[k.slice(2)] = String(v);
      if (k.startsWith('p:') && k.endsWith(':first')) typedNames[k.split(':')[1] ?? ''] = String(v);
    }
    setStatuses(next);
    setNames((n) => ({ ...n, ...typedNames }));
  };
  const nameError = state.code === 'plus_one_name_required' ? state.guestId : undefined;
  const answerError = state.code === 'missing_answer' ? state.guestId : undefined;

  return (
    <form
      ref={ref}
      // Keep every choice made when something needs fixing (no automatic reset).
      onChange={(e) => track(e.currentTarget)}
      onSubmit={(e) => {
        e.preventDefault();
        for (const { g, shown } of asked)
          for (const q of shown)
            if (
              q.required &&
              answerOf(q, values[g.guestId]?.[q.key]) === undefined &&
              !(q.sensitive && questions?.guests.find((x) => x.guestId === g.guestId)?.kept.includes(q.key))
            ) {
              setLocal({ code: 'question_required', guestId: g.guestId, question: q.key, stamp: Date.now() });
              return;
            }
        setLocal(null);
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
          <p className="text-body text-zinc-700">{t('plusOnesHint')}</p>
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
          className="flex flex-col gap-4 rounded-card border border-zinc-200 bg-white p-4 sm:p-6"
        >
          <legend className="float-start w-full text-section">{s.name}</legend>
          <p className="text-caption text-zinc-600">{s.when}</p>
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
                className="flex flex-col gap-2 border-0 border-t border-zinc-100 p-0 pt-3"
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

      {asked.length ? (
        <section aria-labelledby="rsvp-questions" className="flex flex-col gap-4">
          <h2 id="rsvp-questions" className="text-section">
            {t('questionsTitle')}
          </h2>
          <p className="text-body text-zinc-700">{t('questionsHint')}</p>
          {asked.map(({ g, shown }) => (
            <fieldset
              key={g.guestId}
              data-questions-for={g.guestId}
              className="flex flex-col gap-4 rounded-card border border-zinc-200 bg-white p-4 sm:p-6"
            >
              <legend className="float-start w-full text-section">
                {t('questionsFor', { name: nameOf.get(g.guestId) ?? '' })}
              </legend>
              {shown.map((q) => (
                <RsvpQuestionField
                  key={q.key}
                  q={q}
                  id={`q-${g.guestId}-${q.key}`}
                  name={`q:${g.guestId}:${q.key}`}
                  value={values[g.guestId]?.[q.key]}
                  onChange={(v) =>
                    setValues((all) => ({ ...all, [g.guestId]: { ...(all[g.guestId] ?? {}), [q.key]: v } }))
                  }
                  menu={menu}
                  kept={g.kept.includes(q.key)}
                  error={questionError(g.guestId, q.key)}
                />
              ))}
            </fieldset>
          ))}
        </section>
      ) : null}

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
