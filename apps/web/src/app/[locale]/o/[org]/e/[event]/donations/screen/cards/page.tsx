import { givingQrQuery, publicGiving, screenSettingsQuery } from '@yayatoh/donations';
import { checkoutTarget } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { qrPath } from '@yayatoh/pdf';
import { Alert, buttonClass, EmptyState, PageHeader } from '@yayatoh/ui';
import { QrCode } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Crumbs } from '@/components/crumbs.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { appOrigin } from '@/server/engagement.ts';
import { ports } from '@/server/ports.ts';
import { PrintButton } from './print-button.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('donations.screenCards');
  return { title: t('title') };
}

const CARDS = 4;

/**
 * Table cards for QR-to-give (M4.8d, P4-15): a printable sheet of cards whose QR code opens the
 * screen's campaign on the giving page (`via=table`, so the gift is recorded as a QR gift). Only
 * while the giving page takes gifts (P4-9). Black on white in every theme, for the printer.
 */
export default async function ScreenCardsPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'donations');
  if (!can('orders:read')) notFound();
  const view = await executeQuery(screenSettingsQuery, { eventId: ev.id }, data.ctx, ports);
  const t = await getTranslations('donations.screenCards');
  const tn = await getTranslations('nav');
  const ts = await getTranslations('donations.screenPage');
  const base = `/o/${org}/e/${event}/donations`;
  const screen = view.screen;
  const giving = screen ? await publicGiving(data.org.id, ev.id) : null;
  const campaign = screen ? giving?.campaigns.find((c) => c.id === screen.campaignId) : undefined;
  const checkout = campaign ? await checkoutTarget(view.eventSlug) : null;
  const open = !!campaign && checkout?.orgId === data.org.id && checkout.eventId === ev.id;
  const url = screen
    ? `${appOrigin()}/events/${view.eventSlug}/give${givingQrQuery(screen.campaignId, 'table')}`
    : '';
  const qr = open ? qrPath(url) : null;
  return (
    <>
      <div className="print:hidden">
        <PageHeader
          breadcrumb={
            <Crumbs
              items={[
                { label: data.org.name, href: `/o/${org}` },
                { label: ev.name, href: `/o/${org}/e/${event}` },
                { label: tn('donations'), href: base },
                { label: ts('title'), href: `${base}/screen` },
                { label: t('title') },
              ]}
            />
          }
          title={t('title')}
          description={t('subtitle')}
          actions={qr ? <PrintButton label={t('print')} /> : null}
        />
      </div>
      {!screen ? (
        <EmptyState
          icon={<QrCode strokeWidth={2} />}
          title={t('noScreenTitle')}
          description={t('noScreenBody')}
          action={
            <Link href={`${base}/screen`} className={buttonClass('primary', 'md')}>
              {ts('title')}
            </Link>
          }
        />
      ) : !qr || !campaign ? (
        <Alert tone="warning" title={ts('givingClosed')} />
      ) : (
        <ul
          aria-label={t('sheetLabel')}
          className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2 print:grid-cols-2 print:gap-0"
        >
          {Array.from({ length: CARDS }, (_, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: identical printed copies
              key={i}
              data-testid="table-card"
              className="flex break-inside-avoid flex-col items-center gap-3 rounded-panel border border-dashed border-line-strong bg-white p-6 text-center text-black print:rounded-none"
            >
              <p className="m-0 text-[13px] font-extrabold tracking-[0.08em] uppercase">{ev.name}</p>
              <h2 className="m-0 text-[28px] leading-tight font-extrabold tracking-[-0.03em]">
                {t('cardTitle')}
              </h2>
              <svg
                role="img"
                aria-label={t('qrLabel', { url })}
                viewBox={`0 0 ${qr.size} ${qr.size}`}
                shapeRendering="crispEdges"
                className="size-44 bg-white text-black"
              >
                <rect width={qr.size} height={qr.size} className="fill-white" />
                <path d={qr.d} fill="currentColor" />
              </svg>
              <p className="m-0 text-body font-semibold">{t('cardBody', { campaign: campaign.name })}</p>
              <p className="m-0 break-all text-caption" dir="ltr">
                {url}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
