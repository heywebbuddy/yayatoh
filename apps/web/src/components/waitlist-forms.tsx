'use client';

import { Alert, Button, Card, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, startTransition, useActionState } from 'react';
import type { WaitlistActionState } from '@/app/[locale]/waitlist/[token]/actions.ts';
import { CheckoutQuestions, type QuestionView } from '@/components/checkout-questions.tsx';
import { errorMessageKey } from '@/lib/errors.ts';

type Action = (prev: WaitlistActionState, form: FormData) => Promise<WaitlistActionState>;

function useMessage(state: WaitlistActionState): string | null {
  const t = useTranslations('waitlist');
  const tr = useTranslations();
  if (!state.code) return null;
  if (state.code === 'rate_limited')
    return tr('errors.rateLimitedRetry', { minutes: state.retryMinutes ?? 1 });
  if (state.reason && t.has(`errors.${state.reason}`)) return t(`errors.${state.reason}`);
  if (state.reason === 'form_invalid') return tr('checkout.questionsInvalid');
  if (state.reason === 'risk_blocked') return tr('checkout.riskBlocked');
  if (state.reason === 'date_sold_out') return tr('checkout.dateSoldOut');
  return tr(errorMessageKey(state.code));
}

/** One button that changes the person's place (leave, decline, rejoin); errors are announced. */
export function WaitlistButtonForm({
  action,
  label,
  variant = 'secondary',
  children,
}: {
  action: Action;
  label: string;
  variant?: 'primary' | 'secondary';
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, { code: null } as WaitlistActionState);
  const message = useMessage(state);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      {children}
      <Button type="submit" variant={variant} disabled={pending} className="self-start">
        {label}
      </Button>
      <div aria-live="assertive">{message ? <Alert title={message} /> : null}</div>
    </form>
  );
}

/**
 * Check out an open offer: how many (up to what is held), the buyer's name, the event's checkout
 * questions. The address is the one the offer was made to; prices come from the server.
 */
export function WaitlistOfferForm({
  action,
  quantity,
  minPerOrder,
  name,
  email,
  questions,
}: {
  action: Action;
  quantity: number;
  minPerOrder: number;
  name: string;
  email: string;
  questions: readonly QuestionView[];
}) {
  const t = useTranslations('waitlist');
  const [state, formAction, pending] = useActionState(action, { code: null } as WaitlistActionState);
  const message = useMessage(state);
  const min = Math.min(minPerOrder, quantity);
  // No automatic reset: a fixable error keeps what was typed.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };
  return (
    <form
      action={formAction}
      onSubmit={onSubmit}
      aria-label={t('offerFormLabel')}
      className="flex flex-col gap-4"
    >
      <Card className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="offer-quantity" className="text-body font-medium">
            {t('quantity')}
          </label>
          <select
            id="offer-quantity"
            name="quantity"
            defaultValue={String(quantity)}
            className="min-h-10 w-28 rounded-pill border border-zinc-200 bg-white px-4 text-body text-zinc-900"
          >
            {Array.from({ length: quantity - min + 1 }, (_, i) => min + i).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <Input
          name="name"
          required
          autoComplete="name"
          defaultValue={name}
          label={t('name')}
          error={state.field === 'name' ? t('errors.field.name') : undefined}
        />
        <p className="text-body text-zinc-700">{t('offerEmail', { email })}</p>
      </Card>
      {questions.length > 0 ? (
        <Card>
          <CheckoutQuestions questions={questions} invalidKey={state.field} />
        </Card>
      ) : null}
      <Button type="submit" disabled={pending} className="self-start">
        {t('checkOut')}
      </Button>
      <div aria-live="assertive">{message ? <Alert title={message} /> : null}</div>
    </form>
  );
}
