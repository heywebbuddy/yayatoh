import { formatMoney, money } from '@yayatoh/kernel';
import { orderByManageToken, orderHolderTarget } from '@yayatoh/orders';
import { buttonClass, Card, Label, PageHeader, StatusDot } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { HolderContent } from '@/components/holder-content.tsx';
import { TicketQr } from '@/components/ticket-qr.tsx';
import { getPdfRenderer } from '@/server/pdf.ts';

const DOT = {
  paid: 'success',
  reserved: 'warning',
  awaiting_payment: 'warning',
  payment_failed: 'danger',
  expired: 'neutral',
  cancelled: 'danger',
  partially_refunded: 'info',
  refunded: 'info',
} as const;

/** Guest order page, reached by the manage-token link (no account needed). */
export default async function OrderPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const order = await orderByManageToken(token);
  if (!order) notFound();
  const t = await getTranslations();
  const fmt = (minor: number) => formatMoney(money(minor, order.currency), locale);
  const typeName = new Map(order.items.map((i) => [i.ticketTypeId, i.name]));
  // M1.4d: the manage link proves ticket holding; holder-only content needs a live ticket.
  const holderTarget = await orderHolderTarget(token);
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 px-6 py-16">
      <PageHeader
        eyebrow={<Label>{t('order.eyebrow')}</Label>}
        title={t(`order.title.${order.status}`, { name: order.buyerName.split(' ')[0] ?? '' })}
        description={t('order.sentTo', { email: order.buyerEmail })}
      />
      <Card size="panel" className="flex flex-col gap-4">
        <StatusDot status={DOT[order.status]} label={t(`order.status.${order.status}`)} />
        <ul className="flex list-none flex-col divide-y divide-zinc-100 p-0">
          {order.items.map((i) => (
            <li key={i.ticketTypeId} className="flex justify-between gap-4 py-2.5">
              <span>
                {i.quantity} × {i.name}
              </span>
              <span className="font-mono tabular-nums">{fmt(i.unitAllInMinor * i.quantity)}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-between border-t border-zinc-200 pt-3 text-section">
          <span>{t('order.total')}</span>
          <span className="font-mono tabular-nums">{fmt(order.totalMinor)}</span>
        </div>
        <p className="text-caption text-zinc-500">{t('order.feesIncluded', { fees: fmt(order.feeMinor) })}</p>
        <p className="text-caption text-zinc-500">
          {order.collectedBy === 'organizer'
            ? t('order.collectedBy', { org: order.event.organizerName })
            : t(`order.soldBy.${order.fundsFlow}`, { org: order.event.organizerName })}
        </p>
        {order.discountMinor > 0 ? (
          <p className="text-caption text-zinc-500">
            {t('order.discountApplied', { amount: fmt(order.discountMinor), code: order.promoCode ?? '' })}
          </p>
        ) : null}
      </Card>
      {order.transferred > 0 ? (
        <p className="text-body text-zinc-600">{t('order.transferred', { count: order.transferred })}</p>
      ) : null}
      {order.tickets.length > 0 ? (
        <section aria-labelledby="tickets-heading" className="flex flex-col gap-4">
          <h2 id="tickets-heading" className="text-section">
            {t('order.tickets', { count: order.tickets.length })}
          </h2>
          <p className="text-caption text-zinc-500">{t('order.ticketsHint')}</p>
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
                  <p className="flex w-full justify-between gap-4 text-caption text-zinc-500">
                    <span>{typeName.get(tk.ticketTypeId) ?? ''}</span>
                    <span className="font-mono">{t('order.serial', { serial: tk.serial })}</span>
                  </p>
                  <TicketQr
                    code={tk.code}
                    label={t('order.qrLabel', { serial: tk.serial })}
                    className="size-60 text-black"
                  />
                  <p className="text-caption text-zinc-500">
                    {t('order.shortCode')}{' '}
                    <span className="font-mono text-body tracking-[0.2em] text-black">{tk.shortCode}</span>
                  </p>
                  {tk.seatLabel ? (
                    <p className="text-body font-medium">{t('order.seatLabel', { seat: tk.seatLabel })}</p>
                  ) : null}
                  <p className="text-caption">{tk.holderName}</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {holderTarget ? (
        <HolderContent target={holderTarget} locale={locale} timeZone={order.event.timezone} />
      ) : null}
    </main>
  );
}
