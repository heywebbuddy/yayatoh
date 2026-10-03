import { agencyEventsQuery } from '@yayatoh/agency';
import { executeQuery, formatMoney, money } from '@yayatoh/kernel';
import { EmptyState, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { formatDate, formatNumber } from '@/lib/format.ts';
import { ports } from '@/server/ports.ts';
import { loadAgency } from '../load.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('agency');
  return { title: t('tab.events') };
}

/**
 * Events (M6.7a): upcoming and recent events across every live client, soonest first. Each opens
 * in the client's console (through the grant); times in the event's own time zone.
 */
export default async function AgencyEventsPage({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const { data, canRead } = await loadAgency(org);
  if (!canRead) return null;
  const t = await getTranslations('agency');
  const events = await executeQuery(agencyEventsQuery, {}, data.ctx, ports);
  if (events.length === 0) return <EmptyState title={t('eventsTitle')} description={t('eventsEmpty')} />;
  const n = (v: number) => formatNumber(v, locale);
  const anyHidden = events.some((e) => e.grossMinor === null);
  return (
    <section aria-labelledby="agency-events" className="flex flex-col gap-3">
      <h2 id="agency-events" className="text-section">
        {t('eventsTitle')}
      </h2>
      <Table
        caption={t('eventsTitle')}
        rowKey={(e) => `${e.clientOrgId}:${e.eventId}`}
        rows={events}
        empty=""
        columns={[
          {
            key: 'event',
            header: t('event'),
            cell: (e) => (
              <Link
                href={`/o/${e.clientSlug}/e/${e.slug}`}
                className="font-semibold underline underline-offset-2"
                aria-label={t('openEventNamed', { event: e.name, client: e.clientName })}
              >
                {e.name}
              </Link>
            ),
          },
          { key: 'client', header: t('client'), cell: (e) => e.clientName },
          {
            key: 'starts',
            header: t('starts'),
            cell: (e) =>
              formatDate(
                e.startsAt.toISOString(),
                { locale, currency: e.currency, timeZone: e.timezone },
                {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                  timeZoneName: 'short',
                },
              ),
          },
          {
            key: 'status',
            header: t('status'),
            cell: (e) => t(`eventStatus.${e.status as 'draft'}`),
          },
          { key: 'tickets', header: t('tickets'), align: 'end', cell: (e) => n(e.ticketsValid) },
          { key: 'checkins', header: t('checkins'), align: 'end', cell: (e) => n(e.checkins) },
          {
            key: 'gross',
            header: t('gross'),
            align: 'end',
            cell: (e) =>
              e.grossMinor === null ? (
                <span className="text-ink-2">{t('grossHidden')}</span>
              ) : (
                formatMoney(money(e.grossMinor, e.currency), locale)
              ),
          },
        ]}
      />
      {anyHidden ? <p className="text-caption text-ink-2">{t('grossHiddenHint')}</p> : null}
    </section>
  );
}
