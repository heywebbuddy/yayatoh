import { listAlertsQuery } from '@yayatoh/alerts';
import { executeQuery } from '@yayatoh/kernel';
import { type DeliverabilityDto, deliverabilityReportQuery } from '@yayatoh/marketing';
import { roleCan } from '@yayatoh/tenancy';
import {
  Alert,
  buttonClass,
  Card,
  PageHeader,
  SectionHeader,
  StatusDot,
  StatusPill,
  Table,
} from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ratePct } from '@/components/marketing-analytics.tsx';
import { Link } from '@/i18n/navigation.ts';
import { campaignNames } from '@/server/campaign-names.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketingAnalytics.deliverability');
  return { title: t('title') };
}

type Rates = DeliverabilityDto['org'];

/**
 * Email deliverability (M3.8b): bounce and complaint rates over the alert window for the org, each
 * sending domain and each campaign, against the M3.2b deliverability alert's thresholds; the
 * complaint auto-pause (M3.5a) and the open alert, with the way to the suppression list.
 */
export default async function DeliverabilityPage({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('marketing') || !roleCan(data.role, 'messages:read')) notFound();
  const t = await getTranslations('marketingAnalytics.deliverability');
  const [d, alerts] = await Promise.all([
    executeQuery(deliverabilityReportQuery, {}, data.ctx, ports),
    roleCan(data.role, 'events:read')
      ? executeQuery(listAlertsQuery, { status: 'active' }, data.ctx, ports)
      : Promise.resolve([]),
  ]);
  // Batch 3g merge: campaigns by their M3.6b name (readers without `marketing:read` keep the label).
  const names = await campaignNames(
    data.ctx,
    d.campaigns.map((c) => c.campaignId),
  );
  const campaignRows = d.campaigns.map((c) => ({ ...c, name: names.get(c.campaignId) ?? c.name }));
  const alert = alerts.find((a) => a.rule === 'deliverability') ?? null;
  const suppressions = data.modules.has('messaging') ? `/o/${org}/messaging#suppressions` : null;
  const n = new Intl.NumberFormat(locale);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: data.org.timezone,
  });
  const status = (r: Rates) =>
    r.bounceOver || r.complaintOver ? (
      <StatusDot status="danger" label={t('statusOver')} />
    ) : r.enough ? (
      <StatusDot status="success" label={t('statusOk')} />
    ) : (
      <StatusDot status="neutral" label={t('statusFew', { min: d.thresholds.minSent })} />
    );
  const rateColumns = [
    {
      key: 'sent',
      header: t('sent'),
      cell: (r: Rates) => n.format(r.sent),
      align: 'end' as const,
    },
    {
      key: 'delivered',
      header: t('delivered'),
      cell: (r: Rates) => n.format(r.delivered),
      align: 'end' as const,
    },
    {
      key: 'bounce',
      header: t('bounceRate'),
      cell: (r: Rates) => `${ratePct(r.bounceBps, locale)} (${n.format(r.bounced)})`,
      align: 'end' as const,
    },
    {
      key: 'complaint',
      header: t('complaintRate'),
      cell: (r: Rates) => `${ratePct(r.complaintBps, locale)} (${n.format(r.complained)})`,
      align: 'end' as const,
    },
    { key: 'status', header: t('status'), cell: status },
  ];
  const suppressionLink = suppressions ? (
    <Link
      href={suppressions}
      className={buttonClass('secondary', 'sm', 'self-start')}
      data-testid="suppressions-link"
    >
      {t('openSuppressions')}
    </Link>
  ) : null;
  return (
    <>
      <PageHeader title={t('title')} description={t('description', { days: d.thresholds.windowDays })} />
      {d.autoPause?.active ? (
        <Alert
          title={t('paused', {
            rate: ratePct(d.autoPause.rateBps, locale),
            complaints: d.autoPause.complaints,
            sent: n.format(d.autoPause.sent),
            since: when.format(d.autoPause.since),
          })}
        >
          {t('pausedBody')}
        </Alert>
      ) : null}
      {alert ? (
        <Card className="flex flex-col gap-3 border-warning-dot" data-testid="deliverability-alert">
          <StatusPill
            tone={alert.severity === 'critical' ? 'danger' : 'waiting'}
            label={t('alertOpen', { state: alert.state })}
            className="self-start"
          />
          <p className="m-0 text-body text-ink">
            {t('alertBody', { domains: alert.params.domains ?? 0, campaigns: alert.params.campaigns ?? 0 })}
          </p>
          {suppressionLink}
          <Link href={`/o/${org}/alerts`} className={buttonClass('secondary', 'sm', 'self-start')}>
            {t('openAlerts')}
          </Link>
        </Card>
      ) : null}
      <p className="text-caption text-ink-2">
        {t('thresholds', {
          bounce: ratePct(d.thresholds.bounceBps, locale),
          complaint: ratePct(d.thresholds.complaintBps, locale),
          min: d.thresholds.minSent,
          days: d.thresholds.windowDays,
        })}
      </p>

      <section aria-labelledby="org-heading" className="flex flex-col gap-3">
        <SectionHeader id="org-heading" title={t('orgTitle')} />
        <Table
          caption={t('orgTitle')}
          rowKey={() => 'org'}
          rows={d.org.sent > 0 ? [d.org] : []}
          empty={t('noEmail', { days: d.thresholds.windowDays })}
          columns={[{ key: 'name', header: t('scope'), cell: () => data.org.name }, ...rateColumns]}
        />
        {!alert ? suppressionLink : null}
      </section>

      <section aria-labelledby="domains-heading" className="flex flex-col gap-3">
        <SectionHeader id="domains-heading" title={t('domainsTitle')} />
        <Table
          caption={t('domainsTitle')}
          rowKey={(r) => r.domain ?? '(none)'}
          rows={d.domains}
          empty={t('noEmail', { days: d.thresholds.windowDays })}
          columns={[
            {
              key: 'domain',
              header: t('domain'),
              cell: (r) =>
                r.domain === null ? (
                  t('unrecorded')
                ) : (
                  <span dir="ltr">{r.platform ? t('platformSender', { domain: r.domain }) : r.domain}</span>
                ),
            },
            ...rateColumns,
          ]}
        />
      </section>

      <section aria-labelledby="campaigns-heading" className="flex flex-col gap-3">
        <SectionHeader id="campaigns-heading" title={t('campaignsTitle')} />
        <Table
          caption={t('campaignsTitle')}
          rowKey={(r) => r.campaignId}
          rows={campaignRows}
          empty={t('noCampaigns', { days: d.thresholds.windowDays })}
          columns={[
            {
              key: 'campaign',
              header: t('campaign'),
              cell: (r) => (
                <Link
                  href={`/o/${org}/marketing-analytics/campaign?key=c.${r.campaignId}`}
                  className="inline-flex min-h-6 items-center font-bold text-primary-ink underline"
                >
                  {r.name ?? t('unnamedCampaign')}
                </Link>
              ),
            },
            ...rateColumns,
          ]}
        />
      </section>
    </>
  );
}
