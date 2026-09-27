'use client';

import { Alert, Button, buttonClass, Card, Input, Label } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { CheckoutState } from '@/app/[locale]/events/[slug]/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

export interface PassView {
  readonly id: string | null;
  readonly name: string;
  readonly priceLabel: string;
  readonly description: string;
  readonly featured: boolean;
  readonly availability: 'available' | 'sold_out' | 'not_yet_on_sale' | 'sales_ended';
  readonly fewLeft: boolean;
  readonly maxPerOrder: number;
}

/**
 * Pass cards plus buyer details. Only quantities and buyer details are posted; prices are always
 * recomputed on the server. Demo passes (no id) show the design but cannot be bought.
 */
export function CheckoutForm({
  passes,
  organizer,
  action,
}: {
  passes: readonly PassView[];
  organizer: string;
  action: (prev: CheckoutState, form: FormData) => Promise<CheckoutState>;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { code: null });
  const buyable = passes.some((p) => p.id && p.availability === 'available');
  const error =
    state.code === null
      ? null
      : state.reason === 'sold_out'
        ? t('checkout.soldOut')
        : state.reason === 'empty'
          ? t('checkout.chooseTickets')
          : t(errorMessageKey(state.code));
  return (
    <form action={formAction} className="flex min-w-0 flex-1 flex-col gap-4">
      <ul className="grid list-none grid-cols-1 items-start gap-3.5 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {passes.map((p) => (
          <li key={p.id ?? p.name}>
            <Card tone={p.featured ? 'ink' : 'default'} size="panel" className="flex flex-col gap-2.5">
              <Label tone={p.featured ? 'inverse' : 'default'}>{p.name}</Label>
              <p className="text-[40px] leading-[44px] font-light tracking-[-0.04em]">
                {p.priceLabel}
                <span
                  className={`ms-1 text-[15px] tracking-normal ${p.featured ? 'text-white/65' : 'text-zinc-500'}`}
                >
                  {t('publicEvent.allInSuffix')}
                </span>
              </p>
              {p.description ? (
                <p className={`text-body ${p.featured ? 'text-white/65' : 'text-zinc-500'}`}>
                  {p.description}
                </p>
              ) : null}
              {p.availability !== 'available' || p.fewLeft ? (
                <p className={`text-caption ${p.featured ? 'text-white/75' : 'text-accent-text'}`}>
                  {t(
                    `publicEvent.availability.${p.fewLeft && p.availability === 'available' ? 'fewLeft' : p.availability}`,
                  )}
                </p>
              ) : null}
              {p.id && p.availability === 'available' ? (
                <div className="flex items-center gap-2">
                  <label
                    htmlFor={`qty-${p.id}`}
                    className={`text-caption ${p.featured ? 'text-white/75' : 'text-zinc-600'}`}
                  >
                    {t('checkout.quantity')}
                    <span className="sr-only"> — {p.name}</span>
                  </label>
                  <select
                    id={`qty-${p.id}`}
                    name={`qty:${p.id}`}
                    defaultValue="0"
                    className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body text-zinc-900"
                  >
                    {Array.from({ length: p.maxPerOrder + 1 }, (_, n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                // Preview passes (no ticket type yet) cannot be bought; a disabled control says so.
                <button
                  type="button"
                  disabled
                  className={buttonClass(p.featured ? 'on-dark' : 'secondary', 'md', 'self-start')}
                >
                  {t('publicEvent.select')}
                </button>
              )}
            </Card>
          </li>
        ))}
      </ul>
      {buyable ? (
        <Card className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-end">
            <div className="flex-1">
              <Input name="name" required autoComplete="name" label={t('checkout.name')} />
            </div>
            <div className="flex-1">
              <Input name="email" type="email" required autoComplete="email" label={t('checkout.email')} />
            </div>
            <Button type="submit" disabled={pending}>
              {t('checkout.continue')}
            </Button>
          </div>
          {/* Unticked by default: buying is never consent to marketing. */}
          <label className="flex min-h-6 items-start gap-2.5 text-caption text-zinc-600">
            <input
              type="checkbox"
              name="marketingOptIn"
              value="1"
              className="mt-0.5 size-5 shrink-0 accent-ink"
            />
            <span>{t('checkout.marketingOptIn', { org: organizer })}</span>
          </label>
        </Card>
      ) : null}
      <div aria-live="assertive">{error ? <Alert title={error} /> : null}</div>
    </form>
  );
}
