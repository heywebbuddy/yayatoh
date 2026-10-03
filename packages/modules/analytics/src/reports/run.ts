import { type TenantTx, withTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, createCtx, requireOrg } from '@yayatoh/kernel';
import { analyticsReportHtml, type PdfRenderer, type ReportTable } from '@yayatoh/pdf';
import type { Notifier } from '@yayatoh/platform';
import { memberUserIdsTx, ORG_ROLES, type OrgRole, organizationNameTx, roleCan } from '@yayatoh/tenancy';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { buildCounts, buildRevenue, type CountFigures, TOP_EVENTS, topEventCounts } from '../dashboard.ts';
import { reportFiles, reportRuns, reportSchedules } from '../schema.ts';
import { orgTimeZoneTx } from '../sync.ts';
import type { AnalyticsWarehouse, DailyTotal } from '../warehouse/port.ts';
import { lazyWarehouse } from '../warehouse/select.ts';
import { MAX_RUN_ATTEMPTS, type ReportFrequency } from './catalog.ts';
import { fill, REPORT_LABELS, type ReportLocale, RTL_REPORT_LOCALES, reportLocale } from './labels.ts';
import { duePeriods, type ReportPeriod } from './period.ts';

/**
 * Sending scheduled reports (M6.2b). For each due (schedule, period):
 * 1. **Claim** (tenant transaction, under the pair's advisory lock): the run row is created once —
 *    `(org, schedule, period key)` is unique — and a sent run is never sent again.
 * 2. **Render** outside any transaction: one PDF per recipient language and revenue visibility,
 *    from the warehouse, in the org's time zone.
 * 3. **Deliver** (tenant transaction, same lock): store the PDFs, queue one message per recipient
 *    under the key `report:{schedule}:{period}:{member}` (the notifications module never queues a
 *    key twice), mark the run sent. A retried job, a restarted worker or two ticks at once find
 *    the run sent, or queue nothing new: each recipient gets each period once.
 * A failure leaves the run pending with its error; the next tick retries it, up to
 * `MAX_RUN_ATTEMPTS`, then it is marked failed.
 */
export const REPORT_KIND = 'analytics.report';
export const REPORT_ACTOR = 'analytics.reports';

export interface ReportDeps {
  readonly notifier: Notifier;
  /** Gotenberg in the worker; a fake in tests. Null: nothing is rendered or sent (the run waits). */
  readonly renderer: PdfRenderer | null;
  /** Members' languages (the identity database); missing → English. */
  readonly userLocales: (userIds: readonly string[]) => Promise<ReadonlyMap<string, string | null>>;
  readonly warehouse?: AnalyticsWarehouse;
}

interface Recipient {
  readonly userId: string;
  readonly finance: boolean;
}

interface Gathered {
  readonly runId: string;
  readonly scheduleName: string;
  readonly orgName: string;
  readonly timeZone: string;
  readonly frequency: ReportFrequency;
  readonly period: ReportPeriod;
  readonly recipients: readonly Recipient[];
  readonly daily: readonly DailyTotal[];
  readonly totals: CountFigures;
  readonly series: readonly (CountFigures & { bucket: string })[];
  readonly top: readonly { name: string; registrations: number; tickets: number; checkins: number }[];
  readonly revenue: ReturnType<typeof buildRevenue>;
}

const lockPair = (tx: TenantTx, orgId: string, scheduleId: string, key: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`an:report:${orgId}:${scheduleId}:${key}`}, 0))`);

const sysCtx = (orgId: string, now: Date) =>
  ({ ...createCtx({ orgId, actor: { type: 'system', name: REPORT_ACTOR } }), now }) as Ctx;

/** Phase 1: create or find the run; gather the figures and the recipients. Null: nothing to do. */
async function claimTx(
  tx: TenantTx,
  ctx: Ctx,
  warehouse: AnalyticsWarehouse,
  scheduleId: string,
  period: ReportPeriod,
): Promise<Gathered | null> {
  const orgId = requireOrg(ctx);
  await lockPair(tx, orgId, scheduleId, period.key);
  const [schedule] = await tx.select().from(reportSchedules).where(eq(reportSchedules.id, scheduleId));
  if (!schedule?.enabled) return null;
  await tx
    .insert(reportRuns)
    .values({ orgId, scheduleId, periodKey: period.key, periodFrom: period.from, periodTo: period.to })
    .onConflictDoNothing();
  const [run] = await tx
    .select()
    .from(reportRuns)
    .where(and(eq(reportRuns.scheduleId, scheduleId), eq(reportRuns.periodKey, period.key)));
  if (!run || run.status !== 'pending' || run.attempts >= MAX_RUN_ATTEMPTS) return null;
  await tx
    .update(reportRuns)
    .set({ attempts: run.attempts + 1, updatedAt: ctx.now })
    .where(eq(reportRuns.id, run.id));
  const wanted = new Set(schedule.recipients);
  const recipients = (await memberUserIdsTx(tx, ORG_ROLES))
    .filter((m) => wanted.has(m.userId) && roleCan(m.role as OrgRole, 'orders:read'))
    .map((m) => ({ userId: m.userId, finance: roleCan(m.role as OrgRole, 'finance:read') }));
  const timeZone = await orgTimeZoneTx(tx, orgId);
  const scope = { ctx, tx };
  const q = { from: period.from, to: period.to, ...(schedule.eventId ? { eventId: schedule.eventId } : {}) };
  const daily = await warehouse.dailyTotals(scope, q);
  const states = await warehouse.eventStates(scope, q);
  const { totals, series } = buildCounts(daily, states, q, 'day', ctx.now);
  const top = [];
  for (const t of topEventCounts(await warehouse.eventTotals(scope, q), TOP_EVENTS)) {
    const e = await findEventTx(tx, t.eventId);
    top.push({ name: e?.name ?? '', registrations: t.registrations, tickets: t.tickets, checkins: t.checkins });
  }
  return {
    runId: run.id,
    scheduleName: schedule.name,
    orgName: (await organizationNameTx(tx, orgId)) ?? '',
    timeZone,
    frequency: schedule.frequency as ReportFrequency,
    period,
    recipients,
    daily,
    totals,
    series,
    top,
    revenue: buildRevenue(daily, q, 'day', null),
  };
}

/** The period in words, in a locale (a day, a week's range, a month). */
export function periodLabel(period: ReportPeriod, frequency: ReportFrequency, locale: string): string {
  const d = (day: string) => new Date(`${day}T12:00:00Z`);
  if (frequency === 'monthly')
    return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(d(period.from));
  const f = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', dateStyle: 'medium' });
  return frequency === 'daily' ? f.format(d(period.from)) : f.formatRange(d(period.from), d(period.to));
}

const money = (minor: number, currency: string, locale: string) => {
  const f = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const digits = f.resolvedOptions().maximumFractionDigits ?? 2;
  return f.format(minor / 10 ** digits);
};

/** The report's HTML for one language and revenue visibility (pure). */
export function reportHtml(g: Omit<Gathered, 'runId' | 'recipients'>, locale: ReportLocale, finance: boolean, now: Date) {
  const L = REPORT_LABELS[locale];
  const n = new Intl.NumberFormat(locale);
  const dayFmt = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
  const madeFmt = new Intl.DateTimeFormat(locale, { timeZone: g.timeZone, dateStyle: 'medium', timeStyle: 'short' });
  const figures: [string, string][] = [
    [L.registrations, n.format(g.totals.registrations)],
    [L.tickets, n.format(g.totals.tickets)],
    [L.compTickets, n.format(g.totals.compTickets)],
    [L.refundedTickets, n.format(g.totals.refundedTickets)],
    [L.checkins, n.format(g.totals.checkins)],
    [L.noShows, n.format(g.totals.noShows)],
  ];
  const tables: ReportTable[] = [];
  if (finance)
    tables.push({
      title: L.revenue,
      headers: [L.currency, L.gross, L.refunds, L.net],
      rows: g.revenue.totals.map((m) => [
        m.currency,
        money(m.grossMinor, m.currency, locale),
        money(m.refundsMinor, m.currency, locale),
        money(m.netMinor, m.currency, locale),
      ]),
      empty: L.empty,
    });
  if (g.series.length > 1)
    tables.push({
      title: L.byDay,
      headers: [L.day, L.registrations, L.tickets, L.checkins],
      rows: g.series.map((s) => [
        dayFmt.format(new Date(`${s.bucket}T12:00:00Z`)),
        n.format(s.registrations),
        n.format(s.tickets),
        n.format(s.checkins),
      ]),
      empty: L.empty,
    });
  tables.push({
    title: L.topEvents,
    headers: [L.event, L.registrations, L.tickets, L.checkins],
    rows: g.top.map((t) => [t.name, n.format(t.registrations), n.format(t.tickets), n.format(t.checkins)]),
    empty: L.empty,
  });
  const period = periodLabel(g.period, g.frequency, locale);
  return analyticsReportHtml({
    lang: locale,
    dir: RTL_REPORT_LOCALES.has(locale) ? 'rtl' : 'ltr',
    title: g.scheduleName,
    subtitle: fill(L.subtitle, { org: g.orgName, period }),
    meta: fill(L.meta, { date: madeFmt.format(now), timeZone: g.timeZone }),
    figures,
    tables,
    footer: fill(finance ? L.footerFinance : L.footer, { org: g.orgName }),
  });
}

export type RunOutcome = 'sent' | 'skipped' | 'failed';

/** Send one period of one schedule (idempotent; see the module comment). */
export async function runReportPeriod(
  orgId: string,
  scheduleId: string,
  period: ReportPeriod,
  deps: ReportDeps,
  now: Date = new Date(),
): Promise<RunOutcome> {
  const ctx = sysCtx(orgId, now);
  const warehouse = deps.warehouse ?? lazyWarehouse();
  if (!deps.renderer) return 'skipped';
  let gathered: Gathered | null = null;
  try {
    gathered = await withTenant(ctx, (tx) => claimTx(tx, ctx, warehouse, scheduleId, period));
    if (!gathered) return 'skipped';
    const g = gathered;
    const locales = await deps.userLocales(g.recipients.map((r) => r.userId));
    const variantOf = (r: Recipient): string => `${reportLocale(locales.get(r.userId))}|${r.finance ? 1 : 0}`;
    const variants = [...new Set(g.recipients.map(variantOf))];
    const have = await withTenant(ctx, async (tx) =>
      (await tx
        .select({ locale: reportFiles.locale, finance: reportFiles.finance })
        .from(reportFiles)
        .where(eq(reportFiles.runId, g.runId))).map((f) => `${f.locale}|${f.finance ? 1 : 0}`),
    );
    const rendered: { locale: string; finance: boolean; pdf: Uint8Array }[] = [];
    for (const v of variants.filter((x) => !have.includes(x))) {
      const [locale, fin] = v.split('|') as [ReportLocale, string];
      const pdf = await deps.renderer.render({ html: reportHtml(g, locale, fin === '1', now), filename: `report-${period.key}.pdf` });
      rendered.push({ locale, finance: fin === '1', pdf });
    }
    return await withTenant(ctx, async (tx) => {
      await lockPair(tx, orgId, scheduleId, period.key);
      const [run] = await tx.select().from(reportRuns).where(eq(reportRuns.id, g.runId));
      if (!run || run.status === 'sent') return 'skipped' as const;
      for (const r of rendered)
        await tx
          .insert(reportFiles)
          .values({ orgId, runId: g.runId, locale: r.locale, finance: r.finance, pdf: r.pdf, bytes: r.pdf.byteLength })
          .onConflictDoNothing();
      const files = await tx
        .select({ id: reportFiles.id, locale: reportFiles.locale, finance: reportFiles.finance })
        .from(reportFiles)
        .where(eq(reportFiles.runId, g.runId));
      const fileOf = new Map<string, string>(files.map((f) => [`${f.locale}|${f.finance ? 1 : 0}`, f.id]));
      for (const r of g.recipients) {
        const fileId = fileOf.get(variantOf(r));
        if (!fileId) continue;
        const locale = reportLocale(locales.get(r.userId));
        const href = `/analytics/reports/files/${fileId}`;
        await deps.notifier.enqueue(tx, {
            kind: REPORT_KIND,
            to: { userId: r.userId, locale },
            params: { name: g.scheduleName, period: periodLabel(period, g.frequency, locale), _href: href },
            dedupeKey: `report:${scheduleId}:${period.key}:${r.userId}`,
            href,
          });
      }
      await tx
        .update(reportRuns)
        .set({
          status: 'sent',
          sentAt: now,
          recipientsSent: g.recipients.length,
          error: null,
          updatedAt: now,
        })
        .where(eq(reportRuns.id, g.runId));
      return 'sent' as const;
    });
  } catch (err) {
    const runId = gathered?.runId;
    if (runId)
      await withTenant(ctx, async (tx) => {
        const [run] = await tx.select().from(reportRuns).where(eq(reportRuns.id, runId));
        if (!run || run.status === 'sent') return;
        await tx
          .update(reportRuns)
          .set({
            status: run.attempts >= MAX_RUN_ATTEMPTS ? 'failed' : 'pending',
            error: String(err instanceof Error ? err.message : err).slice(0, 500),
            updatedAt: now,
          })
          .where(eq(reportRuns.id, runId));
      });
    return 'failed';
  }
}

/** Every due period of the org's switched-on schedules, not yet sent (oldest first). */
export async function dueReportsTx(
  tx: TenantTx,
  ctx: Ctx,
): Promise<{ scheduleId: string; period: ReportPeriod }[]> {
  const tz = await orgTimeZoneTx(tx, requireOrg(ctx));
  const schedules = await tx.select().from(reportSchedules).where(eq(reportSchedules.enabled, true));
  const out: { scheduleId: string; period: ReportPeriod }[] = [];
  for (const s of schedules) {
    const periods = duePeriods(s.frequency as ReportFrequency, s.sendHour, tz, ctx.now, s.activeSince);
    if (!periods.length) continue;
    const runs = await tx
      .select({ key: reportRuns.periodKey, status: reportRuns.status, attempts: reportRuns.attempts })
      .from(reportRuns)
      .where(and(eq(reportRuns.scheduleId, s.id), inArray(reportRuns.periodKey, periods.map((p) => p.key))));
    const done = new Set(
      runs.filter((r) => r.status !== 'pending' || r.attempts >= MAX_RUN_ATTEMPTS).map((r) => r.key),
    );
    for (const p of periods) if (!done.has(p.key)) out.push({ scheduleId: s.id, period: p });
  }
  return out;
}

/** Send the org's due reports now (the worker job; the dev route). */
export async function runDueReports(
  orgId: string,
  deps: ReportDeps,
  now: Date = new Date(),
): Promise<Record<RunOutcome, number>> {
  const ctx = sysCtx(orgId, now);
  const due = await withTenant(ctx, (tx) => dueReportsTx(tx, ctx));
  const out: Record<RunOutcome, number> = { sent: 0, skipped: 0, failed: 0 };
  for (const d of due) out[await runReportPeriod(orgId, d.scheduleId, d.period, deps, now)] += 1;
  return out;
}
