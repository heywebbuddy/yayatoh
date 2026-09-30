import { getUsersByIds } from '@yayatoh/auth';
import { executeQuery } from '@yayatoh/kernel';
import { dsarHistoryQuery } from '@yayatoh/privacy';
import { roleCan } from '@yayatoh/tenancy';
import { EmptyState, PageHeader, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PrivacyConsole } from '@/components/privacy-console.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { erasePersonAction, exportPersonAction, findPersonAction } from './actions.ts';

/**
 * Privacy requests (M1.14c): find a person across the org, export their data (JSON), erase them
 * with legal holds, and the record of past requests. Owners and admins only.
 */
export default async function PrivacyPage({ params }: { params: Promise<{ locale: string; org: string }> }) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations();
  if (!roleCan(data.role, 'privacy:manage')) {
    return (
      <>
        <PageHeader title={t('privacy.title')} />
        <EmptyState title={t('privacy.noAccessTitle')} description={t('privacy.noAccessDescription')} />
      </>
    );
  }
  const history = await executeQuery(dsarHistoryQuery, { limit: 20 }, data.ctx, ports);
  const people = await getUsersByIds(history.flatMap((h) => (h.requestedBy ? [h.requestedBy] : [])));
  const when = new Intl.DateTimeFormat(locale, {
    timeZone: data.org.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const prefix = locale === 'en' ? '' : `/${locale}`;
  return (
    <>
      <PageHeader
        title={t('privacy.title')}
        description={t('privacy.description')}
        actions={
          <Link href="/privacy" className="text-body underline underline-offset-2">
            {t('privacy.noticeLink')}
          </Link>
        }
      />
      <PrivacyConsole
        find={findPersonAction.bind(null, org)}
        exportData={exportPersonAction.bind(null, org)}
        erase={erasePersonAction.bind(null, org)}
        downloadBase={`${prefix}/o/${org}/privacy/exports`}
      />
      <section aria-labelledby="dsar-history" className="flex flex-col gap-3">
        <h2 id="dsar-history" className="text-section">
          {t('privacy.history.title')}
        </h2>
        <Table
          caption={t('privacy.history.caption')}
          rowKey={(h) => h.id}
          rows={history}
          empty={t('privacy.history.empty')}
          columns={[
            {
              key: 'at',
              header: t('privacy.history.when'),
              cell: (h) => <time dateTime={h.createdAt.toISOString()}>{when.format(h.createdAt)}</time>,
            },
            { key: 'kind', header: t('privacy.history.kind'), cell: (h) => t(`privacy.kinds.${h.kind}`) },
            { key: 'subject', header: t('privacy.history.subject'), cell: (h) => h.subjectHint, mono: true },
            {
              key: 'by',
              header: t('privacy.history.by'),
              cell: (h) =>
                h.requestedBy ? (people.get(h.requestedBy)?.name ?? t('activity.formerMember')) : '—',
            },
            {
              key: 'records',
              header: t('privacy.history.records'),
              cell: (h) => Object.values(h.summary).reduce((a, b) => a + b, 0),
              mono: true,
              align: 'end',
            },
          ]}
        />
      </section>
    </>
  );
}
