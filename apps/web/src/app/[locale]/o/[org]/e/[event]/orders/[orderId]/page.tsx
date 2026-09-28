import { executeQuery, formatMoney, isDomainError, money } from '@yayatoh/kernel';
import { orderMessagesQuery } from '@yayatoh/notifications';
import { orderDetailQuery, orderRefundsQuery } from '@yayatoh/orders';
import { disputesQuery } from '@yayatoh/payments';
import { roleCan } from '@yayatoh/tenancy';
import { Card, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { z } from 'zod';
import { RefundForm } from '@/components/refund-form.tsx';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { refundAction } from './actions.ts';

/** One order for the organizer: buyer, tickets (and who holds them), refunds, and the refund form. */
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

      {canRefund ? (
        <section aria-labelledby="refund-heading" className="flex flex-col gap-3">
          <h2 id="refund-heading" className="text-section">
            {t('refunds.formTitle')}
          </h2>
          <Card>
            <RefundForm
              action={refundAction.bind(null, org, event, orderId)}
              currency={order.currency}
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
