import { executeQuery } from '@yayatoh/kernel';
import { attributionSettingsQuery, linkReportQuery, utmOnlyReportQuery } from '@yayatoh/marketing';
import { roleCan } from '@yayatoh/tenancy';
import { Card, PageHeader, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AttributionWindowForm, CopyLinkButton, TrackedLinkForm } from '@/components/tracked-links.tsx';
import { Link } from '@/i18n/navigation.ts';
import { linkOrigin, percent, revenueText } from '@/lib/tracked-links.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { createTrackedLinkAction, setAttributionWindowAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('trackedLinks');
  return { title: t('title') };
}

/**
 * Tracked links of an event (M3.8a): create links per source / medium / campaign, copy them, and
 * read each one's clicks, attributed orders, revenue and conversion. UTM-only orders (a UTM landing
 * without a tracked-link click) are summarized below.
 */
export default async function TrackedLinksPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event, 'trackedLinks');
  if (!data.modules.has('marketing') || !roleCan(data.role, 'marketing:read')) notFound();
  const t = await getTranslations('trackedLinks');
  const canWrite = roleCan(data.role, 'marketing:write');
  const [rows, utmOnly, settings] = await Promise.all([
    executeQuery(linkReportQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(utmOnlyReportQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(attributionSettingsQuery, {}, data.ctx, ports),
  ]);
  const origin = linkOrigin();
  const nf = new Intl.NumberFormat(locale);
  const base = `/o/${org}/e/${event}/tracked-links`;
  return (
    <>
      <PageHeader title={t('title')} description={t('description', { event: ev.name })} />
      {canWrite ? null : <p className="text-body text-zinc-500">{t('viewerNotice')}</p>}
      {canWrite ? (
        <section aria-labelledby="create-link-heading" className="flex flex-col gap-3">
          <h2 id="create-link-heading" className="text-section">
            {t('createTitle')}
          </h2>
          <Card size="panel">
            <TrackedLinkForm
              action={createTrackedLinkAction.bind(null, org, event)}
              eventPath={`/events/${ev.slug}`}
            />
          </Card>
        </section>
      ) : null}
      <section aria-labelledby="links-heading" className="flex flex-col gap-3">
        <h2 id="links-heading" className="text-section">
          {t('listTitle')}
        </h2>
        <p className="text-caption text-zinc-500">{t('listHint', { days: settings.windowDays })}</p>
        <Table
          caption={t('listTitle')}
          rowKey={(r) => r.link.id}
          rows={rows}
          empty={t('empty')}
          columns={[
            {
              key: 'link',
              header: t('link'),
              cell: (r) => {
                const url = `${origin}/r/${r.link.code}`;
                const name = r.link.label ?? `${r.link.source} / ${r.link.medium} / ${r.link.campaign}`;
                return (
                  <span className="flex flex-col gap-1">
                    <Link href={`${base}/${r.link.id}`} className="underline underline-offset-2">
                      {name}
                    </Link>
                    <span className="text-caption text-zinc-500">
                      {t('utmLine', {
                        source: r.link.source,
                        medium: r.link.medium,
                        campaign: r.link.campaign,
                      })}
                    </span>
                    <span
                      dir="ltr"
                      className="font-mono text-caption break-all"
                      data-testid="tracked-link-url"
                    >
                      {url}
                    </span>
                    <CopyLinkButton url={url} name={name} />
                  </span>
                );
              },
            },
            {
              key: 'clicks',
              header: t('clicks'),
              cell: (r) => nf.format(r.stats.clicks),
              mono: true,
              align: 'end',
            },
            {
              key: 'orders',
              header: t('orders'),
              cell: (r) => nf.format(r.stats.orders),
              mono: true,
              align: 'end',
            },
            {
              key: 'revenue',
              header: t('revenue'),
              cell: (r) => revenueText(r.stats.revenue, locale),
              mono: true,
              align: 'end',
            },
            {
              key: 'conversion',
              header: t('conversion'),
              cell: (r) => percent(r.stats.conversionBps, locale),
              mono: true,
              align: 'end',
            },
          ]}
        />
      </section>
      <section aria-labelledby="utm-only-heading" className="flex flex-col gap-3">
        <h2 id="utm-only-heading" className="text-section">
          {t('utmOnlyTitle')}
        </h2>
        <p className="text-caption text-zinc-500">{t('utmOnlyHint')}</p>
        <Table
          caption={t('utmOnlyTitle')}
          rowKey={(r) => JSON.stringify([r.source, r.medium, r.campaign])}
          rows={utmOnly}
          empty={t('utmOnlyEmpty')}
          columns={[
            { key: 'source', header: t('source'), cell: (r) => r.source },
            { key: 'medium', header: t('medium'), cell: (r) => r.medium ?? '—' },
            { key: 'campaign', header: t('campaign'), cell: (r) => r.campaign ?? '—' },
            {
              key: 'orders',
              header: t('orders'),
              cell: (r) => nf.format(r.orders),
              mono: true,
              align: 'end',
            },
            {
              key: 'revenue',
              header: t('revenue'),
              cell: (r) => revenueText(r.revenue, locale),
              mono: true,
              align: 'end',
            },
          ]}
        />
      </section>
      <section aria-labelledby="window-heading" className="flex flex-col gap-3">
        <h2 id="window-heading" className="text-section">
          {t('windowTitle')}
        </h2>
        <Card size="panel">
          {canWrite ? (
            <AttributionWindowForm
              action={setAttributionWindowAction.bind(null, org, event)}
              windowDays={settings.windowDays}
            />
          ) : (
            <p className="text-body">{t('windowValue', { days: settings.windowDays })}</p>
          )}
        </Card>
      </section>
    </>
  );
}
