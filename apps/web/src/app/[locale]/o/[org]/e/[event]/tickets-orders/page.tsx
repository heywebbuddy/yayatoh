import { listOccurrencesQuery } from '@yayatoh/events';
import { getFormQuery, listResponsesQuery } from '@yayatoh/forms';
import { executeQuery, formatMoney, money } from '@yayatoh/kernel';
import { checkoutSettingsQuery, listOrdersQuery, refundPolicyQuery } from '@yayatoh/orders';
import { publicSeatMap } from '@yayatoh/seating';
import { roleCan } from '@yayatoh/tenancy';
import { listPromoCodesQuery, listTicketTypesQuery } from '@yayatoh/ticketing';
import { Button, Card, EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BoxOfficeForm } from '@/components/box-office-form.tsx';
import { CheckoutVerificationForm } from '@/components/checkout-verification-form.tsx';
import { PromoCodeForm } from '@/components/promo-code-form.tsx';
import { QuestionForm } from '@/components/question-form.tsx';
import { RefundPolicyForm } from '@/components/refund-policy-form.tsx';
import { TicketTypeForm } from '@/components/ticket-type-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { refundPolicyLines } from '@/lib/refund-policy-text.ts';
import { localizedPath } from '@/lib/seo/urls.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import {
  addGuestCountsAction,
  addQuestionAction,
  archiveTicketTypeAction,
  boxOfficeSaleAction,
  createPromoCodeAction,
  createTicketTypeAction,
  moveQuestionAction,
  removeQuestionAction,
  setCheckoutVerificationAction,
  setPromoCodeActiveAction,
  setRefundPolicyAction,
} from './actions.ts';

export default async function TicketsPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event);
  const t = await getTranslations();
  const types = await executeQuery(listTicketTypesQuery, { eventId: ev.id }, data.ctx, ports);
  // Multi-date events (M1.4b): ticket types may be limited to dates; the box office sells one date.
  const dates = await executeQuery(listOccurrencesQuery, { eventId: ev.id }, data.ctx, ports);
  const dateFmt = new Intl.DateTimeFormat(locale, {
    timeZone: ev.timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const dateOptions = dates
    .filter((d) => d.status === 'scheduled')
    .map((d) => ({ id: d.id, label: dateFmt.formatRange(d.startsAt, d.endsAt) }));
  const nowMs = Date.now();
  const saleDates = dateOptions.filter(
    (o) => (dates.find((d) => d.id === o.id)?.endsAt.getTime() ?? 0) > nowMs,
  );
  const canWrite = roleCan(data.role, 'events:write');
  const orders = roleCan(data.role, 'orders:read')
    ? await executeQuery(listOrdersQuery, { eventId: ev.id, limit: 50 }, data.ctx, ports)
    : null;
  const promos = await executeQuery(listPromoCodesQuery, { eventId: ev.id }, data.ctx, ports);
  const canSell = roleCan(data.role, 'orders:sell') && ev.status === 'published' && types.length > 0;
  // Seated events (M1.7f): the box office chooses seats from the same map as buyers, live.
  const seatMap = canSell ? await publicSeatMap(data.ctx.orgId ?? '', ev.id, { audience: 'staff' }) : null;
  const seatedTypes = new Set(seatMap?.seats.map((s) => s.ticketTypeId) ?? []);
  const policy = await executeQuery(refundPolicyQuery, { eventId: ev.id }, data.ctx, ports);
  const checkout = await executeQuery(checkoutSettingsQuery, { eventId: ev.id }, data.ctx, ports);
  const tp = await getTranslations('refundPolicy');
  const subject = { kind: 'checkout_questions', subjectType: 'event', subjectId: ev.id } as const;
  const form = await executeQuery(getFormQuery, subject, data.ctx, ports);
  const fields = form?.definition.fields ?? [];
  const answers = orders
    ? await executeQuery(
        listResponsesQuery,
        { ...subject, respondentIds: orders.map((o) => o.id) },
        data.ctx,
        ports,
      )
    : null;
  // In the form's current order (then any questions since removed), with choice labels.
  const answersFor = (orderId: string) => {
    const r = answers?.responses.find((x) => x.respondentId === orderId);
    if (!r || !answers) return '';
    const order = [...fields.map((f) => f.key), ...Object.keys(r.answers)];
    const shown = (k: string, v: unknown) => {
      const labels = answers.questions[k]?.options ?? {};
      if (Array.isArray(v)) return v.map((x) => labels[String(x)] ?? String(x)).join(', ');
      if (v === true) return '✓';
      return labels[String(v)] ?? String(v);
    };
    return [...new Set(order)]
      .filter((k) => k in r.answers)
      .map((k) => `${answers.questions[k]?.label ?? k}: ${shown(k, r.answers[k])}`)
      .join(' · ');
  };

  const fmt = (minor: number) => formatMoney(money(minor, ev.currency), locale);
  const pct = (bps: number) =>
    new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(bps / 10_000);
  return (
    <>
      <PageHeader title={t('nav.ticketsOrders')} description={t('tickets.subtitle')} />
      {types.length === 0 ? (
        <EmptyState title={t('tickets.emptyTitle')} description={t('tickets.emptyDescription')} />
      ) : (
        <Table
          caption={t('tickets.caption')}
          rowKey={(r) => r.id}
          rows={types}
          columns={[
            {
              key: 'name',
              header: t('tickets.name'),
              cell: (r) => (
                <span className="flex flex-col">
                  <span>{r.name}</span>
                  {r.visibility === 'hidden' ? (
                    <span className="text-caption text-zinc-500">{t('tickets.hidden')}</span>
                  ) : null}
                </span>
              ),
            },
            {
              key: 'price',
              header: t('tickets.price'),
              cell: (r) => fmt(r.priceMinor),
              mono: true,
              align: 'end',
            },
            {
              key: 'allIn',
              header: t('tickets.allIn'),
              cell: (r) => (
                <span className="flex flex-col items-end">
                  <span>{fmt(r.allInMinor)}</span>
                  <span className="text-[11px] text-zinc-500">
                    {r.feeMode === 'absorb'
                      ? t('tickets.feeAbsorbed')
                      : t('tickets.feeIncluded', { fee: fmt(r.feeMinor) })}
                  </span>
                </span>
              ),
              mono: true,
              align: 'end',
            },
            ...(dates.length > 0
              ? [
                  {
                    key: 'dates',
                    header: t('tickets.dates'),
                    cell: (r: (typeof types)[number]) =>
                      r.occurrenceIds.length === 0
                        ? t('tickets.allDates')
                        : t('tickets.someDates', { count: r.occurrenceIds.length }),
                  },
                ]
              : []),
            {
              key: 'sold',
              header: t('tickets.sold'),
              cell: (r) =>
                `${formatNumber(r.quantitySold, locale)} / ${formatNumber(r.quantityTotal, locale)}`,
              mono: true,
              align: 'end',
            },
            {
              key: 'status',
              header: t('tickets.status'),
              cell: (r) =>
                r.quantitySold >= r.quantityTotal ? (
                  <StatusDot status="danger" label={t('tickets.soldOut')} />
                ) : (
                  <StatusDot status="success" label={t('tickets.onSale')} />
                ),
            },
            ...(canWrite
              ? [
                  {
                    key: 'actions',
                    header: t('tickets.actions'),
                    align: 'end' as const,
                    cell: (r: (typeof types)[number]) => (
                      <form action={archiveTicketTypeAction.bind(null, org, event, r.id)}>
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          aria-label={t('tickets.archive', { name: r.name })}
                        >
                          {t('tickets.remove')}
                        </Button>
                      </form>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}
      {canSell ? (
        <section aria-labelledby="box-office-heading" className="flex flex-col gap-3">
          <h2 id="box-office-heading" className="text-section">
            {t('boxOffice.title')}
          </h2>
          <p className="text-body text-zinc-600">{t('boxOffice.description')}</p>
          <Card>
            <BoxOfficeForm
              action={boxOfficeSaleAction.bind(null, org, event)}
              passes={types
                .filter((tt) => tt.quantitySold + tt.quantityHeld < tt.quantityTotal && !tt.isDonation)
                .map((tt) => ({
                  id: tt.id,
                  label: `${tt.name} · ${fmt(tt.allInMinor)}`,
                  seated: seatedTypes.has(tt.id),
                }))}
              orderHref={`/o/${org}/e/${event}/orders/{id}`}
              dates={saleDates}
              seatMap={seatMap}
              seatStream={
                seatMap
                  ? { url: localizedPath(locale, `/o/${org}/e/${event}/seating/stream`), kind: 'staff' }
                  : null
              }
              prices={Object.fromEntries(types.map((tt) => [tt.id, fmt(tt.allInMinor)]))}
              timeZone={ev.timezone}
            />
          </Card>
        </section>
      ) : null}
      {orders ? (
        <section aria-labelledby="orders-heading" className="flex flex-col gap-3">
          <h2 id="orders-heading" className="text-section">
            {t('orders.title')}
          </h2>
          {orders.length === 0 ? (
            <EmptyState title={t('orders.emptyTitle')} description={t('orders.emptyDescription')} />
          ) : (
            <Table
              caption={t('orders.title')}
              rowKey={(o) => o.id}
              rows={orders}
              columns={[
                {
                  key: 'buyer',
                  header: t('orders.buyer'),
                  cell: (o) => (
                    <span className="flex flex-col">
                      <Link
                        href={`/o/${org}/e/${event}/orders/${o.id}`}
                        className="underline underline-offset-2"
                      >
                        {o.buyerName}
                      </Link>
                      <span className="text-caption text-zinc-500">{o.buyerEmail}</span>
                    </span>
                  ),
                },
                {
                  key: 'items',
                  header: t('orders.items'),
                  cell: (o) => o.items.map((i) => `${i.quantity} × ${i.name}`).join(', '),
                },
                ...(fields.length > 0 || (answers?.responses.length ?? 0) > 0
                  ? [
                      {
                        key: 'answers',
                        header: t('questions.answers'),
                        cell: (o: (typeof orders)[number]) => (
                          <span className="text-caption text-zinc-600">{answersFor(o.id)}</span>
                        ),
                      },
                    ]
                  : []),
                {
                  key: 'total',
                  header: t('orders.total'),
                  cell: (o) => fmt(o.totalMinor),
                  mono: true,
                  align: 'end',
                },
                {
                  key: 'status',
                  header: t('orders.status'),
                  cell: (o) => (
                    <StatusDot
                      status={
                        o.status === 'paid'
                          ? 'success'
                          : ['expired', 'cancelled'].includes(o.status)
                            ? 'neutral'
                            : 'warning'
                      }
                      label={t(`order.status.${o.status}`)}
                    />
                  ),
                },
              ]}
            />
          )}
        </section>
      ) : null}
      <section aria-labelledby="questions-heading" className="flex flex-col gap-3">
        <h2 id="questions-heading" className="text-section">
          {t('questions.title')}
        </h2>
        {fields.length === 0 ? (
          <EmptyState title={t('questions.emptyTitle')} description={t('questions.emptyDescription')} />
        ) : (
          <ol className="flex list-none flex-col divide-y divide-zinc-100 rounded-card border border-zinc-200 p-0">
            {fields.map((f, i) => (
              <li key={f.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span>{f.label}</span>
                  <span className="text-caption text-zinc-500">
                    {[
                      t(`questions.types.${f.type}`),
                      f.required ? t('questions.requiredBadge') : null,
                      f.sensitive ? t('questions.privateBadge') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {canWrite ? (
                  <span className="flex gap-1">
                    <form action={moveQuestionAction.bind(null, org, event, f.key, -1)}>
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        disabled={i === 0}
                        aria-label={t('questions.moveUp', { label: f.label })}
                      >
                        ↑
                      </Button>
                    </form>
                    <form action={moveQuestionAction.bind(null, org, event, f.key, 1)}>
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        disabled={i === fields.length - 1}
                        aria-label={t('questions.moveDown', { label: f.label })}
                      >
                        ↓
                      </Button>
                    </form>
                    <form action={removeQuestionAction.bind(null, org, event, f.key)}>
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        aria-label={t('questions.remove', { label: f.label })}
                      >
                        {t('tickets.remove')}
                      </Button>
                    </form>
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        {canWrite ? (
          <Card className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-section">{t('questions.addTitle')}</h3>
              <form action={addGuestCountsAction.bind(null, org, event)}>
                <Button type="submit" variant="secondary" size="sm">
                  {t('questions.addGuestCounts')}
                </Button>
              </form>
            </div>
            <QuestionForm action={addQuestionAction.bind(null, org, event)} />
          </Card>
        ) : null}
      </section>
      <section aria-labelledby="buyer-email-heading" className="flex flex-col gap-3">
        <h2 id="buyer-email-heading" className="text-section">
          {t('guestVerify.settingTitle')}
        </h2>
        <Card className="flex flex-col gap-3">
          <p className="text-body text-zinc-600">{t('guestVerify.settingDescription')}</p>
          {canWrite ? (
            <CheckoutVerificationForm
              action={setCheckoutVerificationAction.bind(null, org, event)}
              verifyEmail={checkout.verifyEmail}
            />
          ) : (
            <p className="text-body">
              {checkout.verifyEmail ? t('guestVerify.settingOn') : t('guestVerify.settingOff')}
            </p>
          )}
        </Card>
      </section>
      <section aria-labelledby="refund-policy-heading" className="flex flex-col gap-3">
        <h2 id="refund-policy-heading" className="text-section">
          {tp('title')}
        </h2>
        <Card className="flex flex-col gap-3">
          {policy ? (
            <ul className="flex list-none flex-col gap-1 p-0 text-body">
              {refundPolicyLines(tp, policy, locale).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="text-body text-zinc-600">{tp('notSet')}</p>
          )}
          {canWrite ? (
            <RefundPolicyForm
              action={setRefundPolicyAction.bind(null, org, event)}
              policy={policy}
              currency={ev.currency}
            />
          ) : null}
        </Card>
      </section>
      <section aria-labelledby="promo-heading" className="flex flex-col gap-3">
        <h2 id="promo-heading" className="text-section">
          {t('promo.title')}
        </h2>
        {promos.length === 0 ? (
          <EmptyState title={t('promo.emptyTitle')} description={t('promo.emptyDescription')} />
        ) : (
          <Table
            caption={t('promo.title')}
            rowKey={(p) => p.id}
            rows={promos}
            columns={[
              { key: 'code', header: t('promo.code'), cell: (p) => p.code, mono: true },
              {
                key: 'discount',
                header: t('promo.discount'),
                cell: (p) =>
                  p.kind === 'percent'
                    ? t('promo.percentOff', { value: pct(p.percentBps ?? 0) })
                    : t('promo.amountOff', { amount: fmt(p.amountMinor ?? 0) }),
              },
              {
                key: 'uses',
                header: t('promo.uses'),
                cell: (p) =>
                  p.maxRedemptions === null
                    ? formatNumber(p.redeemedCount, locale)
                    : `${formatNumber(p.redeemedCount, locale)} / ${formatNumber(p.maxRedemptions, locale)}`,
                mono: true,
                align: 'end',
              },
              {
                key: 'status',
                header: t('promo.status'),
                cell: (p) =>
                  p.active ? (
                    <StatusDot status="success" label={t('promo.active')} />
                  ) : (
                    <StatusDot status="neutral" label={t('promo.paused')} />
                  ),
              },
              ...(canWrite
                ? [
                    {
                      key: 'actions',
                      header: t('tickets.actions'),
                      align: 'end' as const,
                      cell: (p: (typeof promos)[number]) => (
                        <form action={setPromoCodeActiveAction.bind(null, org, event, p.id, !p.active)}>
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            aria-label={t(p.active ? 'promo.pauseCode' : 'promo.resumeCode', {
                              code: p.code,
                            })}
                          >
                            {t(p.active ? 'promo.pause' : 'promo.resume')}
                          </Button>
                        </form>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
        {canWrite ? (
          <Card className="flex flex-col gap-3">
            <h3 className="text-section">{t('promo.addTitle')}</h3>
            <PromoCodeForm currency={ev.currency} action={createPromoCodeAction.bind(null, org, event)} />
          </Card>
        ) : null}
      </section>
      {canWrite ? (
        <Card className="flex flex-col gap-3">
          <h2 className="text-section">{t('tickets.addTitle')}</h2>
          <TicketTypeForm
            currency={ev.currency}
            dates={dateOptions}
            action={createTicketTypeAction.bind(null, org, event)}
          />
        </Card>
      ) : null}
    </>
  );
}
