'use client';

import { isEmptyAnswer, type RespondentPage, visibleOnPage } from '@yayatoh/forms/ui';
import { Alert, Button, Input, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useId, useRef, useState } from 'react';
import type { RegistrationStartState } from '@/app/[locale]/events/[slug]/registration-form/actions.ts';
import type { RespondState } from '@/app/[locale]/registration-form/[token]/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { keepValues } from '@/lib/keep-values.ts';

const CONTROL = 'field w-full';
const AREA = 'w-full rounded-card border bg-surface px-4 py-2.5 text-body text-ink';
const CAPTION = 'text-caption text-ink-2';

/**
 * The page key the person last saw in this tab: when the page changes (Continue, Back, submit),
 * focus moves to the new page's heading; the first load keeps the browser's focus.
 */
let lastPageSeen: string | null = null;

/** The heading of the "submitted" view; focused when the person just submitted in this tab. */
export function SubmittedHeading({ title }: { title: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (lastPageSeen !== null) ref.current?.focus();
    lastPageSeen = null;
  }, []);
  return (
    <h1 ref={ref} tabIndex={-1} className="text-title outline-none">
      {title}
    </h1>
  );
}

function useMessage() {
  const t = useTranslations();
  return (state: { code: string | null; reason?: string; retryMinutes?: number }) => {
    if (state.code === 'rate_limited')
      return t('registrationForm.errors.rateLimited', { minutes: state.retryMinutes ?? 1 });
    if (state.reason && t.has(`registrationForm.errors.${state.reason}`))
      return t(`registrationForm.errors.${state.reason}`);
    return t(errorMessageKey(state.code));
  };
}

/** Pick a registration type, name and email: the first step before the form's own pages. */
export function RegistrationStartForm({
  types,
  action,
}: {
  types: readonly { readonly id: string; readonly name: string }[];
  action: (prev: RegistrationStartState, form: FormData) => Promise<RegistrationStartState>;
}) {
  const t = useTranslations('registrationForm');
  const id = useId();
  const message = useMessage();
  const [state, formAction, pending] = useActionState(action, { code: null });
  const err = (f: string) =>
    state.code === 'validation_failed' && state.field === f ? t(`errors.start_${f}`) : undefined;
  return (
    <form action={formAction} onSubmit={keepValues(formAction)} className="flex flex-col gap-5" noValidate>
      <fieldset
        className="flex flex-col gap-2"
        aria-describedby={err('type') ? `${id}-type-error` : undefined}
      >
        <legend className="mb-1 text-section">{t('typeLegend')}</legend>
        {types.map((ty) => (
          <label key={ty.id} className="flex min-h-6 items-center gap-2.5 text-body">
            <input type="radio" name="type" value={ty.id} required className="size-5 accent-primary" />
            {ty.name}
          </label>
        ))}
        {err('type') ? (
          <p id={`${id}-type-error`} className="text-caption text-danger">
            {err('type')}
          </p>
        ) : null}
      </fieldset>
      <Input
        id={`${id}-name`}
        name="name"
        required
        maxLength={120}
        autoComplete="name"
        label={t('yourName')}
        error={err('name')}
      />
      <Input
        id={`${id}-email`}
        name="email"
        type="email"
        required
        maxLength={254}
        autoComplete="email"
        label={t('yourEmail')}
        hint={t('emailHint')}
        error={err('email')}
      />
      <div aria-live="polite">
        {state.code && state.code !== 'validation_failed' ? <Alert title={message(state)} /> : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('start')}
      </Button>
    </form>
  );
}

type Values = Record<string, unknown>;

/**
 * One page of the person's path (the server sent only this page, with this registration type's
 * questions). Same-page conditions are evaluated as they type; the server decides the rest.
 */
export function RegistrationFormRunner({
  page,
  values,
  step,
  steps,
  first,
  last,
  jobTitles,
  consentTexts,
  action,
  suggest,
}: {
  page: RespondentPage;
  values: Values;
  step: number;
  steps: number;
  first: boolean;
  last: boolean;
  jobTitles: readonly string[];
  consentTexts: Readonly<Record<string, string>>;
  action: (prev: RespondState, form: FormData) => Promise<RespondState>;
  suggest: (prefix: string) => Promise<string[]>;
}) {
  const t = useTranslations('registrationForm');
  const id = useId();
  const message = useMessage();
  const [state, formAction, pending] = useActionState(action, { code: null });
  const [vals, setVals] = useState<Values>(values);
  const heading = useRef<HTMLHeadingElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const set = (key: string, v: unknown) => setVals((prev) => ({ ...prev, [key]: v }));
  const visible = visibleOnPage(page, vals);

  useEffect(() => {
    if (lastPageSeen !== null && lastPageSeen !== page.key) heading.current?.focus();
    lastPageSeen = page.key;
  }, [page.key]);
  useEffect(() => {
    if (state.stamp && state.code) summary.current?.focus();
  }, [state]);

  const fieldId = (key: string) => `${id}-${key}`;
  const errorFor = (key: string) => (state.code && state.field === key ? message(state) : null);

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <p id={`${id}-progress`} className={CAPTION}>
          {t('stepOf', { step, steps })}
        </p>
        <progress
          max={steps}
          value={step}
          aria-labelledby={`${id}-progress`}
          className="h-2 w-full overflow-hidden rounded-pill accent-primary"
        />
      </div>
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-title`} ref={heading} tabIndex={-1} className="text-section outline-none">
          {page.title}
        </h2>
        {page.description ? <p className="text-body text-ink-2">{page.description}</p> : null}
      </div>
      <div ref={summary} tabIndex={-1} aria-live="polite" className="outline-none">
        {state.code ? (
          <Alert title={t('fixTitle')}>
            <p>{message(state)}</p>
            {state.field && visible.some((f) => f.key === state.field) ? (
              <a href={`#${fieldId(state.field)}`} className="underline underline-offset-2">
                {t('goToQuestion', { label: visible.find((f) => f.key === state.field)?.label ?? '' })}
              </a>
            ) : null}
          </Alert>
        ) : state.emailed ? (
          <Alert tone="info" title={t('emailedTitle')}>
            <p>{t('emailedDescription')}</p>
          </Alert>
        ) : null}
      </div>
      <form action={formAction} onSubmit={keepValues(formAction)} className="flex flex-col gap-5" noValidate>
        {visible.map((f) => {
          const fid = fieldId(f.key);
          const err = errorFor(f.key);
          const described = [f.help ? `${fid}-help` : null, err ? `${fid}-error` : null]
            .filter(Boolean)
            .join(' ');
          const label = (
            <>
              {f.label}
              {f.required ? <span className="text-ink-2"> {t('requiredMark')}</span> : null}
            </>
          );
          const common = {
            id: fid,
            'aria-invalid': err ? true : undefined,
            'aria-describedby': described || undefined,
          } as const;
          const help = f.help ? (
            <p id={`${fid}-help`} className="text-caption text-ink-2">
              {f.help}
            </p>
          ) : null;
          const error = err ? (
            <p id={`${fid}-error`} className="text-caption text-danger">
              {err}
            </p>
          ) : null;
          const border = err ? 'field-invalid' : '';
          let control: React.ReactNode;
          switch (f.type) {
            case 'checkbox':
            case 'consent':
              control = (
                <label className="flex min-h-6 items-start gap-2.5 text-body">
                  <input
                    {...common}
                    type="checkbox"
                    name={f.key}
                    checked={vals[f.key] === true}
                    onChange={(e) => set(f.key, e.target.checked)}
                    className="mt-0.5 size-5 shrink-0 accent-primary"
                  />
                  <span>{f.type === 'consent' ? (consentTexts[f.key] ?? f.label) : label}</span>
                </label>
              );
              break;
            case 'multi_select': {
              const chosen = Array.isArray(vals[f.key]) ? (vals[f.key] as string[]) : [];
              control = (
                <fieldset aria-describedby={described || undefined} className="flex flex-col gap-1.5">
                  <legend className={CAPTION}>{label}</legend>
                  {f.options.map((o) => (
                    <label key={o.value} className="flex min-h-6 items-center gap-2.5 text-body">
                      <input
                        type="checkbox"
                        name={f.key}
                        value={o.value}
                        checked={chosen.includes(o.value)}
                        onChange={(e) =>
                          set(
                            f.key,
                            e.target.checked ? [...chosen, o.value] : chosen.filter((v) => v !== o.value),
                          )
                        }
                        className="size-5 accent-primary"
                      />
                      {o.label}
                    </label>
                  ))}
                </fieldset>
              );
              break;
            }
            case 'select':
              control = (
                <>
                  <label htmlFor={fid} className={CAPTION}>
                    {label}
                  </label>
                  <Select
                    {...common}
                    name={f.key}
                    value={typeof vals[f.key] === 'string' ? (vals[f.key] as string) : ''}
                    onValueChange={(v) => set(f.key, v)}
                    className={`${CONTROL} ${border}`}
                  >
                    <option value="">{t('choose')}</option>
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </>
              );
              break;
            case 'long_text':
              control = (
                <>
                  <label htmlFor={fid} className={CAPTION}>
                    {label}
                  </label>
                  <textarea
                    {...common}
                    name={f.key}
                    rows={4}
                    maxLength={2000}
                    value={String(vals[f.key] ?? '')}
                    onChange={(e) => set(f.key, e.target.value)}
                    className={`${AREA} ${border}`}
                  />
                </>
              );
              break;
            case 'job_title':
              control = (
                <JobTitleField
                  fid={fid}
                  name={f.key}
                  label={label}
                  titles={jobTitles}
                  value={String(vals[f.key] ?? '')}
                  onChange={(v) => set(f.key, v)}
                  common={common}
                  border={border}
                />
              );
              break;
            case 'company':
              control = (
                <CompanyField
                  fid={fid}
                  name={f.key}
                  label={label}
                  value={String(vals[f.key] ?? '')}
                  onChange={(v) => set(f.key, v)}
                  suggest={suggest}
                  common={common}
                  border={border}
                />
              );
              break;
            default:
              control = (
                <>
                  <label htmlFor={fid} className={CAPTION}>
                    {label}
                  </label>
                  <input
                    {...common}
                    name={f.key}
                    type={f.type === 'number' || f.type === 'count' ? 'number' : 'text'}
                    inputMode={f.type === 'count' ? 'numeric' : undefined}
                    min={f.type === 'count' ? 0 : (f.min ?? undefined)}
                    max={f.max ?? undefined}
                    maxLength={f.type === 'short_text' ? 200 : undefined}
                    value={isEmptyAnswer(vals[f.key]) ? '' : String(vals[f.key])}
                    onChange={(e) =>
                      set(
                        f.key,
                        (f.type === 'number' || f.type === 'count') && e.target.value !== ''
                          ? Number(e.target.value)
                          : e.target.value,
                      )
                    }
                    className={`${CONTROL} ${border}`}
                  />
                </>
              );
          }
          return (
            <div key={f.key} className="flex flex-col gap-1.5">
              <input type="hidden" name="__shown" value={f.key} />
              {control}
              {help}
              {error}
            </div>
          );
        })}
        {/* Continue first: Enter in a field submits the first button, so it must never be Back. */}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" name="intent" value="next" disabled={pending}>
            {last ? t('submit') : t('continue')}
          </Button>
          <Button type="submit" name="intent" value="email" variant="ghost" disabled={pending}>
            {t('saveForLater')}
          </Button>
          {!first ? (
            <Button type="submit" name="intent" value="back" variant="secondary" disabled={pending}>
              {t('back')}
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}

type Common = { id: string; 'aria-invalid': true | undefined; 'aria-describedby': string | undefined };

/** The org's job titles plus "Other" (free text); the chosen value is what is posted. */
function JobTitleField({
  fid,
  name,
  label,
  titles,
  value,
  onChange,
  common,
  border,
}: {
  fid: string;
  name: string;
  label: React.ReactNode;
  titles: readonly string[];
  value: string;
  onChange: (v: string) => void;
  common: Common;
  border: string;
}) {
  const t = useTranslations('registrationForm');
  const listed = titles.includes(value);
  const [other, setOther] = useState(value !== '' && !listed);
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <label htmlFor={fid} className={CAPTION}>
        {label}
      </label>
      <Select
        {...common}
        value={other ? '__other' : listed ? value : ''}
        onValueChange={(next) => {
          const v = next;
          setOther(v === '__other');
          onChange(v === '__other' || v === '' ? '' : v);
        }}
        className={`${CONTROL} ${border}`}
      >
        <option value="">{t('choose')}</option>
        {titles.map((j) => (
          <option key={j} value={j}>
            {j}
          </option>
        ))}
        <option value="__other">{t('otherJobTitle')}</option>
      </Select>
      {other ? (
        <Input
          id={`${fid}-other`}
          label={t('yourJobTitle')}
          maxLength={120}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}
    </>
  );
}

/** Free text with suggestions (a native datalist: keyboard and screen-reader friendly). */
function CompanyField({
  fid,
  name,
  label,
  value,
  onChange,
  suggest,
  common,
  border,
}: {
  fid: string;
  name: string;
  label: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  suggest: (prefix: string) => Promise<string[]>;
  common: Common;
  border: string;
}) {
  const [options, setOptions] = useState<string[]>([]);
  useEffect(() => {
    if (value.trim().length < 2) {
      setOptions([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      suggest(value)
        .then((o) => {
          if (live) setOptions(o);
        })
        .catch(() => {});
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [value, suggest]);
  return (
    <>
      <label htmlFor={fid} className={CAPTION}>
        {label}
      </label>
      <input
        {...common}
        name={name}
        type="text"
        list={`${fid}-list`}
        autoComplete="organization"
        maxLength={200}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${CONTROL} ${border}`}
      />
      <datalist id={`${fid}-list`}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}
