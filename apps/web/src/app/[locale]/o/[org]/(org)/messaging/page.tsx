import { executeQuery } from '@yayatoh/kernel';
import {
  addressSuppressionsQuery,
  autoPauseQuery,
  frequencyCapsQuery,
  messagingUsageQuery,
  policyLogQuery,
} from '@yayatoh/notifications';
import { roleCan, suspensionsQuery } from '@yayatoh/tenancy';
import { Alert, Card, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MessagingCapsForm } from '@/components/messaging-caps-form.tsx';
import { SuppressionLiftForm } from '@/components/suppression-lift-form.tsx';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { liftSuppressionAction, saveCapsAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('messagingHealth');
  return { title: t('title') };
}

/**
 * Messaging limits (M3.5a): the complaint-rate auto-pause, this month's usage against the org's
 * quotas (and what waits for them), messages the rules held or blocked with their reasons, the
 * suppressed addresses (bounces can be lifted by owners and admins) and the frequency caps.
 */
export default async function MessagingLimitsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ lifted?: string }>;
}) {
  const { locale, org } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('messaging') || !roleCan(data.role, 'messages:read')) notFound();
  const t = await getTranslations('messagingHealth');
  const tn = await getTranslations('notifications');
  const [usage, pause, suspensions, log, suppressed, caps] = await Promise.all([
    executeQuery(messagingUsageQuery, {}, data.ctx, ports),
    executeQuery(autoPauseQuery, {}, data.ctx, ports),
    executeQuery(suspensionsQuery, {}, data.ctx, ports),
    executeQuery(policyLogQuery, {}, data.ctx, ports),
    executeQuery(addressSuppressionsQuery, {}, data.ctx, ports),
    executeQuery(frequencyCapsQuery, {}, data.ctx, ports),
  ]);
  const canEdit = roleCan(data.role, 'org:update');
  const tz = data.org.timezone;
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: tz });
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: tz });
  const pct = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 });
  const num = new Intl.NumberFormat(locale);
  const list = new Intl.ListFormat(locale, { type: 'conjunction' });
  const reached = usage.channels.filter((c) => c.reached);
  const staffPaused = suspensions.some((s) => s.kind === 'pause_messaging') && !pause?.active;
  const reason = (r: string) => (tn.has(`reasons.${r}`) ? tn(`reasons.${r}`) : r);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {pause?.active ? (
        <Alert
          title={t('autoPaused', {
            rate: pct.format(pause.rateBps / 10_000),
            complaints: pause.complaints,
            sent: num.format(pause.sent),
          })}
        >
          {t('autoPausedBody', { since: when.format(pause.since) })}
        </Alert>
      ) : staffPaused ? (
        <Alert title={t('staffPaused')} />
      ) : null}
      {sp.lifted === '1' ? <Alert tone="info" title={t('lifted')} /> : null}

      <section aria-labelledby="usage-heading" className="flex flex-col gap-3">
        <h2 id="usage-heading" className="text-section">
          {t('usageTitle')}
        </h2>
        {reached.length ? (
          <Alert
            title={t('quotaReachedTitle', {
              channels: reached.length,
              list: list.format(reached.map((c) => tn(`channels.${c.channel}`))),
            })}
          >
            {t('quotaReachedBody', { resets: day.format(usage.resetsAt) })}
          </Alert>
        ) : null}
        <Table
          caption={t('usageCaption')}
          rowKey={(c) => c.channel}
          rows={usage.channels}
          columns={[
            { key: 'channel', header: t('channel'), cell: (c) => tn(`channels.${c.channel}`) },
            {
              key: 'used',
              header: t('used'),
              cell: (c) =>
                `${t('usedOf', { used: num.format(c.used), limit: num.format(c.limit) })} ${t(`units.${c.channel}`)}`,
            },
            {
              key: 'status',
              header: t('status'),
              cell: (c) => (
                <StatusDot
                  status={c.reached ? 'danger' : 'success'}
                  label={c.reached ? t('reached') : t('ok')}
                />
              ),
            },
            {
              key: 'waiting',
              header: t('waiting'),
              cell: (c) => num.format(c.waiting),
              mono: true,
              align: 'end',
            },
          ]}
        />
        <p className="text-caption text-zinc-500">
          {t('resets', { date: day.format(usage.resetsAt) })} {t('smsSegmentsNote')}
        </p>
      </section>

      <section aria-labelledby="log-heading" className="flex flex-col gap-3">
        <h2 id="log-heading" className="text-section">
          {t('logTitle')}
        </h2>
        <Table
          caption={t('logCaption')}
          rowKey={(m) => m.id}
          rows={log}
          empty={t('logEmpty')}
          columns={[
            { key: 'when', header: t('when'), cell: (m) => when.format(m.at) },
            {
              key: 'message',
              header: t('message'),
              cell: (m) => (tn.has(`kinds.${m.kind}`) ? tn(`kinds.${m.kind}`) : m.kind),
            },
            { key: 'channel', header: t('channel'), cell: (m) => tn(`channels.${m.channel}`) },
            { key: 'to', header: t('to'), cell: (m) => m.recipient ?? t('noAddress') },
            {
              key: 'status',
              header: t('status'),
              cell: (m) => (
                <span className="flex flex-col gap-0.5">
                  <StatusDot status={m.status === 'blocked' ? 'danger' : 'warning'} label={t(m.status)} />
                  <span className="text-caption text-zinc-600">{reason(m.reason)}</span>
                </span>
              ),
            },
          ]}
        />
      </section>

      <section
        id="suppressions"
        aria-labelledby="suppressions-heading"
        className="flex scroll-mt-20 flex-col gap-3"
      >
        <h2 id="suppressions-heading" className="text-section">
          {t('suppressionsTitle')}
        </h2>
        <Table
          caption={t('suppressionsCaption')}
          rowKey={(s) => s.id}
          rows={suppressed}
          empty={t('suppressionsEmpty')}
          columns={[
            { key: 'address', header: t('address'), cell: (s) => <span dir="ltr">{s.address}</span> },
            { key: 'channel', header: t('channel'), cell: (s) => tn(`channels.${s.channel}`) },
            { key: 'reason', header: t('reason'), cell: (s) => t(`suppressionReason.${s.reason}`) },
            { key: 'since', header: t('since'), cell: (s) => when.format(s.since) },
            ...(canEdit
              ? [
                  {
                    key: 'action',
                    header: t('action'),
                    cell: (s: (typeof suppressed)[number]) =>
                      s.liftable ? (
                        <SuppressionLiftForm
                          action={liftSuppressionAction.bind(null, org, s.id)}
                          id={s.id}
                          address={s.address}
                        />
                      ) : (
                        <span className="text-caption text-zinc-600">
                          {s.reason === 'opt_out' ? t('personOnly') : t('supportOnly')}
                        </span>
                      ),
                  },
                ]
              : []),
          ]}
        />
      </section>

      <section aria-labelledby="caps-heading" className="flex flex-col gap-3">
        <h2 id="caps-heading" className="text-section">
          {t('capsTitle')}
        </h2>
        <p className="text-body text-zinc-600">{t('capsDescription')}</p>
        {canEdit ? (
          <Card>
            <MessagingCapsForm action={saveCapsAction.bind(null, org)} caps={caps} />
          </Card>
        ) : (
          <Table
            caption={t('capsCaption')}
            rowKey={(c) => c.scope}
            rows={caps}
            columns={[
              { key: 'scope', header: t('channel'), cell: (c) => t(`scope.${c.scope}`) },
              {
                key: 'value',
                header: t('limit'),
                cell: (c) => t('capValue', { max: c.maxMessages, hours: c.windowHours }),
              },
              { key: 'kind', header: t('status'), cell: (c) => (c.isDefault ? t('default') : t('custom')) },
            ]}
          />
        )}
      </section>
    </>
  );
}
