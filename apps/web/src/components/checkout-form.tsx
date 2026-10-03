'use client';

import { Alert, Button, buttonClass, Card, cx, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, startTransition, useActionState, useState } from 'react';
import type { CheckoutState } from '@/app/[locale]/events/[slug]/actions.ts';
import type { BestSeatsActions } from '@/components/best-available.tsx';
import { CheckoutQuestions, type QuestionView } from '@/components/checkout-questions.tsx';
import { GuestCodeFields } from '@/components/guest-code-fields.tsx';
import type { SeatMapView, SeatStreamSource } from '@/components/seat-picker.tsx';
import { SeatSelection } from '@/components/seat-selection.tsx';
import { Link } from '@/i18n/navigation.ts';
import { useCssomStyle } from '@/lib/cssom-style.ts';
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
  /** While an early-bird price runs: the regular price and the (formatted) last day. */
  readonly regularPriceLabel?: string | null;
  readonly earlyUntil?: string | null;
  /** Choose-your-amount pass: `priceLabel` is the minimum. */
  readonly isDonation?: boolean;
  readonly accessDates?: readonly { readonly key: string; readonly label: string }[];
  /** M4.2b: a table ticket: one seats this many guests (the buyer names them after paying). */
  readonly tableSize?: number | null;
  /** M3.10a: sold out, with a waitlist to join (the join page's path). */
  readonly waitlistHref?: string | null;
}

/**
 * Pass cards plus buyer details. Only quantities and buyer details are posted; prices are always
 * recomputed on the server. Demo passes (no id) show the design but cannot be bought.
 */
export function CheckoutForm({
  passes,
  organizer,
  questions = [],
  action,
  brand,
  seatMap = null,
  occurrenceId = null,
  seatStream = null,
  timeZone,
  bestSeats = null,
  advancedSeating = false,
  channel = null,
}: {
  /** Multi-date events (M1.4b): the date chosen on the page, posted with the order. */
  occurrenceId?: string | null;
  passes: readonly PassView[];
  /** Seated events: the published seat map; its ticket types are bought by choosing seats. */
  seatMap?: SeatMapView | null;
  /** Its live availability (M1.7f). */
  seatStream?: SeatStreamSource | null;
  /** The event's timezone (seating rule dates). */
  timeZone?: string;
  /** M6.11a: best available's actions (when the organizer offers it). */
  bestSeats?: BestSeatsActions | null;
  /** M6.11a: the org has advanced seating (the accessible-seat statement, companion seats). */
  advancedSeating?: boolean;
  /**
   * M6.11b: the sales channel of the link the buyer came through (its code is posted with the
   * order), or `invalid` when the link's code names none.
   */
  channel?: { readonly code: string; readonly name: string } | { readonly invalid: true } | null;
  organizer: string;
  /** Organizer brand colour and its readable text colour (brand kit); default styling when absent. */
  brand?: { background: string; text: string } | null;
  questions?: readonly QuestionView[];
  action: (prev: CheckoutState, form: FormData) => Promise<CheckoutState>;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { code: null });
  const brandButton = useCssomStyle<HTMLButtonElement>(
    brand ? { background: brand.background, color: brand.text, borderColor: brand.background } : null,
  );
  // Submit without React's automatic form reset, so an error (a seat just taken, a bad promo
  // code) keeps everything the buyer typed and chose. Without JavaScript the form still posts.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // The clicked button's name/value too ("Send a new code" posts verifyIntent=resend).
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const data = new FormData(e.currentTarget, submitter);
    startTransition(() => formAction(data));
  };
  // M1.5f: the email step, until the buyer changes the address it was sent to.
  const [typedEmail, setTypedEmail] = useState<string | null>(null);
  const verify =
    state.code === 'verify_email' && state.verify
      ? typedEmail === null || typedEmail.trim().toLowerCase() === state.verify.email.toLowerCase()
        ? state.verify
        : null
      : null;
  const buyable = passes.some((p) => p.id && p.availability === 'available');
  const seatedTypes = new Set(seatMap?.seats.map((s) => s.ticketTypeId) ?? []);
  const prices = Object.fromEntries(passes.flatMap((p) => (p.id ? [[p.id, p.priceLabel]] : [])));
  const error =
    state.code === null || state.code === 'verify_email'
      ? null
      : state.code === 'rate_limited'
        ? t('errors.rateLimitedRetry', { minutes: state.retryMinutes ?? 1 })
        : state.reason === 'seats_taken'
          ? t('checkout.seatsTaken')
          : state.reason === 'choose_seats'
            ? t('checkout.chooseSeats')
            : state.reason === 'find_seats'
              ? t('checkout.best.findFirst')
              : state.reason === 'seat_hold_expired'
                ? t('checkout.best.expired')
                : state.reason === 'seat_channel'
                  ? t('checkout.seatChannel')
                  : state.reason === 'channel_code_invalid'
                    ? t('checkout.channelInvalid')
                    : state.reason === 'seat_rule'
                      ? t(
                          state.rule === 'max_per_order_seats'
                            ? 'checkout.seatRuleCap'
                            : state.rule === 'ada_companion'
                              ? 'checkout.seatRuleCompanion'
                              : 'checkout.seatRuleAda',
                        )
                      : state.reason === 'sold_out'
                        ? t('checkout.soldOut')
                        : state.reason === 'empty'
                          ? t('checkout.chooseTickets')
                          : state.reason === 'promo_invalid'
                            ? t('checkout.promoInvalid')
                            : state.reason === 'credit_invalid'
                              ? t('checkout.creditInvalid')
                              : state.reason === 'credit_not_applicable'
                                ? t('checkout.creditNotApplicable')
                                : state.reason === 'donation_amount'
                                  ? t('checkout.donationTooLow')
                                  : state.reason === 'form_invalid'
                                    ? t('checkout.questionsInvalid')
                                    : state.reason === 'choose_date'
                                      ? t('checkout.chooseDate')
                                      : state.reason === 'date_sold_out'
                                        ? t('checkout.dateSoldOut')
                                        : ['date_cancelled', 'date_passed', 'wrong_date'].includes(
                                              state.reason ?? '',
                                            )
                                          ? t('checkout.dateUnavailable')
                                          : state.reason === 'checkout_paused'
                                            ? t('publicEvent.salesPausedTitle')
                                            : state.reason === 'risk_blocked'
                                              ? t('checkout.riskBlocked')
                                              : state.reason === 'org_suspended' ||
                                                  state.reason === 'org_terminated'
                                                ? t('checkout.orgUnavailable')
                                                : t(errorMessageKey(state.code));
  return (
    <form action={formAction} onSubmit={onSubmit} className="@container flex min-w-0 flex-1 flex-col gap-4">
      {occurrenceId ? <input type="hidden" name="occurrenceId" value={occurrenceId} /> : null}
      {channel && 'code' in channel ? (
        <>
          <input type="hidden" name="channelCode" value={channel.code} />
          <Alert tone="info" title={t('checkout.channelNotice', { name: channel.name })} />
        </>
      ) : channel ? (
        <Alert tone="info" title={t('checkout.channelLinkInvalid')} />
      ) : null}
      <ul className="grid list-none grid-cols-1 items-start gap-2.5 p-0 @3xl:grid-cols-2">
        {passes.map((p) => {
          const muted = 'text-ink-2';
          return (
            <li key={p.id ?? p.name}>
              <div
                className={cx(
                  'flex flex-col gap-2.5 rounded-[20px] border p-4 transition-colors duration-150',
                  p.featured
                    ? 'border-primary bg-primary-soft ring-[3px] ring-primary-soft'
                    : 'border-line bg-surface-2 hover:border-line-strong/60',
                )}
              >
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex min-w-0 grow basis-40 flex-col gap-1">
                    <h3 className="m-0 text-[15px] font-extrabold tracking-normal text-ink">{p.name}</h3>
                    {p.description ? <p className={`m-0 text-caption ${muted}`}>{p.description}</p> : null}
                    <p className="m-0 text-[22px] leading-tight font-extrabold tracking-[-0.03em] text-ink tabular-nums">
                      {p.isDonation ? (
                        <span className="text-caption font-bold tracking-normal">
                          {t('publicEvent.donationFrom')}{' '}
                        </span>
                      ) : null}
                      {p.priceLabel}
                      <span className={`ms-1 text-caption font-semibold tracking-normal ${muted}`}>
                        {t('publicEvent.allInSuffix')}
                      </span>
                    </p>
                  </div>
                  {p.id && p.availability === 'available' && !seatedTypes.has(p.id) && !p.waitlistHref ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="flex flex-col gap-1">
                        <label htmlFor={`qty-${p.id}`} className={`text-caption font-bold ${muted}`}>
                          {t('checkout.quantity')}
                          <span className="sr-only"> — {p.name}</span>
                        </label>
                        <select
                          id={`qty-${p.id}`}
                          name={`qty:${p.id}`}
                          defaultValue="0"
                          className="field min-w-20 font-bold tabular-nums"
                        >
                          {Array.from({ length: p.maxPerOrder + 1 }, (_, n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </div>
                      {p.isDonation ? (
                        <div className="flex flex-col gap-1">
                          <label htmlFor={`amount-${p.id}`} className={`text-caption font-bold ${muted}`}>
                            {t('checkout.donationAmount')}
                            <span className="sr-only">
                              {' '}
                              — {p.name} ({t('checkout.donationMinimum', { minimum: p.priceLabel })})
                            </span>
                          </label>
                          <input
                            id={`amount-${p.id}`}
                            name={`amount:${p.id}`}
                            inputMode="decimal"
                            pattern="[0-9]+([.,][0-9]{1,3})?"
                            className="field w-28"
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {p.regularPriceLabel && p.earlyUntil ? (
                  <p className="m-0 text-caption font-semibold text-success">
                    {t('publicEvent.earlyBird', { date: p.earlyUntil, regular: p.regularPriceLabel })}
                  </p>
                ) : null}
                {p.tableSize ? (
                  <p className={`m-0 text-caption ${muted}`}>
                    {t('galaTables.publicPass', { size: p.tableSize })}
                  </p>
                ) : null}
                {p.accessDates && p.accessDates.length > 0 ? (
                  <ul
                    aria-label={t('publicEvent.accessDates')}
                    className="flex list-none flex-wrap gap-1.5 p-0"
                  >
                    {p.accessDates.map((d) => (
                      <li
                        key={d.key}
                        className="rounded-pill border border-line bg-surface-solid px-2.5 py-0.5 text-caption font-semibold text-ink-2"
                      >
                        {d.label}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {p.availability !== 'available' || p.fewLeft ? (
                  <p className="m-0 self-start rounded-pill bg-brand-soft px-2.5 py-0.5 text-caption font-bold text-brand-ink">
                    {t(
                      `publicEvent.availability.${p.fewLeft && p.availability === 'available' ? 'fewLeft' : p.availability}`,
                    )}
                  </p>
                ) : null}
                {p.waitlistHref ? (
                  <Link href={p.waitlistHref} className={buttonClass('secondary', 'sm', 'self-start')}>
                    {t('waitlist.joinLink')}
                    <span className="sr-only"> — {p.name}</span>
                  </Link>
                ) : p.id && p.availability === 'available' && seatedTypes.has(p.id) ? (
                  <p className={`m-0 text-caption ${muted}`}>{t('checkout.chooseSeatsBelow')}</p>
                ) : p.id ? null : (
                  // Preview passes (no ticket type yet) cannot be bought; a disabled control says so.
                  <button type="button" disabled className={buttonClass('secondary', 'sm', 'self-start')}>
                    {t('publicEvent.select')}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {buyable && seatMap ? (
        <Card tone="muted">
          <SeatSelection
            map={seatMap}
            prices={prices}
            levels={passes.flatMap((p) =>
              p.id && p.availability === 'available' && seatedTypes.has(p.id)
                ? [{ id: p.id, label: `${p.name} · ${p.priceLabel}` }]
                : [],
            )}
            stream={seatStream}
            best={bestSeats}
            ada={advancedSeating}
            occurrenceId={() => occurrenceId}
            {...(timeZone ? { timeZone } : {})}
          />
        </Card>
      ) : null}
      {buyable && questions.length > 0 ? (
        <Card tone="muted">
          <CheckoutQuestions questions={questions} invalidKey={state.field} />
        </Card>
      ) : null}
      {buyable ? (
        <Card tone="muted" className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 @3xl:flex-row @3xl:items-end">
            <div className="flex-1">
              <Input name="name" required autoComplete="name" label={t('checkout.name')} />
            </div>
            <div className="flex-1">
              <Input
                name="email"
                type="email"
                required
                autoComplete="email"
                label={t('checkout.email')}
                onChange={(e) => setTypedEmail(e.currentTarget.value)}
              />
            </div>
            <div className="@3xl:w-44">
              <Input
                name="promoCode"
                maxLength={32}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                label={t('checkout.promoCode')}
              />
            </div>
            {/* Hidden (not removed) during the email step, so its brand colours stay applied. */}
            <div className={verify ? 'hidden' : 'contents'}>
              <Button
                type="submit"
                size="lg"
                disabled={pending}
                ref={brandButton}
                className="@max-3xl:w-full"
              >
                {t('checkout.continue')}
              </Button>
            </div>
          </div>
          {/* Unticked by default: buying is never consent to marketing. */}
          <label className="flex min-h-6 items-start gap-2.5 text-caption text-ink-2">
            <input
              type="checkbox"
              name="marketingOptIn"
              value="1"
              className="mt-0.5 size-5 shrink-0 accent-primary"
            />
            <span>{t('checkout.marketingOptIn', { org: organizer })}</span>
          </label>
        </Card>
      ) : null}
      {buyable && verify ? (
        <Card tone="muted">
          <section aria-labelledby="verify-email-title" className="flex flex-col gap-3">
            <h2 id="verify-email-title" className="text-section">
              {t('guestVerify.title')}
            </h2>
            {verify.token ? <input type="hidden" name="verifyToken" value={verify.token} /> : null}
            <GuestCodeFields
              email={verify.email}
              status={verify.status}
              attemptsLeft={verify.attemptsLeft}
              resendAt={verify.resendAt}
              submitLabel={t('guestVerify.submit')}
              pending={pending}
              idPrefix="checkout-verify"
            />
            <p className="text-caption text-ink-2">{t('guestVerify.changeEmail')}</p>
          </section>
        </Card>
      ) : null}
      <div aria-live="assertive">{error ? <Alert title={error} /> : null}</div>
    </form>
  );
}
