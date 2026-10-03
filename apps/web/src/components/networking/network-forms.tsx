'use client';

import { Button, type ButtonVariant, Select, ToastProvider, useToast } from '@yayatoh/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useActionState, useEffect, useId, useRef } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

/**
 * Networking forms (M5.8a), composed from `@yayatoh/ui` primitives. Every form works from the
 * keyboard, keeps what was typed when refused, shows the refusal next to it (`role="alert"`) and
 * confirms success with a toast (a polite live region).
 */
type Action = (prev: FormState, form: FormData) => Promise<FormState>;

/** The toast region of the networking pages. */
export function NetworkToasts({ children, closeLabel }: { children: ReactNode; closeLabel: string }) {
  return <ToastProvider closeLabel={closeLabel}>{children}</ToastProvider>;
}

/** The message for a refusal: a networking reason when there is one, else the error code's. */
function useRefusal() {
  const t = useTranslations();
  return (state: FormState): string | null => {
    if (state.ok || !state.code) return null;
    const key = `networking.errors.${state.reason ?? state.code}`;
    return t.has(key) ? t(key) : t(errorMessageKey(state.code));
  };
}

/**
 * Toast on success from inside the action, before React commits the refreshed page: the button or
 * form may be gone from it (an answered request leaves its list), the toast region stays.
 */
function useWithToast<A extends unknown[]>(
  action: (prev: FormState, ...rest: A) => Promise<FormState>,
  title: string | undefined,
  onDone?: () => void,
) {
  const toast = useToast();
  return async (prev: FormState, ...rest: A): Promise<FormState> => {
    const r = await action(prev, ...rest);
    if (r.ok) {
      if (title) toast({ title, tone: 'success' });
      onDone?.();
    }
    return r;
  };
}

/** One button that runs one action (accept, decline, withdraw, cancel, unblock …). */
export function ActionButton({
  action,
  label,
  done,
  variant = 'secondary',
  accessibleName,
}: {
  action: (prev: FormState) => Promise<FormState>;
  label: string;
  done?: string;
  variant?: ButtonVariant;
  /** A fuller name when the visible label is short ("Accept" → "Accept Ana's request"). */
  accessibleName?: string;
}) {
  const [state, formAction, pending] = useActionState(useWithToast(action, done), INITIAL_FORM_STATE);
  const refusal = useRefusal()(state);
  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <Button type="submit" variant={variant} loading={pending} aria-label={accessibleName}>
        {label}
      </Button>
      {refusal && !pending ? (
        <p role="alert" className="text-caption text-danger">
          {refusal}
        </p>
      ) : null}
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-bold text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-caption text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-caption text-ink-2">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, error: unknown, hint: unknown) =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

/** "Connect" with an optional note. */
export function ConnectForm({ action, personName }: { action: Action; personName: string }) {
  const t = useTranslations('networking');
  const id = useId();
  const ref = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    useWithToast(action, t('person.requestSent', { name: personName }), () => ref.current?.reset()),
    INITIAL_FORM_STATE,
  );
  const refusal = useRefusal()(state);
  return (
    <form
      ref={ref}
      action={formAction}
      onSubmit={keepValues(formAction)}
      className="flex flex-col gap-3"
      noValidate
    >
      <Field id={`${id}-message`} label={t('person.note')} hint={t('person.noteHint')}>
        <textarea
          id={`${id}-message`}
          name="message"
          rows={3}
          maxLength={300}
          aria-describedby={`${id}-message-hint`}
          className="rounded-card border border-line-strong bg-surface px-4 py-2 text-body"
        />
      </Field>
      {refusal && !pending ? (
        <p role="alert" className="text-caption text-danger">
          {refusal}
        </p>
      ) : null}
      <Button type="submit" loading={pending} className="self-start">
        {t('person.connect')}
      </Button>
    </form>
  );
}

/** Ask for a meeting: a slot, a place and an optional note. */
export function MeetingRequestForm({
  action,
  personName,
  slots,
  locations,
}: {
  action: Action;
  personName: string;
  slots: readonly { value: string; label: string }[];
  locations: readonly { value: string; label: string }[];
}) {
  const t = useTranslations('networking');
  const id = useId();
  const ref = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    useWithToast(action, t('person.meetingSent', { name: personName }), () => ref.current?.reset()),
    INITIAL_FORM_STATE,
  );
  const refusal = useRefusal()(state);
  const bad = new Set(state.fields ?? []);
  const slotError = bad.has('slotId')
    ? state.reason === 'past'
      ? t('errors.past')
      : t('person.slotRequired')
    : null;
  const placeError = bad.has('locationId') ? t('person.placeRequired') : null;
  return (
    <form
      ref={ref}
      action={formAction}
      onSubmit={keepValues(formAction)}
      className="flex flex-col gap-3"
      noValidate
    >
      <Field id={`${id}-slot`} label={t('person.slot')} error={slotError}>
        <Select
          id={`${id}-slot`}
          name="slotId"
          defaultValue=""
          aria-invalid={slotError ? true : undefined}
          aria-describedby={describedBy(`${id}-slot`, slotError, null)}
          className="field"
        >
          <option value="">{t('person.chooseSlot')}</option>
          {slots.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field id={`${id}-place`} label={t('person.place')} error={placeError}>
        <Select
          id={`${id}-place`}
          name="locationId"
          defaultValue=""
          aria-invalid={placeError ? true : undefined}
          aria-describedby={describedBy(`${id}-place`, placeError, null)}
          className="field"
        >
          <option value="">{t('person.choosePlace')}</option>
          {locations.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field id={`${id}-message`} label={t('person.note')} hint={t('person.noteHint')}>
        <textarea
          id={`${id}-message`}
          name="message"
          rows={2}
          maxLength={300}
          aria-describedby={`${id}-message-hint`}
          className="rounded-card border border-line-strong bg-surface px-4 py-2 text-body"
        />
      </Field>
      {refusal && !pending && !slotError && !placeError ? (
        <p role="alert" className="text-caption text-danger">
          {refusal}
        </p>
      ) : null}
      <Button type="submit" loading={pending} className="self-start">
        {t('person.requestMeeting')}
      </Button>
    </form>
  );
}

/** Block or report, behind a disclosure; afterwards the person is gone, so go to the directory. */
export function SafetyForms({
  block,
  report,
  personName,
  reasons,
  after,
}: {
  block: (prev: FormState) => Promise<FormState>;
  report: Action;
  personName: string;
  reasons: readonly { value: string; label: string }[];
  after: { blocked: string; reported: string };
}) {
  const t = useTranslations('networking');
  const id = useId();
  const router = useRouter();
  const [blocked, blockAction, blocking] = useActionState(block, INITIAL_FORM_STATE);
  const [reported, reportAction, reporting] = useActionState(report, INITIAL_FORM_STATE);
  const refusal = useRefusal();
  useEffect(() => {
    if (blocked.ok) router.push(after.blocked);
  }, [blocked, router, after.blocked]);
  useEffect(() => {
    if (reported.ok) router.push(after.reported);
  }, [reported, router, after.reported]);
  const bad = new Set(reported.fields ?? []);
  const reasonError = bad.has('reason') ? t('safety.reasonRequired') : null;
  const detailsError = bad.has('details') ? t('safety.detailsRequired') : null;
  const blockRefusal = refusal(blocked);
  const reportRefusal = reasonError || detailsError ? null : refusal(reported);
  return (
    <details className="rounded-card border border-line bg-surface p-4">
      <summary className="min-h-11 cursor-pointer content-center font-bold text-ink">
        {t('safety.summary', { name: personName })}
      </summary>
      <div className="flex flex-col gap-6 pt-4">
        <form action={blockAction} className="flex flex-col gap-2">
          <p className="text-body text-ink-2">{t('safety.blockHelp', { name: personName })}</p>
          <Button type="submit" variant="danger" loading={blocking} className="self-start">
            {t('safety.block', { name: personName })}
          </Button>
          {blockRefusal && !blocking ? (
            <p role="alert" className="text-caption text-danger">
              {blockRefusal}
            </p>
          ) : null}
        </form>
        <form
          action={reportAction}
          onSubmit={keepValues(reportAction)}
          className="flex flex-col gap-3"
          noValidate
        >
          <p className="text-body text-ink-2">{t('safety.reportHelp')}</p>
          <Field id={`${id}-reason`} label={t('safety.reason')} error={reasonError}>
            <Select
              id={`${id}-reason`}
              name="reason"
              defaultValue=""
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={describedBy(`${id}-reason`, reasonError, null)}
              className="field"
            >
              <option value="">{t('safety.chooseReason')}</option>
              {reasons.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id={`${id}-details`}
            label={t('safety.details')}
            hint={t('safety.detailsHint')}
            error={detailsError}
          >
            <textarea
              id={`${id}-details`}
              name="details"
              rows={3}
              maxLength={500}
              aria-invalid={detailsError ? true : undefined}
              aria-describedby={describedBy(`${id}-details`, detailsError, true)}
              className={`rounded-card border border-line-strong bg-surface px-4 py-2 text-body ${detailsError ? 'field-invalid' : ''}`}
            />
          </Field>
          {reportRefusal && !reporting ? (
            <p role="alert" className="text-caption text-danger">
              {reportRefusal}
            </p>
          ) : null}
          <Button type="submit" variant="danger" loading={reporting} className="self-start">
            {t('safety.report', { name: personName })}
          </Button>
        </form>
      </div>
    </details>
  );
}
