import { getUsersByIds } from '@yayatoh/auth';
import { apiAccessQuotas } from '@yayatoh/billing';
import { executeQuery } from '@yayatoh/kernel';
import { API_KEY_SCOPES, isApiKeyLive, listApiKeysQuery, roleCan } from '@yayatoh/tenancy';
import { Button, Chip, EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ApiKeyForm } from '@/components/api-key-form.tsx';
import { ApiKeyRotate } from '@/components/api-key-rotate.tsx';
import { StepUpForm } from '@/components/step-up.tsx';
import { Link } from '@/i18n/navigation.ts';
import { scopeKey } from '@/lib/api-keys.ts';
import { formatDate } from '@/lib/format.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { createApiKeyAction, revokeApiKeyAction, rotateApiKeyAction } from './actions.ts';

/** Org API keys for /v1: create (shown once), see scopes and last use, revoke. Owners and admins. */
export default async function ApiKeysPage({ params }: { params: Promise<{ locale: string; org: string }> }) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations();
  const docs = (
    <a href="/api/v1/docs" className="underline underline-offset-2">
      {t('apiKeys.docs')}
    </a>
  );
  if (!roleCan(data.role, 'api_keys:manage')) {
    return (
      <>
        <PageHeader title={t('apiKeys.title')} description={t('apiKeys.subtitle')} />
        <EmptyState
          title={t('apiKeys.noAccessTitle')}
          description={t('apiKeys.noAccessDescription')}
          action={docs}
        />
      </>
    );
  }
  const [keys, quotas] = await Promise.all([
    executeQuery(listApiKeysQuery, {}, data.ctx, ports),
    apiAccessQuotas(data.ctx),
  ]);
  // M6.3a: who created each key (names come from the auth module, never from tenancy rows).
  const creators = await getUsersByIds([
    ...new Set(keys.map((k) => k.createdBy).filter((x): x is string => !!x)),
  ]);
  const f = { locale, currency: data.org.currency, timeZone: data.org.timezone };
  const now = new Date();
  const when = (d: Date | null) =>
    d
      ? formatDate(d.toISOString(), f, { year: 'numeric', month: 'short', day: 'numeric' })
      : t('apiKeys.never');
  const status = (k: (typeof keys)[number]) =>
    k.revokedAt ? (
      <StatusDot status="neutral" label={t('apiKeys.revoked')} />
    ) : !isApiKeyLive(k, now) ? (
      <StatusDot status="neutral" label={t('apiKeys.expired')} />
    ) : k.replacedById ? (
      <StatusDot status="warning" label={t('apiKeys.rotatedStatus')} />
    ) : (
      <StatusDot status="success" label={t('apiKeys.active')} />
    );
  return (
    <>
      <PageHeader title={t('apiKeys.title')} description={t('apiKeys.subtitle')} />
      <nav
        aria-label={t('apiKeys.related')}
        className="flex flex-wrap items-center gap-x-5 gap-y-2 text-body"
      >
        {docs}
        <Link href={`/o/${org}/api-keys/usage`} className="underline underline-offset-2">
          {t('apiKeys.usageLink')}
        </Link>
        <Link href={`/o/${org}/sandboxes`} className="underline underline-offset-2">
          {t('apiKeys.sandboxesLink')}
        </Link>
        <Link href={`/o/${org}/webhooks`} className="underline underline-offset-2">
          {t('apiKeys.webhooksLink')}
        </Link>
      </nav>
      {quotas ? (
        <p className="text-body text-zinc-600" data-testid="rate-limit-note">
          {t('apiKeys.rateLimitNote', {
            perKey: quotas.requestsPerMinute,
            perOrg: quotas.orgRequestsPerMinute,
          })}
        </p>
      ) : (
        <p className="text-body text-zinc-600">{t('apiKeys.noApiAccess')}</p>
      )}
      <ApiKeyForm scopes={API_KEY_SCOPES} action={createApiKeyAction.bind(null, org)} />
      <Table
        caption={t('apiKeys.listTitle')}
        captionHidden={false}
        rowKey={(k) => k.id}
        rows={keys}
        empty={t('apiKeys.empty')}
        columns={[
          {
            key: 'name',
            header: t('apiKeys.name'),
            cell: (k) => (
              <span className="flex flex-wrap items-center gap-2">
                <span>{k.name}</span>
                {k.sandbox ? (
                  <span data-testid="test-key-badge" className="inline-flex">
                    <Chip tone="neutral">{t('apiKeys.testBadge')}</Chip>
                  </span>
                ) : null}
              </span>
            ),
          },
          { key: 'prefix', header: t('apiKeys.key'), cell: (k) => `${k.prefix}…`, mono: true },
          {
            key: 'scopes',
            header: t('apiKeys.scopes'),
            cell: (k) => k.scopes.map((s) => t(scopeKey(s))).join(', '),
          },
          { key: 'created', header: t('apiKeys.createdAt'), cell: (k) => when(k.createdAt), mono: true },
          {
            key: 'createdBy',
            header: t('apiKeys.createdBy'),
            cell: (k) =>
              k.createdBy ? creators.get(k.createdBy)?.name || '—' : t('apiKeys.createdByPlatform'),
          },
          {
            key: 'expires',
            header: t('apiKeys.expiresColumn'),
            cell: (k) => (k.revokedAt ? '—' : when(k.expiresAt)),
            mono: true,
          },
          { key: 'used', header: t('apiKeys.lastUsed'), cell: (k) => when(k.lastUsedAt), mono: true },
          { key: 'status', header: t('apiKeys.status'), cell: status },
          {
            key: 'actions',
            header: t('apiKeys.actions'),
            align: 'end',
            cell: (k) =>
              k.revokedAt ? null : (
                <div className="flex flex-wrap items-start justify-end gap-2">
                  <ApiKeyRotate
                    id={k.id}
                    name={k.name}
                    action={rotateApiKeyAction.bind(null, org, k.id)}
                    timeZone={data.org.timezone}
                    canRotate={isApiKeyLive(k, now) && !k.replacedById}
                  />
                  <StepUpForm action={revokeApiKeyAction.bind(null, org, k.id)}>
                    <Button
                      type="submit"
                      variant="secondary"
                      size="sm"
                      aria-label={t('apiKeys.revokeNamed', { name: k.name })}
                    >
                      {t('apiKeys.revoke')}
                    </Button>
                  </StepUpForm>
                </div>
              ),
          },
        ]}
      />
    </>
  );
}
