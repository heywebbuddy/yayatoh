'use client';

import { REGISTRATION_FIELD_TYPES, type RegistrationFieldType, typeAllows } from '@yayatoh/forms/ui';
import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';
import { fromLogic, opsFor, type SimpleCondition, valueLabel } from '@/lib/registration-conditions.ts';

/** A question as the builder offers it to conditions and the preview. */
export interface BuilderQuestion {
  readonly key: string;
  readonly label: string;
  readonly type: RegistrationFieldType;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}
export interface TypeOption {
  readonly id: string;
  readonly name: string;
}
type Action = (prev: FormState, form: FormData) => Promise<FormState>;

const SELECT = 'field w-full';
const TEXTAREA = 'rounded-card border border-line bg-surface px-4 py-2.5 text-body';
const CAPTION = 'text-caption text-ink-2';

/** Saved / refused, announced politely next to the form that caused it. */
function Status({ state, saved }: { state: FormState; saved?: string }) {
  const t = useTranslations();
  return (
    <div aria-live="polite">
      {state.ok && saved ? <Alert tone="info" title={saved} /> : null}
      {state.code ? (
        <Alert
          title={
            state.reason && t.has(`registrationForm.errors.${state.reason}`)
              ? t(`registrationForm.errors.${state.reason}`)
              : t(errorMessageKey(state.code))
          }
        />
      ) : null}
    </div>
  );
}

/** A one-button form (move, remove) whose refusal shows next to it. */
export function BuilderButton({
  action,
  version,
  label,
  ariaLabel,
  disabled,
}: {
  action: Action;
  version: number;
  label: string;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <form action={formAction} onSubmit={keepValues(formAction)} className="flex flex-col items-end">
      <input type="hidden" name="version" value={version} />
      <Button type="submit" variant="ghost" size="sm" disabled={disabled || pending} aria-label={ariaLabel}>
        {label}
      </Button>
      {state.code ? <Status state={state} /> : null}
    </form>
  );
}

/** Who sees a page or question: every registration type, or only the ones ticked. */
function TypeFields({ types, initial }: { types: readonly TypeOption[]; initial: readonly string[] | null }) {
  const t = useTranslations('registrationForm');
  const [some, setSome] = useState(initial !== null);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={CAPTION}>{t('audienceLegend')}</legend>
      <label className="flex min-h-6 items-center gap-2.5 text-body">
        <input
          type="radio"
          name="audience"
          value="all"
          checked={!some}
          onChange={() => setSome(false)}
          className="size-5 accent-primary"
        />
        {t('allTypes')}
      </label>
      <label className="flex min-h-6 items-center gap-2.5 text-body">
        <input
          type="radio"
          name="audience"
          value="some"
          checked={some}
          disabled={types.length === 0}
          onChange={() => setSome(true)}
          className="size-5 accent-primary"
        />
        {t('someTypes')}
      </label>
      {types.length === 0 ? <p className="text-caption text-ink-2">{t('noTypes')}</p> : null}
      {some ? (
        <fieldset className="flex flex-col gap-1 ps-7">
          <legend className="sr-only">{t('typesGroup')}</legend>
          {types.map((ty) => (
            <label key={ty.id} className="flex min-h-6 items-center gap-2.5 text-body">
              <input
                type="checkbox"
                name="types"
                value={ty.id}
                defaultChecked={initial?.includes(ty.id) ?? false}
                className="size-5 accent-primary"
              />
              {ty.name}
            </label>
          ))}
        </fieldset>
      ) : null}
    </fieldset>
  );
}

/** "Show always", or "only when <question> <is|is not|includes> <value>" (earlier questions only). */
function ConditionFields({
  questions,
  initial,
}: {
  questions: readonly BuilderQuestion[];
  initial: SimpleCondition | 'custom' | null;
}) {
  const t = useTranslations('registrationForm');
  const id = useId();
  const simple = initial && initial !== 'custom' ? initial : null;
  const [when, setWhen] = useState<'always' | 'if' | 'keep'>(
    simple ? 'if' : initial === 'custom' ? 'keep' : 'always',
  );
  const [key, setKey] = useState(simple?.key ?? questions[0]?.key ?? '');
  const q = questions.find((x) => x.key === key);
  const value = simple && simple.key === key ? String(simple.value) : '';
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={CAPTION}>{t('whenLegend')}</legend>
      {(
        [
          ['always', t('always')],
          ...(initial === 'custom' ? [['keep', t('keepCustom')]] : []),
          ['if', t('onlyWhen')],
        ] as [typeof when, string][]
      ).map(([v, label]) => (
        <label key={v} className="flex min-h-6 items-center gap-2.5 text-body">
          <input
            type="radio"
            name="when"
            value={v}
            checked={when === v}
            disabled={v === 'if' && questions.length === 0}
            onChange={() => setWhen(v)}
            className="size-5 accent-primary"
          />
          {label}
        </label>
      ))}
      {questions.length === 0 ? <p className="text-caption text-ink-2">{t('noEarlierQuestions')}</p> : null}
      {when === 'if' && q ? (
        <div className="grid grid-cols-1 gap-3 ps-7 md:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-q`} className={CAPTION}>
              {t('condQuestion')}
            </label>
            <select
              id={`${id}-q`}
              name="condKey"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className={SELECT}
            >
              {questions.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-op`} className={CAPTION}>
              {t('condOp')}
            </label>
            <select
              id={`${id}-op`}
              name="condOp"
              defaultValue={simple?.op ?? 'eq'}
              key={`op-${key}`}
              className={SELECT}
            >
              {opsFor(q).map((op) => (
                <option key={op} value={op}>
                  {t(`ops.${op}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-v`} className={CAPTION}>
              {t('condValue')}
            </label>
            {q.type === 'checkbox' || q.type === 'consent' ? (
              <select
                id={`${id}-v`}
                name="condValue"
                defaultValue={value || 'true'}
                key={`v-${key}`}
                className={SELECT}
              >
                <option value="true">{t('yes')}</option>
                <option value="false">{t('no')}</option>
              </select>
            ) : q.type === 'select' || q.type === 'multi_select' ? (
              <select
                id={`${id}-v`}
                name="condValue"
                defaultValue={value}
                key={`v-${key}`}
                className={SELECT}
              >
                {q.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`${id}-v`}
                key={`v-${key}`}
                name="condValue"
                required
                type={q.type === 'number' || q.type === 'count' ? 'number' : 'text'}
                defaultValue={value}
                maxLength={200}
                className={`${SELECT} text-ink`}
              />
            )}
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}

export function AddPageForm({ action, version }: { action: Action; version: number }) {
  const t = useTranslations('registrationForm');
  const id = useId();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <input type="hidden" name="version" value={version} />
      <Input
        id={`${id}-title`}
        name="title"
        required
        maxLength={120}
        label={t('pageTitle')}
        error={state.fields?.includes('title') ? t('errors.title') : undefined}
      />
      <Input id={`${id}-desc`} name="description" maxLength={500} label={t('pageDescription')} />
      <div className="flex flex-col gap-2 md:col-span-2">
        <Status state={state} saved={t('pageAdded')} />
        <Button type="submit" disabled={pending} className="self-start">
          {t('addPage')}
        </Button>
      </div>
    </form>
  );
}

export function PageSettingsForm({
  action,
  version,
  title,
  description,
  types,
  initialTypes,
  questions,
  condition,
}: {
  action: Action;
  version: number;
  title: string;
  description: string | null;
  types: readonly TypeOption[];
  initialTypes: readonly string[] | null;
  questions: readonly BuilderQuestion[];
  condition: unknown;
}) {
  const t = useTranslations('registrationForm');
  const id = useId();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <form action={formAction} onSubmit={keepValues(formAction)} className="flex flex-col gap-4">
      <input type="hidden" name="version" value={version} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Input
          id={`${id}-title`}
          name="title"
          required
          maxLength={120}
          defaultValue={title}
          label={t('pageTitle')}
        />
        <Input
          id={`${id}-desc`}
          name="description"
          maxLength={500}
          defaultValue={description ?? ''}
          label={t('pageDescription')}
        />
      </div>
      <TypeFields types={types} initial={initialTypes} />
      <ConditionFields questions={questions} initial={fromLogic(condition)} />
      <Status state={state} saved={t('saved')} />
      <Button type="submit" size="sm" disabled={pending} className="self-start">
        {t('savePage')}
      </Button>
    </form>
  );
}

export function QuestionSettingsForm({
  action,
  version,
  types,
  initialTypes,
  questions,
  condition,
  required,
  canRequire,
}: {
  action: Action;
  version: number;
  types: readonly TypeOption[];
  initialTypes: readonly string[] | null;
  questions: readonly BuilderQuestion[];
  condition: unknown;
  required: boolean;
  canRequire: boolean;
}) {
  const t = useTranslations('registrationForm');
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <form action={formAction} onSubmit={keepValues(formAction)} className="flex flex-col gap-4">
      <input type="hidden" name="version" value={version} />
      {canRequire ? (
        <label className="flex min-h-6 items-center gap-2.5 text-body">
          <input
            type="checkbox"
            name="required"
            value="1"
            defaultChecked={required}
            className="size-5 accent-primary"
          />
          {t('required')}
        </label>
      ) : null}
      <TypeFields types={types} initial={initialTypes} />
      <ConditionFields questions={questions} initial={fromLogic(condition)} />
      <Status state={state} saved={t('saved')} />
      <Button type="submit" size="sm" disabled={pending} className="self-start">
        {t('saveQuestion')}
      </Button>
    </form>
  );
}

export function AddQuestionForm({
  action,
  version,
  types,
  questions,
  terms,
}: {
  action: Action;
  version: number;
  types: readonly TypeOption[];
  questions: readonly BuilderQuestion[];
  terms: readonly { readonly key: string; readonly label: string }[];
}) {
  const t = useTranslations();
  const tr = useTranslations('registrationForm');
  const id = useId();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const [type, setType] = useState<RegistrationFieldType>('short_text');
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (state.ok) {
      setType('short_text');
      setRound((r) => r + 1);
    }
  }, [state]);
  const choice = type === 'select' || type === 'multi_select';
  const consent = type === 'consent';
  return (
    <form
      key={round}
      action={formAction}
      onSubmit={keepValues(formAction)}
      className="grid grid-cols-1 gap-4 md:grid-cols-2"
    >
      <input type="hidden" name="version" value={version} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-type`} className={CAPTION}>
          {tr('questionType')}
        </label>
        <select
          id={`${id}-type`}
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value as RegistrationFieldType)}
          className={SELECT}
        >
          {REGISTRATION_FIELD_TYPES.map((ft) => (
            <option key={ft} value={ft}>
              {tr(`types.${ft}`)}
            </option>
          ))}
        </select>
      </div>
      {consent ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-term`} className={CAPTION}>
            {tr('consentTerm')}
          </label>
          <select id={`${id}-term`} name="term" className={SELECT} aria-describedby={`${id}-term-hint`}>
            {terms.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
          <p id={`${id}-term-hint`} className="text-caption text-ink-2">
            {tr('consentHint')}
          </p>
        </div>
      ) : (
        <Input
          id={`${id}-label`}
          name="label"
          required
          maxLength={200}
          label={tr('questionLabel')}
          error={state.fields?.includes('label') ? tr('errors.label') : undefined}
        />
      )}
      {choice ? (
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <label htmlFor={`${id}-options`} className={CAPTION}>
            {t('questions.options')}
          </label>
          <textarea
            id={`${id}-options`}
            name="options"
            rows={3}
            required
            maxLength={2000}
            aria-describedby={`${id}-options-hint`}
            className={TEXTAREA}
          />
          <p id={`${id}-options-hint`} className="text-caption text-ink-2">
            {t('questions.optionsHint')}
          </p>
        </div>
      ) : null}
      {type === 'count' || type === 'number' ? (
        <Input id={`${id}-max`} name="max" type="number" min={0} max={100000} label={t('questions.max')} />
      ) : null}
      {type === 'company' || type === 'job_title' ? (
        <p className="text-caption text-ink-2 md:col-span-2">{tr(`typeHints.${type}`)}</p>
      ) : null}
      {!consent ? (
        <div className="flex flex-col gap-2 md:col-span-2">
          <label className="flex min-h-6 items-center gap-2.5 text-body">
            <input type="checkbox" name="required" value="1" className="size-5 accent-primary" />
            {tr('required')}
          </label>
          <label className="flex min-h-6 items-start gap-2.5 text-body">
            <input
              type="checkbox"
              name="sensitive"
              value="1"
              className="mt-0.5 size-5 shrink-0 accent-primary"
            />
            <span>
              {t('questions.sensitive')}
              <span className="block text-caption text-ink-2">{t('questions.sensitiveHint')}</span>
            </span>
          </label>
        </div>
      ) : null}
      <div className="md:col-span-2">
        <TypeFields types={types} initial={null} />
      </div>
      <div className="md:col-span-2">
        <ConditionFields questions={questions} initial={null} />
      </div>
      <div className="flex flex-col gap-2 md:col-span-2">
        <Status state={state} saved={tr('questionAdded')} />
        <Button type="submit" disabled={pending} className="self-start">
          {tr('addQuestion')}
        </Button>
      </div>
    </form>
  );
}

export function JobTitlesForm({ action, titles }: { action: Action; titles: readonly string[] }) {
  const t = useTranslations('registrationForm');
  const id = useId();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <form action={formAction} onSubmit={keepValues(formAction)} className="flex flex-col gap-3">
      <label htmlFor={`${id}-titles`} className={CAPTION}>
        {t('jobTitlesLabel')}
      </label>
      <textarea
        id={`${id}-titles`}
        name="titles"
        rows={5}
        maxLength={12_000}
        defaultValue={titles.join('\n')}
        aria-describedby={`${id}-titles-hint`}
        className={TEXTAREA}
      />
      <p id={`${id}-titles-hint`} className="text-caption text-ink-2">
        {t('jobTitlesHint')}
      </p>
      <Status state={state} saved={t('jobTitlesSaved')} />
      <Button type="submit" size="sm" disabled={pending} className="self-start">
        {t('saveJobTitles')}
      </Button>
    </form>
  );
}

/** A condition in words ("Shown when Joining workshops? is Yes"), or null for always. */
export function useConditionText(questions: readonly BuilderQuestion[]) {
  const t = useTranslations('registrationForm');
  return (logic: unknown): string | null => {
    const c = fromLogic(logic);
    if (c === null) return null;
    if (c === 'custom') return t('customCondition');
    const q = questions.find((x) => x.key === c.key);
    return t('shownWhen', {
      question: q?.label ?? c.key,
      op: t(`ops.${c.op}`),
      value: valueLabel(q, c.value, { yes: t('yes'), no: t('no') }),
    });
  };
}

export interface PreviewPage {
  readonly key: string;
  readonly title: string;
  readonly showIf: unknown;
  readonly registrationTypes: readonly string[] | null;
  readonly fields: readonly (BuilderQuestion & {
    readonly required: boolean;
    readonly showIf: unknown;
    readonly registrationTypes: readonly string[] | null;
  })[];
}

/**
 * Preview per registration type: the pages and questions that type can reach, in order, with
 * the answers that open the conditional ones (a keyboard-only list, no drag and no canvas).
 */
export function RegistrationPreview({
  pages,
  types,
}: {
  pages: readonly PreviewPage[];
  types: readonly TypeOption[];
}) {
  const t = useTranslations('registrationForm');
  const id = useId();
  const [typeId, setTypeId] = useState(types[0]?.id ?? '');
  const all = pages.flatMap((p) => p.fields);
  const describe = useConditionText(all);
  const reach = pages
    .filter((p) => typeAllows(p.registrationTypes, typeId))
    .map((p) => ({ ...p, fields: p.fields.filter((f) => typeAllows(f.registrationTypes, typeId)) }))
    .filter((p) => p.fields.length > 0);
  if (types.length === 0) return <p className="text-body text-ink-2">{t('noTypes')}</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-w-sm flex-col gap-1.5">
        <label htmlFor={`${id}-type`} className={CAPTION}>
          {t('previewAs')}
        </label>
        <select
          id={`${id}-type`}
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
          className={SELECT}
        >
          {types.map((ty) => (
            <option key={ty.id} value={ty.id}>
              {ty.name}
            </option>
          ))}
        </select>
      </div>
      <div aria-live="polite">
        {reach.length === 0 ? (
          <p className="text-body text-ink-2">{t('previewEmpty')}</p>
        ) : (
          <ol
            aria-label={t('previewList', { type: types.find((x) => x.id === typeId)?.name ?? '' })}
            className="flex list-none flex-col gap-3 p-0"
          >
            {reach.map((p, i) => (
              <li key={p.key} className="rounded-card border border-line p-4">
                <p className="text-section">{t('pageNumbered', { n: i + 1, title: p.title })}</p>
                {describe(p.showIf) ? <p className="text-caption text-ink-2">{describe(p.showIf)}</p> : null}
                <ul className="mt-2 flex list-disc flex-col gap-1 ps-5">
                  {p.fields.map((f) => (
                    <li key={f.key} className="text-body">
                      {f.label}
                      <span className="text-caption text-ink-2">
                        {' · '}
                        {[t(`types.${f.type}`), f.required ? t('requiredBadge') : null, describe(f.showIf)]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
