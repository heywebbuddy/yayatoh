import {
  connectionDetailQuery,
  connectorByKey,
  EVENTBRITE,
  eventbritePreview,
  type ImportPreviewDto,
  importResultQuery,
  isImporter,
  openErrorCountQuery,
} from '@yayatoh/integrations';
import { executeQuery, formatMoney, isDomainError, money } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import {
  Alert,
  Breadcrumb,
  Button,
  buttonClass,
  Card,
  PageHeader,
  SectionHeader,
  Stepper,
  Table,
} from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { integrationAuth } from '@/server/integrations.ts';
import { ports } from '@/server/ports.ts';
import { startImportAction } from '../../connector-actions.ts';
import { codeText, ERROR_CODES, IntegrationTabs, RunPill } from '../../parts.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('integrations.import');
  return { title: t('title') };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The Eventbrite import wizard (M6.4b): connect (done on the way here), preview (a dry run: what
 * the account holds and what is new; nothing is written), import (queued for the worker), result
 * (the run and what Yayatoh now holds from Eventbrite, revenue to the cent). Owners and admins run
 * it; managers see the result.
 */
export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; connection: string }>;
  searchParams: Promise<{ connected?: string; started?: string; error?: string }>;
}) {
  const { locale, org, connection: connectionId } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (
    !data.modules.has('integrations') ||
    !roleCan(data.role, 'integrations:read') ||
    !UUID.test(connectionId)
  )
    notFound();
  const detail = await executeQuery(connectionDetailQuery, { connectionId }, data.ctx, ports).catch((err) => {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  });
  const connector = connectorByKey(detail.connection.connector);
  if (!connector || !isImporter(connector) || connector.key !== EVENTBRITE) notFound();
  const sp = await searchParams;
  const t = await getTranslations('integrations.import');
  const tAll = await getTranslations('integrations');
  const tErr = await getTranslations('integrations.errorsFeedback');
  const canManage = roleCan(data.role, 'integrations:manage');
  const active = detail.connection.status === 'active';
  const [{ open }, result] = await Promise.all([
    executeQuery(openErrorCountQuery, {}, data.ctx, ports),
    executeQuery(importResultQuery, { connectionId }, data.ctx, ports),
  ]);
  // The dry run reads the account live through the port (owners and admins only).
  const auth = integrationAuth();
  let preview: ImportPreviewDto | null = null;
  let previewError: string | null = null;
  if (canManage && active && auth) {
    try {
      preview = await eventbritePreview(data.ctx, { auth }, ports, connectionId);
    } catch (err) {
      previewError = isDomainError(err) && ERROR_CODES.has(err.code) ? err.code : 'provider_unavailable';
    }
  }
  const running = detail.syncing;
  const finished = result.run && !running && result.run.finishedAt;
  const steps = [
    { label: t('steps.connect'), state: 'done' as const },
    { label: t('steps.preview'), state: result.run ? ('done' as const) : ('current' as const) },
    {
      label: t('steps.import'),
      state: running ? ('current' as const) : result.run ? ('done' as const) : ('todo' as const),
    },
    { label: t('steps.result'), state: finished ? ('current' as const) : ('todo' as const) },
  ];
  const fmt = (r: { currency: string; totalMinor: number }) =>
    formatMoney(money(r.totalMinor, r.currency), locale);
  const revenueText = (rows: readonly { currency: string; totalMinor: number }[]) =>
    rows.length ? rows.map(fmt).join(' · ') : t('noRevenue');
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: data.org.timezone,
  });
  const error = sp.error ? (ERROR_CODES.has(sp.error) ? sp.error : 'internal') : null;
  const newRecords = preview ? preview.events.new + preview.ticketTypes.new + preview.orders.new : 0;
  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb
            label={tAll('breadcrumb')}
            link={Link}
            items={[
              { label: tAll('title'), href: `/o/${org}/integrations` },
              { label: connector.name, href: `/o/${org}/integrations/${connectionId}` },
              { label: t('crumb') },
            ]}
          />
        }
        title={t('title')}
        description={t('description')}
      />
      <IntegrationTabs org={org} current="connections" openErrors={open} />
      <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
        {error ? <Alert tone="danger" title={tErr(error)} /> : null}
        {sp.connected ? <Alert tone="success" title={t('connected')} /> : null}
        {sp.started ? (
          <Alert tone="success" title={t(sp.started === 'already' ? 'alreadyRunning' : 'started')} />
        ) : null}
      </div>
      <Stepper label={t('stepsLabel')} steps={steps} />
      {!active ? (
        <Alert tone="warning" title={t('notActive')}>
          <Link href={`/o/${org}/integrations/${connectionId}`} className="underline underline-offset-2">
            {t('backToConnection')}
          </Link>
        </Alert>
      ) : null}

      <section aria-labelledby="preview-heading" className="flex flex-col gap-3">
        <SectionHeader id="preview-heading" title={t('preview.title')} description={t('preview.help')} />
        {!canManage ? (
          <p className="m-0 text-body text-ink-2">{t('preview.readOnly')}</p>
        ) : previewError ? (
          <Alert tone="danger" title={tErr(previewError)} />
        ) : preview ? (
          <Card className="flex flex-col gap-4">
            <Table
              caption={t('preview.caption')}
              rowKey={(r) => r.key}
              rows={[
                {
                  key: 'events',
                  label: t('what.events'),
                  total: preview.events.total,
                  fresh: preview.events.new,
                },
                {
                  key: 'ticketTypes',
                  label: t('what.ticketTypes'),
                  total: preview.ticketTypes.total,
                  fresh: preview.ticketTypes.new,
                },
                {
                  key: 'orders',
                  label: t('what.orders'),
                  total: preview.orders.total,
                  fresh: preview.orders.new,
                },
                { key: 'attendees', label: t('what.attendees'), total: preview.attendees, fresh: null },
              ]}
              columns={[
                { key: 'what', header: t('preview.what'), cell: (r) => r.label },
                { key: 'total', header: t('preview.inEventbrite'), align: 'end', cell: (r) => r.total },
                {
                  key: 'new',
                  header: t('preview.new'),
                  align: 'end',
                  cell: (r) => (r.fresh === null ? '—' : r.fresh),
                },
              ]}
            />
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body">
              <dt className="text-ink-2">{t('what.revenue')}</dt>
              <dd className="m-0 font-mono tabular-nums" data-testid="preview-revenue">
                {revenueText(preview.revenue)}
              </dd>
              <dt className="text-ink-2">{t('what.refunded')}</dt>
              <dd className="m-0">{t('refundedOrders', { count: preview.refundedOrders })}</dd>
            </dl>
            <p className="m-0 text-caption text-ink-2">{t('preview.noEmails')}</p>
            <form action={startImportAction.bind(null, org, connectionId)}>
              <Button type="submit" disabled={running}>
                {running
                  ? t('importing')
                  : newRecords > 0
                    ? t('importNew', { count: newRecords })
                    : t('importAgain')}
              </Button>
            </form>
          </Card>
        ) : null}
      </section>

      <section aria-labelledby="result-heading" className="flex flex-col gap-3">
        <SectionHeader id="result-heading" title={t('result.title')} />
        {!result.run ? (
          <p className="m-0 text-body text-ink-2">{t('result.none')}</p>
        ) : (
          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3" data-testid="import-run">
              <RunPill status={result.run.status} />
              <span className="text-body text-ink-2">
                {result.run.finishedAt
                  ? t('result.finished', { when: when.format(result.run.finishedAt) })
                  : t('result.inProgress')}
              </span>
              {running ? (
                <Link
                  href={`/o/${org}/integrations/${connectionId}/import`}
                  className={buttonClass('secondary', 'sm')}
                >
                  {t('result.refresh')}
                </Link>
              ) : null}
            </div>
            <p className="m-0 text-body">
              {t('result.counts', {
                pulled: result.run.pulled,
                skipped: result.run.skipped,
                failed: result.run.failed,
              })}
            </p>
            {result.run.errorCode ? (
              <Alert tone="danger" title={codeText(tAll, result.run.errorCode)} />
            ) : null}
            {result.run.failed > 0 || result.run.errorCode ? (
              <Link href={`/o/${org}/integrations/errors`} className="underline underline-offset-2">
                {t('result.seeErrors')}
              </Link>
            ) : null}
            <Table
              caption={t('result.caption')}
              rowKey={(r) => r.key}
              rows={[
                { key: 'events', label: t('what.events'), value: String(result.imported.events) },
                {
                  key: 'ticketTypes',
                  label: t('what.ticketTypes'),
                  value: String(result.imported.ticketTypes),
                },
                {
                  key: 'orders',
                  label: t('what.orders'),
                  value: t('result.ordersValue', {
                    count: result.imported.orders,
                    paid: result.imported.paidOrders,
                  }),
                },
                {
                  key: 'attendees',
                  label: t('what.attendees'),
                  value: t('result.attendeesValue', {
                    count: result.imported.attendees,
                    active: result.imported.activeAttendees,
                  }),
                },
                { key: 'revenue', label: t('what.revenue'), value: revenueText(result.imported.revenue) },
              ]}
              columns={[
                { key: 'what', header: t('preview.what'), cell: (r) => r.label },
                { key: 'value', header: t('result.inYayatoh'), align: 'end', cell: (r) => r.value },
              ]}
            />
            <Link href={`/o/${org}/events`} className="self-start underline underline-offset-2">
              {t('result.goToEvents')}
            </Link>
          </Card>
        )}
      </section>
    </>
  );
}
