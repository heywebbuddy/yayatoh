import {
  type ConnectionDto,
  listConnectionsQuery,
  offeredConnectors,
  openErrorCountQuery,
} from '@yayatoh/integrations';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Button, buttonClass, Card, Chip, EmptyState, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { integrationAuth } from '@/server/integrations.ts';
import { ports } from '@/server/ports.ts';
import { beginConnectAction } from './actions.ts';
import { ConnectionPill, ERROR_CODES, IntegrationTabs } from './parts.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('integrations');
  return { title: t('title') };
}

/**
 * Settings → Integrations (M6.4a): every connector this deployment offers, with its connection's
 * state, last sync and open errors; Connect, or Manage an existing connection. Owners, admins and
 * managers (read); owners and admins connect.
 */
export default async function IntegrationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ error?: string; cancelled?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('integrations') || !roleCan(data.role, 'integrations:read')) notFound();
  const sp = await searchParams;
  const t = await getTranslations('integrations');
  const tErr = await getTranslations('integrations.errorsFeedback');
  const canManage = roleCan(data.role, 'integrations:manage');
  const auth = integrationAuth();
  const [connections, { open }] = await Promise.all([
    executeQuery(listConnectionsQuery, {}, data.ctx, ports),
    executeQuery(openErrorCountQuery, {}, data.ctx, ports),
  ]);
  const byConnector = new Map(connections.map((c) => [c.connector, c]));
  const connectors = offeredConnectors(auth?.provider ?? null);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: data.org.timezone,
  });
  const error = sp.error && ERROR_CODES.has(sp.error) ? sp.error : sp.error ? 'internal' : null;
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <IntegrationTabs org={org} current="connections" openErrors={open} />
      <div aria-live="polite" className="empty:hidden">
        {error ? <Alert tone="danger" title={tErr(error)} /> : null}
        {sp.cancelled ? <Alert tone="info" title={t('cancelled')} /> : null}
      </div>
      {!auth ? (
        <EmptyState title={t('offTitle')} description={t('offDescription')} />
      ) : connectors.length === 0 ? (
        <EmptyState title={t('noneTitle')} description={t('noneDescription')} />
      ) : (
        <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2">
          {connectors.map((c) => {
            const conn: ConnectionDto | undefined = byConnector.get(c.key);
            const live = conn && ['pending', 'active', 'paused'].includes(conn.status);
            const entitled = data.modules.has(c.entitlement);
            const headingId = `connector-${c.key}`;
            return (
              <li key={c.key}>
                <Card className="flex h-full flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 id={headingId} className="m-0 text-section">
                      {c.name}
                    </h2>
                    <ConnectionPill status={conn?.status ?? 'none'} />
                  </div>
                  <p className="m-0 text-body text-ink-2">{t(`connectors.${c.key}.description`)}</p>
                  {c.availability === 'fake_only' ? (
                    <span className="inline-flex">
                      <Chip tone="neutral">{t('sandboxBadge')}</Chip>
                    </span>
                  ) : null}
                  {conn ? (
                    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body">
                      {conn.accountLabel ? (
                        <>
                          <dt className="text-ink-2">{t('account')}</dt>
                          <dd className="m-0">{conn.accountLabel}</dd>
                        </>
                      ) : null}
                      <dt className="text-ink-2">{t('lastSync')}</dt>
                      <dd className="m-0" data-testid={`last-sync-${c.key}`}>
                        {conn.lastSyncAt ? when.format(conn.lastSyncAt) : t('never')}
                      </dd>
                      {conn.openErrors > 0 ? (
                        <>
                          <dt className="text-ink-2">{t('openErrors')}</dt>
                          <dd className="m-0">
                            <Link
                              href={`/o/${org}/integrations/errors`}
                              className="underline underline-offset-2"
                            >
                              {t('openErrorCount', { count: conn.openErrors })}
                            </Link>
                          </dd>
                        </>
                      ) : null}
                    </dl>
                  ) : null}
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                    {!entitled ? (
                      <span className="inline-flex">
                        <Chip tone="neutral">{t('notInPlan')}</Chip>
                      </span>
                    ) : null}
                    {conn ? (
                      <Link
                        href={`/o/${org}/integrations/${conn.id}`}
                        className={buttonClass(live ? 'primary' : 'secondary')}
                        aria-label={t('manageNamed', { name: c.name })}
                      >
                        {t('manage')}
                      </Link>
                    ) : null}
                    {canManage && entitled && !live ? (
                      <form action={beginConnectAction.bind(null, org, c.key)}>
                        <Button
                          type="submit"
                          variant={conn ? 'secondary' : 'primary'}
                          aria-label={t(conn ? 'reconnectNamed' : 'connectNamed', { name: c.name })}
                        >
                          {t(conn ? 'reconnect' : 'connect')}
                        </Button>
                      </form>
                    ) : null}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {!canManage ? <p className="text-caption text-ink-2">{t('readOnly')}</p> : null}
    </>
  );
}
