import { formatMoney, money } from '@yayatoh/kernel';
import {
  orderByManageToken,
  orderHolderTarget,
  orderPushDevices,
  orderTablesByManageToken,
} from '@yayatoh/orders';
import { buttonClass, Card, Label, PageHeader, StatusDot } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BuyerRefundRequestForm } from '@/components/buyer-refund-request.tsx';
import { HolderContent } from '@/components/holder-content.tsx';
import { OrderReview } from '@/components/reviews/order-review.tsx';
import { TicketQr } from '@/components/ticket-qr.tsx';
import { WebPushControl } from '@/components/web-push-control.tsx';
import { Link } from '@/i18n/navigation.ts';
import { refundPolicyLines } from '@/lib/refund-policy-text.ts';
import { helpLinksForOrder } from '@/server/assistance.ts';
import { certificateLinksForOrder } from '@/server/ce.ts';
import { getPdfRenderer } from '@/server/pdf.ts';
import { scheduleSummary } from '@/server/schedule.ts';
import { watchLinksForOrder } from '@/server/virtual.ts';
import { webPushPublicKey } from '@/server/web-push.ts';
import {
  removeOrderDeviceAction,
  requestRefundAction,
  subscribeOrderPushAction,
  unsubscribeOrderPushAction,
} from './actions.ts';

const DOT = {
  paid: 'success',
  reserved: 'warning',
  awaiting_payment: 'warning',
  payment_failed: 'danger',
  expired: 'neutral',
  cancelled: 'danger',
  partially_refunded: 'info',
  refunded: 'info',
  awaiting_invoice: 'warning',
  void: 'neutral',
} as const;

/** Guest order page, reached by the manage-token link (no account needed). */
export default async function OrderPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const order = await orderByManageToken(token);
  if (!order) notFound();
  const t = await getTranslations();
  const fmt = (minor: number) => formatMoney(money(minor, order.currency), locale);
  // Times in the event's own timezone (ADR 0015).
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: order.event.timezone,
  });
  const typeName = new Map(order.items.map((i) => [i.ticketTypeId, i.name]));
  // Multi-date events: each ticket shows its date, in the event's timezone (M1.4b).
  const dateFmt = new Intl.DateTimeFormat(locale, {
    timeZone: order.event.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  // M1.4d: the manage link proves ticket holding; holder-only content needs a live ticket.
  const holderTarget = await orderHolderTarget(token);
  // M1.10e: this browser can get the organizer's updates (announcements) as push notifications.
  const devices = (await orderPushDevices(token)) ?? [];
  // M3.3b: each ticket's help link (the seat finder's "Need help" at the event).
  const helpLinks = holderTarget
    ? await helpLinksForOrder(
        holderTarget,
        order.tickets.map((tk) => tk.id),
      )
    : new Map<string, string>();
  // M6.9a: tickets that include online access link to their watch page.
  const watchLinks = holderTarget
    ? await watchLinksForOrder(
        holderTarget,
        order.tickets.map((tk) => tk.id),
      )
    : new Map<string, string>();
  // M6.9b: tickets with an issued CE certificate link to its PDF.
  const certificateLinks = holderTarget
    ? await certificateLinksForOrder(
        holderTarget,
        order.tickets.map((tk) => tk.id),
        locale,
      )
    : new Map<string, string>();
  // M5.2b: a registration with sessions links to the attendee's schedule.
  const schedule = await scheduleSummary(token);
  // M4.2b: tables bought in this order, each with its claim link for naming the guests.
  const tables = await orderTablesByManageToken(token);
  const sinceFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: order.event.timezone });
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 px-6 py-16">
      <PageHeader
        eyebrow={<Label>{t('order.eyebrow')}</Label>}
        title={t(`order.title.${order.status}`, { name: order.buyerName.split(' ')[0] ?? '' })}
        description={t('order.sentTo', { email: order.buyerEmail })}
      />
      <Card size="panel" className="flex flex-col gap-4">
        <StatusDot status={DOT[order.status]} label={t(`order.status.${order.status}`)} />
        {/* M5.1d: a pay-later order: its invoice (view, PDF, pay). */}
        {order.invoicePath ? (
          <Link
            href={order.invoicePath}
            className="inline-flex min-h-8 items-center self-start text-body font-bold text-primary-ink underline-offset-2 hover:underline"
          >
            {t('order.viewInvoice')}
          </Link>
        ) : null}
        <ul className="flex list-none flex-col divide-y divide-line p-0">
          {order.items.map((i) => (
            <li key={i.ticketTypeId} className="flex justify-between gap-4 py-2.5">
              <span>
                {i.quantity} × {i.name}
              </span>
              <span className="font-mono tabular-nums">{fmt(i.unitAllInMinor * i.quantity)}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-between border-t border-line pt-3 text-section">
          <span>{t('order.total')}</span>
          <span className="font-mono tabular-nums">{fmt(order.totalMinor)}</span>
        </div>
        <p className="text-caption text-ink-2">{t('order.feesIncluded', { fees: fmt(order.feeMinor) })}</p>
        <p className="text-caption text-ink-2">
          {order.collectedBy === 'organizer'
            ? t('order.collectedBy', { org: order.event.organizerName })
            : t(`order.soldBy.${order.fundsFlow}`, { org: order.event.organizerName })}
        </p>
        {order.discountMinor > 0 ? (
          <p className="text-caption text-ink-2">
            {t('order.discountApplied', { amount: fmt(order.discountMinor), code: order.promoCode ?? '' })}
          </p>
        ) : null}
      </Card>
      {tables.length > 0 ? (
        <section aria-labelledby="tables-heading" className="flex flex-col gap-3">
          <h2 id="tables-heading" className="text-section">
            {t('galaTables.order.title')}
          </h2>
          <p className="text-body text-ink-2">{t('galaTables.order.intro')}</p>
          <ul className="flex list-none flex-col gap-3 p-0">
            {tables.map((x) => (
              <li key={x.id}>
                <Card className="flex flex-col gap-2">
                  <p className="text-body font-medium">
                    {t('galaTables.public.tableOf', { table: x.typeName, n: x.unitNo })}
                  </p>
                  <p className="text-caption text-ink-2">
                    {t('galaTables.progress', { named: x.named, size: x.named + x.missing })}
                  </p>
                  <Link href={x.path} className={buttonClass('primary', 'lg', 'self-start')}>
                    {t('galaTables.order.cta', { table: x.typeName, n: x.unitNo })}
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {order.transferred > 0 ? (
        <p className="text-body text-ink-2">{t('order.transferred', { count: order.transferred })}</p>
      ) : null}
      {order.creditNotes.length > 0 ? (
        <section aria-labelledby="credit-notes-heading" className="flex flex-col gap-3">
          <h2 id="credit-notes-heading" className="text-section">
            {t('supportTools.buyer.title')}
          </h2>
          <ul className="flex list-none flex-col gap-3 p-0">
            {order.creditNotes.map((c) => (
              <li key={c.label}>
                <Card className="flex flex-col gap-1">
                  <p className="flex flex-wrap justify-between gap-2 text-body">
                    <span className="font-medium">{c.label}</span>
                    <span className="font-mono tabular-nums">
                      {formatMoney(money(c.amountMinor, c.currency), locale)}
                    </span>
                  </p>
                  <p className="text-caption text-ink-2">{c.reason}</p>
                  {c.disposition === 'store_credit' && c.code ? (
                    <p className="text-body">
                      {t('supportTools.buyer.storeCredit', {
                        balance: formatMoney(money(c.balanceMinor, c.currency), locale),
                      })}{' '}
                      <span dir="ltr" className="font-mono">
                        {c.code}
                      </span>
                    </p>
                  ) : (
                    <p className="text-caption text-ink-2">{t('supportTools.buyer.refunded')}</p>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {schedule ? (
        <Link href={`/orders/${token}/schedule`} className={buttonClass('secondary', 'lg', 'self-start')}>
          {t('mySchedule.open')}
        </Link>
      ) : null}
      {order.tickets.length > 0 ? (
        <section aria-labelledby="tickets-heading" className="flex flex-col gap-4">
          <h2 id="tickets-heading" className="text-section">
            {t('order.tickets', { count: order.tickets.length })}
          </h2>
          <p className="text-caption text-ink-2">{t('order.ticketsHint')}</p>
          {getPdfRenderer() ? (
            // A plain link: the PDF route is not a page, so it bypasses client navigation.
            <a
              href={`${locale === 'en' ? '' : `/${locale}`}/orders/${token}/pdf`}
              className={buttonClass('secondary', 'md', 'self-start')}
            >
              {t('order.downloadPdf')}
            </a>
          ) : null}
          <ul className="flex list-none flex-col gap-4 p-0">
            {order.tickets.map((tk) => (
              <li key={tk.id}>
                <Card size="panel" className="flex flex-col items-center gap-3 text-center">
                  <p className="flex w-full justify-between gap-4 text-caption text-ink-2">
                    <span>{typeName.get(tk.ticketTypeId) ?? ''}</span>
                    <span className="font-mono">{t('order.serial', { serial: tk.serial })}</span>
                  </p>
                  <TicketQr
                    code={tk.code}
                    label={t('order.qrLabel', { serial: tk.serial })}
                    className="size-60 rounded-tag text-ink"
                  />
                  <p className="text-caption text-ink-2">
                    {t('order.shortCode')}{' '}
                    <span className="font-mono text-body tracking-[0.2em] text-ink">{tk.shortCode}</span>
                  </p>
                  {tk.date ? (
                    <p className="text-body font-medium">
                      {t('order.ticketDate', { date: dateFmt.format(tk.date.startsAt) })}
                    </p>
                  ) : null}
                  {tk.seatLabel ? (
                    <p className="text-body font-medium">{t('order.seatLabel', { seat: tk.seatLabel })}</p>
                  ) : null}
                  <p className="text-caption">{tk.holderName}</p>
                  {watchLinks.get(tk.id) ? (
                    <Link
                      href={watchLinks.get(tk.id) as string}
                      className={buttonClass('primary')}
                      aria-label={t('virtual.watch.orderLinkLabel', { serial: tk.serial })}
                    >
                      {t('virtual.watch.orderLink')}
                    </Link>
                  ) : null}
                  {certificateLinks.get(tk.id) ? (
                    <a
                      href={certificateLinks.get(tk.id) as string}
                      className={buttonClass('secondary')}
                      aria-label={t('ce.order.linkLabel', { serial: tk.serial })}
                    >
                      {t('ce.order.link')}
                    </a>
                  ) : null}
                  {helpLinks.get(tk.id) ? (
                    <Link
                      href={helpLinks.get(tk.id) as string}
                      className="text-caption underline underline-offset-2"
                      aria-label={t('assistance.guest.ticketLinkLabel', { serial: tk.serial })}
                    >
                      {t('assistance.guest.ticketLink')}
                    </Link>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {holderTarget ? (
        <OrderReview
          orgId={holderTarget.orgId}
          token={token}
          locale={locale}
          timeZone={order.event.timezone}
        />
      ) : null}
      {holderTarget ? (
        <HolderContent target={holderTarget} locale={locale} timeZone={order.event.timezone} />
      ) : null}
      {order.refundPolicy ? (
        <section aria-labelledby="refund-policy-heading" className="flex flex-col gap-2">
          <h2 id="refund-policy-heading" className="text-section">
            {t('refundPolicy.buyerTitle')}
          </h2>
          <ul className="flex list-none flex-col gap-1 p-0 text-body text-ink-2">
            {refundPolicyLines((k, v) => t(`refundPolicy.${k}`, v), order.refundPolicy, locale).map(
              (line) => (
                <li key={line}>{line}</li>
              ),
            )}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="push-heading" className="flex flex-col gap-3">
        <h2 id="push-heading" className="text-section">
          {t('webPush.title')}
        </h2>
        <Card size="panel">
          <WebPushControl
            publicKey={webPushPublicKey()}
            devices={devices.map((d) => ({
              id: d.id,
              label: d.label,
              ref: d.ref,
              since: sinceFmt.format(d.since),
            }))}
            subscribe={subscribeOrderPushAction.bind(null, token)}
            unsubscribe={unsubscribeOrderPushAction.bind(null, token)}
            remove={removeOrderDeviceAction.bind(null, token)}
            hint={t('webPush.buyerHint', { org: order.event.organizerName })}
          />
        </Card>
      </section>
      {order.refundRequest.latest || (order.tickets.length > 0 && order.collectedBy === 'platform') ? (
        <section aria-labelledby="refund-request-heading" className="flex flex-col gap-3">
          <h2 id="refund-request-heading" className="text-section">
            {t('refundOps.buyer.title')}
          </h2>
          {order.refundRequest.latest ? (
            <div className="flex flex-col gap-1 text-body">
              <p>
                {t(`refundOps.buyer.${order.refundRequest.latest.status}`, {
                  date: when.format(
                    order.refundRequest.latest.decidedAt ?? order.refundRequest.latest.createdAt,
                  ),
                })}
              </p>
              {order.refundRequest.latest.declineReason ? (
                <p className="whitespace-pre-line break-words text-ink-2">
                  {t('refundOps.buyer.declineReason', { reason: order.refundRequest.latest.declineReason })}
                </p>
              ) : null}
            </div>
          ) : null}
          {order.refundRequest.canRequest ? (
            <>
              <p className="text-body text-ink-2">{t('refundOps.buyer.intro')}</p>
              <BuyerRefundRequestForm
                action={requestRefundAction.bind(null, token)}
                tickets={order.tickets.map((tk) => ({
                  id: tk.id,
                  label: t('refundOps.buyer.ticket', {
                    serial: tk.serial,
                    type: typeName.get(tk.ticketTypeId) ?? '',
                  }),
                }))}
              />
            </>
          ) : order.refundRequest.refusal === 'policy_window_closed' && order.refundRequest.deadline ? (
            <p className="text-body text-ink-2">
              {t('refundOps.buyer.closed', { deadline: when.format(order.refundRequest.deadline) })}
            </p>
          ) : order.refundRequest.refusal === 'policy_no_refunds' ? (
            <p className="text-body text-ink-2">{t('refundOps.buyer.noRefunds')}</p>
          ) : null}
        </section>
      ) : null}
      <section aria-labelledby="emails-heading" className="flex flex-col gap-3">
        <h2 id="emails-heading" className="text-section">
          {t('order.emailsSent')}
        </h2>
        {order.messages.length === 0 ? (
          <p className="text-body text-ink-2">{t('order.emailsNone')}</p>
        ) : (
          <ul className="flex list-none flex-col divide-y divide-line p-0">
            {order.messages.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
                <span className="flex flex-col">
                  <span>{t(`notifications.kinds.${m.kind}`)}</span>
                  {m.subject ? <span className="text-caption text-ink-2">{m.subject}</span> : null}
                </span>
                <span className="text-caption text-ink-2">
                  {m.status === 'sent'
                    ? t('order.emailSentAt', { when: when.format(m.at) })
                    : m.status === 'scheduled'
                      ? t('order.emailScheduled', { when: when.format(m.at) })
                      : t('order.emailQueued')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
