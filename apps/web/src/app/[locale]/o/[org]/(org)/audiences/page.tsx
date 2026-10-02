import { listSegmentsQuery, TEMPLATE_KEYS } from '@yayatoh/audiences';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, Card, EmptyState, PageHeader, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('audiences');
  return { title: t('title') };
}

/** Marketing → Audiences (M3.6): saved audiences with live counts, and the vision templates. */
export default async function AudiencesPage({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('marketing') || !roleCan(data.role, 'messages:read')) notFound();
  const t = await getTranslations('audiences');
  const canSave = roleCan(data.role, 'messages:send');
  const segments = await executeQuery(listSegmentsQuery, {}, data.ctx, ports);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: data.org.timezone });
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <>
            {/* M6.1a: the org's people (timelines) and possible duplicates. */}
            {roleCan(data.role, 'contacts:read') ? (
              <>
                <Link href={`/o/${org}/audiences/people`} className={buttonClass('secondary')}>
                  {t('peopleLink')}
                </Link>
                <Link href={`/o/${org}/audiences/duplicates`} className={buttonClass('secondary')}>
                  {t('duplicatesLink')}
                </Link>
              </>
            ) : null}
            {canSave ? (
              <Link href={`/o/${org}/audiences/new`} className={buttonClass('primary')}>
                {t('new')}
              </Link>
            ) : null}
          </>
        }
      />
      {segments.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <Table
          caption={t('caption')}
          rowKey={(r) => r.id}
          rows={segments}
          columns={[
            {
              key: 'name',
              header: t('name'),
              cell: (r) => (
                <Link href={`/o/${org}/audiences/${r.id}`} className="underline underline-offset-2">
                  {r.name}
                </Link>
              ),
            },
            {
              key: 'count',
              header: t('people'),
              align: 'end',
              cell: (r) => (
                <span className="font-mono">
                  {r.count === null ? t('countUnavailable') : formatNumber(r.count, locale)}
                </span>
              ),
            },
            { key: 'updated', header: t('updated'), cell: (r) => when.format(r.updatedAt) },
          ]}
        />
      )}
      {canSave ? (
        <section aria-labelledby="templates-heading" className="flex flex-col gap-3">
          <h2 id="templates-heading" className="text-section">
            {t('templates.title')}
          </h2>
          <div className="grid gap-3 md:grid-cols-3">
            {TEMPLATE_KEYS.map((k) => (
              <Card key={k}>
                <div className="flex h-full flex-col gap-2">
                  <h3 className="text-body font-medium">{t(`templates.${k}.name`)}</h3>
                  <p className="text-caption text-zinc-500">{t(`templates.${k}.description`)}</p>
                  <Link
                    href={`/o/${org}/audiences/new?template=${k}`}
                    className={`${buttonClass('secondary', 'sm')} mt-auto self-start`}
                    aria-label={t('templates.startFor', { name: t(`templates.${k}.name`) })}
                  >
                    {t('templates.start')}
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
