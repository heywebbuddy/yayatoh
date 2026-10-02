'use client';

import { Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useId } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

/**
 * One cell of the registration matrix (M5.1a): the price an item costs for a type, offered or
 * not. A labelled price field and a button (keyboard-operable, no drag); "Stop offering" when the
 * cell is on. Outcomes are announced in the cell.
 */
export function RegistrationCell({
  label,
  currency,
  price,
  canWrite,
  setAction,
  disableAction,
}: {
  /** "Member · Full pass" */
  label: string;
  currency: string;
  /** The current price as a decimal string, or null when the item is not offered to the type. */
  price: string | null;
  canWrite: boolean;
  setAction: (prev: FormState, form: FormData) => Promise<FormState>;
  disableAction: (prev: FormState) => Promise<FormState>;
}) {
  const t = useTranslations('registration');
  const te = useTranslations();
  const id = useId();
  const [state, formAction, pending] = useActionState(setAction, INITIAL_FORM_STATE);
  const [offState, offAction, offPending] = useActionState(disableAction, INITIAL_FORM_STATE);
  const bad = state.fields?.includes('price');
  const message = bad
    ? t('errors.price')
    : state.code
      ? state.reason && t.has(`errors.${state.reason}`)
        ? t(`errors.${state.reason}`)
        : te(errorMessageKey(state.code))
      : offState.code
        ? te(errorMessageKey(offState.code))
        : null;
  if (!canWrite)
    return <span className="text-body">{price === null ? t('notOffered') : `${price} ${currency}`}</span>;
  return (
    <div className="flex min-w-40 flex-col gap-1.5">
      <form key={price ?? 'none'} action={formAction} className="flex flex-wrap items-end gap-2" noValidate>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-price`} className="text-caption text-zinc-600">
            {t('priceFor', { cell: label, currency })}
          </label>
          <input
            id={`${id}-price`}
            name="price"
            inputMode="decimal"
            defaultValue={price ?? ''}
            placeholder={price === null ? t('notOffered') : undefined}
            aria-invalid={bad ? true : undefined}
            aria-describedby={message ? `${id}-msg` : undefined}
            className={`min-h-10 w-28 rounded-pill border bg-white px-4 text-body ${bad ? 'border-pink-700' : 'border-zinc-200'}`}
          />
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          {price === null ? t('offer') : t('savePrice')}
          <span className="sr-only"> — {label}</span>
        </Button>
      </form>
      {price !== null ? (
        <form action={offAction}>
          <Button type="submit" size="sm" variant="ghost" disabled={offPending}>
            {t('stopOffering')}
            <span className="sr-only"> — {label}</span>
          </Button>
        </form>
      ) : null}
      <p id={`${id}-msg`} aria-live="polite" className="text-caption text-pink-700">
        {message}
      </p>
    </div>
  );
}
