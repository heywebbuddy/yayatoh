'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useId, useState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

const field = 'field';
const area = 'rounded-card border border-line bg-surface px-4 py-2 text-body';

type Action<S> = (prev: S, form: FormData) => Promise<S>;

/** A support action's answer: the form state, plus what to show once (a claim link, a code). */
export interface SupportState extends FormState {
  readonly link?: string;
  readonly label?: string;
  readonly code2?: string | null;
  readonly name?: string;
}
const INITIAL: SupportState = INITIAL_FORM_STATE;

/** Error wording shared by the support forms: a specific reason first, then the error code. */
function useMessage() {
  const t = useTranslations('supportTools');
  const te = useTranslations();
  return (s: SupportState, fallbackFields: Record<string, string> = {}) => {
    if (s.reason && t.has(`reasons.${s.reason}`)) return t(`reasons.${s.reason}`);
    for (const f of s.fields ?? []) if (fallbackFields[f]) return fallbackFields[f];
    return te(errorMessageKey(s.code));
  };
}

function ShownOnce({ label, value }: { label: string; value: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[13px] font-bold text-ink">
        {label}
      </label>
      <input
        id={id}
        readOnly
        value={value}
        dir="ltr"
        onFocus={(e) => e.currentTarget.select()}
        className={`${field} font-mono`}
      />
    </div>
  );
}

/** Organizer: transfer one of the order's tickets to a new name and email (M3.10c). */
export function TransferTicketForm({
  action,
  tickets,
}: {
  action: Action<SupportState>;
  tickets: readonly { id: string; label: string }[];
}) {
  const t = useTranslations('supportTools.transfers');
  const message = useMessage();
  const [state, formAction, pending] = useActionState(action, INITIAL);
  return (
    <form key={state.stamp ?? 0} action={formAction} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="transfer-ticket" className="text-[13px] font-bold text-ink">
          {t('ticket')}
        </label>
        <select id="transfer-ticket" name="ticketId" required className={field}>
          {tickets.map((tk) => (
            <option key={tk.id} value={tk.id}>
              {tk.label}
            </option>
          ))}
        </select>
      </div>
      <Input
        name="toName"
        id="transfer-to-name"
        required
        maxLength={120}
        autoComplete="off"
        label={t('toName')}
        aria-invalid={state.fields?.includes('toName') || undefined}
      />
      <Input
        name="toEmail"
        id="transfer-to-email"
        type="email"
        required
        autoComplete="off"
        label={t('toEmail')}
        hint={t('toEmailHint')}
        aria-invalid={state.fields?.includes('toEmail') || undefined}
      />
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.ok ? <Alert tone="info" title={t('started', { name: state.name ?? '' })} /> : null}
        {state.ok && state.link ? (
          <ShownOnce label={t('link')} value={`${window.location.origin}${state.link}`} />
        ) : null}
        {state.code ? (
          <Alert title={message(state, { toName: t('toNameInvalid'), toEmail: t('toEmailInvalid') })} />
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('submit')}
      </Button>
    </form>
  );
}

/** A one-button form (cancel a transfer, archive a macro). */
export function ConfirmButton({
  action,
  label,
  done,
  variant = 'secondary',
}: {
  action: Action<SupportState>;
  label: string;
  done: string;
  variant?: 'secondary' | 'ghost';
}) {
  const message = useMessage();
  const [state, formAction, pending] = useActionState(action, INITIAL);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <Button type="submit" size="sm" variant={variant} disabled={pending}>
        {label}
      </Button>
      <span aria-live="polite" className="text-caption">
        {state.ok ? done : state.code ? message(state) : null}
      </span>
    </form>
  );
}

/** Finance: issue a credit note against the order (M3.10c). */
export function CreditNoteForm({
  action,
  currency,
  creditable,
  requestKey,
}: {
  action: Action<SupportState>;
  currency: string;
  creditable: string;
  requestKey: string;
}) {
  const t = useTranslations('supportTools.credit');
  const message = useMessage();
  const [kind, setKind] = useState<'full' | 'partial'>('partial');
  const [state, formAction, pending] = useActionState(action, INITIAL);
  return (
    <form key={state.stamp ?? 0} action={formAction} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="key" value={requestKey} />
      <p className="text-caption text-ink-2">{t('creditable', { amount: creditable })}</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[13px] font-bold text-ink">{t('kindLegend')}</legend>
        {(['partial', 'full'] as const).map((k) => (
          <label key={k} className="flex min-h-6 items-center gap-2 text-body">
            <input
              type="radio"
              name="kind"
              value={k}
              checked={kind === k}
              onChange={() => setKind(k)}
              className="size-5"
            />
            {t(`kind.${k}`)}
          </label>
        ))}
      </fieldset>
      {kind === 'partial' ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="credit-amount" className="text-[13px] font-bold text-ink">
            {t('amount', { currency })}
          </label>
          <input
            id="credit-amount"
            name="amount"
            inputMode="decimal"
            aria-invalid={state.fields?.includes('amountMinor') || undefined}
            className={`${field} w-40`}
          />
        </div>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[13px] font-bold text-ink">{t('dispositionLegend')}</legend>
        {(['store_credit', 'refunded'] as const).map((d, i) => (
          <label key={d} className="flex min-h-6 items-center gap-2 text-body">
            <input type="radio" name="disposition" value={d} defaultChecked={i === 0} className="size-5" />
            {t(`disposition.${d}`)}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="credit-reason" className="text-[13px] font-bold text-ink">
          {t('reason')}
        </label>
        <textarea
          id="credit-reason"
          name="reason"
          maxLength={500}
          rows={2}
          aria-describedby="credit-reason-hint"
          aria-invalid={state.fields?.includes('reason') || undefined}
          className={area}
        />
        <p id="credit-reason-hint" className="text-caption text-ink-2">
          {t('reasonHint')}
        </p>
      </div>
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.ok ? <Alert tone="info" title={t('issued', { label: state.label ?? '' })} /> : null}
        {state.ok && state.code2 ? <ShownOnce label={t('codeOnce')} value={state.code2} /> : null}
        {state.code ? (
          <Alert title={message(state, { reason: t('reasonInvalid'), amountMinor: t('amountInvalid') })} />
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('submit')}
      </Button>
    </form>
  );
}

export interface MacroOption {
  readonly id: string;
  readonly name: string;
  readonly actions: readonly string[];
  readonly subject: string;
  readonly body: string;
}

/** Run a support macro on the order (M3.10c): pick it, see what it sends, fill the transfer if it has one. */
export function RunMacroForm({
  action,
  macros,
  tickets,
  requestKey,
}: {
  action: Action<SupportState>;
  macros: readonly MacroOption[];
  tickets: readonly { id: string; label: string }[];
  requestKey: string;
}) {
  const t = useTranslations('supportTools.macros');
  const message = useMessage();
  const [macroId, setMacroId] = useState(macros[0]?.id ?? '');
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const macro = macros.find((m) => m.id === macroId);
  const transfers = macro?.actions.includes('transfer_ticket') ?? false;
  return (
    <form key={state.stamp ?? 0} action={formAction} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="key" value={requestKey} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="macro-select" className="text-[13px] font-bold text-ink">
          {t('choose')}
        </label>
        <select
          id="macro-select"
          name="macroId"
          value={macroId}
          onChange={(e) => setMacroId(e.target.value)}
          className={field}
        >
          {macros.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      {macro ? (
        <section
          className="flex flex-col gap-1 rounded-card border border-line p-3"
          aria-label={t('preview')}
        >
          <p className="text-caption text-ink-2">
            {t('does', { actions: macro.actions.map((a) => t(`action.${a}`)).join(' · ') })}
          </p>
          {macro.actions.includes('email_buyer') || macro.actions.includes('add_note') ? (
            <>
              <p className="text-body font-medium">{macro.subject}</p>
              <p className="whitespace-pre-line break-words text-body">{macro.body}</p>
            </>
          ) : null}
        </section>
      ) : null}
      {transfers ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-[13px] font-bold text-ink">{t('transferLegend')}</legend>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="macro-ticket" className="text-[13px] font-bold text-ink">
              {t('ticket')}
            </label>
            <select id="macro-ticket" name="ticketId" className={field}>
              {tickets.map((tk) => (
                <option key={tk.id} value={tk.id}>
                  {tk.label}
                </option>
              ))}
            </select>
          </div>
          <Input name="toName" id="macro-to-name" maxLength={120} autoComplete="off" label={t('toName')} />
          <Input name="toEmail" id="macro-to-email" type="email" autoComplete="off" label={t('toEmail')} />
        </fieldset>
      ) : null}
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.ok ? <Alert tone="info" title={t('ran', { name: state.name ?? '' })} /> : null}
        {state.ok && state.link ? (
          <ShownOnce label={t('link')} value={`${window.location.origin}${state.link}`} />
        ) : null}
        {state.code ? <Alert title={message(state, { transfer: t('transferRequired') })} /> : null}
      </div>
      <Button type="submit" disabled={pending || !macro} className="self-start">
        {t('run')}
      </Button>
    </form>
  );
}

/** Create or edit a support macro (M3.10c): name, reply with merge fields, actions. */
export function MacroEditor({
  action,
  macro,
  fields,
  idPrefix,
}: {
  action: Action<SupportState>;
  macro?: MacroOption;
  fields: readonly string[];
  idPrefix: string;
}) {
  const t = useTranslations('supportTools.macros');
  const message = useMessage();
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const id = (s: string) => `${idPrefix}-${s}`;
  return (
    <form
      key={macro ? undefined : (state.stamp ?? 0)}
      action={formAction}
      className="flex flex-col gap-3"
      noValidate
    >
      <Input
        name="name"
        id={id('name')}
        required
        maxLength={80}
        defaultValue={macro?.name}
        label={t('name')}
        aria-invalid={state.fields?.includes('name') || undefined}
      />
      <Input
        name="subject"
        id={id('subject')}
        required
        maxLength={200}
        defaultValue={macro?.subject}
        label={t('subject')}
        aria-invalid={state.fields?.includes('subject') || undefined}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id('body')} className="text-[13px] font-bold text-ink">
          {t('body')}
        </label>
        <textarea
          id={id('body')}
          name="body"
          required
          maxLength={5000}
          rows={4}
          defaultValue={macro?.body}
          aria-describedby={id('fields')}
          aria-invalid={state.fields?.includes('body') || undefined}
          className={area}
        />
        <p id={id('fields')} className="text-caption text-ink-2">
          {t('fieldsHint')}{' '}
          <span dir="ltr" className="font-mono">
            {fields.map((f) => `{{${f}}}`).join(' ')}
          </span>
        </p>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[13px] font-bold text-ink">{t('actionsLegend')}</legend>
        {(['email_buyer', 'add_note', 'resend_tickets', 'transfer_ticket'] as const).map((a) => (
          <label key={a} className="flex min-h-6 items-center gap-2 text-body">
            <input
              type="checkbox"
              name="actions"
              value={a}
              defaultChecked={macro ? macro.actions.includes(a) : a === 'email_buyer'}
              className="size-5"
            />
            {t(`action.${a}`)}
          </label>
        ))}
      </fieldset>
      <div aria-live="polite">
        {state.ok ? <Alert tone="info" title={t('saved')} /> : null}
        {state.code ? (
          <Alert
            title={message(state, {
              name: t('nameInvalid'),
              actions: t('actionsInvalid'),
              subject: t('subjectInvalid'),
              body: t('bodyInvalid'),
            })}
          />
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {macro ? t('update') : t('create')}
      </Button>
    </form>
  );
}

/** Holder: transfer my ticket to someone by name and email, agreeing to the fee when there is one. */
export function HolderTransferForm({
  action,
  idPrefix,
  fee,
}: {
  action: Action<SupportState>;
  idPrefix: string;
  fee: string | null;
}) {
  const t = useTranslations('supportTools.holder');
  const message = useMessage();
  const [state, formAction, pending] = useActionState(action, INITIAL);
  return (
    <form key={state.stamp ?? 0} action={formAction} className="flex flex-col gap-3" noValidate>
      <Input
        name="toName"
        id={`${idPrefix}-name`}
        required
        maxLength={120}
        autoComplete="off"
        label={t('toName')}
        aria-invalid={state.fields?.includes('toName') || undefined}
      />
      <Input
        name="toEmail"
        id={`${idPrefix}-email`}
        type="email"
        required
        autoComplete="off"
        label={t('toEmail')}
        aria-invalid={state.fields?.includes('toEmail') || undefined}
      />
      {fee ? (
        <label className="flex min-h-6 items-center gap-2 text-body">
          <input type="checkbox" name="acceptFee" value="yes" className="size-5" />
          {t('acceptFee', { fee })}
        </label>
      ) : null}
      <div aria-live="polite">
        {state.ok ? <Alert tone="info" title={t('sent', { name: state.name ?? '' })} /> : null}
        {state.code ? (
          <Alert title={message(state, { toName: t('toNameInvalid'), toEmail: t('toEmailInvalid') })} />
        ) : null}
      </div>
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {t('submit')}
      </Button>
    </form>
  );
}

/** A ticket type's transfer rules (M3.10c): may holders transfer, until when, for what fee. */
export function TransferRulesForm({
  action,
  idPrefix,
  name,
  currency,
  rules,
}: {
  action: Action<SupportState>;
  idPrefix: string;
  name: string;
  currency: string;
  rules: { allowed: boolean; cutoffHours: number | null; fee: string };
}) {
  const t = useTranslations('supportTools.rules');
  const message = useMessage();
  const [state, formAction, pending] = useActionState(action, INITIAL);
  return (
    <form
      action={formAction}
      className="flex flex-wrap items-end gap-4"
      aria-label={t('formLabel', { name })}
    >
      <label className="flex min-h-10 items-center gap-2 text-body">
        <input type="checkbox" name="allowed" value="yes" defaultChecked={rules.allowed} className="size-5" />
        {t('allowed')}
      </label>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${idPrefix}-cutoff`} className="text-[13px] font-bold text-ink">
          {t('cutoff')}
        </label>
        <input
          id={`${idPrefix}-cutoff`}
          name="cutoffHours"
          inputMode="numeric"
          defaultValue={rules.cutoffHours ?? ''}
          aria-describedby={`${idPrefix}-cutoff-hint`}
          aria-invalid={state.fields?.includes('transferCutoffHours') || undefined}
          className={`${field} w-28`}
        />
        <span id={`${idPrefix}-cutoff-hint`} className="text-caption text-ink-2">
          {t('cutoffHint')}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${idPrefix}-fee`} className="text-[13px] font-bold text-ink">
          {t('fee', { currency })}
        </label>
        <input
          id={`${idPrefix}-fee`}
          name="fee"
          inputMode="decimal"
          defaultValue={rules.fee}
          aria-invalid={state.fields?.includes('transferFeeMinor') || undefined}
          className={`${field} w-28`}
        />
        <span className="text-caption text-ink-2">{t('feeHint')}</span>
      </div>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {t('save')}
      </Button>
      <span aria-live="polite" className="basis-full text-caption">
        {state.ok
          ? t('saved')
          : state.code
            ? message(state, { transferCutoffHours: t('cutoffInvalid'), transferFeeMinor: t('feeInvalid') })
            : null}
      </span>
    </form>
  );
}
