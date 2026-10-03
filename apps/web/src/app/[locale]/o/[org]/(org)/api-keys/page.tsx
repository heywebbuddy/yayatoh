import { executeQuery } from '@yayatoh/kernel';
import { API_KEY_SCOPES, listApiKeysQuery, roleCan } from '@yayatoh/tenancy';
import { Button, Chip, EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ApiKeyForm } from '@/components/api-key-form.tsx';
import { StepUpForm } from '@/components/step-up.tsx';
import { scopeKey } from '@/lib/api-keys.ts';
import { formatDate } from '@/lib/format.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { createApiKeyAction, revokeApiKeyAction } from './actions.ts';

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
  const keys = await executeQuery(listApiKeysQuery, {}, data.ctx, ports);
  const f = { locale, currency: data.org.currency, timeZone: data.org.timezone };
  const when = (d: Date | null) =>
    d
      ? formatDate(d.toISOString(), f, { year: 'numeric', month: 'short', day: 'numeric' })
      : t('apiKeys.never');
  return (
    <>
      <PageHeader title={t('apiKeys.title')} description={t('apiKeys.subtitle')} />
      <p className="text-body text-ink-2">{docs}</p>
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
          { key: 'used', header: t('apiKeys.lastUsed'), cell: (k) => when(k.lastUsedAt), mono: true },
          {
            key: 'status',
            header: t('apiKeys.status'),
            cell: (k) =>
              k.revokedAt ? (
                <StatusDot status="neutral" label={t('apiKeys.revoked')} />
              ) : (
                <StatusDot status="success" label={t('apiKeys.active')} />
              ),
          },
          {
            key: 'actions',
            header: t('apiKeys.actions'),
            align: 'end',
            cell: (k) =>
              k.revokedAt ? null : (
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
              ),
          },
        ]}
      />
    </>
  );
}
