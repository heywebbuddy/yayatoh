import { listJourneysQuery } from '@yayatoh/automations';
import { listSeriesQuery } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, buttonClass, Chip, EmptyState, PageHeader, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('journeys');
  return { title: t('title') };
}

/** Marketing → Journeys (M3.7a): the org's automations, on or off, with how many people are on them. */
export default async function JourneysPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ deleted?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('marketing') || !roleCan(data.role, 'marketing:read')) notFound();
  const sp = await searchParams;
  const t = await getTranslations('journeys');
  const canWrite = roleCan(data.role, 'marketing:write');
  const [journeys, series] = await Promise.all([
    executeQuery(listJourneysQuery, {}, data.ctx, ports),
    executeQuery(listSeriesQuery, {}, data.ctx, ports),
  ]);
  const seriesName = new Map(series.map((s) => [s.id, s.name]));
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: data.org.timezone });
  const newLink = canWrite ? (
    <Link href={`/o/${org}/journeys/new`} className={buttonClass('primary')}>
      {t('new')}
    </Link>
  ) : undefined;
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} actions={newLink} />
      {sp.deleted ? (
        <div aria-live="polite">
          <Alert tone="info" title={t('detail.deleted')} />
        </div>
      ) : null}
      {journeys.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          description={canWrite ? t('emptyDescription') : t('emptyReadOnly')}
          action={newLink}
        />
      ) : (
        <Table
          caption={t('caption')}
          rowKey={(r) => r.id}
          rows={journeys}
          columns={[
            {
              key: 'name',
              header: t('name'),
              cell: (r) => (
                <Link href={`/o/${org}/journeys/${r.id}`} className="underline underline-offset-2">
                  {r.name}
                </Link>
              ),
            },
            {
              key: 'scope',
              header: t('scope'),
              cell: (r) =>
                r.eventName ??
                (r.seriesId ? t('seriesScope', { name: seriesName.get(r.seriesId) ?? '' }) : '—'),
            },
            { key: 'trigger', header: t('trigger'), cell: (r) => t(`triggers.${r.trigger}`) },
            {
              key: 'status',
              header: t('status'),
              cell: (r) => (
                <Chip tone={r.enabled ? 'accent' : 'neutral'}>{r.enabled ? t('on') : t('off')}</Chip>
              ),
            },
            {
              key: 'steps',
              header: t('steps'),
              align: 'end',
              cell: (r) => <span className="font-mono">{formatNumber(r.steps, locale)}</span>,
            },
            {
              key: 'runs',
              header: t('runs'),
              align: 'end',
              cell: (r) => <span className="font-mono">{formatNumber(r.runs, locale)}</span>,
            },
            { key: 'updated', header: t('updated'), cell: (r) => when.format(r.updatedAt) },
          ]}
        />
      )}
    </>
  );
}
