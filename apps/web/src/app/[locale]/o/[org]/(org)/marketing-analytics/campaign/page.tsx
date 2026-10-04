import { executeQuery, formatMoney, isDomainError, money } from '@yayatoh/kernel';
import { type CampaignDetailDto, campaignDetailQuery } from '@yayatoh/marketing';
import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, Card, PageHeader, SectionHeader, StatusDot, Table, Tag } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AnalyticsRows, FigureTiles, RangeForm, ratePct } from '@/components/marketing-analytics.tsx';
import { Link } from '@/i18n/navigation.ts';
import { campaignNames } from '@/server/campaign-names.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketingAnalytics');
  return { title: t('detail.title') };
}

const RANGE_REASONS = new Set(['invalid_date', 'from_after_to', 'range_too_long']);
const day = (v: string | undefined) => (v && v.length <= 10 ? v : undefined);

/**
 * One campaign (M3.8b): its figures for the range, how its email and texts were delivered, its
 * tracked links and the orders it led to (first touch, last touch or both).
 */
export default async function CampaignAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ key?: string; from?: string; to?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const data = await loadConsole(org);
  if (!data.modules.has('marketing') || !roleCan(data.role, 'marketing:read')) notFound();
  // The key travels as a query parameter: campaign keys contain dots (`c.{id}`, UTM values).
  const key = typeof sp.key === 'string' && sp.key.length >= 2 && sp.key.length <= 120 ? sp.key : null;
  if (!key) notFound();
  const t = await getTranslations('marketingAnalytics');
  const load = (from?: string, to?: string) =>
    executeQuery(campaignDetailQuery, { key, from, to }, data.ctx, ports);
  let error: string | null = null;
  let d: CampaignDetailDto;
  try {
    d = await load(day(sp.from), day(sp.to));
  } catch (err) {
    if (!isDomainError(err)) throw err;
    if (err.code === 'not_found') notFound();
    const reason = String(err.details?.reason ?? '');
    if (err.code !== 'validation_failed' || !RANGE_REASONS.has(reason)) throw err;
    error = reason;
    d = await load().catch((e) => {
      if (isDomainError(e) && e.code === 'not_found') notFound();
      throw e;
    });
  }
  const base = `/o/${org}/marketing-analytics`;
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const n = new Intl.NumberFormat(locale);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: d.timeZone,
  });
  const canOrders = roleCan(data.role, 'orders:read');
  // Batch 3g merge: a messaging campaign by its M3.6b name.
  const named =
    d.kind === 'campaign' ? (await campaignNames(data.ctx, [key.slice(2)])).get(key.slice(2)) : undefined;
  const name = named ?? d.name ?? t('unnamed');
  return (
    <>
      <PageHeader title={name} tag={<Tag>{t(`kind.${d.kind}`)}</Tag>} />
      <RangeForm
        action={`${prefix}${base}/campaign`}
        from={error ? (sp.from ?? d.fromDay) : d.fromDay}
        to={error ? (sp.to ?? d.toDay) : d.toDay}
        timeZone={d.timeZone}
        currency={d.currency}
        error={error}
        hidden={{ key }}
      />
      <FigureTiles
        figures={d.figures}
        currency={d.currency}
        locale={locale}
        label={t('detail.figuresLabel')}
      />

      {d.delivery ? (
        <section aria-labelledby="delivery-heading" className="flex flex-col gap-3">
          <SectionHeader id="delivery-heading" title={t('detail.deliveryTitle')} />
          <Card className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="campaign-delivery">
              {(
                [
                  ['sent', n.format(d.delivery.sent)],
                  ['delivered', n.format(d.delivery.delivered)],
                  ['bounced', n.format(d.delivery.bounced)],
                  ['complained', n.format(d.delivery.complained)],
                  ['bounceRate', ratePct(d.delivery.bounceBps, locale)],
                  ['complaintRate', ratePct(d.delivery.complaintBps, locale)],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex flex-col gap-1 rounded-tile bg-surface-2 px-4 py-3">
                  <dt className="text-body font-semibold text-ink-2">{t(`detail.${k}`)}</dt>
                  <dd className="m-0 text-[24px] leading-none font-extrabold tracking-[-0.03em] text-ink tabular-nums">
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
            {roleCan(data.role, 'messages:read') ? (
              <Link href={`${base}/deliverability`} className={buttonClass('secondary', 'sm', 'self-start')}>
                {t('openDeliverability')}
              </Link>
            ) : null}
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="links-heading" className="flex flex-col gap-3">
        <SectionHeader id="links-heading" title={t('detail.linksTitle')} />
        <AnalyticsRows view="link" rows={d.links} currency={d.currency} locale={locale} href={() => null} />
      </section>

      <section aria-labelledby="orders-heading" className="flex flex-col gap-3">
        <SectionHeader id="orders-heading" title={t('detail.ordersTitle')} />
        <Table
          caption={t('detail.ordersTitle')}
          rowKey={(o) => o.orderId}
          rows={d.orders}
          empty={t('detail.noOrders')}
          columns={[
            {
              key: 'order',
              header: t('detail.order'),
              cell: (o) =>
                canOrders && o.eventSlug ? (
                  <Link
                    href={`/o/${org}/e/${o.eventSlug}/orders/${o.orderId}`}
                    className="inline-flex min-h-6 items-center font-mono font-bold text-primary-ink underline"
                  >
                    {o.orderId.slice(-8).toUpperCase()}
                  </Link>
                ) : (
                  <span className="font-mono">{o.orderId.slice(-8).toUpperCase()}</span>
                ),
            },
            { key: 'event', header: t('detail.event'), cell: (o) => o.eventName ?? '—' },
            {
              key: 'touch',
              header: t('detail.credit'),
              cell: (o) => (
                <StatusDot
                  status={o.touch === 'both' ? 'success' : 'neutral'}
                  label={t(`detail.touch.${o.touch}`)}
                />
              ),
            },
            {
              key: 'total',
              header: t('detail.total'),
              cell: (o) => formatMoney(money(o.totalMinor, o.currency), locale),
              align: 'end',
            },
            { key: 'placed', header: t('detail.placed'), cell: (o) => when.format(o.orderedAt) },
          ]}
        />
      </section>
    </>
  );
}
