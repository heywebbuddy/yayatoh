'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, startTransition, useActionState, useEffect, useRef, useState } from 'react';
import type { BoxOfficeState } from '@/app/[locale]/o/[org]/e/[event]/tickets-orders/actions.ts';
import type { BestSeatsActions } from '@/components/best-available.tsx';
import type { SeatChoice, SeatMapView, SeatStreamSource } from '@/components/seat-picker.tsx';
import { SeatSelection } from '@/components/seat-selection.tsx';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';

const METHODS = ['cash', 'zelle', 'card_terminal', 'other'] as const;
const field = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';

/**
 * Sell tickets for money the organizer took themselves (cash at the door, Zelle, own terminal).
 * Seated events (M1.7f): seated passes are sold by choosing seats with the same list and map as
 * online, live; the seats are held and sold in one go, and each ticket names its seat. When the
 * organizer's seating rules are enforced, staff may sell anyway by saying so (recorded).
 */
export function BoxOfficeForm({
  action,
  passes,
  orderHref,
  dates = [],
  seatMap = null,
  seatStream = null,
  prices = {},
  timeZone,
  bestSeats = null,
  advancedSeating = false,
}: {
  /** Multi-date events (M1.4b): the date being sold. */
  dates?: readonly { id: string; label: string }[];
  action: (prev: BoxOfficeState, form: FormData) => Promise<BoxOfficeState>;
  passes: readonly { id: string; label: string; seated?: boolean }[];
  /** The console order page, with `{id}` for the order id. */
  orderHref: string;
  seatMap?: SeatMapView | null;
  seatStream?: SeatStreamSource | null;
  /** Ticket type id → its all-in price label (seat list). */
  prices?: Readonly<Record<string, string>>;
  timeZone?: string;
  /** M6.11a: best available at the door (when the organizer offers it). */
  bestSeats?: BestSeatsActions | null;
  /** M6.11a: the org has advanced seating (the accessible-seat statement, companion seats). */
  advancedSeating?: boolean;
}) {
  const t = useTranslations('boxOffice');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null });
  const [choice, setChoice] = useState<SeatChoice>({ seats: [], hits: [] });
  const [round, setRound] = useState(0);
  const [mustConfirm, setMustConfirm] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const enforced = choice.hits.filter((h) => h.severity === 'enforce');
  // Submit without React's automatic form reset, so a refused sale keeps what was typed; clear
  // the form only once the sale is recorded.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    // An enforced seating rule: staff must say they mean it before the sale is sent.
    if (enforced.length && !data.get('overrideRules')) return setMustConfirm(true);
    setMustConfirm(false);
    startTransition(() => formAction(data));
  };
  useEffect(() => {
    if (!state.ok) return;
    form.current?.reset();
    // A recorded sale starts a fresh seat choice.
    setRound((r) => r + 1);
  }, [state]);
  const error =
    state.code === null
      ? null
      : state.reason === 'empty'
        ? t('chooseTickets')
        : state.reason === 'sold_out'
          ? t('soldOut')
          : state.reason === 'seats_taken'
            ? t('seatsTaken')
            : state.reason === 'find_seats'
              ? te('checkout.best.findFirst')
              : state.reason === 'seat_hold_expired'
                ? te('checkout.best.expired')
                : state.reason === 'seat_rule'
                  ? t('seatRule')
                  : state.reason === 'seats_not_on_sale' || state.reason === 'seat_not_on_sale'
                    ? t('notOnSale')
                    : state.reason === 'choose_date'
                      ? t('chooseDate')
                      : state.reason === 'date_sold_out'
                        ? t('dateSoldOut')
                        : state.reason === 'wrong_date'
                          ? t('wrongDate')
                          : state.reason === 'date_cancelled' || state.reason === 'date_passed'
                            ? t('dateUnavailable')
                            : te(errorMessageKey(state.code));
  const standing = passes.filter((p) => !p.seated);
  return (
    <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-4">
      {dates.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="bo-date" className="text-caption text-zinc-600">
            {t('date')}
          </label>
          <select id="bo-date" name="occurrenceId" required className={field}>
            {dates.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-caption text-zinc-600">{t('tickets')}</legend>
        {standing.map((p) => (
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
        {passes
          .filter((p) => p.seated)
          .map((p) => (
            <p key={p.id} className="text-body text-zinc-600">
              {t('seatedPass', { pass: p.label })}
            </p>
          ))}
      </fieldset>
      {seatMap ? (
        <div className="rounded-card border border-zinc-200 p-4">
          <SeatSelection
            key={round}
            map={seatMap}
            prices={prices}
            levels={passes.filter((p) => p.seated)}
            max={50}
            stream={seatStream}
            context="box_office"
            best={bestSeats}
            ada={advancedSeating}
            occurrenceId={() =>
              (form.current?.elements.namedItem('occurrenceId') as HTMLSelectElement | null)?.value || null
            }
            onChoice={setChoice}
            {...(timeZone ? { timeZone } : {})}
          />
        </div>
      ) : null}
      {enforced.length ? (
        <div className="flex flex-col gap-2 rounded-card border border-pink-700/30 bg-pink-50 p-4">
          <p className="text-body text-pink-700">{t('rulesEnforced')}</p>
          <label className="flex min-h-6 items-center gap-2 text-body">
            <input
              type="checkbox"
              name="overrideRules"
              value="1"
              className="size-5"
              aria-invalid={mustConfirm || undefined}
              aria-describedby={mustConfirm ? 'bo-override-error' : undefined}
            />
            {t('override')}
          </label>
          {mustConfirm ? (
            <p id="bo-override-error" role="alert" className="text-body font-medium text-pink-700">
              {t('confirmOverride')}
            </p>
          ) : null}
        </div>
      ) : null}
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
          <Alert tone="info" title={state.seats ? t('doneSeats', { count: state.seats }) : t('done')}>
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
