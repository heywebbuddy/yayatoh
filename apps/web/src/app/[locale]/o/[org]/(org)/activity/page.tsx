import { getUsersByIds } from '@yayatoh/auth';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { type AuditEntryDto, auditExportBulk, auditLogQuery, type BulkOperationDto } from '@yayatoh/platform';
import { roleCan } from '@yayatoh/tenancy';
import { Button, buttonClass, EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AutoRefresh } from '@/components/auto-refresh.tsx';
import { StepUpForm } from '@/components/step-up.tsx';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { formatNumber } from '@/lib/format.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { exportActivityAction } from './actions.ts';
import { resolveActivityFilter } from './filters.ts';

const PAGE = 25;
const field = 'min-h-10 w-full rounded-pill border border-zinc-200 bg-white px-4 text-body';

/**
 * Settings → Activity (M1.14b): the org's audit log for owners and admins. Who did what, when
 * (in the org's timezone), to what; filters by person, action and dates; keyset paging; a CSV
 * export through the bulk framework; and the hash-chain check ("Verified").
 */
export default async function ActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{
    actor?: string;
    action?: string;
    from?: string;
    to?: string;
    before?: string;
    op?: string;
    exportError?: string;
  }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const data = await loadConsole(org);
  const t = await getTranslations();
  if (!roleCan(data.role, 'audit:read')) {
    return (
      <>
        <PageHeader title={t('activity.title')} />
        <EmptyState title={t('activity.noAccessTitle')} description={t('activity.noAccessDescription')} />
      </>
    );
  }
  const tz = data.org.timezone;
  const { filter, values, error } = resolveActivityFilter(sp, tz);
  const before = /^\d{1,15}$/.test(sp.before ?? '') ? Number(sp.before) : undefined;
  const log = await executeQuery(
    auditLogQuery,
    { filter, limit: PAGE, ...(before ? { before } : {}) },
    data.ctx,
    ports,
  );
  const userIds = log.actors.filter((a) => a.startsWith('user:')).map((a) => a.slice(5));
  const people = await getUsersByIds(userIds);
  const who = (actor: string) => {
    if (actor.startsWith('user:')) return people.get(actor.slice(5))?.name ?? t('activity.formerMember');
    if (actor.startsWith('system:')) return t('activity.system', { name: actor.slice(7) });
    if (actor.startsWith('api_key:')) return t('activity.apiKey');
    return t('activity.anonymous');
  };
  const when = new Intl.DateTimeFormat(locale, { timeZone: tz, dateStyle: 'medium', timeStyle: 'medium' });
  const n = (v: number) => formatNumber(v, locale);
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams(
      Object.entries({ ...values, ...extra }).filter(([, v]) => v !== '') as [string, string][],
    );
    return p.size ? `?${p}` : '';
  };
  const base = `/o/${org}/activity`;

  let op: BulkOperationDto | null = null;
  if (sp.op && /^[0-9a-f-]{36}$/.test(sp.op)) {
    op = await executeQuery(auditExportBulk.status, { operationId: sp.op }, data.ctx, ports).catch((err) => {
      if (isDomainError(err) && (err.code === 'not_found' || err.code === 'forbidden')) return null;
      throw err;
    });
  }
  const opActive = op ? ['queued', 'running'].includes(op.status) : false;
  const filtered = Object.values(values).some((v) => v !== '');

  return (
    <>
      <PageHeader
        title={t('activity.title')}
        description={t('activity.description', { timeZone: tz })}
        actions={
          <Link href={`/o/${org}/settings`} className={buttonClass('ghost', 'sm')}>
            {t('activity.backToSettings')}
          </Link>
        }
      />
      <section aria-labelledby="integrity-heading" className="flex flex-col gap-1">
        <h2 id="integrity-heading" className="sr-only">
          {t('activity.integrityTitle')}
        </h2>
        {log.chain.verified ? (
          <p className="flex flex-wrap items-center gap-2" data-testid="audit-integrity">
            <StatusDot status="success" label={t('activity.verified')} />
            <span className="text-caption text-zinc-600">
              {t('activity.verifiedDetail', { count: log.chain.entries })}
            </span>
          </p>
        ) : (
          <p
            role="alert"
            data-testid="audit-integrity"
            className="rounded-card border border-pink-700 bg-pink-50 px-4 py-3 text-body text-pink-700"
          >
            {t('activity.broken', { seq: log.chain.brokenAt ?? 0 })}
          </p>
        )}
      </section>

      <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="activity-actor" className="text-caption text-zinc-600">
            {t('activity.filters.actor')}
          </label>
          <select id="activity-actor" name="actor" defaultValue={values.actor} className={field}>
            <option value="">{t('activity.filters.anyone')}</option>
            {log.actors.map((a) => (
              <option key={a} value={a}>
                {who(a)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="activity-action" className="text-caption text-zinc-600">
            {t('activity.filters.action')}
          </label>
          <select id="activity-action" name="action" defaultValue={values.action} className={field}>
            <option value="">{t('activity.filters.anyAction')}</option>
            {log.actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="activity-from" className="text-caption text-zinc-600">
            {t('activity.filters.from')}
          </label>
          <input id="activity-from" name="from" type="date" defaultValue={values.from} className={field} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="activity-to" className="text-caption text-zinc-600">
            {t('activity.filters.to')}
          </label>
          <input id="activity-to" name="to" type="date" defaultValue={values.to} className={field} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">{t('activity.filters.apply')}</Button>
          {filtered ? (
            <Link href={base} className={buttonClass('ghost', 'md')}>
              {t('activity.filters.clear')}
            </Link>
          ) : null}
        </div>
      </form>
      {error ? (
        <p
          role="alert"
          className="rounded-card border border-pink-700 bg-pink-50 px-4 py-3 text-body text-pink-700"
        >
          {t(`activity.errors.${error}`)}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-body text-zinc-600">
          {t('activity.showing', { count: log.entries.length })}
        </p>
        {log.entries.length > 0 ? (
          <StepUpForm action={exportActivityAction.bind(null, org)}>
            {Object.entries(values).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <Button type="submit" variant="secondary" size="sm">
              {t('activity.export')}
            </Button>
          </StepUpForm>
        ) : null}
      </div>
      {sp.exportError ? (
        <p
          role="alert"
          className="rounded-card border border-pink-700 bg-pink-50 px-4 py-3 text-body text-pink-700"
        >
          {t('activity.exportError', { reason: t(errorMessageKey(sp.exportError)) })}
        </p>
      ) : null}
      {op ? (
        <section
          aria-labelledby="export-heading"
          className="flex flex-col gap-2 rounded-panel border border-zinc-200 bg-white px-5 py-4"
        >
          {opActive ? <AutoRefresh seconds={2} /> : null}
          <h2 id="export-heading" className="text-section">
            {t('activity.exportTitle')}
          </h2>
          <p className="text-body" role="status">
            {op.status === 'done'
              ? t('bulk.exportDone', { succeeded: n(op.succeeded) })
              : t(`bulk.status.${op.status}`, {
                  processed: n(op.processed),
                  total: n(op.total),
                  succeeded: n(op.succeeded),
                  failed: n(op.failed),
                  undone: n(op.undone),
                })}
          </p>
          {op.status === 'done' && op.hasFile ? (
            <a
              href={`${locale === 'en' ? '' : `/${locale}`}${base}/exports/${op.id}`}
              className={buttonClass('primary', 'sm', 'self-start')}
              download
            >
              {t('bulk.download')}
            </a>
          ) : null}
        </section>
      ) : null}

      {log.entries.length === 0 ? (
        <EmptyState
          title={t(filtered ? 'activity.emptyFilteredTitle' : 'activity.emptyTitle')}
          description={t('activity.emptyDescription')}
        />
      ) : (
        <Table
          caption={t('activity.caption')}
          rowKey={(e: AuditEntryDto) => e.id}
          rows={log.entries}
          columns={[
            { key: 'seq', header: t('activity.columns.seq'), cell: (e) => n(e.seq), mono: true },
            {
              key: 'at',
              header: t('activity.columns.at'),
              cell: (e) => <time dateTime={e.at.toISOString()}>{when.format(e.at)}</time>,
            },
            { key: 'actor', header: t('activity.columns.actor'), cell: (e) => who(e.actor) },
            {
              key: 'action',
              header: t('activity.columns.action'),
              cell: (e) => <span className="font-mono text-caption">{e.action}</span>,
            },
            {
              key: 'target',
              header: t('activity.columns.targetId'),
              cell: (e) => (
                <span className="flex flex-col">
                  <span>{e.targetType}</span>
                  {e.targetId ? (
                    <span className="font-mono text-caption text-zinc-500">{e.targetId.slice(0, 13)}</span>
                  ) : null}
                </span>
              ),
            },
            {
              key: 'details',
              header: t('activity.columns.details'),
              cell: (e) => (
                <span className="font-mono text-caption text-zinc-600">
                  {Object.entries(e.details)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(' · ')}
                </span>
              ),
            },
          ]}
        />
      )}
      <nav aria-label={t('activity.pagination')} className="flex flex-wrap gap-2">
        {before ? (
          <Link href={`${base}${qs({})}`} className={buttonClass('secondary', 'sm')}>
            {t('activity.newest')}
          </Link>
        ) : null}
        {log.nextBefore ? (
          <Link
            href={`${base}${qs({ before: String(log.nextBefore) })}`}
            className={buttonClass('secondary', 'sm')}
          >
            {t('activity.older')}
          </Link>
        ) : null}
      </nav>
    </>
  );
}
