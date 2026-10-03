'use client';

import type { RsvpQuestion } from '@yayatoh/forms/ui';
import { Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';

/** A question as the field needs it (the party's page gets no write-back target). */
export type FieldQuestion = Pick<
  RsvpQuestion,
  'key' | 'type' | 'label' | 'help' | 'required' | 'sensitive' | 'options' | 'min' | 'max'
>;

export interface FieldMenuOption {
  readonly id: string;
  readonly label: string;
  readonly notes: string | null;
}

/** What a field holds while someone types: text, a choice, choices, or a tick. */
export type FieldValue = string | readonly string[] | boolean;

/** A choice as a 44 px row (phone-first): the whole row is the target. */
const ROW =
  'flex min-h-11 cursor-pointer items-start gap-3 rounded-card border border-line bg-surface px-4 py-2.5 text-body has-[:checked]:border-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink';
const BOX = 'mt-0.5 size-5 shrink-0 accent-ink';

/**
 * One RSVP question (M4.1e), for one guest: native inputs only (radios for one choice and the
 * meal, checkboxes for several), labelled and described, with the message the server gave it.
 * `name` is the form field (`q:{guestId}:{key}`); `kept` says a private answer was given before
 * (it is never shown back).
 */
export function RsvpQuestionField({
  q,
  name,
  id,
  value,
  onChange,
  menu,
  error,
  kept,
}: {
  q: FieldQuestion;
  name: string;
  id: string;
  value: FieldValue | undefined;
  onChange: (v: FieldValue) => void;
  menu: readonly FieldMenuOption[];
  error?: string;
  kept?: boolean;
}) {
  const t = useTranslations('rsvpQuestion');
  const label = q.required ? t('requiredLabel', { label: q.label }) : q.label;
  const notes = [q.help, q.sensitive ? t('private') : null, q.sensitive && kept ? t('kept') : null].filter(
    Boolean,
  );
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [error ? errorId : null, notes.length ? hintId : null].filter(Boolean).join(' ') || undefined;
  const hint = notes.length ? (
    <p id={hintId} className="text-caption text-ink-2">
      {notes.join(' ')}
    </p>
  ) : null;
  const message = error ? (
    <p id={errorId} className="text-caption text-danger">
      {error}
    </p>
  ) : null;
  const text = typeof value === 'string' ? value : '';

  if (q.type === 'short_text' || q.type === 'number' || q.type === 'count')
    return (
      <div className="flex flex-col gap-1.5" data-question={q.key}>
        <Input
          id={id}
          name={name}
          label={label}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          type={q.type === 'short_text' ? 'text' : 'number'}
          inputMode={q.type === 'short_text' ? undefined : q.type === 'count' ? 'numeric' : 'decimal'}
          min={q.min ?? (q.type === 'count' ? 0 : undefined)}
          max={q.max ?? undefined}
          maxLength={q.type === 'short_text' ? 200 : undefined}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className="min-h-11"
        />
        {hint}
        {message}
      </div>
    );

  if (q.type === 'long_text')
    return (
      <div className="flex flex-col gap-1.5" data-question={q.key}>
        <label htmlFor={id} className="text-caption text-ink-2">
          {label}
        </label>
        <textarea
          id={id}
          name={name}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          maxLength={2000}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={`rounded-card border bg-surface px-4 py-2.5 text-body ${error ? 'border-danger' : 'border-line'}`}
        />
        {hint}
        {message}
      </div>
    );

  if (q.type === 'checkbox')
    return (
      <div className="flex flex-col gap-1.5" data-question={q.key}>
        <label className={ROW}>
          <input
            id={id}
            type="checkbox"
            name={name}
            value="true"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            className={BOX}
          />
          <span>{label}</span>
        </label>
        {hint}
        {message}
      </div>
    );

  // One choice, several choices, or the meal: a group of rows.
  const multi = q.type === 'multi_select';
  const choices =
    q.type === 'meal'
      ? menu.map((m) => ({ value: m.id, label: m.label, notes: m.notes }))
      : q.options.map((o) => ({ value: o.value, label: o.label, notes: null }));
  const picked = new Set(Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : []);
  return (
    <fieldset
      className="flex flex-col gap-2 border-0 p-0"
      data-question={q.key}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
      id={id}
      tabIndex={-1}
    >
      <legend className="mb-1 text-caption text-ink-2">{label}</legend>
      {choices.map((c) => (
        <label key={c.value} className={ROW}>
          <input
            type={multi ? 'checkbox' : 'radio'}
            name={name}
            value={c.value}
            checked={picked.has(c.value)}
            onChange={(e) => {
              if (!multi) return onChange(c.value);
              const next = new Set(picked);
              if (e.target.checked) next.add(c.value);
              else next.delete(c.value);
              onChange([...next]);
            }}
            className={BOX}
          />
          <span className="flex flex-col">
            <span>{c.label}</span>
            {c.notes ? <span className="text-caption text-ink-2">{c.notes}</span> : null}
          </span>
        </label>
      ))}
      {hint}
      {message}
    </fieldset>
  );
}

/** A typed value as the engine's conditions read it (numbers stay text; the server normalizes). */
export function answerOf(q: Pick<FieldQuestion, 'type'>, v: FieldValue | undefined): unknown {
  if (v === undefined) return undefined;
  if (q.type === 'checkbox') return v === true ? true : undefined;
  if (Array.isArray(v)) return v.length ? v : undefined;
  return v === '' ? undefined : v;
}
