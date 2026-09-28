import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BlogIndexView, blogMetadata } from '@/components/cms/public-views.tsx';
import { tenantContentSite } from '@/server/cms.ts';
import { pageLocale } from '@/server/locale.ts';
import { tenantOrgParam } from '@/server/tenant-site.ts';

type Props = { params: Promise<{ locale: string; org: string }>; searchParams: Promise<{ page?: string }> };
const pageOf = (raw?: string) => Math.min(500, Math.max(1, Number.parseInt(raw ?? '1', 10) || 1));

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale, org } = await params;
  return blogMetadata(
    await tenantContentSite(tenantOrgParam(org)),
    locale,
    pageOf((await searchParams).page),
  );
}

/** A tenant site's blog (`{org host}/blogs`, rewritten here by the proxy). */
export default async function TenantBlog({ params, searchParams }: Props) {
  const { locale, org } = await params;
  pageLocale(locale);
  const site = await tenantContentSite(tenantOrgParam(org));
  if (!site) notFound();
  return <BlogIndexView site={site} locale={locale} page={pageOf((await searchParams).page)} />;
}
