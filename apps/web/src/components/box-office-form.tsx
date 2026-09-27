'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, startTransition, useActionState, useEffect, useRef } from 'react';
import type { BoxOfficeState } from '@/app/[locale]/o/[org]/e/[event]/tickets-orders/actions.ts';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';

const METHODS = ['cash', 'zelle', 'card_terminal', 'other'] as const;
const field = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';

/** Sell tickets for money the organizer took themselves (cash at the door, Zelle, own terminal). */
export function BoxOfficeForm({
  action,
  passes,
  orderHref,
}: {
  action: (prev: BoxOfficeState, form: FormData) => Promise<BoxOfficeState>;
  passes: readonly { id: string; label: string }[];
  /** The console order page, with `{id}` for the order id. */
  orderHref: string;
}) {
  const t = useTranslations('boxOffice');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null });
  const form = useRef<HTMLFormElement>(null);
  // Submit without React's automatic form reset, so a refused sale keeps what was typed; clear
  // the form only once the sale is recorded.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);
  const error =
    state.code === null
      ? null
      : state.reason === 'empty'
        ? t('chooseTickets')
        : state.reason === 'sold_out'
          ? t('soldOut')
          : te(errorMessageKey(state.code));
  return (
    <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-caption text-zinc-600">{t('tickets')}</legend>
        {passes.map((p) => (
          <div key={p.id} className="flex items-center gap-3">
            <input
              id={`bo-${p.id}`}
              name={`qty:${p.id}`}
              type="number"
              min={0}
              max={100}
              defaultValue={0}
              className={`${field} w-24`}
            />
            <label htmlFor={`bo-${p.id}`} className="text-body">
              {p.label}
            </label>
          </div>
        ))}
      </fieldset>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="bo-name" className="text-caption text-zinc-600">
            {t('name')}
          </label>
          <input id="bo-name" name="name" required maxLength={120} autoComplete="off" className={field} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="bo-email" className="text-caption text-zinc-600">
            {t('email')}
          </label>
          <input id="bo-email" name="email" type="email" required autoComplete="off" className={field} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="bo-method" className="text-caption text-zinc-600">
            {t('methodLabel')}
          </label>
          <select id="bo-method" name="method" defaultValue="cash" className={field}>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`method.${m}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="bo-reference" className="text-caption text-zinc-600">
            {t('reference')}
          </label>
          <input id="bo-reference" name="reference" maxLength={120} autoComplete="off" className={field} />
        </div>
      </div>
      <p className="text-caption text-zinc-500">{t('feeNote')}</p>
      <div aria-live="polite">
        {state.ok && state.orderId ? (
          <Alert tone="info" title={t('done')}>
            <Link href={orderHref.replace('{id}', state.orderId)} className="underline">
              {t('openOrder')}
            </Link>
          </Alert>
        ) : null}
        {error ? <Alert title={error} /> : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('submit')}
      </Button>
    </form>
  );
}
