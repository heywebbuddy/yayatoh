import { type ExploreCsvColumn, exploreCsv } from '@yayatoh/analytics';
import { isDomainError } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { getTranslations } from 'next-intl/server';
import { loadConsole } from '@/server/console.ts';
import { parseExplorer, rowLabels, runExplorer } from '@/server/explorer.ts';

/**
 * The explorer's CSV (M6.2b): the same allowlisted DTO as the page, through the export row
 * serializer (`exploreCsv`), headers and labels in the reader's language. The org is the route's
 * and the session's; money measures only for finance (like the page).
 */
export async function GET(req: Request, { params }: { params: Promise<{ locale: string; org: string }> }) {
  const { locale, org } = await params;
  const plain = (status: number, body: string) =>
    new Response(body, { status, headers: { 'cache-control': 'no-store' } });
  const data = await loadConsole(org);
  if (!data.modules.has('analytics_pro') || !roleCan(data.role, 'orders:read'))
    return plain(404, 'Not found');
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const { choice, badDate } = parseExplorer(sp, roleCan(data.role, 'finance:read'));
  if (badDate) return plain(400, 'Invalid date');
  try {
    const dto = await runExplorer(data, choice);
    const t = await getTranslations({ locale, namespace: 'analyticsPro.explore' });
    const labels = await rowLabels(data, dto, locale, {
      none: t('none'),
      unnamedCampaign: t('unnamedCampaign'),
      weekOf: (d) => t('weekOf', { day: d }),
    });
    const headers = {
      dimension: t(`dimensions.${dto.dimension}`),
      currency: t('currency'),
      value: t(`measures.${dto.measure}`),
    } satisfies Record<ExploreCsvColumn, string>;
    const csv = exploreCsv(dto, headers, (r) => labels.get(r.key) ?? r.key, t('total'));
    const name = `analytics-${dto.measure}-${dto.dimension}-${dto.from}-${dto.to}.csv`;
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${name}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (err) {
    if (isDomainError(err) && err.code === 'validation_failed') return plain(400, 'Invalid request');
    if (isDomainError(err) && ['not_found', 'forbidden', 'module_not_enabled'].includes(err.code))
      return plain(404, 'Not found');
    throw err;
  }
}
