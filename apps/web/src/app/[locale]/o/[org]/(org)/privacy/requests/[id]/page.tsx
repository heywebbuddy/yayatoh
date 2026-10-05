import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { requestQuery } from '@yayatoh/privacy';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, buttonClass, Card, EmptyState, PageHeader, StatusPill, Table } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import {
  PrivacyCancelForm,
  PrivacyEraseForm,
  PrivacyExportForm,
} from '@/components/privacy-request-actions.tsx';
import { Link } from '@/i18n/navigation.ts';
import { PRIVACY_MODULES } from '@/lib/privacy-modules.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { cancelRequestAction, eraseRequestAction, exportRequestAction } from '../../actions.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * One data-subject request (M6.1c): who asked and when it is due, what each module holds about
 * the person while it is open, and the one action that fulfils it (the signed archive, or the
 * erasure with its signed receipt). Withdrawing is the secondary action.
 */
export default async function PrivacyRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; id: string }>;
  searchParams: Promise<{ opened?: string; cancelled?: string }>;
}) {
  const { locale, org, id } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations();
  if (!roleCan(data.role, 'privacy:manage')) {
    return (
      <>
        <PageHeader title={t('privacy.title')} />
        <EmptyState
          title={t('privacy.noAccessTitle')}
          description={t('privacy.noAccessDescription')}
          action={
            <Link href={`/o/${org}/team`} className={buttonClass('primary', 'md')}>
              {t('privacy.findOwner')}
            </Link>
          }
        />
      </>
    );
  }
  if (!UUID.test(id)) notFound();
  const r = await executeQuery(requestQuery, { requestId: id }, data.ctx, ports).catch((err) => {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  });
  const req = r.request;
  const date = new Intl.DateTimeFormat(locale, { timeZone: data.org.timezone, dateStyle: 'medium' });
  const dateTime = new Intl.DateTimeFormat(locale, {
    timeZone: data.org.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const moduleLabel = (m: string) =>
    (PRIVACY_MODULES as readonly string[]).includes(m) ? t(`privacy.modules.${m}`) : m;
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const base = `${prefix}/o/${org}/privacy/requests/${req.id}`;
  const tone =
    req.status === 'open'
      ? req.overdue
        ? 'danger'
        : 'waiting'
      : req.status === 'completed'
        ? 'success'
        : 'neutral';
  const title = req.kind === 'access' ? t('privacy.request.titleAccess') : t('privacy.request.titleErasure');
  const holdings = r.holdings ? Object.entries(r.holdings).filter(([, n]) => n > 0) : [];

  return (
    <>
      <PageHeader
        title={title}
        tag={
          <StatusPill
            tone={tone}
            label={req.overdue ? t('privacy.queue.overdue') : t(`privacy.statuses.${req.status}`)}
          />
        }
        description={r.email ?? req.subjectHint}
      />
      <div aria-live="polite" className="flex flex-col gap-3">
        {sp.opened && req.status === 'open' && req.dueAt ? (
          <Alert tone="success" title={t('privacy.request.openedNotice', { date: date.format(req.dueAt) })} />
        ) : null}
        {req.status === 'completed' && req.kind === 'access' && req.archiveUntil ? (
          <Alert tone="success" title={t('privacy.request.export.done')}>
            {req.source === 'self' ? t('privacy.request.export.notified') : null}
          </Alert>
        ) : null}
        {req.status === 'completed' && req.kind === 'erasure' ? (
          <Alert tone="success" title={t('privacy.request.erase.done')}>
            {req.source === 'self' ? t('privacy.request.receipt.notified') : null}
          </Alert>
        ) : null}
        {sp.cancelled && req.status === 'cancelled' ? (
          <Alert tone="info" title={t('privacy.request.cancelledNotice')} />
        ) : null}
      </div>

      <Card>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2" data-testid="dsar-request">
          {(
            [
              ['kind', t(`privacy.kinds.${req.kind}`)],
              ['source', t(`privacy.sources.${req.source}`)],
              ['opened', dateTime.format(req.createdAt)],
              ['due', req.dueAt ? date.format(req.dueAt) : '—'],
              ...(req.verifiedAt ? [['verified', dateTime.format(req.verifiedAt)] as const] : []),
              ...(req.completedAt ? [['completed', dateTime.format(req.completedAt)] as const] : []),
              ...(req.cancelledAt ? [['cancelled', dateTime.format(req.cancelledAt)] as const] : []),
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 border-b border-line py-1">
              <dt className="text-body text-ink-2">{t(`privacy.request.fields.${k}`)}</dt>
              <dd className="text-body">{v}</dd>
            </div>
          ))}
        </dl>
        {r.cancelReason ? (
          <p className="mt-3 text-body">
            <span className="text-ink-2">{t('privacy.request.fields.reason')}: </span>
            {r.cancelReason}
          </p>
        ) : null}
      </Card>

      {req.status === 'open' ? (
        <>
          <section aria-labelledby="dsar-holdings" className="flex flex-col gap-3">
            <h2 id="dsar-holdings" className="text-section">
              {t('privacy.request.holdings.title')}
            </h2>
            {holdings.length === 0 ? (
              <EmptyState
                title={t('privacy.request.holdings.empty')}
                description={t('privacy.request.holdings.emptyHint')}
                action={
                  <Link href="#dsar-answer" className={buttonClass('primary', 'md')}>
                    {t('privacy.request.holdings.emptyAction')}
                  </Link>
                }
              />
            ) : (
              <Card>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2" data-testid="dsar-summary">
                  {holdings.map(([m, n]) => (
                    <div
                      key={m}
                      className="flex items-baseline justify-between gap-3 border-b border-line py-1"
                    >
                      <dt className="text-body text-ink-2">{moduleLabel(m)}</dt>
                      <dd className="font-mono text-body">{n}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            )}
          </section>
          <div id="dsar-answer" className="flex flex-col">
            {req.kind === 'access' ? (
              <PrivacyExportForm action={exportRequestAction.bind(null, org, req.id)} />
            ) : (
              <PrivacyEraseForm action={eraseRequestAction.bind(null, org, req.id)} email={r.email ?? ''} />
            )}
          </div>
          <PrivacyCancelForm action={cancelRequestAction.bind(null, org, req.id)} />
        </>
      ) : null}

      {req.status === 'completed' && req.kind === 'access' ? (
        <Card className="flex flex-col gap-3">
          <h2 className="text-section">{t('privacy.request.export.title')}</h2>
          {req.archiveUntil ? (
            <>
              <p className="text-body text-ink-2">
                {t('privacy.request.export.until', { date: dateTime.format(req.archiveUntil) })}
              </p>
              <a href={`${base}/archive`} className={buttonClass('primary', 'md', 'self-start')} download>
                {t('privacy.request.export.download')}
              </a>
            </>
          ) : (
            <p className="text-body text-ink-2">{t('privacy.request.export.expired')}</p>
          )}
        </Card>
      ) : null}

      {r.receipt ? (
        <section aria-labelledby="dsar-receipt" className="flex flex-col gap-3">
          <h2 id="dsar-receipt" className="text-section">
            {t('privacy.request.receipt.title')}
          </h2>
          <Table
            caption={t('privacy.request.receipt.erased')}
            rowKey={(e) => e.table}
            rows={r.receipt.erased}
            empty={t('privacy.request.receipt.noneErased')}
            columns={[
              { key: 'table', header: t('privacy.request.receipt.table'), cell: (e) => e.table, mono: true },
              {
                key: 'action',
                header: t('privacy.request.receipt.action'),
                cell: (e) => t(`privacy.request.receipt.actions.${e.action}`),
              },
              {
                key: 'rows',
                header: t('privacy.request.receipt.rows'),
                cell: (e) => e.rows,
                mono: true,
                align: 'end',
              },
            ]}
          />
          <Table
            caption={t('privacy.request.receipt.held')}
            rowKey={(h) => `${h.table}:${h.id}`}
            rows={r.receipt.held}
            empty={t('privacy.request.receipt.noneHeld')}
            columns={[
              { key: 'table', header: t('privacy.request.receipt.table'), cell: (h) => h.table, mono: true },
              { key: 'ref', header: t('privacy.request.receipt.ref'), cell: (h) => h.ref, mono: true },
              {
                key: 'basis',
                header: t('privacy.request.receipt.basis'),
                cell: (h) => t(`privacy.request.receipt.bases.${h.basis}`),
              },
              {
                key: 'until',
                header: t('privacy.request.receipt.until'),
                cell: (h) => h.until ?? '—',
                mono: true,
              },
            ]}
          />
          <Card className="flex flex-col gap-2 text-body">
            <p>{t('privacy.request.receipt.files', { count: r.receipt.files })}</p>
            {r.receipt.suppressed ? <p>{t('privacy.request.receipt.suppressed')}</p> : null}
            <p>
              {t('privacy.request.receipt.connectors', {
                count: r.receipt.connectors.length,
                names: r.receipt.connectors.join(', '),
              })}
            </p>
            <p className="text-ink-2">{t('privacy.request.receipt.signature', { key: r.receipt.key.id })}</p>
            <a href={`${base}/receipt`} className={buttonClass('primary', 'md', 'self-start')}>
              {t('privacy.request.receipt.download')}
            </a>
          </Card>
        </section>
      ) : null}
    </>
  );
}
