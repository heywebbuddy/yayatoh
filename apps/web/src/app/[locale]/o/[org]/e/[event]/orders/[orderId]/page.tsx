import { randomUUID } from 'node:crypto';
import { getUsersByIds } from '@yayatoh/auth';
import { orderSignalsQuery } from '@yayatoh/checkin';
import { eventRolesOf } from '@yayatoh/events';
import { executeQuery, formatMoney, isDomainError, money } from '@yayatoh/kernel';
import { orderAttributionQuery } from '@yayatoh/marketing';
import { orderMessagesQuery } from '@yayatoh/notifications';
import {
  creditableMinor,
  creditNotesQuery,
  localDay,
  orderDetailQuery,
  orderInvoiceQuery,
  orderRefundsQuery,
  previewSupportMacroQuery,
  refundRequestsQuery,
  supportMacrosQuery,
} from '@yayatoh/orders';
import { disputesQuery } from '@yayatoh/payments';
import { disputeTimelineItems, orderTimelineQuery, sortTimeline } from '@yayatoh/reports';
import { ticketSeatLabelsQuery } from '@yayatoh/seating';
import { eventRoleCan, roleCan } from '@yayatoh/tenancy';
import { orderTransfersQuery, orderWalletPassesQuery } from '@yayatoh/ticketing';
import { Card, EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { z } from 'zod';
import { InvoicePanel } from '@/components/invoice-panel.tsx';
import { OrderTimeline } from '@/components/order-timeline.tsx';
import { RefundForm } from '@/components/refund-form.tsx';
import { OrderNoteForm, RefundRequestPanel } from '@/components/refund-request-panel.tsx';
import { ReissueLinkForm } from '@/components/reissue-link-form.tsx';
import { SignalItem } from '@/components/signal-item.tsx';
import {
  ConfirmButton,
  CreditNoteForm,
  type MacroOption,
  RunMacroForm,
  TransferTicketForm,
} from '@/components/support-tools.tsx';
import { Link } from '@/i18n/navigation.ts';
import { refundPolicyLines } from '@/lib/refund-policy-text.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { resolveSignalAction } from '../../onsite/signals/actions.ts';
import {
  addNoteAction,
  approveRequestAction,
  cancelTransferAction,
  declineRequestAction,
  issueCreditNoteAction,
  recordInvoicePaymentAction,
  refundAction,
  reissueLinkAction,
  runMacroAction,
  transferTicketAction,
  voidInvoiceAction,
} from './actions.ts';

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
  const { data, event: ev } = await loadEvent(org, event, 'ticketsOrders');
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
  // M5.1d: a pay-later order's invoice and its payments.
  const invoice = await executeQuery(orderInvoiceQuery, { orderId }, data.ctx, ports);
  const messages = await executeQuery(orderMessagesQuery, { orderId }, data.ctx, ports);
  const disputes = roleCan(data.role, 'finance:read')
    ? await executeQuery(disputesQuery, { orderId }, data.ctx, ports)
    : [];
  // M3.10b: the policy this order is under (bought under, or a looser current one).
  const policy = order.refundPolicy;
  // M1.9e order timeline: fraud signals about the order and its tickets, oldest first.
  const signals = await executeQuery(orderSignalsQuery, { orderId }, data.ctx, ports);
  const scanners = await getUsersByIds([...new Set(signals.flatMap((s) => (s.userId ? [s.userId] : [])))]);
  const canTriage =
    roleCan(data.role, 'events:write') || eventRoleCan(await eventRolesOf(data.ctx, ev.id), 'events:write');
  // M3.8a: where the order came from (tracked-link click or UTM landing), when recorded.
  const attribution = data.modules.has('marketing')
    ? await executeQuery(orderAttributionQuery, { orderId }, data.ctx, ports)
    : null;
  const tp = await getTranslations('refundPolicy');
  const tr = await getTranslations('refundOps');
  const requests = await executeQuery(refundRequestsQuery, { orderId }, data.ctx, ports);
  const openRequest = requests.find((r) => r.status === 'open') ?? null;
  // Answered: the latest request stays in view with its outcome.
  const lastAnswered = openRequest ? null : (requests[0] ?? null);
  const timeline = await executeQuery(orderTimelineQuery, { orderId }, data.ctx, ports);
  // Disputes are finance data: only members who may see them get them on the timeline.
  const fullTimeline = {
    ...timeline,
    items: sortTimeline([...timeline.items, ...disputeTimelineItems(disputes)]),
  };
  const authors = timeline.items.flatMap((i) =>
    (i.kind === 'note' || i.kind === 'macro_run') && i.who?.startsWith('user:') ? [i.who.slice(5)] : [],
  );
  // M3.10c support tools: transfers (and the wallet pass of each ticket), credit notes, macros.
  const ts = await getTranslations('supportTools');
  const canSupport = roleCan(data.role, 'orders:support');
  const transfers = await executeQuery(orderTransfersQuery, { orderId }, data.ctx, ports);
  const passes = await executeQuery(orderWalletPassesQuery, { orderId }, data.ctx, ports);
  const livePass = new Map(passes.filter((p) => p.status === 'active').map((p) => [p.ticketId, p]));
  const credits = await executeQuery(creditNotesQuery, { orderId }, data.ctx, ports);
  const creditable = creditableMinor({
    totalMinor: order.totalMinor,
    refundedMinor: refunds
      .filter((r) => r.status === 'pending' || r.status === 'succeeded')
      .reduce((n, r) => n + r.amountMinor, 0),
    creditedMinor: credits.reduce((n, c) => n + c.amountMinor, 0),
  });
  const canCredit =
    roleCan(data.role, 'orders:refund') &&
    ['paid', 'partially_refunded'].includes(order.status) &&
    creditable > 0;
  const macros: MacroOption[] = canSupport
    ? await Promise.all(
        (await executeQuery(supportMacrosQuery, {}, data.ctx, ports)).map(async (m) => ({
          id: m.id,
          name: m.name,
          actions: m.actions,
          ...(await executeQuery(previewSupportMacroQuery, { orderId, macroId: m.id }, data.ctx, ports)),
        })),
      )
    : [];
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
  // M5.1d: an invoice's payments came by several ways (pay link, check, wire): a credit note
  // (recorded refund) settles money paid back, not a provider refund.
  const canRefund =
    roleCan(data.role, 'orders:refund') &&
    order.collectedBy === 'platform' &&
    !invoice &&
    ['paid', 'partially_refunded'].includes(order.status) &&
    order.totalMinor > 0;
  const active = order.tickets.filter((tk) => tk.status === 'active');
  // The Seat column (M1.7g): the seat bought with each ticket, or the one the organizer gave its
  // holder, on the chart of the ticket's date.
  const seats = new Map(
    data.modules.has('seating') && roleCan(data.role, 'attendees:read')
      ? (
          await executeQuery(
            ticketSeatLabelsQuery,
            {
              eventId: ev.id,
              tickets: order.tickets.map((tk) => ({ ticketId: tk.id, occurrenceId: tk.occurrenceId })),
            },
            data.ctx,
            ports,
          )
        ).map((r) => [r.ticketId, r.seat])
      : [],
  );
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
              order.status === 'paid'
                ? 'success'
                : order.status.includes('refunded') || order.status === 'awaiting_invoice'
                  ? 'warning'
                  : 'neutral'
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

      {invoice ? (
        <InvoicePanel
          invoice={invoice}
          locale={locale}
          today={localDay(new Date(), ev.timezone)}
          pdfHref={`/o/${org}/e/${event}/orders/${orderId}/invoice/pdf?locale=${locale}`}
          canManage={roleCan(data.role, 'orders:refund')}
          recordAction={recordInvoicePaymentAction.bind(null, org, event, orderId)}
          voidAction={voidInvoiceAction.bind(null, org, event, orderId)}
        />
      ) : null}

      {roleCan(data.role, 'orders:support') ? (
        <section aria-labelledby="order-link-heading" className="flex flex-col gap-3">
          <h2 id="order-link-heading" className="text-section">
            {t('orderLinks.organizerTitle')}
          </h2>
          <p className="text-body text-zinc-600">{t('orderLinks.organizerDescription')}</p>
          <ReissueLinkForm
            action={reissueLinkAction.bind(null, org, event, orderId)}
            email={order.buyerEmail}
          />
        </section>
      ) : null}

      {attribution ? (
        <section aria-labelledby="attribution-heading" className="flex flex-col gap-3">
          <h2 id="attribution-heading" className="text-section">
            {t('trackedLinks.attributionTitle')}
          </h2>
          <Card>
            <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {(['firstTouch', 'lastTouch'] as const).map((k) => {
                const touch = attribution[k];
                return (
                  <div key={k} className="flex flex-col gap-1" data-testid={`attribution-${k}`}>
                    <dt className="text-caption text-zinc-600">{t(`trackedLinks.${k}`)}</dt>
                    <dd className="m-0 text-body">
                      {[touch.source, touch.medium, touch.campaign].filter(Boolean).join(' / ')}
                      {touch.code ? (
                        <span dir="ltr" className="ms-2 font-mono text-caption text-zinc-500">
                          /r/{touch.code}
                        </span>
                      ) : null}
                      <span className="block text-caption text-zinc-500">
                        {attribution.model === 'click'
                          ? t('trackedLinks.viaClick')
                          : t('trackedLinks.viaUtm')}{' '}
                        · {when.format(touch.at)}
                      </span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </Card>
        </section>
      ) : null}

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
              key: 'seat',
              header: t('attendees.seat'),
              cell: (tk) => seats.get(tk.id) ?? tk.seatLabel ?? '—',
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
            {
              key: 'wallet',
              header: ts('transfers.wallet'),
              cell: (tk) => {
                const p = livePass.get(tk.id);
                return p ? (p.pushed ? ts('transfers.walletLive') : ts('transfers.walletPending')) : '—';
              },
            },
          ]}
        />
      </section>

      <section aria-labelledby="transfers-heading" className="flex flex-col gap-3">
        <h2 id="transfers-heading" className="text-section">
          {ts('transfers.title')}
        </h2>
        <p className="text-body text-zinc-600">{ts('transfers.description')}</p>
        {transfers.length === 0 ? (
          <p className="text-body text-zinc-600">{ts('transfers.empty')}</p>
        ) : (
          <Table
            caption={ts('transfers.title')}
            rowKey={(x) => x.id}
            rows={transfers}
            columns={[
              { key: 'serial', header: '#', cell: (x) => x.ticketSerial, mono: true },
              {
                key: 'from',
                header: ts('transfers.from'),
                cell: (x) => (
                  <span className="flex flex-col">
                    <span>{x.fromName}</span>
                    <span className="text-caption text-zinc-500">{x.fromEmail}</span>
                  </span>
                ),
              },
              {
                key: 'to',
                header: ts('transfers.to'),
                cell: (x) => (
                  <span className="flex flex-col">
                    <span>{x.toName}</span>
                    <span className="text-caption text-zinc-500">{x.toEmail}</span>
                  </span>
                ),
              },
              {
                key: 'by',
                header: ts('transfers.by'),
                cell: (x) =>
                  `${ts(`transfers.initiatedBy.${x.initiatedBy}`)}${x.feeMinor > 0 ? ` · ${ts('transfers.fee', { amount: formatMoney(money(x.feeMinor, x.currency), locale) })}` : ''}`,
              },
              {
                key: 'state',
                header: t('orders.status'),
                cell: (x) => (
                  <span className="flex flex-col gap-1">
                    <StatusDot
                      status={x.state === 'claimed' ? 'success' : x.state === 'pending' ? 'info' : 'neutral'}
                      label={ts(`transfers.state.${x.state}`)}
                    />
                    <span className="text-caption text-zinc-500">
                      {x.state === 'claimed' && x.claimedAt
                        ? eventWhen.format(x.claimedAt)
                        : x.state === 'pending'
                          ? ts('transfers.until', { date: eventWhen.format(x.expiresAt) })
                          : eventWhen.format(x.cancelledAt ?? x.expiresAt)}
                    </span>
                  </span>
                ),
              },
              {
                key: 'actions',
                header: ts('transfers.actions'),
                cell: (x) =>
                  x.state === 'pending' && canSupport ? (
                    <ConfirmButton
                      action={cancelTransferAction.bind(null, org, event, orderId, x.id)}
                      label={ts('transfers.cancel')}
                      done={ts('transfers.cancelled')}
                    />
                  ) : null,
              },
            ]}
          />
        )}
        {canSupport && active.length > 0 ? (
          <Card>
            <TransferTicketForm
              action={transferTicketAction.bind(null, org, event, orderId, locale)}
              tickets={active.map((tk) => ({
                id: tk.id,
                label: `#${tk.serial} · ${tk.itemName} · ${tk.holderName}`,
              }))}
            />
          </Card>
        ) : null}
      </section>

      <section aria-labelledby="signals-heading" className="flex flex-col gap-3">
        <h2 id="signals-heading" className="text-section">
          {t('fraudSignals.timeline.title')}
        </h2>
        {signals.length === 0 ? (
          <p className="text-body text-zinc-600">{t('fraudSignals.timeline.empty')}</p>
        ) : (
          <ol aria-labelledby="signals-heading" className="flex list-none flex-col gap-3 p-0">
            {signals.map((s) => (
              <li key={s.id}>
                <SignalItem
                  signal={s}
                  timeZone={ev.timezone}
                  people={Object.fromEntries([...scanners].map(([id, u]) => [id, u.name]))}
                  action={canTriage ? resolveSignalAction.bind(null, org, event, s.id) : null}
                />
              </li>
            ))}
          </ol>
        )}
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
      ) : lastAnswered ? (
        <section aria-labelledby="request-heading" className="flex flex-col gap-3">
          <h2 id="request-heading" className="text-section">
            {tr('request.title')}
          </h2>
          <Card className="flex flex-col gap-2">
            <StatusDot
              status={lastAnswered.status === 'approved' ? 'success' : 'neutral'}
              label={tr(`request.status.${lastAnswered.status}`)}
            />
            <p className="whitespace-pre-line break-words text-body">
              {lastAnswered.status === 'approved'
                ? tr('request.answeredApproved', {
                    date: eventWhen.format(lastAnswered.decidedAt ?? lastAnswered.createdAt),
                  })
                : tr('request.answeredDeclined', {
                    date: eventWhen.format(lastAnswered.decidedAt ?? lastAnswered.createdAt),
                    reason: lastAnswered.declineReason ?? '',
                  })}
            </p>
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

      <section aria-labelledby="credit-heading" className="flex flex-col gap-3">
        <h2 id="credit-heading" className="text-section">
          {ts('credit.title')}
        </h2>
        {credits.length === 0 ? (
          <p className="text-body text-zinc-600">{ts('credit.empty')}</p>
        ) : (
          <Table
            caption={ts('credit.title')}
            rowKey={(c) => c.id}
            rows={credits}
            columns={[
              { key: 'number', header: ts('credit.number'), cell: (c) => c.label, mono: true },
              { key: 'when', header: t('refunds.when'), cell: (c) => when.format(c.createdAt) },
              {
                key: 'disposition',
                header: ts('credit.dispositionCol'),
                cell: (c) => (
                  <span className="flex flex-col">
                    <span>{ts(`credit.disposition.${c.disposition}`)}</span>
                    {c.codeLast4 ? (
                      <span className="text-caption text-zinc-500">
                        {ts('credit.codeEnding', { last4: c.codeLast4 })}
                      </span>
                    ) : null}
                  </span>
                ),
              },
              { key: 'reason', header: t('refunds.reason'), cell: (c) => c.reason },
              {
                key: 'amount',
                header: t('refunds.amountCol'),
                cell: (c) => fmt(c.amountMinor),
                mono: true,
                align: 'end',
              },
              {
                key: 'balance',
                header: ts('credit.balance'),
                cell: (c) => (c.disposition === 'store_credit' ? fmt(c.balanceMinor) : '—'),
                mono: true,
                align: 'end',
              },
              {
                key: 'pdf',
                header: ts('credit.document'),
                cell: (c) => (
                  <a
                    href={`/o/${org}/e/${event}/orders/${orderId}/credit-notes/${c.id}/pdf?locale=${locale}`}
                    className="inline-flex min-h-6 items-center underline underline-offset-2"
                  >
                    {ts('credit.pdf', { label: c.label })}
                  </a>
                ),
              },
            ]}
          />
        )}
        {canCredit ? (
          <Card>
            <CreditNoteForm
              action={issueCreditNoteAction.bind(null, org, event, orderId)}
              currency={order.currency}
              creditable={fmt(creditable)}
              requestKey={randomUUID()}
            />
          </Card>
        ) : null}
      </section>

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

      {canSupport ? (
        <section aria-labelledby="macros-heading" className="flex flex-col gap-3">
          <h2 id="macros-heading" className="text-section">
            {ts('macros.runTitle')}
          </h2>
          {macros.length === 0 ? (
            <EmptyState
              title={ts('macros.noneTitle')}
              action={
                <Link href={`/o/${org}/macros`} className="underline underline-offset-2">
                  {ts('macros.manage')}
                </Link>
              }
            />
          ) : (
            <Card>
              <RunMacroForm
                action={runMacroAction.bind(null, org, event, orderId, locale)}
                macros={macros}
                tickets={active.map((tk) => ({
                  id: tk.id,
                  label: `#${tk.serial} · ${tk.itemName} · ${tk.holderName}`,
                }))}
                requestKey={randomUUID()}
              />
            </Card>
          )}
        </section>
      ) : null}

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
