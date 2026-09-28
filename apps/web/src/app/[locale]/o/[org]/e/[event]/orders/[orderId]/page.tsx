import { getUsersByIds } from '@yayatoh/auth';
import { executeQuery, formatMoney, isDomainError, money } from '@yayatoh/kernel';
import { orderMessagesQuery } from '@yayatoh/notifications';
import { orderDetailQuery, orderRefundsQuery, refundRequestsQuery } from '@yayatoh/orders';
import { disputesQuery } from '@yayatoh/payments';
import { disputeTimelineItems, orderTimelineQuery, sortTimeline } from '@yayatoh/reports';
import { roleCan } from '@yayatoh/tenancy';
import { Card, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { z } from 'zod';
import { OrderTimeline } from '@/components/order-timeline.tsx';
import { RefundForm } from '@/components/refund-form.tsx';
import { OrderNoteForm, RefundRequestPanel } from '@/components/refund-request-panel.tsx';
import { Link } from '@/i18n/navigation.ts';
import { refundPolicyLines } from '@/lib/refund-policy-text.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { addNoteAction, approveRequestAction, declineRequestAction, refundAction } from './actions.ts';

/**
 * One order for the organizer: buyer, tickets (and who holds them), the buyer's refund request
 * (M3.10b: approve or decline), refunds, disputes, messages, the unified timeline with notes, and
 * the refund form.
 */
export default async function OrderPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string; orderId: string }>;
}) {
  const { locale, org, event, orderId } = await params;
  setRequestLocale(locale);
  if (!z.uuid().safeParse(orderId).success) notFound();
  const { data, event: ev } = await loadEvent(org, event);
  if (!roleCan(data.role, 'orders:read')) notFound();
  const t = await getTranslations();
  let order: Awaited<ReturnType<typeof loadOrder>>;
  async function loadOrder() {
    return executeQuery(orderDetailQuery, { orderId }, data.ctx, ports);
  }
  try {
    order = await loadOrder();
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  }
  if (order.eventId !== ev.id) notFound();
  const refunds = await executeQuery(orderRefundsQuery, { orderId }, data.ctx, ports);
  const messages = await executeQuery(orderMessagesQuery, { orderId }, data.ctx, ports);
  const disputes = roleCan(data.role, 'finance:read')
    ? await executeQuery(disputesQuery, { orderId }, data.ctx, ports)
    : [];
  // M3.10b: the policy this order is under (bought under, or a looser current one).
  const policy = order.refundPolicy;
  const tp = await getTranslations('refundPolicy');
  const tr = await getTranslations('refundOps');
  const requests = await executeQuery(refundRequestsQuery, { orderId }, data.ctx, ports);
  const openRequest = requests.find((r) => r.status === 'open') ?? null;
  const timeline = await executeQuery(orderTimelineQuery, { orderId }, data.ctx, ports);
  // Disputes are finance data: only members who may see them get them on the timeline.
  const fullTimeline = {
    ...timeline,
    items: sortTimeline([...timeline.items, ...disputeTimelineItems(disputes)]),
  };
  const authors = timeline.items.flatMap((i) =>
    i.kind === 'note' && i.who?.startsWith('user:') ? [i.who.slice(5)] : [],
  );
  const people = authors.length ? await getUsersByIds([...new Set(authors)]) : new Map();
  const memberNames = new Map([...people].map(([id, u]) => [`user:${id}`, u.name] as const));
  const eventWhen = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: ev.timezone,
  });
  const fmt = (minor: number) => formatMoney(money(minor, order.currency), locale);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: data.org.timezone,
  });
  // Organizer-collected money is refunded in person, not through the payment provider.
  const canRefund =
    roleCan(data.role, 'orders:refund') &&
    order.collectedBy === 'platform' &&
    ['paid', 'partially_refunded'].includes(order.status) &&
    order.totalMinor > 0;
  const active = order.tickets.filter((tk) => tk.status === 'active');
  return (
    <>
      <PageHeader
        title={t('refunds.orderTitle', { name: order.buyerName })}
        description={`${order.buyerEmail} · ${when.format(order.createdAt)}`}
      />
      <Card className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <StatusDot
            status={
              order.status === 'paid' ? 'success' : order.status.includes('refunded') ? 'warning' : 'neutral'
            }
            label={t(`order.status.${order.status}`)}
          />
          <span className="font-mono tabular-nums">{fmt(order.totalMinor)}</span>
          <span className="text-caption text-zinc-600">
            {order.collectedBy === 'organizer'
              ? [
                  t('boxOffice.collected'),
                  order.paymentMethod ? t(`boxOffice.method.${order.paymentMethod}`) : null,
                  order.paymentReference,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : t(`refunds.soldBy.${order.fundsFlow}`)}
          </span>
        </div>
        <p className="text-caption text-zinc-600">
          {order.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}
        </p>
        {order.riskReview.length > 0 ? (
          <p className="flex flex-wrap items-center gap-2 text-caption">
            <StatusDot status="warning" label={t('risk.flagged')} />
            <span className="text-zinc-600">
              {order.riskReview.map((r) => (t.has(`risk.rules.${r}`) ? t(`risk.rules.${r}`) : r)).join(' · ')}
            </span>
          </p>
        ) : null}
      </Card>

      <section aria-labelledby="tickets-heading" className="flex flex-col gap-3">
        <h2 id="tickets-heading" className="text-section">
          {t('refunds.ticketsTitle')}
        </h2>
        <Table
          caption={t('refunds.ticketsTitle')}
          rowKey={(tk) => tk.id}
          rows={order.tickets}
          columns={[
            { key: 'serial', header: '#', cell: (tk) => tk.serial, mono: true },
            {
              key: 'type',
              header: t('refunds.ticketType'),
              cell: (tk) => (tk.seatLabel ? `${tk.itemName} · ${tk.seatLabel}` : tk.itemName),
            },
            {
              key: 'holder',
              header: t('refunds.holder'),
              cell: (tk) => (
                <span className="flex flex-col">
                  <span>{tk.holderName}</span>
                  <span className="text-caption text-zinc-500">{tk.holderEmail}</span>
                </span>
              ),
            },
            { key: 'code', header: t('refunds.code'), cell: (tk) => tk.shortCode, mono: true },
            {
              key: 'status',
              header: t('orders.status'),
              cell: (tk) => (
                <StatusDot
                  status={tk.status === 'active' ? 'success' : 'neutral'}
                  label={t(`refunds.ticketStatus.${tk.status}`)}
                />
              ),
            },
          ]}
        />
      </section>

      {openRequest ? (
        <section aria-labelledby="request-heading" className="flex flex-col gap-3">
          <h2 id="request-heading" className="text-section">
            {tr('request.title')}
          </h2>
          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <StatusDot
                status={openRequest.overdue ? 'danger' : 'warning'}
                label={openRequest.overdue ? tr('request.overdue') : tr('request.onTime')}
              />
              <span className="text-body">{tr('request.tickets', { count: openRequest.tickets })}</span>
              <span className="text-caption text-zinc-600">
                {tr('request.asked', { date: eventWhen.format(openRequest.createdAt) })}
              </span>
              <span className="text-caption text-zinc-600">
                {tr('request.due', { date: eventWhen.format(openRequest.dueAt) })}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-caption text-zinc-600">{tr('request.message')}</p>
              <p className="whitespace-pre-line break-words text-body">
                {openRequest.message ?? tr('request.noMessage')}
              </p>
            </div>
            {roleCan(data.role, 'orders:refund') ? (
              <RefundRequestPanel
                approve={approveRequestAction.bind(null, org, event, orderId, openRequest.id)}
                decline={declineRequestAction.bind(null, org, event, openRequest.id)}
                currency={order.currency}
              />
            ) : (
              <p className="text-caption text-zinc-600">{tr('request.readOnly')}</p>
            )}
          </Card>
        </section>
      ) : null}

      {refunds.length > 0 ? (
        <section aria-labelledby="refunds-heading" className="flex flex-col gap-3">
          <h2 id="refunds-heading" className="text-section">
            {t('refunds.title')}
          </h2>
          <Table
            caption={t('refunds.title')}
            rowKey={(r) => r.id}
            rows={refunds}
            columns={[
              { key: 'when', header: t('refunds.when'), cell: (r) => when.format(r.createdAt) },
              { key: 'reason', header: t('refunds.reason'), cell: (r) => t(`refunds.reasons.${r.reason}`) },
              {
                key: 'amount',
                header: t('refunds.amountCol'),
                cell: (r) => fmt(r.amountMinor),
                mono: true,
                align: 'end',
              },
              {
                key: 'fee',
                header: t('refunds.feeCol'),
                cell: (r) => fmt(r.feeRefundedMinor),
                mono: true,
                align: 'end',
              },
              {
                key: 'kept',
                header: t('refunds.keptCol'),
                cell: (r) => (
                  <span className="flex flex-col items-end">
                    <span>{fmt(r.retainedMinor)}</span>
                    {r.policyOverride ? (
                      <span className="font-sans text-caption text-zinc-500">{t('refunds.overridden')}</span>
                    ) : null}
                  </span>
                ),
                mono: true,
                align: 'end',
              },
              {
                key: 'status',
                header: t('orders.status'),
                cell: (r) => (
                  <StatusDot
                    status={r.status === 'succeeded' ? 'success' : r.status === 'failed' ? 'danger' : 'info'}
                    label={t(`refunds.status.${r.status}`)}
                  />
                ),
              },
            ]}
          />
        </section>
      ) : null}

      {disputes.length > 0 ? (
        <section aria-labelledby="disputes-heading" className="flex flex-col gap-3">
          <h2 id="disputes-heading" className="text-section">
            {t('disputes.title')}
          </h2>
          <p className="text-body text-zinc-600">{t(`disputes.explain.${order.fundsFlow}`)}</p>
          <ul className="flex list-none flex-col gap-2 p-0">
            {disputes.map((d) => (
              <li key={d.id}>
                <Card className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <StatusDot
                    status={d.status === 'won' ? 'success' : d.status === 'lost' ? 'danger' : 'warning'}
                    label={t(`disputes.status.${d.status}`)}
                  />
                  <span className="font-mono tabular-nums">{fmt(d.amountMinor)}</span>
                  <span className="text-caption text-zinc-600">{d.reason}</span>
                  {d.evidenceDueBy ? (
                    <span className="text-caption text-zinc-600">
                      {t('disputes.dueBy', { date: when.format(d.evidenceDueBy) })}
                    </span>
                  ) : null}
                  <a
                    href={`/o/${org}/e/${event}/orders/${orderId}/disputes/${d.id}/evidence`}
                    className="text-caption underline underline-offset-2"
                  >
                    {t('disputes.evidence')}
                  </a>
                  {d.status === 'open' && roleCan(data.role, 'disputes:respond') ? (
                    <Link
                      href={`/o/${org}/e/${event}/orders/${orderId}/disputes/${d.id}`}
                      className="text-caption underline underline-offset-2"
                    >
                      {t('disputes.respond')}
                    </Link>
                  ) : d.status === 'evidence_submitted' ? (
                    <span className="text-caption text-zinc-600">{t('disputes.submitted')}</span>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="messages-heading" className="flex flex-col gap-3">
        <h2 id="messages-heading" className="text-section">
          {t('notifications.log.title')}
        </h2>
        {messages.length === 0 ? (
          <p className="text-body text-zinc-600">{t('notifications.log.empty')}</p>
        ) : (
          <Table
            caption={t('notifications.log.title')}
            rowKey={(m) => m.id}
            rows={messages}
            columns={[
              { key: 'when', header: t('notifications.log.when'), cell: (m) => when.format(m.at) },
              {
                key: 'kind',
                header: t('notifications.log.message'),
                cell: (m) => (
                  <span className="flex flex-col">
                    <span>{t(`notifications.kinds.${m.kind}`)}</span>
                    {m.subject ? <span className="text-caption text-zinc-500">{m.subject}</span> : null}
                  </span>
                ),
              },
              { key: 'to', header: t('notifications.log.to'), cell: (m) => m.recipient ?? '' },
              {
                key: 'channel',
                header: t('notifications.log.channel'),
                cell: (m) => t(`notifications.channels.${m.channel}`),
              },
              {
                key: 'status',
                header: t('orders.status'),
                cell: (m) => (
                  <span className="flex flex-col">
                    <StatusDot
                      status={
                        m.status === 'sent'
                          ? 'success'
                          : m.status === 'failed'
                            ? 'danger'
                            : m.status === 'suppressed'
                              ? 'neutral'
                              : 'info'
                      }
                      label={t(`notifications.status.${m.status}`)}
                    />
                    {m.reason && m.status !== 'sent' ? (
                      <span className="text-caption text-zinc-500">
                        {t.has(`notifications.reasons.${m.reason}`)
                          ? t(`notifications.reasons.${m.reason}`)
                          : m.reason}
                      </span>
                    ) : null}
                    {m.status === 'sent' && m.delivery ? (
                      <span className="text-caption text-zinc-500">
                        {t(`notifications.delivery.${m.delivery}`)}
                      </span>
                    ) : null}
                  </span>
                ),
              },
            ]}
          />
        )}
      </section>

      <section aria-labelledby="timeline-heading" className="flex flex-col gap-3">
        <h2 id="timeline-heading" className="text-section">
          {tr('timeline.title')}
        </h2>
        <Card className="flex flex-col gap-4">
          <OrderTimeline timeline={fullTimeline} locale={locale} memberNames={memberNames} />
          {roleCan(data.role, 'orders:note') ? (
            <OrderNoteForm action={addNoteAction.bind(null, org, event, orderId)} />
          ) : null}
        </Card>
      </section>

      {canRefund ? (
        <section aria-labelledby="refund-heading" className="flex flex-col gap-3">
          <h2 id="refund-heading" className="text-section">
            {t('refunds.formTitle')}
          </h2>
          <Card className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <p className="text-caption text-zinc-600">{tr('policy.orderTitle')}</p>
              {policy ? (
                <ul className="flex list-none flex-col gap-0.5 p-0 text-caption">
                  {refundPolicyLines(tp, policy, locale).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-caption">{tp('notSet')}</p>
              )}
            </div>
            <RefundForm
              action={refundAction.bind(null, org, event, orderId)}
              currency={order.currency}
              timeZone={ev.timezone}
              canOverride={roleCan(data.role, 'orders:refund_override')}
              tickets={active.map((tk) => ({
                id: tk.id,
                label: `#${tk.serial} · ${tk.itemName} · ${tk.holderName}`,
              }))}
            />
          </Card>
        </section>
      ) : null}
    </>
  );
}
