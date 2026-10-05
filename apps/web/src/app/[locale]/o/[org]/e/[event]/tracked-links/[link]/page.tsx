import { executeQuery, formatMoney, isDomainError, money } from '@yayatoh/kernel';
import { type LinkDetailDto, linkDetailQuery } from '@yayatoh/marketing';
import { qrPath } from '@yayatoh/pdf';
import { roleCan } from '@yayatoh/tenancy';
import { Card, PageHeader, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CopyLinkButton } from '@/components/tracked-links.tsx';
import { Link } from '@/i18n/navigation.ts';
import { linkOrigin, percent, revenueText } from '@/lib/tracked-links.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('trackedLinks');
  return { title: t('reportTitle') };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** One tracked link (M3.8a): its URL and QR code, figures, and the orders it touched. */
export default async function TrackedLinkPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string; link: string }>;
}) {
  const { locale, org, event, link } = await params;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event, 'trackedLinks');
  if (!data.modules.has('marketing') || !roleCan(data.role, 'marketing:read') || !UUID.test(link)) notFound();
  const t = await getTranslations('trackedLinks');
  const tr = await getTranslations();
  let detail: LinkDetailDto;
  try {
    detail = await executeQuery(linkDetailQuery, { linkId: link }, data.ctx, ports);
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  }
  // A link of another event of the org is not this event's page.
  if (detail.link.eventId !== ev.id) notFound();
  const url = `${linkOrigin()}/r/${detail.link.code}`;
  const name = detail.link.label ?? `${detail.link.source} / ${detail.link.medium} / ${detail.link.campaign}`;
  const qr = qrPath(url);
  const nf = new Intl.NumberFormat(locale);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: ev.timezone,
  });
  const canSeeOrders = roleCan(data.role, 'orders:read');
  const s = detail.stats;
  const figures: [string, string, string][] = [
    ['clicks', t('clicks'), nf.format(s.clicks)],
    ['visitors', t('visitors'), nf.format(s.visitors)],
    ['orders', t('orders'), nf.format(s.orders)],
    ['first-touch', t('firstTouchOrders'), nf.format(s.firstTouchOrders)],
    ['revenue', t('revenue'), revenueText(s.revenue, locale)],
    ['conversion', t('conversion'), percent(s.conversionBps, locale)],
  ];
  return (
    <>
      <p>
        <Link
          href={`/o/${org}/e/${event}/tracked-links`}
          className="text-caption underline underline-offset-2"
        >
          {t('back')}
        </Link>
      </p>
      <PageHeader title={name} description={t('reportDescription')} />
      <Card size="panel" className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-3">
          <dl className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <dt className="text-caption text-ink-2">{t('link')}</dt>
              <dd className="m-0 font-mono text-body break-all" dir="ltr" data-testid="tracked-link-url">
                {url}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-caption text-ink-2">{t('utm')}</dt>
              <dd className="m-0 text-body">
                {t('utmLine', {
                  source: detail.link.source,
                  medium: detail.link.medium,
                  campaign: detail.link.campaign,
                })}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-caption text-ink-2">{t('destination')}</dt>
              <dd className="m-0 font-mono text-body break-all" dir="ltr">
                {detail.link.destinationPath ?? `/events/${ev.slug}`}
              </dd>
            </div>
          </dl>
          <CopyLinkButton url={url} name={name} />
        </div>
        <svg
          role="img"
          aria-label={t('qrLabel', { url })}
          data-testid="tracked-link-qr"
          viewBox={`0 0 ${qr.size} ${qr.size}`}
          shapeRendering="crispEdges"
          className="size-40 shrink-0 rounded-tag text-black"
        >
          <rect width={qr.size} height={qr.size} className="fill-white" />
          <path d={qr.d} fill="currentColor" />
        </svg>
      </Card>
      <section aria-labelledby="figures-heading" className="flex flex-col gap-3">
        <h2 id="figures-heading" className="text-section">
          {t('figures')}
        </h2>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {figures.map(([key, label, value]) => (
            <Card key={key} className="flex flex-col gap-1">
              <dt className="text-caption text-ink-2">{label}</dt>
              <dd className="m-0 font-mono text-section" data-testid={`figure-${key}`}>
                {value}
              </dd>
            </Card>
          ))}
        </dl>
      </section>
      <section aria-labelledby="orders-heading" className="flex flex-col gap-3">
        <h2 id="orders-heading" className="text-section">
          {t('ordersTitle')}
        </h2>
        <Table
          caption={t('ordersTitle')}
          rowKey={(o) => o.orderId}
          rows={detail.orders}
          empty={t('ordersEmpty')}
          columns={[
            {
              key: 'order',
              header: t('order'),
              cell: (o) =>
                canSeeOrders ? (
                  <Link
                    href={`/o/${org}/e/${event}/orders/${o.orderId}`}
                    className="font-mono underline underline-offset-2"
                  >
                    {o.orderId.slice(-8).toUpperCase()}
                  </Link>
                ) : (
                  <span className="font-mono">{o.orderId.slice(-8).toUpperCase()}</span>
                ),
            },
            { key: 'when', header: t('orderedAt'), cell: (o) => when.format(o.orderedAt) },
            { key: 'touch', header: t('touch'), cell: (o) => t(`touchKind.${o.touch}`) },
            {
              key: 'status',
              header: t('status'),
              cell: (o) => tr(`order.status.${o.status}` as 'order.status.paid'),
            },
            {
              key: 'total',
              header: t('total'),
              cell: (o) => formatMoney(money(o.totalMinor, o.currency), locale),
              mono: true,
              align: 'end',
            },
          ]}
        />
      </section>
    </>
  );
}
