'use client';

import { Alert, Button, Checkbox, Input, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';

/**
 * M4.2b gala tables: the forms of the table's claim link (the buyer names guests) and of the
 * host's Tables & Sponsors page. Local compositions of `@yayatoh/ui` primitives; every error is
 * shown inline (the field it is about, or the form) and every success is announced.
 */

export interface TableFormState {
  readonly ok: boolean;
  readonly code: string | null;
  readonly reason?: string;
  readonly fields?: readonly string[];
  /** The guest just named (success message). */
  readonly named?: string;
  readonly sent?: number;
  readonly skipped?: number;
  readonly stamp?: number;
}

export const TABLE_FORM_INITIAL: TableFormState = { ok: false, code: null };

type Action = (prev: TableFormState, form: FormData) => Promise<TableFormState>;

/** Reasons with their own sentence (`galaTables.errors.*`). */
const REASONS = [
  'table_full',
  'slot_named',
  'event_over',
  'not_paid',
  'party_full',
  'not_a_table',
  'foreign_logo',
  'no_plan',
] as const;

function useErrorText() {
  const t = useTranslations();
  return (state: TableFormState) =>
    state.reason && (REASONS as readonly string[]).includes(state.reason)
      ? t(`galaTables.errors.${state.reason}`)
      : t(errorMessageKey(state.code));
}

const fieldError = (state: TableFormState, field: string, text: string) =>
  state.code && state.fields?.includes(field) ? text : undefined;

/** Name one guest of a table: first name (required), last name, and where their ticket goes. */
export function NameGuestForm({
  action,
  idPrefix,
  large = false,
  submitLabel,
}: {
  action: Action;
  idPrefix: string;
  /** Public pages: 44 px targets. */
  large?: boolean;
  submitLabel: string;
}) {
  const t = useTranslations('galaTables');
  const errorText = useErrorText();
  const [state, formAction, pending] = useActionState(action, TABLE_FORM_INITIAL);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-4" noValidate>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          id={`${idPrefix}-first`}
          name="firstName"
          required
          maxLength={80}
          autoComplete="off"
          label={t('firstName')}
          error={fieldError(state, 'firstName', t('errors.firstName'))}
        />
        <Input
          id={`${idPrefix}-last`}
          name="lastName"
          maxLength={80}
          autoComplete="off"
          label={t('lastName')}
        />
      </div>
      <Input
        id={`${idPrefix}-email`}
        name="email"
        type="email"
        maxLength={254}
        autoComplete="off"
        label={t('email')}
        hint={t('emailHint')}
        error={fieldError(state, 'email', t('errors.email'))}
      />
      <div aria-live="polite">
        {state.ok && state.named ? <Alert tone="success" title={t('named', { name: state.named })} /> : null}
        {state.code && !state.fields?.length ? <Alert title={errorText(state)} /> : null}
      </div>
      <Button type="submit" size={large ? 'lg' : 'md'} disabled={pending} className="self-start">
        {submitLabel}
      </Button>
    </form>
  );
}

/** The table's party: the buyer's company or the sponsor. */
export function CompanyForm({ action, current }: { action: Action; current: string | null }) {
  const t = useTranslations('galaTables');
  const errorText = useErrorText();
  const [state, formAction, pending] = useActionState(action, TABLE_FORM_INITIAL);
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <Input
        id="table-company"
        name="company"
        required
        maxLength={120}
        defaultValue={current ?? ''}
        label={t('company')}
        hint={t('companyHint')}
        error={fieldError(state, 'company', t('errors.company'))}
      />
      <div aria-live="polite">
        {state.ok ? <Alert tone="success" title={t('companySaved')} /> : null}
        {state.code && !state.fields?.length ? <Alert title={errorText(state)} /> : null}
      </div>
      <Button type="submit" size="lg" variant="secondary" disabled={pending} className="self-start">
        {t('companySave')}
      </Button>
    </form>
  );
}

/** One button that runs an action and announces what happened (resend the link, send reminders). */
export function ActionButton({
  action,
  label,
  done,
  large = false,
  variant = 'secondary',
}: {
  action: Action;
  label: string;
  /** Which success sentence to show. */
  done: 'resend' | 'reminders';
  large?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  const t = useTranslations('galaTables');
  const errorText = useErrorText();
  const [state, formAction, pending] = useActionState(action, TABLE_FORM_INITIAL);
  const message =
    done === 'resend'
      ? state.sent
        ? t('public.resent')
        : t('public.resendWait')
      : t('reminders.done', { sent: state.sent ?? 0, skipped: state.skipped ?? 0 });
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Button
        type="submit"
        variant={variant}
        size={large ? 'lg' : 'md'}
        disabled={pending}
        className="self-start"
      >
        {label}
      </Button>
      <div aria-live="polite">
        {state.ok ? (
          <Alert tone={done === 'resend' && !state.sent ? 'info' : 'success'} title={message} />
        ) : null}
        {state.code ? <Alert title={errorText(state)} /> : null}
      </div>
    </form>
  );
}

/** A table's sponsor on the floor plan: name, optional logo (an event image), shown to guests or not. */
export function SponsorForm({
  action,
  removeAction,
  idPrefix,
  table,
  sponsor,
  logos,
}: {
  action: Action;
  removeAction: Action | null;
  idPrefix: string;
  table: string;
  sponsor: { sponsorName: string; logoUrl: string | null; published: boolean } | null;
  logos: readonly { url: string; label: string }[];
}) {
  const t = useTranslations('galaTables');
  const errorText = useErrorText();
  const [state, formAction, pending] = useActionState(action, TABLE_FORM_INITIAL);
  const [removed, removeFormAction, removing] = useActionState(
    removeAction ?? (async () => TABLE_FORM_INITIAL),
    TABLE_FORM_INITIAL,
  );
  return (
    <div className="flex flex-col gap-3">
      <form
        action={formAction}
        className="flex flex-col gap-4"
        noValidate
        aria-label={t('sponsorFormOf', { table })}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            id={`${idPrefix}-name`}
            name="sponsorName"
            required
            maxLength={80}
            defaultValue={sponsor?.sponsorName ?? ''}
            label={t('sponsorName')}
            error={fieldError(state, 'sponsorName', t('errors.sponsorName'))}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idPrefix}-logo`} className="text-[13px] font-bold text-ink">
              {t('logo')}
            </label>
            <Select
              id={`${idPrefix}-logo`}
              name="logoUrl"
              defaultValue={sponsor?.logoUrl ?? ''}
              aria-describedby={`${idPrefix}-logo-hint`}
              className="field w-full pe-9"
            >
              <option value="">{t('noLogo')}</option>
              {logos.map((l) => (
                <option key={l.url} value={l.url}>
                  {l.label}
                </option>
              ))}
            </Select>
            <p id={`${idPrefix}-logo-hint`} className="text-caption text-ink-2">
              {t('logoHint')}
            </p>
          </div>
        </div>
        <Checkbox
          id={`${idPrefix}-published`}
          name="published"
          value="1"
          defaultChecked={sponsor?.published ?? false}
          label={t('published')}
          hint={t('publishedHint')}
        />
        <div aria-live="polite">
          {state.ok ? <Alert tone="success" title={t('sponsorSaved', { table })} /> : null}
          {state.code && !state.fields?.length ? <Alert title={errorText(state)} /> : null}
        </div>
        <Button type="submit" disabled={pending} className="self-start">
          {t('sponsorSave')}
        </Button>
      </form>
      {removeAction && sponsor ? (
        <form action={removeFormAction} className="flex flex-col gap-2 border-t border-line pt-3">
          <Button type="submit" variant="ghost" size="sm" disabled={removing} className="self-start">
            {t('sponsorRemove', { table })}
          </Button>
          <div aria-live="polite">
            {removed.ok ? <Alert tone="success" title={t('sponsorRemoved', { table })} /> : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
