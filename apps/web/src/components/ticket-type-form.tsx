'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import type { TicketFormState } from '@/app/[locale]/o/[org]/e/[event]/tickets-orders/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

export function TicketTypeForm({
  currency,
  action,
}: {
  currency: string;
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
        <label htmlFor="feeMode" className="text-caption text-zinc-600">
          {t('tickets.feeMode')}
        </label>
        <select
          id="feeMode"
          name="feeMode"
          defaultValue="pass_on"
          className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
        >
          <option value="pass_on">{t('tickets.passOn')}</option>
          <option value="absorb">{t('tickets.absorb')}</option>
        </select>
      </div>
      <Input name="description" maxLength={500} label={t('tickets.description')} />
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
