'use client';

import {
  EMPTY_RULE,
  logicVars,
  RSVP_CONTEXT_VARS,
  RSVP_FIELD_TYPES,
  type RsvpBinding,
  type RsvpFieldType,
  type RsvpQuestion,
  type RsvpRule,
  rsvpVisible,
  ruleFromLogic,
  ruleToLogic,
} from '@yayatoh/forms/ui';
import { Alert, Button, buttonClass, Card, EmptyState, FieldMessage, IconButton, Input, Select } from '@yayatoh/ui';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { startTransition, useActionState, useEffect, useId, useRef, useState } from 'react';
import {
  answerOf,
  type FieldMenuOption,
  type FieldValue,
  RsvpQuestionField,
} from '@/components/rsvp-question-field.tsx';
import { errorMessageKey } from '@/lib/errors.ts';
import type { PublishState } from './actions.ts';

const SELECT = 'field w-full pe-9';
const TEXTAREA = 'field w-full py-3 leading-relaxed';
const CAPTION = 'm-0 text-caption text-ink-2';
const LABEL = 'text-[13px] font-bold text-ink';
const CHECK =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-control text-body font-semibold text-ink has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55';
const BOX = 'size-[18px] shrink-0 cursor-pointer accent-primary';

const CHOICE = new Set<RsvpFieldType>(['select', 'multi_select']);
const TEXT = new Set<RsvpFieldType>(['short_text', 'long_text']);
/** Questions whose answer a condition can test (one choice, several, or a tick). */
const TESTABLE = new Set<RsvpFieldType>(['select', 'multi_select', 'checkbox']);

export interface SubEventOption {
  readonly id: string;
  readonly name: string;
}

/** A stable key from a label ("Dietary needs?" → dietary_needs), unique among `taken`. */
function keyFor(label: string, taken: ReadonlySet<string>, fallback: string): string {
  const base =
    label
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || fallback;
  const start = /^[a-z]/.test(base) ? base : `${fallback}_${base}`.slice(0, 36);
  const reserved = new Set<string>([...taken, ...RSVP_CONTEXT_VARS]);
  let key = start;
  for (let n = 2; reserved.has(key); n++) key = `${start.slice(0, 34)}_${n}`;
  return key;
}

/** The first question whose condition reads a later (or missing) question, or null. */
function orderProblem(list: readonly RsvpQuestion[]): string | null {
  const before = new Set<string>(RSVP_CONTEXT_VARS);
  for (const q of list) {
    if (logicVars(q.showIf).some((v) => !before.has(v))) return q.key;
    before.add(q.key);
  }
  return null;
}

interface Draft {
  label: string;
  type: RsvpFieldType;
  options: string;
  help: string;
  subEventId: string;
  binding: '' | RsvpBinding;
  required: boolean;
  sensitive: boolean;
  /** `custom`: a condition written another way (kept as is). */
  when: 'rule' | 'custom';
  rule: RsvpRule;
}

const blank = (): Draft => ({
  label: '',
  type: 'short_text',
  options: '',
  help: '',
  subEventId: '',
  binding: '',
  required: false,
  sensitive: false,
  when: 'rule',
  rule: EMPTY_RULE,
});

function draftOf(q: RsvpQuestion): Draft {
  const rule = ruleFromLogic(q.showIf);
  return {
    label: q.label,
    type: q.type,
    options: q.options.map((o) => o.label).join('\n'),
    help: q.help ?? '',
    subEventId: q.subEventId ?? '',
    binding: q.binding ?? '',
    required: q.required,
    sensitive: q.sensitive,
    when: rule ? 'rule' : 'custom',
    rule: rule ?? EMPTY_RULE,
  };
}

/**
 * The RSVP question builder (M4.1e): the host drafts questions (type, the sub-event it is about,
 * where the answer is saved, required, private, and when it shows) and sees them in a live
 * preview for a sample guest (attending or not, adult or child, with a named plus-one or not)
 * before publishing them as the next version. Buttons move and remove questions (no dragging).
 * Viewers see the questions and the preview only.
 */
export function QuestionsBuilder({
  initial,
  version: startVersion,
  subEvents,
  menu,
  canWrite,
  publish,
}: {
  initial: readonly RsvpQuestion[];
  version: number;
  subEvents: readonly SubEventOption[];
  menu: readonly FieldMenuOption[];
  canWrite: boolean;
  publish: (prev: PublishState, form: FormData) => Promise<PublishState>;
}) {
  const t = useTranslations('rsvpQuestions');
  const te = useTranslations();
  const [questions, setQuestions] = useState<RsvpQuestion[]>([...initial]);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(publish, { ok: false, code: null } as PublishState);
  const version = state.ok && state.version ? state.version : startVersion;
  const lastStamp = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state.ok && state.stamp !== lastStamp.current) {
      lastStamp.current = state.stamp;
      setDirty(false);
    }
  }, [state]);

  const subName = (id: string | null) =>
    id === null ? t('wholeEvent') : (subEvents.find((s) => s.id === id)?.name ?? t('unknownSubEvent'));
  const describeRule = (q: RsvpQuestion): string => {
    const rule = ruleFromLogic(q.showIf);
    if (!rule) return t('customCondition');
    const parts = [
      rule.attending ? t('rule.attending') : null,
      rule.adultsOnly ? t('rule.adultsOnly') : null,
      rule.plusOneNamed ? t('rule.plusOneNamed') : null,
    ].filter(Boolean) as string[];
    if (rule.answer) {
      const src = questions.find((x) => x.key === rule.answer?.key);
      const value =
        src?.type === 'checkbox'
          ? t('rule.checked')
          : (src?.options.find((o) => o.value === rule.answer?.value)?.label ?? rule.answer.value);
      parts.push(t('rule.answer', { question: src?.label ?? rule.answer.key, value }));
    }
    return parts.length ? t('shownWhen', { conditions: parts.join(t('rule.and')) }) : t('shownAlways');
  };

  const change = (next: RsvpQuestion[]) => {
    setQuestions(next);
    setDirty(true);
    setListError(null);
  };
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= questions.length) return;
    const next = [...questions];
    [next[i], next[j]] = [next[j] as RsvpQuestion, next[i] as RsvpQuestion];
    if (orderProblem(next)) return setListError(t('errors.order'));
    change(next);
  };
  const remove = (i: number) => {
    const next = questions.filter((_, k) => k !== i);
    if (orderProblem(next)) return setListError(t('errors.inUse'));
    change(next);
  };

  const publishError = state.code
    ? state.reason && t.has(`errors.${state.reason}`)
      ? t(`errors.${state.reason}`)
      : te(errorMessageKey(state.code))
    : null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section aria-labelledby="rq-list" className="flex min-w-0 flex-col gap-3">
        <h2 id="rq-list" className="m-0 text-section text-ink">
          {t('questionsTitle')}
        </h2>
        {questions.length === 0 ? (
          <EmptyState
            title={t('empty')}
            description={t('emptyDescription')}
            action={
              canWrite ? (
                <Button type="button" onClick={() => setEditing('new')}>
                  {t('emptyAction')}
                </Button>
              ) : (
                <a href="#rq-preview" className={buttonClass('primary', 'md')}>
                  {t('emptyViewerAction')}
                </a>
              )
            }
          />
        ) : (
          <ol aria-label={t('questionsTitle')} className="m-0 flex list-none flex-col gap-2.5 p-0">
            {questions.map((q, i) => (
              <li
                key={q.key}
                className="flex flex-col gap-3 rounded-tile border border-line bg-surface px-4 py-3 elevation-card glass"
              >
                <div className="flex flex-wrap items-start gap-2">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-body font-bold text-ink">{q.label}</span>
                    <span className={CAPTION}>
                      {[
                        t(`types.${q.type}`),
                        subName(q.subEventId),
                        q.required ? t('requiredBadge') : null,
                        q.sensitive ? t('privateBadge') : null,
                        q.binding ? t(`savedTo.${q.binding}`) : q.type === 'meal' ? t('savedTo.meal') : null,
                        describeRule(q),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {canWrite ? (
                    <span className="flex flex-wrap gap-1">
                      <IconButton
                        variant="ghost"
                        size="sm"
                        disabled={i === 0}
                        label={t('moveUp', { label: q.label })}
                        icon={<ArrowUp aria-hidden="true" strokeWidth={2} />}
                        onClick={() => move(i, -1)}
                      />
                      <IconButton
                        variant="ghost"
                        size="sm"
                        disabled={i === questions.length - 1}
                        label={t('moveDown', { label: q.label })}
                        icon={<ArrowDown aria-hidden="true" strokeWidth={2} />}
                        onClick={() => move(i, 1)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t('editQuestion', { label: q.label })}
                        aria-expanded={editing === i}
                        onClick={() => setEditing(editing === i ? null : i)}
                      >
                        {t('edit')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t('removeQuestion', { label: q.label })}
                        onClick={() => remove(i)}
                      >
                        {t('remove')}
                      </Button>
                    </span>
                  ) : null}
                </div>
                {editing === i ? (
                  <QuestionEditor
                    key={`edit-${q.key}`}
                    initial={draftOf(q)}
                    earlier={questions.slice(0, i)}
                    others={questions.filter((_, k) => k !== i)}
                    subEvents={subEvents}
                    menu={menu}
                    submitLabel={t('saveQuestion')}
                    onCancel={() => setEditing(null)}
                    onSave={(d) => {
                      change(questions.map((x, k) => (k === i ? build(d, x, questions) : x)));
                      setEditing(null);
                    }}
                  />
                ) : null}
              </li>
            ))}
          </ol>
        )}
        <div aria-live="polite">{listError ? <Alert title={listError} /> : null}</div>
        {canWrite ? (
          editing === 'new' ? (
            <Card className="flex flex-col gap-3">
              <h3 className="m-0 text-[16px] font-extrabold text-ink">{t('addTitle')}</h3>
              <QuestionEditor
                key={`new-${questions.length}`}
                initial={blank()}
                earlier={questions}
                others={questions}
                subEvents={subEvents}
                menu={menu}
                submitLabel={t('addQuestion')}
                onCancel={() => setEditing(null)}
                onSave={(d) => {
                  change([...questions, build(d, null, questions)]);
                  setEditing(null);
                }}
              />
            </Card>
          ) : (
            <Button
              type="button"
              variant="secondary"
              className="self-start"
              onClick={() => setEditing('new')}
            >
              {t('newQuestion')}
            </Button>
          )
        ) : null}
        {canWrite ? (
          <form
            action={formAction}
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              startTransition(() => formAction(form));
            }}
            className="flex flex-col gap-3 border-t border-line pt-4"
          >
            <input type="hidden" name="definition" value={JSON.stringify({ questions })} />
            <input type="hidden" name="version" value={version} />
            <p className={CAPTION} role="status">
              {dirty ? t('unpublished') : version ? t('publishedVersion', { version }) : t('neverPublished')}
            </p>
            <div aria-live="polite">
              {state.ok && !dirty ? <Alert tone="info" title={t('published', { version })} /> : null}
              {publishError ? <Alert title={publishError} /> : null}
            </div>
            <Button type="submit" disabled={pending || !dirty} className="self-start">
              {t('publish')}
            </Button>
          </form>
        ) : null}
      </section>

      <section aria-labelledby="rq-preview" className="flex min-w-0 flex-col gap-3">
        <h2 id="rq-preview" className="m-0 text-section text-ink">
          {t('previewTitle')}
        </h2>
        <Preview questions={questions} subEvents={subEvents} menu={menu} />
      </section>
    </div>
  );
}

/** The question from the editor's draft (a new key for a new question; options keep their values). */
function build(d: Draft, before: RsvpQuestion | null, all: readonly RsvpQuestion[]): RsvpQuestion {
  const taken = new Set(all.filter((x) => x !== before).map((x) => x.key));
  const key = before?.key ?? keyFor(d.label, taken, 'q');
  const used = new Set<string>();
  const options = CHOICE.has(d.type)
    ? d.options
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((label, i) => {
          const kept = before?.options.find((o) => o.label === label)?.value;
          const value = kept && !used.has(kept) ? kept : keyFor(label, used, `o${i + 1}`);
          used.add(value);
          return { value, label: label.slice(0, 120) };
        })
    : [];
  const earlier = all.slice(0, before ? all.indexOf(before) : all.length);
  const binding = TEXT.has(d.type) && d.binding ? d.binding : null;
  return {
    key,
    type: d.type,
    label: d.label.trim().slice(0, 200),
    help: d.help.trim().slice(0, 300) || null,
    required: d.required,
    sensitive: d.type === 'meal' ? false : binding ? true : d.sensitive,
    options,
    min: null,
    max: null,
    subEventId: d.subEventId || null,
    binding,
    showIf:
      d.when === 'custom' && before
        ? before.showIf
        : (ruleToLogic(d.rule, earlier) as RsvpQuestion['showIf']),
  };
}

/** Add or edit one question: every control labelled, problems named next to the field. */
function QuestionEditor({
  initial,
  earlier,
  others,
  subEvents,
  menu,
  submitLabel,
  onSave,
  onCancel,
}: {
  initial: Draft;
  /** Questions before this one (a condition can test their answers). */
  earlier: readonly RsvpQuestion[];
  /** Every other question (one meal, one question per saved answer). */
  others: readonly RsvpQuestion[];
  subEvents: readonly SubEventOption[];
  menu: readonly FieldMenuOption[];
  submitLabel: string;
  onSave: (d: Draft) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('rsvpQuestions');
  const id = useId();
  const [d, setD] = useState<Draft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const root = useRef<HTMLFieldSetElement>(null);
  // Opening the editor puts the cursor in the question (keyboard users start typing at once).
  useEffect(() => {
    root.current?.querySelector<HTMLElement>('[data-field="label"]')?.focus();
  }, []);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const setRule = (r: Partial<RsvpRule>) => setD((x) => ({ ...x, rule: { ...x.rule, ...r } }));
  const testable = earlier.filter((q) => TESTABLE.has(q.type));
  const src = testable.find((q) => q.key === d.rule.answer?.key);
  const bindings = (['dietary', 'accessibility'] as const).filter(
    (b) => !others.some((q) => q.binding === b) || initial.binding === b,
  );

  const check = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!d.label.trim()) e.label = t('errors.label');
    if (CHOICE.has(d.type) && !d.options.split(/\r?\n/).some((l) => l.trim()))
      e.options = t('errors.options');
    if (d.type === 'meal' && menu.length === 0) e.type = t('errors.menu_empty');
    if (d.type === 'meal' && others.some((q) => q.type === 'meal')) e.type = t('errors.oneMeal');
    if (d.rule.answer && !src) e.answer = t('errors.answer');
    return e;
  };
  const save = () => {
    const e = check();
    setErrors(e);
    const first = Object.keys(e)[0];
    if (first) {
      root.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
      return;
    }
    onSave(d);
  };
  const err = (k: string) => errors[k];
  const describedBy = (k: string) => (errors[k] ? `${id}-${k}-error` : undefined);
  const message = (k: string) => (errors[k] ? <FieldMessage id={`${id}-${k}`} error={errors[k]} /> : null);

  return (
    <fieldset
      ref={root}
      className="flex min-w-0 flex-col gap-4 border-0 p-0"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault();
          save();
        }
      }}
    >
      <legend className="sr-only">{submitLabel}</legend>
      <Input
        id={`${id}-label`}
        data-field="label"
        label={t('field.label')}
        value={d.label}
        onChange={(e) => set('label', e.target.value)}
        maxLength={200}
        error={err('label')}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-type`} className={LABEL}>
          {t('field.type')}
        </label>
        <Select
          id={`${id}-type`}
          data-field="type"
          value={d.type}
          onValueChange={(v) => set('type', v as RsvpFieldType)}
          aria-invalid={err('type') ? true : undefined}
          aria-describedby={describedBy('type')}
          className={SELECT}
        >
          {RSVP_FIELD_TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {t(`types.${ty}`)}
            </option>
          ))}
        </Select>
        {message('type')}
        {d.type === 'meal' ? <p className={CAPTION}>{t('field.mealHint')}</p> : null}
      </div>
      {CHOICE.has(d.type) ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-options`} className={LABEL}>
            {t('field.options')}
          </label>
          <textarea
            id={`${id}-options`}
            data-field="options"
            rows={4}
            value={d.options}
            onChange={(e) => set('options', e.target.value)}
            aria-invalid={err('options') ? true : undefined}
            aria-describedby={describedBy('options') ?? `${id}-options-hint`}
            className={TEXTAREA}
          />
          {message('options') ?? (
            <p id={`${id}-options-hint`} className="text-caption text-ink-2">
              {t('field.optionsHint')}
            </p>
          )}
        </div>
      ) : null}
      <Input
        id={`${id}-help`}
        label={t('field.help')}
        value={d.help}
        onChange={(e) => set('help', e.target.value)}
        maxLength={300}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-scope`} className={LABEL}>
          {t('field.scope')}
        </label>
        <Select
          id={`${id}-scope`}
          value={d.subEventId}
          onValueChange={(v) => set('subEventId', v)}
          className={SELECT}
        >
          <option value="">{t('wholeEvent')}</option>
          {subEvents.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>
      {TEXT.has(d.type) ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-binding`} className={LABEL}>
            {t('field.binding')}
          </label>
          <Select
            id={`${id}-binding`}
            value={d.binding}
            onValueChange={(v) => set('binding', v as Draft['binding'])}
            aria-describedby={`${id}-binding-hint`}
            className={SELECT}
          >
            <option value="">{t('savedTo.none')}</option>
            {bindings.map((b) => (
              <option key={b} value={b}>
                {t(`savedTo.${b}`)}
              </option>
            ))}
          </Select>
          <p id={`${id}-binding-hint`} className="text-caption text-ink-2">
            {t('field.bindingHint')}
          </p>
        </div>
      ) : null}
      <fieldset className="m-0 flex flex-col border-0 p-0">
        <legend className={`${LABEL} pb-1`}>{t('field.options2')}</legend>
        <label className={CHECK}>
          <input
            type="checkbox"
            checked={d.required}
            onChange={(e) => set('required', e.target.checked)}
            className={BOX}
          />
          {t('field.required')}
        </label>
        <label className={CHECK}>
          <input
            type="checkbox"
            checked={d.type !== 'meal' && (d.sensitive || !!(TEXT.has(d.type) && d.binding))}
            disabled={d.type === 'meal' || !!(TEXT.has(d.type) && d.binding)}
            onChange={(e) => set('sensitive', e.target.checked)}
            className={BOX}
          />
          {t('field.private')}
        </label>
      </fieldset>
      <fieldset className="m-0 flex flex-col border-0 p-0">
        <legend className={`${LABEL} pb-1`}>{t('field.when')}</legend>
        {initial.when === 'custom' ? (
          <label className={CHECK}>
            <input
              type="checkbox"
              checked={d.when === 'custom'}
              onChange={(e) => set('when', e.target.checked ? 'custom' : 'rule')}
              className={BOX}
            />
            {t('keepCustom')}
          </label>
        ) : null}
        {d.when === 'rule' ? (
          <>
            <label className={CHECK}>
              <input
                type="checkbox"
                checked={d.rule.attending}
                onChange={(e) => setRule({ attending: e.target.checked })}
                className={BOX}
              />
              {t('rule.attendingLabel')}
            </label>
            <label className={CHECK}>
              <input
                type="checkbox"
                checked={d.rule.adultsOnly}
                onChange={(e) => setRule({ adultsOnly: e.target.checked })}
                className={BOX}
              />
              {t('rule.adultsOnlyLabel')}
            </label>
            <label className={CHECK}>
              <input
                type="checkbox"
                checked={d.rule.plusOneNamed}
                onChange={(e) => setRule({ plusOneNamed: e.target.checked })}
                className={BOX}
              />
              {t('rule.plusOneNamedLabel')}
            </label>
            {testable.length ? (
              <div className="grid grid-cols-1 gap-3 pt-2 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`${id}-ans`} className={LABEL}>
                    {t('rule.answerQuestion')}
                  </label>
                  <Select
                    id={`${id}-ans`}
                    data-field="answer"
                    value={d.rule.answer?.key ?? ''}
                    onValueChange={(v) => {
                      const q = testable.find((x) => x.key === v);
                      setRule({
                        answer: q
                          ? {
                              key: q.key,
                              value: q.type === 'checkbox' ? 'true' : (q.options[0]?.value ?? ''),
                            }
                          : null,
                      });
                    }}
                    aria-invalid={err('answer') ? true : undefined}
                    aria-describedby={describedBy('answer')}
                    className={SELECT}
                  >
                    <option value="">{t('rule.anyAnswer')}</option>
                    {testable.map((q) => (
                      <option key={q.key} value={q.key}>
                        {q.label}
                      </option>
                    ))}
                  </Select>
                  {message('answer')}
                </div>
                {src && src.type !== 'checkbox' ? (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`${id}-val`} className={LABEL}>
                      {src.type === 'multi_select' ? t('rule.includes') : t('rule.is')}
                    </label>
                    <Select
                      id={`${id}-val`}
                      value={d.rule.answer?.value ?? ''}
                      onValueChange={(v) => setRule({ answer: { key: src.key, value: v } })}
                      className={SELECT}
                    >
                      {src.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={save}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </fieldset>
  );
}

/** The questions as a sample guest sees them, re-evaluated as the host changes the guest or answers. */
function Preview({
  questions,
  subEvents,
  menu,
}: {
  questions: readonly RsvpQuestion[];
  subEvents: readonly SubEventOption[];
  menu: readonly FieldMenuOption[];
}) {
  const t = useTranslations('rsvpQuestions');
  const id = useId();
  const [attending, setAttending] = useState(true);
  const [age, setAge] = useState('adult');
  const [plusOne, setPlusOne] = useState(false);
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const invited = subEvents.map((s) => s.id);
  const shown = rsvpVisible(
    { questions: [...questions] },
    {
      invited: invited.length ? invited : ['preview'],
      attending: attending ? (invited.length ? invited : ['preview']) : [],
      ageClass: age,
      isPlusOne: false,
      named: true,
      plusOneNamed: plusOne,
    },
    Object.fromEntries(questions.map((q) => [q.key, answerOf(q, values[q.key])])),
    { menu: menu.map((m) => ({ id: m.id, label: m.label })) },
  );
  return (
    <Card size="panel" className="flex flex-col gap-4">
      <fieldset className="m-0 flex flex-col gap-1 rounded-tile border border-line bg-surface-2 px-4 pt-1 pb-3">
        <legend className={`${LABEL} px-1`}>{t('preview.guest')}</legend>
        <label className={CHECK}>
          <input
            type="checkbox"
            checked={attending}
            onChange={(e) => setAttending(e.target.checked)}
            className={BOX}
          />
          {t('preview.attending')}
        </label>
        <label className={CHECK}>
          <input
            type="checkbox"
            checked={plusOne}
            onChange={(e) => setPlusOne(e.target.checked)}
            className={BOX}
          />
          {t('preview.plusOne')}
        </label>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-age`} className={LABEL}>
            {t('preview.age')}
          </label>
          <Select id={`${id}-age`} value={age} onValueChange={(v) => setAge(v)} className={SELECT}>
            {(['adult', 'child', 'infant'] as const).map((a) => (
              <option key={a} value={a}>
                {t(`preview.ages.${a}`)}
              </option>
            ))}
          </Select>
        </div>
      </fieldset>
      <p className={CAPTION} role="status">
        {t('preview.count', { shown: shown.length, total: questions.length })}
      </p>
      {shown.length === 0 ? (
        <p className="m-0 text-body text-ink-2">{t('preview.none')}</p>
      ) : (
        <fieldset data-testid="rsvp-preview" className="flex min-w-0 flex-col gap-4 border-0 p-0">
          <legend className="sr-only">{t('preview.label')}</legend>
          {shown.map((q) => (
            <RsvpQuestionField
              key={q.key}
              q={q}
              id={`${id}-${q.key}`}
              name={`preview:${q.key}`}
              value={values[q.key]}
              onChange={(v) => setValues((x) => ({ ...x, [q.key]: v }))}
              menu={menu}
            />
          ))}
        </fieldset>
      )}
    </Card>
  );
}
