import { SPOTTER_CHANNEL, spotterStateQuery } from '@yayatoh/donations';
import { executeQuery } from '@yayatoh/kernel';
import { realtimeChannelName } from '@yayatoh/platform';
import { PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Crumbs } from '@/components/crumbs.tsx';
import { realtimeUrl } from '@/lib/realtime-url.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { Spotter } from './spotter.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('donations.spot');
  return { title: t('title') };
}

/**
 * The spotter's view (M4.8c), on a phone: anyone who may scan at the event (`checkin:scan`:
 * door staff, box office, managers, co-hosts) records the paddles they see raised. Only the level
 * being called and paddle numbers reach this page (P4-13).
 */
export default async function SpotterPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'donations');
  if (!can('checkin:scan')) notFound();
  const initial = await executeQuery(spotterStateQuery, { eventId: ev.id }, data.ctx, ports);
  const t = await getTranslations('donations.spot');
  const tn = await getTranslations('nav');
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const base = `/o/${org}/e/${event}/donations`;
  const crumbs = (
    <Crumbs
      items={[
        { label: ev.name, href: `/o/${org}/e/${event}` },
        { label: tn('donations'), href: base },
        { label: t('title') },
      ]}
    />
  );
  return (
    <>
      <PageHeader breadcrumb={crumbs} title={t('title')} description={t('subtitle')} />
      <Spotter
        initial={initial}
        streamUrl={realtimeUrl(realtimeChannelName(SPOTTER_CHANNEL, data.org.id, ev.id))}
        syncUrl={`${prefix}${base}/paddle-raise/sync`}
        storageKey={`yy-paddles:${ev.id}:${data.session.userId}`}
      />
    </>
  );
}
