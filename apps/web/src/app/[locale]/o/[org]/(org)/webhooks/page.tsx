import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, Chip, EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { listEndpointsQuery } from '@yayatoh/webhooks';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EndpointForm } from '@/components/webhooks/endpoint-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatDate } from '@/lib/format.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { createEndpointAction } from './actions.ts';
import { TYPE_GROUPS, webhooksAvailable } from './shared.ts';

/**
 * Settings → Webhooks (M6.3b): the org's endpoints, and a form to add one. Owners and admins;
 * everyone else gets an explanation (and the commands refuse them too).
 */
export default async function WebhooksPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ deleted?: string }>;
}) {
  const { locale, org } = await params;
  const { deleted } = await searchParams;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations('webhooks');
  const docs = (
    <Link href="/developers/guides/webhooks" className="underline underline-offset-2">
      {t('docs')}
    </Link>
  );
  const header = <PageHeader title={t('title')} description={t('subtitle')} />;
  if (!roleCan(data.role, 'webhooks:manage'))
    return (
      <>
        {header}
        <EmptyState title={t('noAccessTitle')} description={t('noAccessDescription')} action={docs} />
      </>
    );
  if (!data.modules.has('api_access'))
    return (
      <>
        {header}
        <EmptyState title={t('noModuleTitle')} description={t('noModuleDescription')} action={docs} />
      </>
    );
  if (!webhooksAvailable())
    return (
      <>
        {header}
        <EmptyState title={t('unavailableTitle')} description={t('unavailableDescription')} action={docs} />
      </>
    );
  const endpoints = await executeQuery(listEndpointsQuery, {}, data.ctx, ports);
  const f = { locale, currency: data.org.currency, timeZone: data.org.timezone };
  return (
    <>
      {header}
      <nav aria-label={t('related')} className="flex flex-wrap items-center gap-x-5 gap-y-2 text-body">
        {docs}
        <Link href={`/o/${org}/webhooks/portal`} className="underline underline-offset-2">
          {t('portalLink')}
        </Link>
        <Link href={`/o/${org}/api-keys`} className="underline underline-offset-2">
          {t('apiKeysLink')}
        </Link>
      </nav>
      {deleted === '1' ? (
        <p role="status" className="text-body font-medium">
          {t('deleted')}
        </p>
      ) : null}
      {endpoints.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          description={t('emptyDescription')}
          action={
            <Link href={`/o/${org}/webhooks#new-endpoint`} className={buttonClass('primary', 'md')}>
              {t('emptyAction')}
            </Link>
          }
        />
      ) : (
        <Table
          caption={t('listTitle')}
          captionHidden={false}
          rowKey={(e) => e.id}
          rows={endpoints}
          empty={t('emptyTitle')}
          columns={[
            {
              key: 'url',
              header: t('url'),
              cell: (e) => (
                <span className="flex flex-col gap-0.5">
                  <Link
                    href={`/o/${org}/webhooks/${e.id}`}
                    className="break-all font-mono text-caption underline underline-offset-2"
                  >
                    {e.url}
                  </Link>
                  {e.description ? <span className="text-caption text-ink-2">{e.description}</span> : null}
                </span>
              ),
            },
            {
              key: 'types',
              header: t('events'),
              cell: (e) =>
                e.eventTypes.length === 0 ? (
                  <Chip tone="neutral">{t('allEvents')}</Chip>
                ) : (
                  t('eventCount', { count: e.eventTypes.length })
                ),
            },
            {
              key: 'status',
              header: t('status'),
              cell: (e) =>
                e.status === 'active' ? (
                  <StatusDot status="success" label={t('active')} />
                ) : (
                  <StatusDot status="neutral" label={t('disabled')} />
                ),
            },
            {
              key: 'created',
              header: t('createdAt'),
              cell: (e) =>
                formatDate(e.createdAt.toISOString(), f, { year: 'numeric', month: 'short', day: 'numeric' }),
              mono: true,
            },
          ]}
        />
      )}
      <div id="new-endpoint">
        <EndpointForm action={createEndpointAction.bind(null, org)} groups={TYPE_GROUPS} />
      </div>
    </>
  );
}
