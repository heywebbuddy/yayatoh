'use client';

import type { PublicCampaignDto } from '@yayatoh/donations';
import { processingFeeCover } from '@yayatoh/donations/giving';
import { formatMoney, moneyFromDecimal } from '@yayatoh/kernel';
import { Alert, Button, FieldMessage, Input, Select, Textarea } from '@yayatoh/ui';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, startTransition, useActionState, useEffect, useRef, useState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import type { GiveState } from './actions.ts';

type Action = (prev: GiveState, form: FormData) => Promise<GiveState>;

/** Phone-first targets (44 px) for the public page; the chosen option gets a violet outline. */
const option =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-tile border border-line bg-surface-2 px-4 py-3 text-body text-ink transition-colors duration-150 hover:border-line-strong has-[:checked]:border-primary has-[:checked]:ring-1 has-[:checked]:ring-primary';
const choiceInput = 'size-5 shrink-0 cursor-pointer accent-primary';
const legend = 'm-0 mb-3 p-0 text-card text-ink';
/** The public cards of the v2 event page (give-frame.tsx; that module is server-only). */
const giveCard = 'flex flex-col gap-4 rounded-panel border border-line bg-surface p-5 elevation-card glass';
const fieldMessages = ['choice', 'amount', 'name', 'email', 'displayAs', 'tributeName'] as const;

/**
 * The giving form (M4.8a): a level or an own amount, the processing-fee cover with its exact
 * amount (off by default, P4-10), the donor, how their name appears (P4-13, no default: the donor
 * chooses), an optional employer (P4-17) and an optional tribute. Native radios, a checkbox and a
 * select: everything works with the keyboard; the first field to fix gets focus and its message.
 */
export function GiveForm({ campaign, action }: { campaign: PublicCampaignDto; action: Action }) {
  const t = useTranslations('donations.give');
  const tr = useTranslations();
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(action, { code: null } as GiveState);
  const ref = useRef<HTMLFormElement>(null);
  const [choice, setChoice] = useState('');
  const [own, setOwn] = useState('');
  const [cover, setCover] = useState(false);
  const [tribute, setTribute] = useState('none');
  const fmt = (minor: number) => formatMoney({ amount: minor, currency: campaign.currency }, locale);
  useEffect(() => {
    if (state.field) ref.current?.querySelector<HTMLElement>(`[name="${state.field}"]`)?.focus();
  }, [state]);

  let gift = 0;
  if (choice.startsWith('level:'))
    gift = campaign.levels.find((l) => `level:${l.id}` === choice)?.amountMinor ?? 0;
  else if (choice === 'other' && own.trim()) {
    try {
      gift = moneyFromDecimal(own, campaign.currency).amount;
    } catch {
      gift = 0;
    }
  }
  const fee = gift > 0 ? processingFeeCover(gift) : 0;
  const total = gift + (cover ? fee : 0);
  const fieldError = (name: (typeof fieldMessages)[number]) =>
    state.field === name
      ? t.has(`errors.${state.reason ?? name}`)
        ? t(`errors.${state.reason ?? name}`, {
            min: fmt(campaign.minGiftMinor),
            max: fmt(campaign.maxGiftMinor),
          })
        : t(`errors.${name}`, { min: fmt(campaign.minGiftMinor), max: fmt(campaign.maxGiftMinor) })
      : undefined;
  const general =
    state.code === null || (state.field && (fieldMessages as readonly string[]).includes(state.field))
      ? null
      : state.code === 'rate_limited'
        ? tr('errors.rateLimitedRetry', { minutes: state.retryMinutes ?? 1 })
        : state.reason && t.has(`errors.${state.reason}`)
          ? t(`errors.${state.reason}`, { min: fmt(campaign.minGiftMinor), max: fmt(campaign.maxGiftMinor) })
          : tr(errorMessageKey(state.code));
  // Submitted without the form action's automatic reset, so a rejected form keeps what was typed.
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };
  const choiceError = fieldError('choice');
  const amountError = fieldError('amount');
  const displayError = fieldError('displayAs');
  return (
    <form ref={ref} onSubmit={submit} noValidate className="flex flex-col gap-5" aria-label={t('formLabel')}>
      <div className={giveCard}>
        <fieldset
          className="m-0 flex min-w-0 flex-col gap-2.5 border-0 p-0"
          aria-describedby={choiceError ? 'choice-error' : undefined}
          aria-invalid={choiceError ? true : undefined}
        >
          <legend className={legend}>{t('chooseAmount')}</legend>
          {campaign.levels.map((l) => (
            <label key={l.id} className={option}>
              <input
                type="radio"
                name="choice"
                value={`level:${l.id}`}
                checked={choice === `level:${l.id}`}
                onChange={(e) => setChoice(e.target.value)}
                className={choiceInput}
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-bold tabular-nums">
                  {t('levelOption', { amount: fmt(l.amountMinor), name: l.name })}
                </span>
                {l.description ? <span className="text-caption text-ink-2">{l.description}</span> : null}
              </span>
            </label>
          ))}
          <label className={option}>
            <input
              type="radio"
              name="choice"
              value="other"
              checked={choice === 'other'}
              onChange={(e) => setChoice(e.target.value)}
              className={choiceInput}
            />
            <span className="font-bold">{campaign.levels.length ? t('otherAmount') : t('yourAmount')}</span>
          </label>
          <FieldMessage id="choice" error={choiceError} />
          <Input
            id="give-amount"
            name="amount"
            label={t('amountLabel', { currency: campaign.currency })}
            hint={t('amountHint', { min: fmt(campaign.minGiftMinor), max: fmt(campaign.maxGiftMinor) })}
            error={amountError}
            inputMode="decimal"
            autoComplete="off"
            value={own}
            onChange={(e) => {
              setOwn(e.target.value);
              setChoice('other');
            }}
          />
        </fieldset>

        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <label className={option}>
            <input
              type="checkbox"
              name="coverFee"
              checked={cover}
              onChange={(e) => setCover(e.target.checked)}
              className={choiceInput}
            />
            <span>{fee > 0 ? t('coverFeeAmount', { fee: fmt(fee) }) : t('coverFee')}</span>
          </label>
          <p
            className={
              total > 0
                ? 'm-0 text-[22px] leading-tight font-extrabold tracking-[-0.02em] text-ink tabular-nums'
                : 'm-0 text-body text-ink-2'
            }
            aria-live="polite"
          >
            {total > 0 ? t('total', { total: fmt(total) }) : t('totalNone')}
          </p>
        </div>
      </div>

      <div className={giveCard}>
        <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
          <legend className={legend}>{t('aboutYou')}</legend>
          <Input
            id="give-name"
            name="name"
            label={t('name')}
            autoComplete="name"
            maxLength={120}
            error={fieldError('name')}
          />
          <Input
            id="give-email"
            name="email"
            type="email"
            label={t('email')}
            hint={t('emailHint')}
            autoComplete="email"
            maxLength={254}
            error={fieldError('email')}
          />
          <Input
            id="give-employer"
            name="employer"
            label={t('employer')}
            hint={t('employerHint')}
            autoComplete="organization"
            maxLength={120}
          />
        </fieldset>
      </div>

      <div className={giveCard}>
        <fieldset
          className="m-0 flex min-w-0 flex-col gap-2.5 border-0 p-0"
          aria-describedby={displayError ? 'displayAs-error' : 'displayAs-hint'}
          aria-invalid={displayError ? true : undefined}
        >
          <legend className={legend}>{t('displayAs')}</legend>
          <p id="displayAs-hint" className="m-0 text-caption text-ink-2">
            {t('displayAsHint')}
          </p>
          {(['full_name', 'first_name', 'anonymous'] as const).map((v) => (
            <label key={v} className={option}>
              <input type="radio" name="displayAs" value={v} className={choiceInput} />
              <span className="font-bold">{t(`display.${v}`)}</span>
            </label>
          ))}
          <FieldMessage id="displayAs" error={displayError} />
        </fieldset>
      </div>

      <div className={giveCard}>
        <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
          <legend className={legend}>{t('tribute')}</legend>
          <Select
            id="give-tribute"
            name="tributeKind"
            label={t('tributeKind')}
            value={tribute}
            onValueChange={(v) => setTribute(v)}
          >
            <option value="none">{t('tributeNone')}</option>
            <option value="honor">{t('tributeHonor')}</option>
            <option value="memory">{t('tributeMemory')}</option>
          </Select>
          {tribute === 'none' ? null : (
            <>
              <Input
                id="give-tribute-name"
                name="tributeName"
                label={tribute === 'memory' ? t('tributeNameMemory') : t('tributeNameHonor')}
                maxLength={120}
                error={fieldError('tributeName')}
              />
              <Input
                id="give-tribute-recipient"
                name="tributeRecipient"
                label={t('tributeRecipient')}
                hint={t('tributeRecipientHint')}
                maxLength={120}
              />
              <Textarea
                id="give-tribute-note"
                name="tributeNote"
                label={t('tributeNote')}
                rows={3}
                maxLength={500}
              />
            </>
          )}
        </fieldset>
      </div>

      {general ? <Alert title={general} /> : null}
      <div className="flex flex-col gap-3">
        <Button type="submit" size="lg" className="w-full" disabled={pending} loading={pending}>
          {total > 0 ? t('submitAmount', { total: fmt(total) }) : t('submit')}
        </Button>
        <p className="m-0 text-center text-caption text-ink-2">{t('secureNote')}</p>
      </div>
    </form>
  );
}
