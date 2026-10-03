import { executeQuery } from '@yayatoh/kernel';
import { storageUsageQuery } from '@yayatoh/media';
import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, EmptyState, PageHeader, ProgressBar } from '@yayatoh/ui';
import { Images } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Pagination } from '@/components/marketplace/pagination.tsx';
import { LibraryGrid } from '@/components/media-library-grid.tsx';
import { MediaUploader } from '@/components/media-uploader.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatBytes, percentOf } from '@/lib/bytes.ts';
import { loadConsole } from '@/server/console.ts';
import { libraryPage, mediaPanel } from '@/server/media.ts';
import { ports } from '@/server/ports.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'mediaLibrary' });
  return { title: t('title') };
}

/**
 * U10: the org's media library. Every image it has uploaded (originals), where each is used,
 * an upload straight into the library, and delete for images used nowhere. Images are reused
 * from each uploader's "Choose from the media library" without uploading again.
 */
export default async function MediaLibraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ page?: string; filter?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const data = await loadConsole(org);
  const t = await getTranslations('mediaLibrary');
  const unusedOnly = sp.filter === 'unused';
  const page = Math.min(1000, Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1));
  const lib = await libraryPage(data, { page, unusedOnly });
  const usage = await executeQuery(storageUsageQuery, { largest: 0 }, data.ctx, ports);
  const upload = await mediaPanel(data, 'library', data.org.id, 'library');
  const canWrite = roleCan(data.role, 'events:write');
  const pct = percentOf(usage.usedBytes, usage.limitBytes);
  const filter = (key: 'all' | 'unused') => (
    <Link
      href={key === 'all' ? `/o/${org}/media` : `/o/${org}/media?filter=unused`}
      aria-current={(key === 'unused') === unusedOnly ? 'page' : undefined}
      className={buttonClass((key === 'unused') === unusedOnly ? 'primary' : 'secondary', 'sm')}
    >
      {t(`filters.${key}`)}
    </Link>
  );
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canWrite ? (
            <a href="#library-upload" className={buttonClass('primary')}>
              {t('upload')}
            </a>
          ) : null
        }
      />
      <section aria-label={t('summaryLabel')} className="flex flex-col gap-2">
        <p className="text-body">
          {t('summary', {
            images: usage.images,
            reuses: usage.reuses,
            used: formatBytes(usage.usedBytes, locale),
            limit: formatBytes(usage.limitBytes, locale),
          })}{' '}
          <Link href={`/o/${org}/storage`} className="underline">
            {t('storageLink')}
          </Link>
        </p>
        <ProgressBar value={pct} label={t('usedPercent', { percent: pct })} />
      </section>
      <nav aria-label={t('filtersLabel')} className="flex gap-2">
        {filter('all')}
        {filter('unused')}
      </nav>
      {lib.items.length === 0 ? (
        <EmptyState
          icon={<Images strokeWidth={2} />}
          title={t(unusedOnly ? 'emptyUnusedTitle' : 'emptyTitle')}
          description={t(
            unusedOnly ? 'emptyUnusedDescription' : canWrite ? 'emptyDescription' : 'emptyViewer',
          )}
          action={
            unusedOnly ? (
              <Link href={`/o/${org}/media`} className={buttonClass('secondary', 'md')}>
                {t('filters.all')}
              </Link>
            ) : canWrite ? (
              <a href="#library-upload" className={buttonClass('primary', 'md')}>
                {t('upload')}
              </a>
            ) : (
              <Link href={`/o/${org}/team`} className={buttonClass('secondary', 'md')}>
                {t('findOwner')}
              </Link>
            )
          }
        />
      ) : (
        <LibraryGrid org={org} items={lib.items} canDelete={canWrite} />
      )}
      <Pagination
        path={`/o/${org}/media`}
        params={{ filter: unusedOnly ? 'unused' : undefined }}
        page={lib.page}
        pageCount={lib.pageCount}
      />
      {canWrite ? (
        <div id="library-upload" className="scroll-mt-24">
          <MediaUploader
            org={org}
            slot="library"
            ticket={upload.ticket}
            items={[]}
            listless
            title={t('uploadTitle')}
          />
        </div>
      ) : null}
    </>
  );
}
