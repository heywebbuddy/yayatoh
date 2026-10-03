import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, Card, EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { listVenuesQuery } from '@yayatoh/venues';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { VenueForm } from '@/components/venue-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { zonesWith } from '@/lib/zones.ts';
import { loadConsole } from '@/server/console.ts';
import { venueThumbnails } from '@/server/media.ts';
import { ports } from '@/server/ports.ts';
import { createVenueAction } from './actions.ts';

export default async function VenuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ archived?: string }>;
}) {
  const { locale, org } = await params;
  const { archived } = await searchParams;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations('venues');
  const canWrite = roleCan(data.role, 'events:write');
  const showArchived = archived === '1';
  const venues = await executeQuery(listVenuesQuery, { includeArchived: showArchived }, data.ctx, ports);
  const thumbs = await venueThumbnails(
    data,
    venues.map((v) => v.id),
  );
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          // M6.11b: the venue layout library (saved floor plans).
          <Link href={`/o/${org}/seating-library`} className={buttonClass('secondary')}>
            {t('layoutLibrary')}
          </Link>
        }
      />
      {venues.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          description={canWrite ? t('emptyDescription') : t('emptyViewer')}
          action={
            canWrite ? (
              <a href="#new-venue-heading" className={buttonClass('primary')}>
                {t('new')}
              </a>
            ) : undefined
          }
        />
      ) : (
        <Table
          caption={t('caption')}
          rowKey={(v) => v.id}
          rows={venues}
          columns={[
            {
              // U3: the venue's first photo (decorative: the name follows in the next column).
              key: 'photo',
              header: t('photo'),
              cell: (v) => {
                const p = thumbs.get(v.id);
                return p ? (
                  <img
                    src={p.preview}
                    alt=""
                    width={p.width}
                    height={p.height}
                    data-testid="venue-thumb"
                    className="size-12 rounded-tag bg-surface-2 object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex size-12 items-center justify-center rounded-tag bg-surface-2 text-ink-3"
                  >
                    {v.name.slice(0, 1).toUpperCase()}
                  </span>
                );
              },
            },
            {
              key: 'name',
              header: t('name'),
              cell: (v) => (
                <Link href={`/o/${org}/venues/${v.id}`} className="underline underline-offset-2">
                  {v.name}
                </Link>
              ),
            },
            {
              key: 'place',
              header: t('place'),
              cell: (v) => [v.city, v.country].filter(Boolean).join(', '),
            },
            {
              key: 'capacity',
              header: t('capacity'),
              cell: (v) => (v.capacity === null ? '—' : formatNumber(v.capacity, locale)),
              mono: true,
              align: 'end',
            },
            {
              key: 'status',
              header: t('status'),
              cell: (v) =>
                v.archivedAt ? (
                  <StatusDot status="neutral" label={t('archived')} />
                ) : v.directoryListed ? (
                  <StatusDot status="success" label={t('listed')} />
                ) : (
                  <StatusDot status="info" label={t('unlisted')} />
                ),
            },
          ]}
        />
      )}
      <Link
        href={showArchived ? `/o/${org}/venues` : `/o/${org}/venues?archived=1`}
        className="self-start text-caption text-ink-2 underline underline-offset-2"
      >
        {showArchived ? t('hideArchived') : t('showArchived')}
      </Link>
      {canWrite ? (
        <section aria-labelledby="new-venue-heading" className="flex flex-col gap-3">
          <h2 id="new-venue-heading" className="text-section">
            {t('new')}
          </h2>
          <Card size="panel">
            <VenueForm
              action={createVenueAction.bind(null, org)}
              zones={zonesWith(data.org.timezone)}
              defaultTimezone={data.org.timezone}
            />
          </Card>
        </section>
      ) : (
        <p className="text-body text-ink-2">{t('viewerNotice')}</p>
      )}
    </>
  );
}
