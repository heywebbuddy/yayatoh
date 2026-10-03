import {
  connectionDetailQuery,
  connectorByKey,
  mappingFields,
  openErrorCountQuery,
  SYNC_INTERVALS,
} from '@yayatoh/integrations';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Button, buttonClass, Card, PageHeader, SectionHeader, Select, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import {
  beginConnectAction,
  cancelConnectAction,
  checkConnectAction,
  disconnectAction,
  saveMappingAction,
  setIntervalAction,
  setPausedAction,
  syncNowAction,
} from '../actions.ts';
import { ConnectionPill, codeText, ERROR_CODES, IntegrationTabs, RunPill } from '../parts.tsx';
import { MappingForm } from './mapping-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('integrations');
  return { title: t('detail.title') };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * One connection (M6.4a): its status and schedule (Sync now, pause, interval, disconnect), the
 * field mappings for each object and direction, and its recent runs.
 */
export default async function ConnectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; connection: string }>;
  searchParams: Promise<{
    error?: string;
    done?: string;
    sync?: string;
    connected?: string;
    confirm?: string;
  }>;
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
  const { open } = await executeQuery(openErrorCountQuery, {}, data.ctx, ports);
  const sp = await searchParams;
  const t = await getTranslations('integrations');
  const tErr = await getTranslations('integrations.errorsFeedback');
  const c = detail.connection;
  const connector = connectorByKey(c.connector);
  if (!connector) notFound();
  const canManage = roleCan(data.role, 'integrations:manage');
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: data.org.timezone,
  });
  const fmt = (d: Date | null) => (d ? when.format(d) : t('never'));
  const error = sp.error ? (ERROR_CODES.has(sp.error) ? sp.error : 'internal') : null;
  const done =
    sp.done && ['paused', 'resumed', 'interval', 'disconnected'].includes(sp.done) ? sp.done : null;
  const live = c.status === 'active' || c.status === 'paused';
  const confirming = sp.confirm === 'disconnect' && live && canManage;
  const syncNow =
    canManage && c.status === 'active' ? (
      <form action={syncNowAction.bind(null, org, c.id)}>
        <Button type="submit" disabled={detail.syncing}>
          {detail.syncing ? t('detail.syncing') : t('detail.syncNow')}
        </Button>
      </form>
    ) : undefined;
  return (
    <>
      <PageHeader
        title={connector.name}
        tag={<ConnectionPill status={c.status} />}
        description={t(`connectors.${connector.key}.description`)}
        actions={syncNow}
      />
      <IntegrationTabs org={org} current="connections" openErrors={open} />
      <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
        {error ? <Alert tone="danger" title={tErr(error)} /> : null}
        {sp.connected ? (
          <Alert tone="success" title={t('detail.connected', { name: connector.name })} />
        ) : null}
        {sp.sync ? (
          <Alert tone="success" title={t(`detail.sync.${sp.sync === 'already' ? 'already' : 'queued'}`)} />
        ) : null}
        {done ? <Alert tone="success" title={t(`detail.done.${done}`)} /> : null}
      </div>
      {c.status === 'revoked' ? (
        <Alert
          tone="warning"
          title={t(`detail.revoked.${c.revokeReason ?? 'user'}`, { when: fmt(c.revokedAt) })}
        >
          {canManage ? (
            <form action={beginConnectAction.bind(null, org, connector.key)} className="mt-2">
              <Button type="submit" variant="secondary">
                {t('reconnect')}
              </Button>
            </form>
          ) : null}
        </Alert>
      ) : null}
      {c.status === 'pending' ? (
        <Alert tone="info" title={t('detail.pending')}>
          {canManage ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <form action={checkConnectAction.bind(null, org, c.id)}>
                <Button type="submit" variant="secondary">
                  {t('detail.checkConnection')}
                </Button>
              </form>
              <form action={cancelConnectAction.bind(null, org, c.id)}>
                <Button type="submit" variant="ghost">
                  {t('detail.cancelConnect')}
                </Button>
              </form>
            </div>
          ) : null}
        </Alert>
      ) : null}
      {confirming ? (
        <Alert tone="warning" title={t('detail.confirmDisconnect', { name: connector.name })}>
          <p className="m-0">{t('detail.confirmDisconnectBody')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <form action={disconnectAction.bind(null, org, c.id)}>
              <Button type="submit" variant="danger">
                {t('detail.disconnect')}
              </Button>
            </form>
            <Link href={`/o/${org}/integrations/${c.id}`} className={buttonClass('ghost')}>
              {t('detail.keep')}
            </Link>
          </div>
        </Alert>
      ) : null}
      <section aria-labelledby="status-heading" className="flex flex-col gap-3">
        <SectionHeader id="status-heading" title={t('detail.statusTitle')} />
        <Card className="flex flex-col gap-4">
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body">
            {c.accountLabel ? (
              <>
                <dt className="text-ink-2">{t('account')}</dt>
                <dd className="m-0">{c.accountLabel}</dd>
              </>
            ) : null}
            <dt className="text-ink-2">{t('detail.connectedAt')}</dt>
            <dd className="m-0">{fmt(c.connectedAt)}</dd>
            <dt className="text-ink-2">{t('lastSync')}</dt>
            <dd className="m-0 flex flex-wrap items-center gap-2" data-testid="last-sync">
              {fmt(c.lastSyncAt)}
              {c.lastSyncStatus ? <RunPill status={c.lastSyncStatus} /> : null}
            </dd>
            {c.status === 'active' ? (
              <>
                <dt className="text-ink-2">{t('detail.nextSync')}</dt>
                <dd className="m-0">{fmt(c.nextSyncAt)}</dd>
              </>
            ) : null}
            <dt className="text-ink-2">{t('openErrors')}</dt>
            <dd className="m-0">
              {c.openErrors > 0 ? (
                <Link href={`/o/${org}/integrations/errors`} className="underline underline-offset-2">
                  {t('openErrorCount', { count: c.openErrors })}
                </Link>
              ) : (
                t('noErrors')
              )}
            </dd>
          </dl>
          {canManage && live ? (
            <div className="flex flex-wrap items-end gap-3">
              <form
                action={setIntervalAction.bind(null, org, c.id)}
                className="flex flex-wrap items-end gap-2"
              >
                <Select
                  id="sync-interval"
                  name="minutes"
                  label={t('detail.interval')}
                  defaultValue={String(c.syncIntervalMinutes)}
                >
                  {SYNC_INTERVALS.map((m) => (
                    <option key={m} value={m}>
                      {t(`detail.intervals.${m}`)}
                    </option>
                  ))}
                </Select>
                <Button type="submit" variant="secondary">
                  {t('detail.saveInterval')}
                </Button>
              </form>
              <form action={setPausedAction.bind(null, org, c.id, c.status === 'active')}>
                <Button type="submit" variant="secondary">
                  {c.status === 'active' ? t('detail.pause') : t('detail.resume')}
                </Button>
              </form>
              {!confirming ? (
                <Link
                  href={`/o/${org}/integrations/${c.id}?confirm=disconnect`}
                  className={buttonClass('ghost')}
                >
                  {t('detail.disconnect')}
                </Link>
              ) : null}
            </div>
          ) : null}
        </Card>
      </section>
      {live || detail.mappings.length ? (
        <section aria-labelledby="mapping-heading" className="flex flex-col gap-3">
          <SectionHeader
            id="mapping-heading"
            title={t('mapping.sectionTitle')}
            description={t('mapping.sectionHelp')}
          />
          {connector.objects.flatMap((o) =>
            (['pull', 'push'] as const).flatMap((direction) => {
              if (!o[direction]) return [];
              const current = detail.mappings.find(
                (m) => m.objectType === o.key && m.direction === direction,
              );
              const { sources, targets } = mappingFields(o, direction);
              return [
                <MappingForm
                  key={`${o.key}-${direction}`}
                  direction={direction}
                  objectType={o.key}
                  version={current?.version ?? null}
                  rules={current?.rules ?? o[direction]?.defaultMapping ?? []}
                  sources={sources}
                  targets={targets}
                  canManage={canManage && live}
                  action={saveMappingAction.bind(null, org, c.id, o.key, direction)}
                />,
              ];
            }),
          )}
        </section>
      ) : null}
      <section aria-labelledby="runs-heading" className="flex flex-col gap-3">
        <SectionHeader id="runs-heading" title={t('runs.title')} count={detail.runs.length} />
        <Table
          caption={t('runs.caption')}
          rowKey={(r) => r.id}
          rows={detail.runs}
          stackOnPhone
          empty={t('runs.empty')}
          columns={[
            { key: 'when', header: t('runs.when'), cell: (r) => fmt(r.startedAt ?? r.createdAt) },
            { key: 'trigger', header: t('runs.trigger'), cell: (r) => t(`runs.triggers.${r.trigger}`) },
            { key: 'status', header: t('runs.status'), cell: (r) => <RunPill status={r.status} /> },
            { key: 'pulled', header: t('runs.pulled'), cell: (r) => r.pulled, align: 'end' },
            { key: 'pushed', header: t('runs.pushed'), cell: (r) => r.pushed, align: 'end' },
            { key: 'skipped', header: t('runs.skipped'), cell: (r) => r.skipped, align: 'end' },
            { key: 'failed', header: t('runs.failed'), cell: (r) => r.failed, align: 'end' },
            {
              key: 'error',
              header: t('runs.error'),
              cell: (r) => (r.errorCode ? codeText(t, r.errorCode) : '—'),
            },
          ]}
        />
      </section>
    </>
  );
}
