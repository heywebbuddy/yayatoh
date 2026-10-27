import 'server-only';
import { formatMoney, money } from '@yayatoh/kernel';
import type { PublicOrderDto } from '@yayatoh/orders';
import { getTranslations } from 'next-intl/server';

/** A buyer receipt exists for orders that were actually paid (not free, not unpaid or expired). */
export const receiptEligible = (o: Pick<PublicOrderDto, 'status' | 'totalMinor' | 'paidAt'>) =>
  ['paid', 'partially_refunded', 'refunded'].includes(o.status) && o.totalMinor > 0 && o.paidAt !== null;

/** The short receipt number a buyer quotes: stable, from the order's id. */
export const receiptNumber = (orderId: string) => `R-${orderId.replaceAll('-', '').slice(-8).toUpperCase()}`;

export interface ReceiptModel {
  readonly number: string;
  readonly title: string;
  readonly seller: string;
  readonly rows: readonly (readonly [string, string])[];
  readonly lineHeads: readonly [string, string, string, string];
  readonly lines: readonly (readonly [string, string, string, string])[];
  readonly totals: readonly (readonly [string, string])[];
  readonly paymentsTitle: string;
  readonly payments: readonly (readonly [string, string])[];
  readonly note: string;
  readonly footer: string;
}

/** What a receipt says, translated and formatted for the reader (page and PDF share it). */
export async function buildReceipt(order: PublicOrderDto, locale: string): Promise<ReceiptModel> {
  const t = await getTranslations({ locale, namespace: 'receipt' });
  const all = await getTranslations({ locale });
  const fmt = (minor: number) => formatMoney(money(minor, order.currency), locale);
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: order.event.timezone });
  const stamp = new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: order.event.timezone,
  });
  const number = receiptNumber(order.id);
  const seller = order.event.organizerName;
  const list = order.subtotalMinor + order.discountMinor;
  return {
    number,
    title: t('title', { number }),
    seller,
    rows: [
      [t('number'), number],
      [t('paidOn'), order.paidAt ? stamp.format(order.paidAt) : ''],
      [t('billedTo'), `${order.buyerName} <${order.buyerEmail}>`],
      [t('event'), `${order.event.name} · ${stamp.format(order.event.startsAt)}`],
      [
        t('soldBy'),
        order.collectedBy === 'organizer'
          ? all('order.collectedBy', { org: seller })
          : all(`order.soldBy.${order.fundsFlow}`, { org: seller }),
      ],
      ...(order.status === 'paid' ? [] : [[t('status'), all(`order.status.${order.status}`)] as const]),
    ],
    lineHeads: [t('item'), t('quantity'), t('unit'), t('amount')],
    lines: order.items.map((i) => [
      i.name,
      String(i.quantity),
      fmt(i.unitAllInMinor),
      fmt(i.unitAllInMinor * i.quantity),
    ]),
    totals: [
      [t('tickets'), fmt(list)],
      ...(order.discountMinor > 0
        ? [[t('discount', { code: order.promoCode ?? '' }), `−${fmt(order.discountMinor)}`] as const]
        : []),
      ...(order.feeMinor > 0 ? [[t('feesIncluded'), fmt(order.feeMinor)] as const] : []),
      [t('totalPaid'), fmt(order.totalMinor)],
    ],
    paymentsTitle: t('payment'),
    payments: [[order.paidAt ? day.format(order.paidAt) : '', fmt(order.totalMinor)]],
    note: t('note'),
    footer: t('footer', { seller }),
  };
}
