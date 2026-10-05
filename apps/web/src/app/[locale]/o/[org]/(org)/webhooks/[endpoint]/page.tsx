import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Button, buttonClass, Card, EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { type DeliveryAttemptDto, endpointAttemptsQuery, getEndpointQuery } from '@yayatoh/webhooks';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StepUpForm } from '@/components/step-up.tsx';
import { EndpointForm } from '@/components/webhooks/endpoint-form.tsx';
import { RecoverForm, ResendButton } from '@/components/webhooks/replay.tsx';
import { SecretPanel } from '@/components/webhooks/secret-panel.tsx';
import { TestSend } from '@/components/webhooks/test-send.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatDate } from '@/lib/format.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import {
  deleteEndpointAction,
  recoverAction,
  resendAction,
  revealSecretAction,
  rotateSecretAction,
  sendTestAction,
  updateEndpointAction,
} from '../actions.ts';
import { TEST_TYPES, TYPE_GROUPS, webhooksAvailable } from '../shared.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One webhook endpoint (M6.3b): its signing secret, a test send, its recent deliveries with
 * replay, recovery of failed messages, its settings, and deletion.
 */
export default async function WebhookEndpointPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; endpoint: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { locale, org, endpoint: endpointId } = await params;
  const { created } = await searchParams;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!UUID.test(endpointId)) notFound();
  // Lower roles get the not-found page: an endpoint's URL is owners' and admins' business.
  if (!roleCan(data.role, 'webhooks:manage') || !data.modules.has('api_access') || !webhooksAvailable())
    notFound();
  const t = await getTranslations('webhooks');
  let endpoint: Awaited<ReturnType<typeof loadEndpoint>>;
  try {
    endpoint = await loadEndpoint(endpointId, data.ctx);
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  }
  let attempts: DeliveryAttemptDto[] = [];
  let attemptsFailed = false;
  try {
    attempts = await executeQuery(endpointAttemptsQuery, { endpointId, limit: 50 }, data.ctx, ports);
  } catch (err) {
    if (!isDomainError(err)) throw err;
    attemptsFailed = true;
  }
  const f = { locale, currency: data.org.currency, timeZone: data.org.timezone };
  const when = (d: Date) =>
    formatDate(d.toISOString(), f, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
  const status = (a: DeliveryAttemptDto) =>
    a.status === 'succeeded' ? (
      <StatusDot status="success" label={t('attemptSucceeded')} />
    ) : a.status === 'failed' ? (
      <StatusDot status="danger" label={t('attemptFailed')} />
    ) : (
      <StatusDot status="info" label={t('attemptPending')} />
    );
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${org}/webhooks`} className="text-caption underline underline-offset-2">
            {t('back')}
          </Link>
        }
        title={t('endpointTitle')}
        description={endpoint.description || undefined}
      />
      <p className="break-all font-mono text-body" data-testid="endpoint-url">
        {endpoint.url}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {endpoint.status === 'active' ? (
          <StatusDot status="success" label={t('active')} />
        ) : (
          <StatusDot status="neutral" label={t('disabled')} />
        )}
      </div>
      {created === '1' ? (
        <p role="status" className="text-body font-medium">
          {t('created')}
        </p>
      ) : null}
      <div id="send-test" className="grid gap-4 lg:grid-cols-2">
        <TestSend action={sendTestAction.bind(null, org, endpointId)} types={TEST_TYPES} />
        <SecretPanel
          reveal={revealSecretAction.bind(null, org, endpointId)}
          rotate={rotateSecretAction.bind(null, org, endpointId)}
        />
      </div>
      {attemptsFailed ? (
        <Alert title={t('deliveriesUnavailable')} />
      ) : attempts.length === 0 ? (
        <EmptyState
          title={t('noDeliveriesTitle')}
          description={t('noDeliveriesDescription')}
          action={
            <Link
              href={`/o/${org}/webhooks/${endpointId}#send-test`}
              className={buttonClass('primary', 'md')}
            >
              {t('testTitle')}
            </Link>
          }
        />
      ) : (
        <Table
          caption={t('deliveriesTitle')}
          captionHidden={false}
          rowKey={(a) => a.attemptId}
          rows={attempts}
          columns={[
            { key: 'when', header: t('attemptedAt'), cell: (a) => when(a.attemptedAt), mono: true },
            { key: 'type', header: t('eventType'), cell: (a) => a.eventType, mono: true },
            { key: 'status', header: t('status'), cell: status },
            {
              key: 'response',
              header: t('response'),
              cell: (a) => (a.responseStatus > 0 ? String(a.responseStatus) : t('noResponse')),
              mono: true,
            },
            {
              key: 'trigger',
              header: t('trigger'),
              cell: (a) => (a.trigger === 'manual' ? t('triggerManual') : t('triggerScheduled')),
            },
            {
              key: 'next',
              header: t('nextRetry'),
              cell: (a) => (a.nextAttemptAt ? when(a.nextAttemptAt) : '—'),
              mono: true,
            },
            {
              key: 'actions',
              header: t('actions'),
              align: 'end',
              cell: (a) => (
                <ResendButton
                  action={resendAction.bind(null, org, endpointId, a.messageId)}
                  label={t('resendNamed', { type: a.eventType, when: when(a.attemptedAt) })}
                />
              ),
            },
          ]}
        />
      )}
      <RecoverForm action={recoverAction.bind(null, org, endpointId)} />
      <EndpointForm
        action={updateEndpointAction.bind(null, org, endpointId)}
        groups={TYPE_GROUPS}
        initial={{
          url: endpoint.url,
          description: endpoint.description,
          eventTypes: endpoint.eventTypes,
          enabled: endpoint.status === 'active',
        }}
      />
      <Card className="flex flex-col gap-3">
        <h2 className="text-section">{t('deleteTitle')}</h2>
        <p className="text-body text-ink-2">{t('deleteHint')}</p>
        <StepUpForm
          action={deleteEndpointAction.bind(null, org, endpointId)}
          className="flex flex-wrap gap-2"
        >
          <Button type="submit" variant="secondary">
            {t('delete')}
          </Button>
        </StepUpForm>
      </Card>
    </>
  );
}

async function loadEndpoint(endpointId: string, ctx: Awaited<ReturnType<typeof loadConsole>>['ctx']) {
  return executeQuery(getEndpointQuery, { endpointId }, ctx, ports);
}
