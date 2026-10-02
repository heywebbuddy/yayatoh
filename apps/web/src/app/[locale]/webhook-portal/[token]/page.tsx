import { Card, EmptyState, StatusDot, Table } from '@yayatoh/ui';
import {
  fakePortalView,
  fakeWebhookSeed,
  processWebhookStore,
  verifyFakePortalToken,
} from '@yayatoh/webhooks';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The fake webhook portal (M6.3b): what the console embeds in dev, preview and CI instead of Svix's
 * App Portal. A signed, ten-minute link names the org; it lists the org's endpoints and recent
 * attempts from the fake publisher's store. A 404 wherever the real provider (or none) is set up.
 */
export default async function FakeWebhookPortal({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const seed = fakeWebhookSeed(process.env);
  const appId = seed ? verifyFakePortalToken(seed, token) : null;
  if (!appId) notFound();
  const t = await getTranslations('webhooks.fakePortal');
  const view = fakePortalView(processWebhookStore(), appId);
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <h1 className="text-section">{t('title')}</h1>
      <p className="text-body text-zinc-600">{t('subtitle')}</p>
      {view.endpoints.length === 0 ? (
        <EmptyState title={t('noEndpoints')} />
      ) : (
        <Table
          caption={t('endpoints')}
          captionHidden={false}
          rowKey={(e) => e.id}
          rows={view.endpoints}
          columns={[
            {
              key: 'url',
              header: t('url'),
              cell: (e) => <span className="break-all">{e.url}</span>,
              mono: true,
            },
            {
              key: 'types',
              header: t('types'),
              cell: (e) => (e.eventTypes.length ? e.eventTypes.join(', ') : t('allTypes')),
              mono: true,
            },
            {
              key: 'status',
              header: t('status'),
              cell: (e) =>
                e.disabled ? (
                  <StatusDot status="neutral" label={t('disabled')} />
                ) : (
                  <StatusDot status="success" label={t('enabled')} />
                ),
            },
          ]}
        />
      )}
      <Card className="flex flex-col gap-3">
        <h2 className="text-section">{t('attempts')}</h2>
        {view.attempts.length === 0 ? (
          <p className="text-body text-zinc-600">{t('noAttempts')}</p>
        ) : (
          <Table
            caption={t('attempts')}
            rowKey={(a) => a.attemptId}
            rows={view.attempts}
            columns={[
              { key: 'type', header: t('type'), cell: (a) => a.eventType, mono: true },
              { key: 'message', header: t('message'), cell: (a) => a.messageId, mono: true },
              {
                key: 'status',
                header: t('status'),
                cell: (a) =>
                  a.status === 'succeeded' ? (
                    <StatusDot status="success" label={`${t('succeeded')} · ${a.responseStatus}`} />
                  ) : (
                    <StatusDot status="danger" label={`${t('failed')} · ${a.responseStatus}`} />
                  ),
              },
              { key: 'at', header: t('at'), cell: (a) => a.attemptedAt.toISOString(), mono: true },
            ]}
          />
        )}
      </Card>
    </main>
  );
}
