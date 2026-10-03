import { executeQuery } from '@yayatoh/kernel';
import {
  identityPortFromEnv,
  type SendingDomainDto,
  sendingSetupQuery,
  suggestedDmarcRecord,
} from '@yayatoh/notifications';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Button, Card, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SendingDomainForm } from '@/components/sending-domain-form.tsx';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { addSendingDomainAction, checkSendingDomainAction, removeSendingDomainAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('sendingSetup');
  return { title: t('title') };
}

const DOT = { verified: 'success', pending: 'info', failed: 'danger', missing: 'warning' } as const;
const CAMPAIGN_DOT = {
  verified: 'success',
  pending: 'info',
  failed: 'danger',
  not_registered: 'warning',
} as const;
const DONE = ['added', 'checked', 'removed', 'forbidden', 'error'] as const;

/**
 * Sending setup (M3.5b): the org's own email sending domain (DKIM, SPF through the bounce
 * subdomain, DMARC), the text senders Yayatoh set up for it (10DLC campaign status, the WhatsApp
 * route) and the fallback chains per message category. Everyone who can read the org sees it;
 * owners and admins add, check and remove the domain.
 */
export default async function SendingSetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { locale, org } = await params;
  const { done } = await searchParams;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations('sendingSetup');
  const tn = await getTranslations('notifications');
  const setup = await executeQuery(sendingSetupQuery, {}, data.ctx, ports);
  const canEdit = roleCan(data.role, 'org:update');
  const available = identityPortFromEnv(process.env) !== null;
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: data.org.timezone,
  });
  const d = setup.domain;
  const outcome = DONE.find((x) => x === done);
  const checks = d
    ? ([
        { key: 'dkim', status: d.dkim },
        { key: 'spf', status: d.spf },
        { key: 'dmarc', status: d.dmarc },
      ] as const)
    : [];
  const records: SendingDomainDto['records'] = d
    ? [...d.records, ...(d.dmarc === 'missing' ? [suggestedDmarcRecord(d.domain)] : [])]
    : [];
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {outcome ? (
        <Alert
          tone={outcome === 'forbidden' || outcome === 'error' ? 'danger' : 'info'}
          title={t(`done.${outcome}`)}
        />
      ) : null}

      <section aria-labelledby="domain-heading" className="flex flex-col gap-3">
        <h2 id="domain-heading" className="text-section">
          {t('domainTitle')}
        </h2>
        {!d ? (
          <Card className="flex flex-col gap-4">
            <p className="text-body">{t('noDomain')}</p>
            {!available ? (
              <p className="text-caption text-ink-2">{t('unavailable')}</p>
            ) : canEdit ? (
              <SendingDomainForm action={addSendingDomainAction.bind(null, org)} />
            ) : (
              <p className="text-caption text-ink-2">{t('readOnly')}</p>
            )}
          </Card>
        ) : (
          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <h3 className="font-mono text-body break-all" dir="ltr">
                {d.domain}
              </h3>
              <StatusDot status={DOT[d.status]} label={t(`status.${d.status}`)} />
            </div>
            <p className="text-body">
              {d.status === 'verified'
                ? t('sendingFrom', { address: d.fromAddress })
                : t('notYet', { address: d.fromAddress })}
            </p>
            <Table
              caption={t('checksCaption', { domain: d.domain })}
              rowKey={(c) => c.key}
              rows={[...checks]}
              columns={[
                { key: 'check', header: t('check'), cell: (c) => t(`checks.${c.key}`) },
                {
                  key: 'status',
                  header: t('statusHeader'),
                  cell: (c) => (
                    <StatusDot
                      status={DOT[c.status]}
                      label={
                        c.key === 'dmarc' && c.status === 'verified' && d.dmarcPolicy
                          ? t('dmarcPolicy', { policy: d.dmarcPolicy })
                          : t(`checkStatus.${c.status}`)
                      }
                    />
                  ),
                },
              ]}
            />
            {records.length ? (
              <div className="flex flex-col gap-2">
                <p className="text-caption text-ink-2">{t('recordsIntro')}</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-start text-caption">
                    <caption className="sr-only">{t('recordsCaption', { domain: d.domain })}</caption>
                    <thead>
                      <tr className="text-ink-2">
                        {(['recordType', 'recordName', 'recordValue', 'recordFor'] as const).map((k) => (
                          <th key={k} scope="col" className="py-1 pe-4 text-start font-normal">
                            {t(k)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r) => (
                        <tr key={`${r.type}:${r.name}:${r.value}`} className="border-t border-line">
                          <td className="py-1.5 pe-4 align-top font-mono">{r.type}</td>
                          <td className="py-1.5 pe-4 align-top font-mono break-all" dir="ltr">
                            {r.name}
                          </td>
                          <td className="py-1.5 pe-4 align-top font-mono break-all" dir="ltr">
                            {r.value}
                          </td>
                          <td className="py-1.5 align-top">{t(`checks.${r.purpose}`)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
            {d.lastCheckedAt ? (
              <p className="text-caption text-ink-2">
                {t('lastChecked', { when: when.format(d.lastCheckedAt) })}
              </p>
            ) : null}
            {canEdit ? (
              <div className="flex flex-wrap gap-2">
                <form action={checkSendingDomainAction.bind(null, org, d.id)} aria-label={t('checkForm')}>
                  <Button type="submit" variant="secondary" size="sm">
                    {t('checkNow')}
                  </Button>
                </form>
                <form action={removeSendingDomainAction.bind(null, org, d.id)} aria-label={t('removeForm')}>
                  <Button type="submit" variant="secondary" size="sm">
                    {t('remove')}
                  </Button>
                </form>
              </div>
            ) : (
              <p className="text-caption text-ink-2">{t('readOnly')}</p>
            )}
          </Card>
        )}
      </section>

      <section aria-labelledby="texts-heading" className="flex flex-col gap-3">
        <h2 id="texts-heading" className="text-section">
          {t('textsTitle')}
        </h2>
        <Card className="flex flex-col gap-3">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-body sm:grid-cols-[auto_1fr]">
            <dt className="text-ink-2">{t('smsSender')}</dt>
            <dd>
              {setup.sms.dedicated
                ? t('ownNumber', {
                    number: setup.sms.displayNumber ?? t('ending', { hint: setup.sms.refHint ?? '' }),
                  })
                : t('sharedNumber')}
            </dd>
            {setup.sms.dedicated && setup.sms.campaignStatus ? (
              <>
                <dt className="text-ink-2">{t('campaign')}</dt>
                <dd>
                  <StatusDot
                    status={CAMPAIGN_DOT[setup.sms.campaignStatus]}
                    label={t(`campaignStatus.${setup.sms.campaignStatus}`)}
                  />
                </dd>
              </>
            ) : null}
            <dt className="text-ink-2">{t('whatsappSender')}</dt>
            <dd>
              {setup.whatsapp.dedicated
                ? t(`route.${setup.whatsapp.provider === 'whatsapp_gateway' ? 'gateway' : 'cloud'}`)
                : t('route.default')}
              {setup.whatsapp.displayNumber ? (
                <span dir="ltr" className="ms-2 font-mono">
                  {setup.whatsapp.displayNumber}
                </span>
              ) : null}
            </dd>
          </dl>
          <p className="text-caption text-ink-2">
            {setup.sms.dedicated && !setup.sms.active ? t('campaignPending') : t('textsNote')}
          </p>
        </Card>
      </section>

      <section aria-labelledby="fallback-heading" className="flex flex-col gap-3">
        <h2 id="fallback-heading" className="text-section">
          {t('fallbackTitle')}
        </h2>
        <p className="text-body text-ink-2">{t('fallbackDescription')}</p>
        <Table
          caption={t('fallbackCaption')}
          rowKey={(f) => f.category}
          rows={setup.fallbacks}
          columns={[
            { key: 'category', header: t('category'), cell: (f) => t(`categories.${f.category}`) },
            {
              key: 'chain',
              header: t('chain'),
              cell: (f) =>
                f.chain.length ? f.chain.map((c) => tn(`channels.${c}`)).join(t('arrow')) : t('noFallback'),
            },
          ]}
        />
      </section>
    </>
  );
}
