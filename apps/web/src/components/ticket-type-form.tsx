'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import type { TicketFormState } from '@/app/[locale]/o/[org]/e/[event]/tickets-orders/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

export function TicketTypeForm({
  currency,
  action,
  dates = [],
}: {
  currency: string;
  /** Multi-date events (M1.4b): the dates a type may be limited to. */
  dates?: readonly { id: string; label: string }[];
  action: (prev: TicketFormState, form: FormData) => Promise<TicketFormState>;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Input name="name" required maxLength={120} label={t('tickets.name')} />
      <Input
        name="price"
        inputMode="decimal"
        required
        pattern="[0-9]+([.,][0-9]{1,3})?"
        label={t('tickets.priceIn', { currency })}
        hint={t('tickets.priceHint')}
      />
      <Input name="quantity" type="number" min={0} max={1000000} required label={t('tickets.quantity')} />
      <Input
        name="maxPerOrder"
        type="number"
        min={1}
        max={100}
        defaultValue={10}
        label={t('tickets.maxPerOrder')}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="feeMode" className="text-caption text-ink-2">
          {t('tickets.feeMode')}
        </label>
        <select id="feeMode" name="feeMode" defaultValue="pass_on" className="field">
          <option value="pass_on">{t('tickets.passOn')}</option>
          <option value="absorb">{t('tickets.absorb')}</option>
        </select>
      </div>
      <Input name="description" maxLength={500} label={t('tickets.description')} />
      <Input
        name="earlyPrice"
        inputMode="decimal"
        pattern="[0-9]+([.,][0-9]{1,3})?"
        label={t('tickets.earlyPrice', { currency })}
        hint={t('tickets.earlyPriceHint')}
      />
      <Input name="earlyEndsAt" type="datetime-local" label={t('tickets.earlyEndsAt')} />
      <div className="flex flex-col gap-1.5 md:col-span-2">
        <label htmlFor="accessDates" className="text-caption text-ink-2">
          {t('tickets.accessDates')}
        </label>
        <textarea
          id="accessDates"
          name="accessDates"
          rows={3}
          maxLength={2000}
          aria-describedby="accessDates-hint"
          className="rounded-card border border-line bg-surface px-4 py-2.5 font-mono text-body"
        />
        <p id="accessDates-hint" className="text-caption text-ink-2">
          {t('tickets.accessDatesHint')}
        </p>
      </div>
      {dates.length > 0 ? (
        <fieldset className="flex flex-col gap-2 md:col-span-2">
          <legend className="text-caption text-ink-2">{t('tickets.validDates')}</legend>
          <ul className="flex max-h-56 list-none flex-col gap-1 overflow-y-auto p-0">
            {dates.map((d) => (
              <li key={d.id}>
                <label className="flex min-h-6 items-center gap-2.5 text-body">
                  <input
                    type="checkbox"
                    name="occurrenceIds"
                    value={d.id}
                    className="size-5 shrink-0 accent-primary"
                  />
                  {d.label}
                </label>
              </li>
            ))}
          </ul>
          <p className="text-caption text-ink-2">{t('tickets.validDatesHint')}</p>
        </fieldset>
      ) : null}
      <label className="flex min-h-6 items-start gap-2.5 text-body md:col-span-2">
        <input
          type="checkbox"
          name="isDonation"
          value="1"
          className="mt-0.5 size-5 shrink-0 accent-primary"
        />
        <span>
          {t('tickets.isDonation')}
          <span className="block text-caption text-ink-2">{t('tickets.isDonationHint')}</span>
        </span>
      </label>
      <label className="flex min-h-6 items-start gap-2.5 text-body md:col-span-2">
        <input type="checkbox" name="hidden" value="1" className="mt-0.5 size-5 shrink-0 accent-primary" />
        <span>
          {t('tickets.hiddenOption')}
          <span className="block text-caption text-ink-2">{t('tickets.hiddenOptionHint')}</span>
        </span>
      </label>
      <div className="flex flex-col gap-2 md:col-span-2">
        <div aria-live="polite">
          {state.ok ? <Alert tone="info" title={t('tickets.added')} /> : null}
          {state.code ? <Alert title={t(errorMessageKey(state.code))} /> : null}
        </div>
        <Button type="submit" disabled={pending} className="self-start">
          {t('tickets.add')}
        </Button>
      </div>
    </form>
  );
}
