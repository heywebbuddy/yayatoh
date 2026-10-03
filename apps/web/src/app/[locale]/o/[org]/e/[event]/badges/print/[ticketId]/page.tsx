import { Card } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BadgePrintPanel } from '@/components/badge-print-panel.tsx';
import { Crumbs } from '@/components/crumbs.tsx';
import { loadPrintingPage } from '@/server/printing.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The desk's print page for one badge (M5.5b): print, or reprint with a reason. */
export default async function PrintBadgePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string; ticketId: string }>;
  searchParams: Promise<{ printed?: string }>;
}) {
  const { locale, org, event, ticketId } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  if (!UUID.test(ticketId)) notFound();
  const { data, ev, printing, canPrint } = await loadPrintingPage(org, event);
  if (!canPrint) notFound();
  const t = await getTranslations();
  return (
    <>
      <Crumbs
        items={[
          { label: data.org.name, href: `/o/${org}` },
          { label: ev.name, href: `/o/${org}/e/${event}` },
          { label: t('nav.badges'), href: `/o/${org}/e/${event}/badges` },
          { label: t('badgePrinting.badgeHeading') },
        ]}
      />
      <Card size="panel" className="flex max-w-2xl flex-col gap-4">
        <BadgePrintPanel
          org={org}
          event={event}
          eventId={ev.id}
          ticketId={ticketId}
          timeZone={ev.timezone}
          ctx={data.ctx}
          printing={printing}
          back={{ to: 'desk' }}
          printedJobId={sp.printed && UUID.test(sp.printed) ? sp.printed : undefined}
          headingId="print-heading"
          headingLevel={1}
        />
      </Card>
    </>
  );
}
