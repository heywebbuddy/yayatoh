'use client';

import {
  JOURNEY_TRIGGERS,
  type JourneyTrigger,
  MAX_OFFSET_DAYS,
  MAX_STEPS,
  STEP_ACTIONS,
  STEP_CONDITIONS,
  type StepAction,
  type StepCondition,
  WAIT_ANCHORS,
  type WaitAnchor,
} from '@yayatoh/automations/client';
import { Alert, Button, Input } from '@yayatoh/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useActionState, useEffect, useId, useState } from 'react';
import type { JourneyFormState } from '@/app/[locale]/o/[org]/(org)/journeys/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { describeWait } from '@/lib/journeys.ts';

const SELECT = 'min-h-10 w-full rounded-pill border border-zinc-200 bg-white px-4 text-body';
const TEXTAREA =
  'min-h-24 w-full rounded-card border border-zinc-200 bg-white px-4 py-2 text-body text-zinc-900 outline-none focus-visible:border-zinc-900';
const MESSAGE_ACTIONS: readonly StepAction[] = ['email', 'sms', 'whatsapp', 'push'];
const INITIAL: JourneyFormState = { ok: false, code: null };

function Select({
  id,
  label,
  value,
  onChange,
  children,
  error,
  name,
}: {
  id: string;
  label: string;
  value: string;
  onChange?: (v: string) => void;
  children: React.ReactNode;
  error?: string;
  name?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-caption text-zinc-600">
        {label}
      </label>
      <select
        id={id}
        name={name}
        className={`${SELECT} ${error ? 'border-pink-700' : ''}`}
        value={onChange ? value : undefined}
        defaultValue={onChange ? undefined : value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      >
        {children}
      </select>
      {error ? (
        <p id={`${id}-error`} className="text-caption text-pink-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** New journey: name, event or series, trigger, and the vision template or a blank journey. */
export function NewJourneyForm({
  events,
  series,
  initialScope,
  action,
}: {
  events: readonly { id: string; name: string }[];
  series: readonly { id: string; name: string }[];
  initialScope: string;
  action: (prev: JourneyFormState, form: FormData) => Promise<JourneyFormState>;
}) {
  const t = useTranslations('journeys');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [template, setTemplate] = useState<'vision' | 'blank'>('vision');
  // Controlled: a form action resets uncontrolled fields, and a refused submit must keep them.
  const [name, setName] = useState(() => t('vision.name'));
  const [scope, setScope] = useState(initialScope);
  const [trigger, setTrigger] = useState<JourneyTrigger>('order_paid');
  const fieldError = (f: string) =>
    state.field === f ? t(f === 'name' ? 'form.errors.name' : 'form.errors.scope') : undefined;
  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-5" noValidate>
      <Input
        id="journey-name"
        name="name"
        label={t('form.name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={120}
        required
        error={fieldError('name')}
      />
      <Select
        id="journey-scope"
        name="scope"
        label={t('form.scope')}
        value={scope}
        onChange={setScope}
        error={fieldError('scope')}
      >
        <option value="">{t('form.pickScope')}</option>
        {events.length ? (
          <optgroup label={t('form.events')}>
            {events.map((e) => (
              <option key={e.id} value={`event:${e.id}`}>
                {e.name}
              </option>
            ))}
          </optgroup>
        ) : null}
        {series.length ? (
          <optgroup label={t('form.series')}>
            {series.map((s) => (
              <option key={s.id} value={`series:${s.id}`}>
                {s.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </Select>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-caption text-zinc-600">{t('form.start')}</legend>
        {(['vision', 'blank'] as const).map((k) => (
          <label key={k} className="flex min-h-10 items-start gap-3 rounded-card border border-zinc-200 p-3">
            <input
              type="radio"
              name="template"
              value={k}
              checked={template === k}
              onChange={() => setTemplate(k)}
              className="mt-1 size-5"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-body font-medium">{t(`form.${k}`)}</span>
              <span className="text-caption text-zinc-500">{t(`form.${k}Hint`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {template === 'blank' ? (
        <Select
          id="journey-trigger"
          name="trigger"
          label={t('form.trigger')}
          value={trigger}
          onChange={(v) => setTrigger(v as JourneyTrigger)}
        >
          {JOURNEY_TRIGGERS.map((k) => (
            <option key={k} value={k}>
              {t(`triggers.${k}`)}
            </option>
          ))}
        </Select>
      ) : null}
      {state.code && !state.field ? (
        <div aria-live="polite">
          <Alert title={te(errorMessageKey(state.code))} />
        </div>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {t('form.create')}
        </Button>
      </div>
    </form>
  );
}

interface Draft {
  readonly key: string;
  readonly id: string | null;
  anchor: WaitAnchor;
  dir: 'before' | 'after';
  days: number;
  hours: number;
  minutes: number;
  atTime: string;
  action: StepAction;
  subject: string;
  body: string;
  label: string;
  condition: StepCondition | '';
}

export interface EditorStep {
  readonly id: string;
  readonly anchor: WaitAnchor;
  readonly offsetDays: number;
  readonly offsetMinutes: number;
  readonly atTime: string | null;
  readonly action: StepAction;
  readonly subject: string | null;
  readonly body: string | null;
  readonly label: string | null;
  readonly condition: StepCondition | null;
}

let seq = 0;
const nextKey = () => `n${++seq}`;

function toDraft(s: EditorStep): Draft {
  const m = Math.abs(s.offsetMinutes);
  return {
    key: s.id,
    id: s.id,
    anchor: s.anchor,
    dir: s.offsetDays < 0 || s.offsetMinutes < 0 ? 'before' : 'after',
    days: Math.abs(s.offsetDays),
    hours: Math.floor(m / 60),
    minutes: m % 60,
    atTime: s.atTime ?? '',
    action: s.action,
    subject: s.subject ?? '',
    body: s.body ?? '',
    label: s.label ?? '',
    condition: s.condition ?? '',
  };
}

const blankDraft = (trigger: JourneyTrigger): Draft => ({
  key: nextKey(),
  id: null,
  anchor: trigger === 'event_time' ? 'event_start' : 'trigger',
  dir: trigger === 'event_time' ? 'before' : 'after',
  days: trigger === 'event_time' ? 1 : 0,
  hours: 0,
  minutes: 0,
  atTime: '',
  action: 'email',
  subject: '',
  body: '',
  label: '',
  condition: '',
});

function toInput(d: Draft) {
  const sign = d.anchor !== 'trigger' && d.dir === 'before' ? -1 : 1;
  const minutes = d.hours * 60 + d.minutes;
  const isMessage = MESSAGE_ACTIONS.includes(d.action);
  return {
    id: d.id,
    anchor: d.anchor,
    offsetDays: sign * d.days || 0,
    offsetMinutes: sign * minutes || 0,
    atTime: d.atTime || null,
    action: d.action,
    subject: isMessage ? d.subject : null,
    body: isMessage ? d.body : null,
    label: d.action === 'label' ? d.label : null,
    condition: d.condition || null,
  };
}

const clampInt = (v: string, max: number) => Math.max(0, Math.min(max, Math.trunc(Number(v) || 0)));

/**
 * The step editor (M3.7a): every step is a group of native controls, reordered with Move up /
 * Move down buttons (no drag), so everything works from the keyboard. Focus follows the moved step.
 */
export function StepsEditor({
  name,
  trigger: initialTrigger,
  steps,
  action,
}: {
  name: string;
  trigger: JourneyTrigger;
  steps: readonly EditorStep[];
  action: (prev: JourneyFormState, form: FormData) => Promise<JourneyFormState>;
}) {
  const t = useTranslations('journeys');
  const te = useTranslations();
  const locale = useLocale();
  const base = useId();
  const [trigger, setTrigger] = useState<JourneyTrigger>(initialTrigger);
  const [title, setTitle] = useState(name);
  const [drafts, setDrafts] = useState<Draft[]>(() => steps.map(toDraft));
  const [focus, setFocus] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(action, INITIAL);

  useEffect(() => {
    if (!focus) return;
    document.getElementById(focus)?.focus();
    setFocus(null);
  }, [focus]);

  const set = (key: string, patch: Partial<Draft>) =>
    setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const move = (i: number, by: -1 | 1, which: 'up' | 'down') =>
    setDrafts((list) => {
      const next = [...list];
      const [d] = next.splice(i, 1);
      if (!d) return list;
      next.splice(i + by, 0, d);
      const target =
        i + by === 0 && which === 'up'
          ? 'down'
          : i + by === next.length - 1 && which === 'down'
            ? 'up'
            : which;
      setFocus(`${base}-${d.key}-${target}`);
      return next;
    });
  const remove = (i: number) =>
    setDrafts((list) => {
      const next = list.filter((_, j) => j !== i);
      const neighbour = next[Math.min(i, next.length - 1)];
      setFocus(neighbour ? `${base}-${neighbour.key}-legend` : `${base}-add`);
      return next;
    });
  const add = () => {
    const d = blankDraft(trigger);
    setDrafts((list) => [...list, d]);
    setFocus(`${base}-${d.key}-anchor`);
  };

  // `steps.2.subject` → step 2's subject field.
  const [, badIndex, badField] = /^steps\.(\d+)\.(\w+)$/.exec(state.field ?? '') ?? [];
  const stepError = (i: number, field: string) => {
    if (badIndex === undefined || Number(badIndex) !== i || badField !== field) return undefined;
    if (field === 'anchor') return t('editor.errors.anchor');
    if (field === 'offsetMinutes') return t('editor.errors.direction');
    if (field === 'offsetDays') return t('editor.errors.offset');
    return t('editor.errors.required');
  };
  const json = JSON.stringify(drafts.map(toInput));

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="steps" value={json} />
      <div className="grid gap-4 md:grid-cols-2">
        <Input
          id={`${base}-name`}
          name="name"
          label={t('form.name')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          required
          error={state.field === 'name' ? t('form.errors.name') : undefined}
        />
        <Select
          id={`${base}-trigger`}
          name="trigger"
          label={t('form.trigger')}
          value={trigger}
          onChange={(v) => setTrigger(v as JourneyTrigger)}
        >
          {JOURNEY_TRIGGERS.map((k) => (
            <option key={k} value={k}>
              {t(`triggers.${k}`)}
            </option>
          ))}
        </Select>
      </div>
      {drafts.length === 0 ? <p className="text-body text-zinc-500">{t('detail.noSteps')}</p> : null}
      <ol className="flex flex-col gap-4">
        {drafts.map((d, i) => {
          const id = (f: string) => `${base}-${d.key}-${f}`;
          const n = i + 1;
          const isMessage = MESSAGE_ACTIONS.includes(d.action);
          const input = toInput(d);
          return (
            <li key={d.key}>
              <fieldset className="flex flex-col gap-4 rounded-card border border-zinc-200 bg-white p-4">
                <legend id={id('legend')} tabIndex={-1} className="px-1 text-body font-medium">
                  {t('editor.step', { n })}
                </legend>
                <p className="text-caption text-zinc-500" data-testid="step-summary">
                  {describeWait(t, locale, input)}
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Select
                    id={id('anchor')}
                    label={t('editor.anchor')}
                    value={d.anchor}
                    onChange={(v) => set(d.key, { anchor: v as WaitAnchor })}
                    error={stepError(i, 'anchor')}
                  >
                    {WAIT_ANCHORS.map((a) => (
                      <option key={a} value={a}>
                        {t(`editor.anchors.${a}`)}
                      </option>
                    ))}
                  </Select>
                  {d.anchor !== 'trigger' ? (
                    <Select
                      id={id('dir')}
                      label={t('editor.direction')}
                      value={d.dir}
                      onChange={(v) => set(d.key, { dir: v as Draft['dir'] })}
                      error={stepError(i, 'offsetMinutes')}
                    >
                      <option value="before">{t('editor.before')}</option>
                      <option value="after">{t('editor.after')}</option>
                    </Select>
                  ) : null}
                  <Input
                    id={id('days')}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={MAX_OFFSET_DAYS}
                    label={t('editor.days')}
                    value={d.days}
                    onChange={(e) => set(d.key, { days: clampInt(e.target.value, MAX_OFFSET_DAYS) })}
                    error={stepError(i, 'offsetDays')}
                  />
                  <Input
                    id={id('hours')}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={23}
                    label={t('editor.hours')}
                    value={d.hours}
                    onChange={(e) => set(d.key, { hours: clampInt(e.target.value, 23) })}
                  />
                  <Input
                    id={id('minutes')}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={59}
                    label={t('editor.minutes')}
                    value={d.minutes}
                    onChange={(e) => set(d.key, { minutes: clampInt(e.target.value, 59) })}
                  />
                  <Input
                    id={id('at')}
                    type="time"
                    label={t('editor.atTime')}
                    hint={t('editor.atTimeHint')}
                    value={d.atTime}
                    onChange={(e) => set(d.key, { atTime: e.target.value })}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select
                    id={id('action')}
                    label={t('editor.action')}
                    value={d.action}
                    onChange={(v) => set(d.key, { action: v as StepAction })}
                  >
                    {STEP_ACTIONS.map((a) => (
                      <option key={a} value={a}>
                        {t(`editor.actions.${a}`)}
                      </option>
                    ))}
                  </Select>
                  <Select
                    id={id('condition')}
                    label={t('editor.condition')}
                    value={d.condition}
                    onChange={(v) => set(d.key, { condition: v as Draft['condition'] })}
                  >
                    <option value="">{t('editor.conditions.none')}</option>
                    {STEP_CONDITIONS.map((c) => (
                      <option key={c} value={c}>
                        {t(`editor.conditions.${c}`)}
                      </option>
                    ))}
                  </Select>
                </div>
                {isMessage ? (
                  <div className="flex flex-col gap-3">
                    <Input
                      id={id('subject')}
                      label={d.action === 'email' ? t('editor.subject') : t('editor.title')}
                      value={d.subject}
                      maxLength={150}
                      onChange={(e) => set(d.key, { subject: e.target.value })}
                      error={stepError(i, 'subject')}
                    />
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={id('body')} className="text-caption text-zinc-600">
                        {t('editor.body')}
                      </label>
                      <textarea
                        id={id('body')}
                        className={`${TEXTAREA} ${stepError(i, 'body') ? 'border-pink-700' : ''}`}
                        value={d.body}
                        maxLength={2000}
                        onChange={(e) => set(d.key, { body: e.target.value })}
                        aria-invalid={stepError(i, 'body') ? true : undefined}
                        aria-describedby={`${id('body')}-hint${stepError(i, 'body') ? ` ${id('body')}-error` : ''}`}
                      />
                      <p id={`${id('body')}-hint`} className="text-caption text-zinc-500">
                        {t('editor.placeholders', { name: '{name}', event: '{event}', when: '{when}' })}
                      </p>
                      {stepError(i, 'body') ? (
                        <p id={`${id('body')}-error`} className="text-caption text-pink-700">
                          {stepError(i, 'body')}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {d.action === 'label' ? (
                  <Input
                    id={id('label')}
                    label={t('editor.label')}
                    value={d.label}
                    maxLength={40}
                    onChange={(e) => set(d.key, { label: e.target.value })}
                    error={stepError(i, 'label')}
                  />
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    id={id('up')}
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={i === 0}
                    onClick={() => move(i, -1, 'up')}
                    aria-label={t('editor.moveUpFor', { n })}
                  >
                    {t('editor.moveUp')}
                  </Button>
                  <Button
                    id={id('down')}
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={i === drafts.length - 1}
                    onClick={() => move(i, 1, 'down')}
                    aria-label={t('editor.moveDownFor', { n })}
                  >
                    {t('editor.moveDown')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(i)}
                    aria-label={t('editor.removeFor', { n })}
                  >
                    {t('editor.remove')}
                  </Button>
                </div>
              </fieldset>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          id={`${base}-add`}
          type="button"
          variant="secondary"
          onClick={add}
          disabled={drafts.length >= MAX_STEPS}
        >
          {t('editor.add')}
        </Button>
        {drafts.length >= MAX_STEPS ? (
          <p className="text-caption text-zinc-500">{t('editor.max', { max: MAX_STEPS })}</p>
        ) : null}
      </div>
      <div aria-live="polite">
        {state.code && (!state.field || state.field === 'steps') ? (
          <Alert title={te(errorMessageKey(state.code))} />
        ) : state.code && badIndex !== undefined ? (
          <Alert title={t('editor.errors.step', { n: Number(badIndex) + 1 })} />
        ) : null}
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {t('editor.save')}
        </Button>
      </div>
    </form>
  );
}
