import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PublicEventView } from '@/components/public-event-view.tsx';
import { eventMetadata } from '@/server/event-metadata.ts';
import { pageLocale } from '@/server/locale.ts';
import { tenantOrgParam } from '@/server/tenant-site.ts';

type Params = {
  params: Promise<{ locale: string; org: string; slug: string }>;
  searchParams: Promise<{ date?: string; channel?: string }>;
};

export async function generateMetadata({ params }: Pick<Params, 'params'>): Promise<Metadata> {
  const { locale, slug } = await params;
  return eventMetadata(locale, slug);
}

/** An event on its org's tenant site (the proxy rewrites `{host}/events/{slug}` here). */
export default async function TenantEventPage({ params, searchParams }: Params) {
  const { locale, org, slug } = await params;
  const { date, channel } = await searchParams;
  pageLocale(locale);
  const orgId = tenantOrgParam(org);
  if (!orgId) notFound();
  return (
    <PublicEventView
      locale={locale}
      slug={slug}
      orgId={orgId}
      date={date ?? null}
      channelCode={channel?.slice(0, 40) ?? null}
    />
  );
}
