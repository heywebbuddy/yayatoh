import {
  addDays,
  dayIn,
  evaluateAlertRulesTx,
  listReportSchedulesQuery,
  periodContaining,
  type ReportFrequency,
  runReportPeriod,
  warehouseFromEnv,
} from '@yayatoh/analytics';
import { withTenant } from '@yayatoh/db';
import { createCtx, executeQuery } from '@yayatoh/kernel';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { notifier, userLocales } from '@/server/notifications.ts';
import { getPdfRenderer } from '@/server/pdf.ts';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/CI only (M6.2b): what the worker's `analytics.tick` does, on demand. `rules=1` evaluates the
 * org's alert rules now; `reports=1` sends, for every switched-on schedule, its last complete
 * period now (whatever the send hour; the run table still allows one send per period). Messages
 * then go out through `/api/dev/outbox/drain`. 404 unless dev auth is on; never in production.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  const ctx = createCtx({ orgId: org.orgId, actor: { type: 'system', name: 'dev.analytics' } });
  const warehouse = warehouseFromEnv();
  const out: { rules?: unknown; reports?: Record<string, string> } = {};
  if (form.get('rules') === '1')
    out.rules = await withTenant(ctx, (tx) => evaluateAlertRulesTx(ctx, tx, warehouse));
  if (form.get('reports') === '1') {
    const schedules = (await executeQuery(listReportSchedulesQuery, {}, ctx, ports)).filter((x) => x.enabled);
    // Dev and CI may have no Gotenberg: a stand-in PDF keeps the flow testable.
    const renderer = getPdfRenderer() ?? {
      render: async () => new TextEncoder().encode('%PDF-1.7\n% Yayatoh dev report (no renderer)\n'),
    };
    out.reports = {};
    for (const s of schedules) {
      const frequency: ReportFrequency = s.frequency;
      const today = dayIn(ctx.now, s.timeZone);
      const period = periodContaining(frequency, addDays(periodContaining(frequency, today).from, -1));
      out.reports[s.id] = await runReportPeriod(org.orgId, s.id, period, {
        notifier,
        renderer,
        userLocales,
        warehouse,
      });
    }
  }
  return NextResponse.json(out);
}
