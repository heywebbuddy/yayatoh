import { listEventsQuery } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, EmptyState, PageHeader, StatusPill, Table } from '@yayatoh/ui';
import { TicketPercent } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { HowItWorks } from '@/components/how-it-works.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'coupons' });
  return { title: t('title') };
}

/**
 * U2: Money › Coupons, the Create menu's "Coupon". Promo codes belong to one event each (set in
 * the event's Tickets & orders), so this page explains that and opens the codes of the event the
 * organizer picks. Org-wide coupons (UX-5) arrive with U9.
 */
export default async function CouponsPage({ params }: { params: Promise<{ locale: string; org: string }> }) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('ticketing') || !roleCan(data.role, 'events:read')) notFound();
  const t = await getTranslations('coupons');
  const ts = await getTranslations('eventStatus');
  const canWrite = roleCan(data.role, 'events:write');
  const events = (await executeQuery(listEventsQuery, {}, data.ctx, ports)).filter(
    (e) => e.status !== 'cancelled',
  );
  const when = (e: (typeof events)[number]) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: e.timezone }).format(e.startsAt);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <HowItWorks topic="coupons" />
      {events.length === 0 ? (
        <EmptyState
          icon={<TicketPercent strokeWidth={2} />}
          title={t('emptyTitle')}
          description={t('emptyDescription')}
          action={
            canWrite ? (
              <Link href={`/o/${org}/events/new/guided`} className={buttonClass('primary', 'md')}>
                {t('emptyAction')}
              </Link>
            ) : (
              <Link href={`/o/${org}`} className={buttonClass('secondary', 'md')}>
                {t('emptyActionRead')}
              </Link>
            )
          }
        />
      ) : (
        <Table
          caption={t('caption')}
          rowKey={(e) => e.id}
          rows={events}
          stackOnPhone
          columns={[
            { key: 'name', header: t('event'), cell: (e) => <span className="font-semibold">{e.name}</span> },
            { key: 'when', header: t('when'), cell: (e) => when(e) },
            {
              key: 'status',
              header: t('status'),
              cell: (e) => (
                <StatusPill
                  tone={e.status === 'published' ? 'success' : e.status === 'draft' ? 'waiting' : 'neutral'}
                  label={ts(e.status)}
                />
              ),
            },
            {
              key: 'codes',
              header: t('codes'),
              align: 'end',
              cell: (e) => (
                <Link
                  href={`/o/${org}/e/${e.slug}/tickets-orders#promo-codes`}
                  className={buttonClass('secondary', 'sm')}
                  aria-label={t('manageFor', { name: e.name })}
                >
                  {canWrite ? t('manage') : t('view')}
                </Link>
              ),
            },
          ]}
        />
      )}
    </>
  );
}
