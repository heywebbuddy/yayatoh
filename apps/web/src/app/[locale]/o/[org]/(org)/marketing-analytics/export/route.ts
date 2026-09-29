import { executeQuery, isDomainError } from '@yayatoh/kernel';
import {
  ANALYTICS_CSV_COLUMNS,
  type AnalyticsCsvColumn,
  analyticsCsv,
  analyticsReportQuery,
  DIMENSIONS,
  type Dimension,
} from '@yayatoh/marketing';
import { roleCan } from '@yayatoh/tenancy';
import { getTranslations } from 'next-intl/server';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

/**
 * CSV of the marketing analytics (M3.8b) for a view and range: the report's allowlisted rows
 * through the export serializer (`analyticsCsv`), headers in the reader's language. The org is
 * the route's and the session's; `marketing:read` like the page.
 */
export async function GET(req: Request, { params }: { params: Promise<{ locale: string; org: string }> }) {
  const { locale, org } = await params;
  const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const data = await loadConsole(org);
  if (!data.modules.has('marketing') || !roleCan(data.role, 'marketing:read')) return notFound();
  const url = new URL(req.url);
  const v = url.searchParams.get('view') ?? 'campaign';
  const view: Dimension = (DIMENSIONS as readonly string[]).includes(v) ? (v as Dimension) : 'campaign';
  const day = (k: string) => {
    const x = url.searchParams.get(k);
    return x && x.length <= 10 ? x : undefined;
  };
  try {
    const report = await executeQuery(
      analyticsReportQuery,
      { dimension: view, from: day('from'), to: day('to') },
      data.ctx,
      ports,
    );
    const t = await getTranslations({ locale, namespace: 'marketingAnalytics' });
    const headers = Object.fromEntries(ANALYTICS_CSV_COLUMNS.map((c) => [c, t(`csv.${c}`)])) as Record<
      AnalyticsCsvColumn,
      string
    >;
    const csv = analyticsCsv(report, headers, { unnamed: t('unnamed'), total: t('csv.total') });
    const name = `marketing-${view}-${report.fromDay}-${report.toDay}.csv`;
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${name}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (err) {
    if (isDomainError(err) && err.code === 'validation_failed')
      return new Response('Invalid date range', { status: 400, headers: { 'cache-control': 'no-store' } });
    if (isDomainError(err) && ['not_found', 'forbidden', 'module_not_enabled'].includes(err.code))
      return notFound();
    throw err;
  }
}
