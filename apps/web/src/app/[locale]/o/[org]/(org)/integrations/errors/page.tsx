import { connectorByKey, listErrorGroupsQuery, openErrorCountQuery } from '@yayatoh/integrations';
import { ERROR_STATUSES, type ErrorStatus } from '@yayatoh/integrations/client';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Button, Card, EmptyState, filterChipClass, PageHeader, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { dismissErrorsAction, retryErrorsAction } from '../actions.ts';
import { codeText, ERROR_CODES, IntegrationTabs } from '../parts.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('integrations');
  return { title: t('inbox.title') };
}

/**
 * The integration errors inbox (M6.4a): failed records grouped by connection, step and code, with
 * the record, attempts and the next automatic retry; Retry and Dismiss per record or per group.
 * Codes and field names only: no token and no record values ever reach it.
 */
export default async function IntegrationErrorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ status?: string; error?: string; retried?: string; dismissed?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('integrations') || !roleCan(data.role, 'integrations:read')) notFound();
  const sp = await searchParams;
  const status: ErrorStatus = (ERROR_STATUSES as readonly string[]).includes(sp.status ?? '')
    ? (sp.status as ErrorStatus)
    : 'open';
  const t = await getTranslations('integrations');
  const tErr = await getTranslations('integrations.errorsFeedback');
  const canManage = roleCan(data.role, 'integrations:manage') && status === 'open';
  const [groups, { open }] = await Promise.all([
    executeQuery(listErrorGroupsQuery, { status }, data.ctx, ports),
    executeQuery(openErrorCountQuery, {}, data.ctx, ports),
  ]);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: data.org.timezone,
  });
  const error = sp.error ? (ERROR_CODES.has(sp.error) ? sp.error : 'internal') : null;
  const count = (v: string | undefined) => (v && /^\d{1,4}$/.test(v) ? Number(v) : null);
  const retried = count(sp.retried);
  const dismissed = count(sp.dismissed);
  return (
    <>
      <PageHeader title={t('inbox.title')} description={t('inbox.description')} />
      <IntegrationTabs org={org} current="errors" openErrors={open} />
      <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
        {error ? <Alert tone="danger" title={tErr(error)} /> : null}
        {retried !== null ? <Alert tone="success" title={t('inbox.retried', { count: retried })} /> : null}
        {dismissed !== null ? (
          <Alert tone="success" title={t('inbox.dismissed', { count: dismissed })} />
        ) : null}
      </div>
      <nav aria-label={t('inbox.filterLabel')} className="flex flex-wrap gap-2">
        {ERROR_STATUSES.map((s) => (
          <Link
            key={s}
            href={
              s === 'open' ? `/o/${org}/integrations/errors` : `/o/${org}/integrations/errors?status=${s}`
            }
            aria-current={s === status ? 'page' : undefined}
            className={filterChipClass(s === status)}
          >
            {t(`inbox.status.${s}`)}
          </Link>
        ))}
      </nav>
      {groups.length === 0 ? (
        <EmptyState
          title={t(`inbox.empty.${status}`)}
          description={status === 'open' ? t('inbox.emptyOpenHelp') : undefined}
          action={
            status === 'open' ? (
              <Link href={`/o/${org}/integrations`} className="underline underline-offset-2">
                {t('inbox.backToConnections')}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {groups.map((g) => {
            const name = connectorByKey(g.connector)?.name ?? g.connector;
            const id = `group-${g.connectionId}-${g.step}-${g.code}-${g.field ?? 'none'}`;
            const ids = g.errors.map((e) => e.id);
            const title = t('inbox.groupTitle', {
              connector: name,
              step: t(`inbox.steps.${g.step}`),
              count: g.count,
            });
            return (
              <li key={id}>
                <Card className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-1">
                      <h2 id={id} className="m-0 text-section">
                        {title}
                      </h2>
                      <p className="m-0 text-body text-ink-2">
                        {codeText(t, g.code)}
                        {g.field ? ` · ${t('inbox.field', { field: g.field })}` : ''}
                      </p>
                      <p className="m-0 text-caption text-ink-2">
                        {t('inbox.lastSeen', { when: when.format(g.lastSeenAt) })}
                      </p>
                    </div>
                    {canManage ? (
                      <div className="flex flex-wrap gap-2">
                        <form action={retryErrorsAction.bind(null, org)}>
                          {ids.map((e) => (
                            <input key={e} type="hidden" name="error" value={e} />
                          ))}
                          <Button
                            type="submit"
                            variant="secondary"
                            size="sm"
                            aria-label={t('inbox.retryAllNamed', { group: title })}
                          >
                            {t('inbox.retryAll')}
                          </Button>
                        </form>
                        <form action={dismissErrorsAction.bind(null, org)}>
                          {ids.map((e) => (
                            <input key={e} type="hidden" name="error" value={e} />
                          ))}
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            aria-label={t('inbox.dismissAllNamed', { group: title })}
                          >
                            {t('inbox.dismissAll')}
                          </Button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                  <Table
                    caption={t('inbox.recordsCaption', { group: title })}
                    rowKey={(e) => e.id}
                    rows={g.errors}
                    stackOnPhone
                    density="compact"
                    columns={[
                      {
                        key: 'record',
                        header: t('inbox.record'),
                        mono: true,
                        cell: (e) => e.externalId ?? e.localId ?? t('inbox.wholeConnection'),
                      },
                      {
                        key: 'object',
                        header: t('inbox.object'),
                        cell: (e) =>
                          e.objectType
                            ? t('inbox.objectDirection', {
                                object: t.has(`objects.${e.objectType}`)
                                  ? t(`objects.${e.objectType}`)
                                  : e.objectType,
                                direction: t(`inbox.directions.${e.direction ?? 'pull'}`),
                              })
                            : '—',
                      },
                      { key: 'attempts', header: t('inbox.attempts'), align: 'end', cell: (e) => e.attempts },
                      {
                        key: 'next',
                        header: status === 'open' ? t('inbox.nextRetry') : t('inbox.closedAt'),
                        cell: (e) =>
                          status === 'open'
                            ? e.nextRetryAt
                              ? when.format(e.nextRetryAt)
                              : t('inbox.manualRetry')
                            : e.resolvedAt
                              ? when.format(e.resolvedAt)
                              : '—',
                      },
                      ...(canManage
                        ? [
                            {
                              key: 'actions',
                              header: t('inbox.actions'),
                              align: 'end' as const,
                              cell: (e: (typeof g.errors)[number]) => {
                                const record = e.externalId ?? e.localId ?? t('inbox.wholeConnection');
                                return (
                                  <div className="flex flex-wrap justify-end gap-2">
                                    <form action={retryErrorsAction.bind(null, org)}>
                                      <input type="hidden" name="error" value={e.id} />
                                      <Button
                                        type="submit"
                                        variant="secondary"
                                        size="sm"
                                        aria-label={t('inbox.retryNamed', { record })}
                                      >
                                        {t('inbox.retry')}
                                      </Button>
                                    </form>
                                    <form action={dismissErrorsAction.bind(null, org)}>
                                      <input type="hidden" name="error" value={e.id} />
                                      <Button
                                        type="submit"
                                        variant="ghost"
                                        size="sm"
                                        aria-label={t('inbox.dismissNamed', { record })}
                                      >
                                        {t('inbox.dismiss')}
                                      </Button>
                                    </form>
                                  </div>
                                );
                              },
                            },
                          ]
                        : []),
                    ]}
                  />
                  {g.count > g.errors.length ? (
                    <p className="m-0 text-caption text-ink-2">
                      {t('inbox.more', { count: g.count - g.errors.length })}
                    </p>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
