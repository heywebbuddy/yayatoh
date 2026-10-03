'use client';

import { Alert, Button, Combobox, CurrencyPicker, DateTimePicker, Input, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

/**
 * U9 (UX-5): a new org-wide coupon. Percentage or a fixed amount (in a currency, for events in
 * that currency), for every event or chosen ones, with total and per-buyer limits and an
 * optional start and expiry in the org's time zone.
 */
export function CouponForm({
  action,
  events,
  currency,
  timeZone,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  events: readonly { id: string; name: string; currency: string }[];
  currency: string;
  timeZone: string;
}) {
  const t = useTranslations('coupons');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const [kind, setKind] = useState('percent');
  const [scope, setScope] = useState('all');
  const ref = useRef<HTMLFormElement>(null);
  const eventOptions = useMemo(
    () => events.map((e) => ({ value: e.id, label: e.name, text: e.name, hint: e.currency })),
    [events],
  );
  useEffect(() => {
    if (state.ok) {
      ref.current?.reset();
      setKind('percent');
      setScope('all');
    }
  }, [state]);
  const fieldError = (f: string) =>
    state.fields?.includes(f)
      ? state.reason === 'currency_mismatch'
        ? t('errors.currencyMismatch')
        : t(`errors.${f}` as 'errors.code')
      : undefined;
  // Problems not tied to one field (a field's own message is shown under it).
  const general =
    state.code && !state.fields?.length && state.code !== 'conflict' ? te(errorMessageKey(state.code)) : null;
  return (
    <form ref={ref} action={formAction} className="grid grid-cols-1 gap-4 md:grid-cols-2" noValidate>
      <Input
        id="coupon-code"
        name="code"
        required
        minLength={3}
        maxLength={32}
        pattern="[A-Za-z0-9_\-]{3,32}"
        autoCapitalize="characters"
        spellCheck={false}
        label={t('code')}
        hint={te('promo.codeHint')}
        error={state.code === 'conflict' ? t('errors.codeTaken') : fieldError('code')}
      />
      <Select
        id="coupon-kind"
        name="kind"
        value={kind}
        onValueChange={setKind}
        label={t('kind')}
        className="field"
      >
        <option value="percent">{t('percent')}</option>
        <option value="amount">{t('amount')}</option>
      </Select>
      <Input
        id="coupon-value"
        name="value"
        inputMode="decimal"
        required
        pattern="[0-9]+([.,][0-9]{1,3})?"
        label={kind === 'percent' ? t('percentValue') : t('amountValue')}
        hint={kind === 'percent' ? t('percentHint') : t('amountHint')}
        error={fieldError('percentBps') ?? fieldError('amountMinor') ?? fieldError('value')}
      />
      {kind === 'amount' ? (
        <CurrencyPicker
          id="coupon-currency"
          name="currency"
          required
          defaultValue={currency}
          label={t('currency')}
          hint={t('currencyHint')}
          error={fieldError('currency')}
          className="field"
        />
      ) : (
        <div aria-hidden="true" className="hidden md:block" />
      )}
      <Select
        id="coupon-scope"
        name="scope"
        value={scope}
        onValueChange={setScope}
        label={t('scope')}
        className="field"
      >
        <option value="all">{t('scopeAll')}</option>
        <option value="events">{t('scopeEvents')}</option>
      </Select>
      {scope === 'events' ? (
        <Combobox
          id="coupon-events"
          name="eventIds"
          multiple
          required
          label={t('events')}
          hint={t('eventsHint')}
          error={fieldError('eventIds')}
          options={eventOptions}
          placeholder={t('eventsPlaceholder')}
        />
      ) : (
        <div aria-hidden="true" className="hidden md:block" />
      )}
      <Input
        id="coupon-max"
        name="maxUses"
        type="number"
        min={1}
        max={1000000}
        label={t('maxUses')}
        hint={t('maxUsesHint')}
        error={fieldError('maxRedemptions')}
      />
      <Input
        id="coupon-per-buyer"
        name="perBuyer"
        type="number"
        min={1}
        max={1000}
        label={t('perBuyer')}
        hint={t('perBuyerHint')}
        error={fieldError('perBuyerLimit')}
      />
      <DateTimePicker
        id="coupon-starts"
        name="startsAt"
        timeZone={timeZone}
        valueFormat="utc"
        label={t('startsAt')}
        hint={t('optional')}
        error={fieldError('startsAt')}
      />
      <DateTimePicker
        id="coupon-ends"
        name="endsAt"
        timeZone={timeZone}
        valueFormat="utc"
        label={t('endsAt')}
        hint={t('optional')}
        error={fieldError('endsAt')}
      />
      <div className="flex flex-col gap-2 md:col-span-2">
        <div aria-live="polite">
          {state.ok && !pending ? <Alert tone="info" title={t('added')} /> : null}
          {general ? <Alert title={general} /> : null}
        </div>
        <Button type="submit" disabled={pending} className="self-start">
          {t('add')}
        </Button>
      </div>
    </form>
  );
}
