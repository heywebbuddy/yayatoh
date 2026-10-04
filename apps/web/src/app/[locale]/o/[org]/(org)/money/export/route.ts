import { executeQuery, isDomainError } from '@yayatoh/kernel';
import {
  eventMoneyQuery,
  eventsCsv,
  feesCsv,
  feesReportQuery,
  MONEY_CSV_COLUMNS,
  type MoneyCsvHeaders,
  type MoneyCsvView,
  moneyOverviewQuery,
  orgReportQuery,
  overviewCsv,
  payoutCsv,
  payoutDetailQuery,
  payoutsCsv,
  payoutsDashboardQuery,
} from '@yayatoh/reports';
import { roleCan } from '@yayatoh/tenancy';
import { getTranslations } from 'next-intl/server';
import { isGrain } from '@/lib/money.ts';
import { resolvePeriod } from '@/lib/period.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIEWS = Object.keys(MONEY_CSV_COLUMNS) as MoneyCsvView[];

/**
 * CSV exports of the Money pages (U5): the same queries as the pages, through the allowlisted
 * serializers in `@yayatoh/reports`, with headers in the reader's language. The org comes from
 * the route and the session; the permission is the page's (sales by event needs `orders:read` and
 * leaves the money columns empty without `finance:read`; everything else needs `finance:read`).
 */
export async function GET(req: Request, { params }: { params: Promise<{ locale: string; org: string }> }) {
  const { locale, org } = await params;
  const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const data = await loadConsole(org);
  const url = new URL(req.url);
  const v = url.searchParams.get('view') ?? '';
  if (!(VIEWS as string[]).includes(v)) return notFound();
  const view = v as MoneyCsvView;
  const finance = roleCan(data.role, 'finance:read');
  if (view === 'events' ? !roleCan(data.role, 'orders:read') : !finance) return notFound();
  const sp = Object.fromEntries(
    ['period', 'from', 'to'].map((k) => [k, url.searchParams.get(k)?.slice(0, 10) || undefined]),
  );
  const period = resolvePeriod(sp, data.org.timezone, new Date());
  const input = { ...(period.from ? { from: period.from } : {}), ...(period.to ? { to: period.to } : {}) };
  const t = await getTranslations({ locale, namespace: 'money' });
  const headers = <V extends MoneyCsvView>(view: V) =>
    Object.fromEntries(MONEY_CSV_COLUMNS[view].map((c) => [c, t(`csv.${c}`)])) as MoneyCsvHeaders<V>;
  const span = period.from && period.to ? `${period.from}-${period.to}` : 'all';
  try {
    let csv: string;
    let name: string;
    if (view === 'overview') {
      const grain = url.searchParams.get('grain') ?? undefined;
      const o = await executeQuery(
        moneyOverviewQuery,
        { ...input, ...(isGrain(grain) ? { grain } : {}) },
        data.ctx,
        ports,
      );
      csv = overviewCsv(o, headers('overview'));
      name = `money-overview-${span}.csv`;
    } else if (view === 'events') {
      const report = await executeQuery(orgReportQuery, input, data.ctx, ports);
      const money = finance ? await executeQuery(eventMoneyQuery, input, data.ctx, ports) : null;
      const rows = [
        ...report.byEvent.map((r) => ({
          ...r,
          money: money?.events.find((m) => m.eventId === r.eventId && m.currency === r.currency) ?? null,
        })),
        ...(money?.events ?? [])
          .filter((m) => !report.byEvent.some((r) => r.eventId === m.eventId && r.currency === m.currency))
          .map((m) => ({
            name: m.name,
            currency: m.currency,
            orders: 0,
            tickets: 0,
            grossMinor: 0,
            money: m,
          })),
      ];
      csv = eventsCsv(rows, headers('events'));
      name = `sales-by-event-${span}.csv`;
    } else if (view === 'payouts') {
      const d = await executeQuery(payoutsDashboardQuery, {}, data.ctx, ports);
      csv = payoutsCsv(d, headers('payouts'), (s) => t(`payouts.status.${s}`));
      name = 'payouts.csv';
    } else if (view === 'payout') {
      const id = url.searchParams.get('id') ?? '';
      if (!UUID.test(id)) return notFound();
      const p = await executeQuery(payoutDetailQuery, { settlementId: id }, data.ctx, ports);
      csv = payoutCsv(p, data.org.timezone, headers('payout'), (k) => t(`payout.kind.${k}`));
      name = `payout-${p.releasedAt.toISOString().slice(0, 10)}-${id.slice(-8)}.csv`;
    } else {
      const f = await executeQuery(feesReportQuery, input, data.ctx, ports);
      csv = feesCsv(f, headers('fees'));
      name = `fees-${span}.csv`;
    }
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
      return new Response('Invalid period', { status: 400, headers: { 'cache-control': 'no-store' } });
    if (isDomainError(err) && ['not_found', 'forbidden', 'module_not_enabled'].includes(err.code))
      return notFound();
    throw err;
  }
}
