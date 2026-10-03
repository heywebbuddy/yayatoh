import {
  openErrorCountQuery,
  ZAPIER_ACTIONS,
  ZAPIER_EVENT_PICKER,
  ZAPIER_SCOPES,
  ZAPIER_TRIGGERS,
} from '@yayatoh/integrations';
import { executeQuery } from '@yayatoh/kernel';
import { isApiKeyLive, listApiKeysQuery, roleCan } from '@yayatoh/tenancy';
import {
  Alert,
  Breadcrumb,
  buttonClass,
  EmptyState,
  PageHeader,
  SectionHeader,
  StatusPill,
  Table,
} from '@yayatoh/ui';
import { listRestHooksQuery } from '@yayatoh/webhooks';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { scopeKey } from '@/lib/api-keys.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { IntegrationTabs } from '../parts.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('integrations.zapier');
  return { title: t('title') };
}

/**
 * Settings → Integrations → Zapier (M6.4c): Zapier connects with an org API key, so this page is
 * its "connection": the scope each trigger and action needs, which of the org's keys cover them,
 * and the triggers Zapier has subscribed (REST hooks). Owners, admins and managers read it; keys
 * are listed for those who manage them.
 */
export default async function ZapierPage({ params }: { params: Promise<{ locale: string; org: string }> }) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('integrations') || !roleCan(data.role, 'integrations:read')) notFound();
  const t = await getTranslations('integrations.zapier');
  const tAll = await getTranslations();
  const hasApi = data.modules.has('api_access');
  const canKeys = roleCan(data.role, 'api_keys:manage');
  const [{ open }, keys, hooks] = await Promise.all([
    executeQuery(openErrorCountQuery, {}, data.ctx, ports),
    hasApi && canKeys ? executeQuery(listApiKeysQuery, {}, data.ctx, ports) : Promise.resolve([]),
    hasApi ? executeQuery(listRestHooksQuery, {}, data.ctx, ports) : Promise.resolve([]),
  ]);
  const now = new Date();
  const liveKeys = keys.filter((k) => !k.sandbox && isApiKeyLive(k, now));
  const keyName = new Map(keys.map((k) => [k.id, k.name]));
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: data.org.timezone,
  });
  const parts = [
    ...ZAPIER_TRIGGERS.map((p) => ({ ...p, kind: 'trigger' as const })),
    ...ZAPIER_ACTIONS.map((p) => ({ ...p, kind: 'action' as const })),
    { ...ZAPIER_EVENT_PICKER, kind: 'picker' as const },
  ];
  const scope = (s: string) => (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span>{tAll(scopeKey(s))}</span>
      <code className="font-mono text-caption text-ink-2">{s}</code>
    </span>
  );
  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb
            label={tAll('integrations.breadcrumb')}
            link={Link}
            items={[
              { label: tAll('integrations.title'), href: `/o/${org}/integrations` },
              { label: t('title') },
            ]}
          />
        }
        title={t('title')}
        description={t('description')}
        actions={
          hasApi && canKeys ? (
            <Link href={`/o/${org}/api-keys`} className={buttonClass('primary')}>
              {t('createKey')}
            </Link>
          ) : undefined
        }
      />
      <IntegrationTabs org={org} current="connections" openErrors={open} />
      <Alert tone="info" title={t('reviewTitle')}>
        <p className="m-0">{t('reviewBody')}</p>
      </Alert>
      {!hasApi ? <Alert tone="warning" title={t('noApiAccess')} /> : null}
      <section aria-labelledby="zapier-scopes-heading" className="flex flex-col gap-3">
        <SectionHeader id="zapier-scopes-heading" title={t('scopesTitle')} description={t('scopesHelp')} />
        <p className="m-0 text-body" data-testid="zapier-scopes">
          {t('allScopes')}{' '}
          {ZAPIER_SCOPES.map((s, i) => (
            <span key={s}>
              {i ? ', ' : ''}
              <code className="font-mono">{s}</code>
            </span>
          ))}
        </p>
        <Table
          caption={t('partsCaption')}
          rowKey={(p) => p.key}
          rows={parts}
          stackOnPhone
          columns={[
            { key: 'name', header: t('part'), cell: (p) => t(`parts.${p.key}`) },
            { key: 'kind', header: t('kind'), cell: (p) => t(`kinds.${p.kind}`) },
            { key: 'scope', header: t('scope'), cell: (p) => scope(p.scope) },
          ]}
        />
      </section>
      {hasApi && canKeys ? (
        <section aria-labelledby="zapier-keys-heading" className="flex flex-col gap-3">
          <SectionHeader id="zapier-keys-heading" title={t('keysTitle')} description={t('keysHelp')} />
          {liveKeys.length === 0 ? (
            <EmptyState
              title={t('noKeysTitle')}
              description={t('noKeysDescription')}
              action={
                <Link href={`/o/${org}/api-keys`} className={buttonClass('secondary')}>
                  {t('createKey')}
                </Link>
              }
            />
          ) : (
            <Table
              caption={t('keysCaption')}
              rowKey={(k) => k.id}
              rows={liveKeys}
              stackOnPhone
              columns={[
                { key: 'name', header: t('keyName'), cell: (k) => k.name },
                { key: 'prefix', header: t('key'), cell: (k) => `${k.prefix}…`, mono: true },
                {
                  key: 'coverage',
                  header: t('coverage'),
                  cell: (k) => {
                    const missing = ZAPIER_SCOPES.filter((s) => !k.scopes.includes(s));
                    return missing.length === 0 ? (
                      <StatusPill tone="success" label={t('ready')} />
                    ) : (
                      <span className="flex flex-col gap-1">
                        <StatusPill tone="waiting" label={t('partial', { count: missing.length })} />
                        <span className="text-caption text-ink-2">
                          {t('missing', { scopes: missing.join(', ') })}
                        </span>
                      </span>
                    );
                  },
                },
              ]}
            />
          )}
        </section>
      ) : null}
      {hasApi ? (
        <section aria-labelledby="zapier-hooks-heading" className="flex flex-col gap-3">
          <SectionHeader
            id="zapier-hooks-heading"
            title={t('hooksTitle')}
            count={hooks.length}
            description={t('hooksHelp')}
          />
          <Table
            caption={t('hooksCaption')}
            rowKey={(h) => h.id}
            rows={hooks}
            stackOnPhone
            empty={t('hooksEmpty')}
            columns={[
              { key: 'event', header: t('event'), cell: (h) => <code className="font-mono">{h.event}</code> },
              { key: 'host', header: t('host'), cell: (h) => h.host, mono: true },
              {
                key: 'key',
                header: t('keyName'),
                cell: (h) => (h.apiKeyId ? (keyName.get(h.apiKeyId) ?? t('otherKey')) : '—'),
              },
              { key: 'created', header: t('created'), cell: (h) => when.format(h.createdAt) },
            ]}
          />
        </section>
      ) : null}
    </>
  );
}
