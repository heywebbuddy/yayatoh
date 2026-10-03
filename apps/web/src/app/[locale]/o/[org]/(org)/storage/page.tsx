import { executeQuery } from '@yayatoh/kernel';
import { storageUsageQuery } from '@yayatoh/media';
import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, EmptyState, PageHeader, ProgressBar, StatCard, Table } from '@yayatoh/ui';
import { HardDrive } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { formatBytes, percentOf } from '@/lib/bytes.ts';
import { loadConsole } from '@/server/console.ts';
import { toLibraryEntry } from '@/server/media.ts';
import { ports } from '@/server/ports.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'storage' });
  return { title: t('title') };
}

/**
 * U10 (UX-3): the org's storage, numbers first. Storage is platform-managed (no per-org storage
 * account): the quota staff set, what uses it by kind, and the largest images with where they
 * are used. Reused library images cost nothing (their files are stored once).
 */
export default async function StoragePage({ params }: { params: Promise<{ locale: string; org: string }> }) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations('storage');
  const u = await executeQuery(storageUsageQuery, { largest: 10 }, data.ctx, ports);
  const pct = percentOf(u.usedBytes, u.limitBytes);
  const size = (b: number) => formatBytes(b, locale);
  const largest = u.largest.map((l) => toLibraryEntry(org, l));
  const canWrite = roleCan(data.role, 'events:write');
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Link href={`/o/${org}/media`} className={buttonClass('primary')}>
            {t('openLibrary')}
          </Link>
        }
      />
      <section aria-label={t('summaryLabel')} className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatCard
          label={t('used')}
          value={size(u.usedBytes)}
          sub={t(u.customLimit ? 'ofCustom' : 'ofDefault', { limit: size(u.limitBytes) })}
          progress={{
            value: pct,
            label: t('usedPercent', { percent: pct }),
            tone: pct >= 90 ? 'danger' : pct >= 75 ? 'warning' : 'primary',
          }}
          testId="storage-used"
        />
        <StatCard
          label={t('free')}
          value={size(Math.max(0, u.limitBytes - u.usedBytes))}
          sub={t('freeSub')}
        />
        <StatCard
          label={t('images')}
          value={new Intl.NumberFormat(locale).format(u.images)}
          sub={t('imagesSub', { files: u.files, reuses: u.reuses })}
        />
      </section>
      {pct >= 90 ? <p className="text-body text-danger">{t('nearlyFull')}</p> : null}

      <section aria-labelledby="by-kind" className="flex flex-col gap-3">
        <h2 id="by-kind" className="text-section">
          {t('byKindTitle')}
        </h2>
        <Table
          caption={t('byKindTitle')}
          rowKey={(k) => k.kind}
          rows={u.byKind}
          stackOnPhone
          columns={[
            {
              key: 'kind',
              header: t('kind'),
              cell: (k) => <span className="font-semibold">{t(`kinds.${k.kind}`)}</span>,
            },
            { key: 'images', header: t('imagesCol'), align: 'end', mono: true, cell: (k) => k.images },
            { key: 'bytes', header: t('size'), align: 'end', mono: true, cell: (k) => size(k.bytes) },
            {
              key: 'share',
              header: t('share'),
              cell: (k) => {
                const share = percentOf(k.bytes, u.usedBytes);
                return (
                  <ProgressBar
                    value={share}
                    label={t('shareOf', { kind: t(`kinds.${k.kind}`), percent: share })}
                    className="min-w-24"
                  />
                );
              },
            },
          ]}
        />
        <p className="text-caption text-ink-2">
          {t('portalFiles', { files: u.portalFiles.files, size: size(u.portalFiles.bytes) })}
        </p>
      </section>

      <section aria-labelledby="largest" className="flex flex-col gap-3">
        <h2 id="largest" className="text-section">
          {t('largestTitle')}
        </h2>
        {largest.length === 0 ? (
          <EmptyState
            icon={<HardDrive strokeWidth={2} />}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
            action={
              <Link
                href={canWrite ? `/o/${org}/media#library-upload` : `/o/${org}/media`}
                className={buttonClass('primary', 'md')}
              >
                {canWrite ? t('emptyAction') : t('openLibrary')}
              </Link>
            }
          />
        ) : (
          <Table
            caption={t('largestTitle')}
            rowKey={(l) => l.id}
            rows={largest}
            stackOnPhone
            columns={[
              {
                key: 'image',
                header: t('image'),
                cell: (l) => (
                  <span className="flex items-center gap-3">
                    <img
                      src={l.preview}
                      alt=""
                      width={l.width}
                      height={l.height}
                      loading="lazy"
                      className="h-10 w-16 shrink-0 rounded-control bg-surface-2 object-contain"
                    />
                    <span className="break-words">{l.alt ?? t('decorative')}</span>
                  </span>
                ),
              },
              { key: 'size', header: t('size'), align: 'end', mono: true, cell: (l) => size(l.bytes) },
              {
                key: 'used',
                header: t('usedIn'),
                cell: (l) =>
                  l.usedIn.length === 0 ? (
                    <span className="text-ink-2">{t('unused')}</span>
                  ) : (
                    t('places', { count: l.usedIn.length })
                  ),
              },
            ]}
          />
        )}
      </section>
      <p className="text-caption text-ink-2">{t('managedNote')}</p>
    </>
  );
}
