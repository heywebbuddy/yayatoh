import { contactStatsQuery, contactValueQuery } from '@yayatoh/crm';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, EmptyState, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ContactStatsPanel } from '@/components/contact-stats.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('contactStats');
  return { title: t('title') };
}

const UUID = /^[0-9a-f-]{36}$/;

/**
 * A contact (M6.1b): who they are to this org in numbers. Stats need `contacts:read`; lifetime
 * value and the RFM monetary quintile are loaded only for members who can read finance.
 */
export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; contact: string }>;
}) {
  const { locale, org, contact } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!roleCan(data.role, 'contacts:read') || !UUID.test(contact)) notFound();
  const t = await getTranslations('contactStats');
  let stats: Awaited<ReturnType<typeof loadStats>>;
  try {
    stats = await loadStats();
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  }
  async function loadStats() {
    return executeQuery(contactStatsQuery, { contactId: contact }, data.ctx, ports);
  }
  const value = roleCan(data.role, 'finance:read')
    ? await executeQuery(contactValueQuery, { contactId: contact }, data.ctx, ports)
    : null;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${org}/contacts/stats`} className="underline underline-offset-2">
            {t('insightsTitle')}
          </Link>
        }
        title={stats.name ?? stats.email}
        description={<bdi>{stats.email}</bdi>}
      />
      {!stats.live ? <Alert tone="info" title={t('notLive')} /> : null}
      {stats.computedAt === null ? (
        <EmptyState
          title={t('emptyTitle')}
          description={t('emptyDescription')}
          action={
            <Link href={`/o/${org}/audiences`} className="underline underline-offset-2">
              {t('emptyAction')}
            </Link>
          }
        />
      ) : (
        <ContactStatsPanel stats={stats} value={value} locale={locale} timezone={data.org.timezone} />
      )}
    </>
  );
}
