'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import type { TicketFormState } from '@/app/[locale]/o/[org]/e/[event]/tickets-orders/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

export function PromoCodeForm({
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
      <Input
        name="code"
        required
        minLength={3}
        maxLength={32}
        pattern="[A-Za-z0-9_\-]{3,32}"
        autoCapitalize="characters"
        spellCheck={false}
        label={t('promo.code')}
        hint={t('promo.codeHint')}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="promo-kind" className="text-caption text-zinc-600">
          {t('promo.kind')}
        </label>
        <select
          id="promo-kind"
          name="kind"
          defaultValue="percent"
          className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
        >
          <option value="percent">{t('promo.percent')}</option>
          <option value="amount">{t('promo.amount', { currency })}</option>
        </select>
      </div>
      <Input
        name="value"
        inputMode="decimal"
        required
        pattern="[0-9]+([.,][0-9]{1,3})?"
        label={t('promo.value')}
        hint={t('promo.valueHint')}
      />
      <Input name="maxUses" type="number" min={1} max={1000000} label={t('promo.maxUses')} />
      <div className="flex flex-col gap-2 md:col-span-2">
        <div aria-live="polite">
          {state.ok ? <Alert tone="info" title={t('promo.added')} /> : null}
          {state.code ? <Alert title={t(errorMessageKey(state.code))} /> : null}
        </div>
        <Button type="submit" disabled={pending} className="self-start">
          {t('promo.add')}
        </Button>
      </div>
    </form>
  );
}
