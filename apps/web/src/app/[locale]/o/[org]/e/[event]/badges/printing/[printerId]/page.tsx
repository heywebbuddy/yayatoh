import { printLogQuery } from '@yayatoh/badges';
import { executeQuery } from '@yayatoh/kernel';
import { Alert, buttonClass, Card, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Crumbs } from '@/components/crumbs.tsx';
import { PrintStation } from '@/components/print-station.tsx';
import { Link } from '@/i18n/navigation.ts';
import { ports } from '@/server/ports.ts';
import { loadPrintingPage } from '@/server/printing.ts';
import { stationHeartbeatAction } from '@/server/printing-actions.ts';

/**
 * A print station (M5.5b, Stage 1): the page the desk keeps open on the computer next to a
 * browser printer. Its heartbeat keeps the printer online; it also lists the printer's recent jobs
 * and leads to the desk's badge search.
 */
export default async function PrintStationPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string; printerId: string }>;
}) {
  const { locale, org, event, printerId } = await params;
  setRequestLocale(locale);
  const { data, ev, printing, canPrint } = await loadPrintingPage(org, event);
  const printer = printing.printers.find((p) => p.id === printerId);
  if (!canPrint || !printer) notFound();
  const log = await executeQuery(printLogQuery, { eventId: ev.id, printerId, limit: 20 }, data.ctx, ports);
  const t = await getTranslations();
  const tp = await getTranslations('badgePrinting');
  const format = await getFormatter();
  const base = `/o/${org}/e/${event}/badges`;
  return (
    <>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: data.org.name, href: `/o/${org}` },
              { label: ev.name, href: `/o/${org}/e/${event}` },
              { label: t('nav.badges'), href: base },
              { label: tp('title'), href: `${base}/printing` },
              { label: printer.name },
            ]}
          />
        }
        title={tp('stationTitle', { name: printer.name })}
        description={tp('stationIntro', { name: printer.name })}
        actions={
          <Link href={`${base}#one-heading`} className={buttonClass('primary')}>
            {tp('findBadge')}
          </Link>
        }
      />
      {printer.adapter === 'browser' ? (
        <Card className="flex flex-col gap-2">
          <PrintStation beat={stationHeartbeatAction.bind(null, org, event, printer.id)} />
        </Card>
      ) : (
        <Alert tone="info" title={tp('stationNotBrowser')} />
      )}
      <section aria-labelledby="station-jobs-heading" className="flex flex-col gap-3">
        <h2 id="station-jobs-heading" className="text-section">
          {tp('recentJobs', { name: printer.name })}
        </h2>
        {log.entries.length === 0 ? (
          <p className="text-body text-ink-2">{tp('noJobsYet')}</p>
        ) : (
          <ol className="flex list-none flex-col gap-1.5 p-0 text-body">
            {log.entries.map((e) => (
              <li key={e.id}>
                {e.holderName || tp('voided')} · {tp(`kinds.${e.kind}`)}
                {e.kind === 'reprint' ? ` (${tp(`reasons.${e.reason}`)})` : ''} ·{' '}
                {format.dateTime(e.createdAt, { timeStyle: 'short', timeZone: ev.timezone })}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
