import { executeQuery, isDomainError } from '@yayatoh/kernel';
import {
  autoPauseQuery,
  DEFAULT_MONTHLY_QUOTAS,
  messagingUsageQuery,
  sendingSetupQuery,
} from '@yayatoh/notifications';
import { getOrganizationQuery, type OrganizationDto } from '@yayatoh/tenancy';
import { Alert, Button, Card, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { Shell } from '@/components/shell.tsx';
import { ports } from '@/server/ports.ts';
import { requireStaff } from '@/server/staff.ts';
import { liftAutoPauseAction, quotaAction, smsSenderAction, whatsappSenderAction } from './actions.ts';

const field = 'field';

export async function generateMetadata() {
  const t = await getTranslations('messagingPolicy');
  return { title: t('tenantTitle') };
}

/**
 * One tenant's messaging (M3.5a): the complaint-rate auto-pause (lift with a note: admin and
 * support) and this month's usage against its quotas (set or reset: admin and finance). Every
 * change is an audited platform command.
 */
export default async function TenantMessagingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const staff = await requireStaff();
  const { id } = await params;
  const { done, error } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const t = await getTranslations('messagingPolicy');
  const ctx = staff.ctx(id);
  let org: OrganizationDto;
  try {
    org = await executeQuery(getOrganizationQuery, {}, ctx, ports);
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  }
  const [usage, pause, setup] = await Promise.all([
    executeQuery(messagingUsageQuery, {}, ctx, ports),
    executeQuery(autoPauseQuery, {}, ctx, ports),
    executeQuery(sendingSetupQuery, {}, ctx, ports),
  ]);
  const when = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const pct = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 2 });
  const num = new Intl.NumberFormat('en');
  return (
    <Shell staff={staff}>
      <p>
        <Link href={`/tenants/${id}`} className="text-body underline underline-offset-2">
          {t('back', { org: org.name })}
        </Link>
      </p>
      <PageHeader title={t('tenantHeading', { org: org.name })} description={t('tenantDescription')} />
      {done ? <Alert tone="info" title={t(`done.${done}`)} /> : null}
      {error ? (
        <Alert title={t.has(`errors.${error}`) ? t(`errors.${error}`) : t('errors.internal')} />
      ) : null}

      <section aria-labelledby="pause-heading" className="flex flex-col gap-3">
        <h2 id="pause-heading" className="text-section">
          {t('pauseTitle')}
        </h2>
        <Card className="flex flex-col gap-4">
          {pause?.active ? (
            <>
              <StatusDot
                status="danger"
                label={t('pausedSince', { since: `${when.format(pause.since)} UTC` })}
              />
              <p className="text-body">
                {t('rateValue', {
                  rate: pct.format(pause.rateBps / 10_000),
                  complaints: pause.complaints,
                  sent: pause.sent,
                })}
              </p>
              {staff.can('messaging') ? (
                <form action={liftAutoPauseAction.bind(null, id)} className="flex flex-wrap items-end gap-3">
                  <div className="flex min-w-60 flex-1 flex-col gap-1.5">
                    <label htmlFor="lift-note" className="text-[13px] font-bold text-ink">
                      {t('liftNote')}
                    </label>
                    <input
                      id="lift-note"
                      name="note"
                      required
                      minLength={3}
                      maxLength={500}
                      className={field}
                    />
                  </div>
                  <Button type="submit">{t('lift')}</Button>
                </form>
              ) : null}
            </>
          ) : (
            <StatusDot
              status="success"
              label={
                pause?.liftedAt ? t('liftedAt', { at: `${when.format(pause.liftedAt)} UTC` }) : t('notPaused')
              }
            />
          )}
        </Card>
      </section>

      <section aria-labelledby="senders-heading" className="flex flex-col gap-3">
        <h2 id="senders-heading" className="text-section">
          {t('sendersTitle')}
        </h2>
        <p className="text-body text-ink-2">{t('sendersDescription')}</p>
        <Card className="flex flex-col gap-4">
          <p className="text-body">
            {setup.sms.dedicated
              ? t('smsDedicated', {
                  hint: setup.sms.refHint ?? '',
                  status: t(`campaignStatus.${setup.sms.campaignStatus ?? 'not_registered'}`),
                })
              : t('smsShared')}
          </p>
          {staff.can('messaging') ? (
            <form
              action={smsSenderAction.bind(null, id)}
              aria-label={t('smsForm')}
              className="flex flex-wrap items-end gap-3"
            >
              <div className="flex min-w-60 flex-1 flex-col gap-1.5">
                <label htmlFor="sms-sid" className="text-[13px] font-bold text-ink">
                  {t('smsSid')}
                </label>
                <input
                  id="sms-sid"
                  name="sid"
                  autoComplete="off"
                  spellCheck={false}
                  className={`${field} font-mono`}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="sms-number" className="text-[13px] font-bold text-ink">
                  {t('displayNumber')}
                </label>
                <input id="sms-number" name="number" inputMode="tel" className={`${field} w-48 font-mono`} />
              </div>
              <Button type="submit" name="intent" value="save" variant="secondary">
                {t('smsSave')}
              </Button>
              {setup.sms.dedicated ? (
                <Button type="submit" name="intent" value="clear" variant="ghost">
                  {t('smsClear')}
                </Button>
              ) : null}
            </form>
          ) : null}
        </Card>
        <Card className="flex flex-col gap-4">
          <p className="text-body">
            {setup.whatsapp.dedicated
              ? t(setup.whatsapp.provider === 'whatsapp_gateway' ? 'waGateway' : 'waCloud', {
                  hint: setup.whatsapp.refHint ?? '',
                })
              : t('waDefault')}
          </p>
          {staff.can('messaging') ? (
            <form
              action={whatsappSenderAction.bind(null, id)}
              aria-label={t('waForm')}
              className="flex flex-wrap items-end gap-3"
            >
              <div className="flex flex-col gap-1.5">
                <label htmlFor="wa-route" className="text-[13px] font-bold text-ink">
                  {t('waRoute')}
                </label>
                <select id="wa-route" name="route" className={field}>
                  <option value="cloud">{t('routeCloud')}</option>
                  <option value="gateway">{t('routeGateway')}</option>
                </select>
              </div>
              <div className="flex min-w-60 flex-1 flex-col gap-1.5">
                <label htmlFor="wa-ref" className="text-[13px] font-bold text-ink">
                  {t('waRef')}
                </label>
                <input
                  id="wa-ref"
                  name="ref"
                  autoComplete="off"
                  spellCheck={false}
                  className={`${field} font-mono`}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="wa-number" className="text-[13px] font-bold text-ink">
                  {t('displayNumber')}
                </label>
                <input id="wa-number" name="number" inputMode="tel" className={`${field} w-48 font-mono`} />
              </div>
              <Button type="submit" name="intent" value="save" variant="secondary">
                {t('waSave')}
              </Button>
              {setup.whatsapp.dedicated ? (
                <Button type="submit" name="intent" value="clear" variant="ghost">
                  {t('waClear')}
                </Button>
              ) : null}
            </form>
          ) : null}
        </Card>
      </section>

      <section aria-labelledby="quota-heading" className="flex flex-col gap-3">
        <h2 id="quota-heading" className="text-section">
          {t('quotaTitle', { period: usage.period })}
        </h2>
        <Table
          caption={t('quotaCaption')}
          rowKey={(c) => c.channel}
          rows={usage.channels}
          columns={[
            { key: 'channel', header: t('channel'), cell: (c) => t(`channels.${c.channel}`) },
            { key: 'used', header: t('used'), cell: (c) => num.format(c.used), mono: true, align: 'end' },
            {
              key: 'limit',
              header: t('limit'),
              cell: (c) => `${num.format(c.limit)}${c.isDefault ? ` (${t('default')})` : ''}`,
              mono: true,
              align: 'end',
            },
            {
              key: 'status',
              header: t('status'),
              cell: (c) => (
                <StatusDot
                  status={c.reached ? 'danger' : 'success'}
                  label={c.reached ? t('reached', { waiting: c.waiting }) : t('ok')}
                />
              ),
            },
          ]}
        />
        {staff.can('quotas')
          ? usage.channels.map((c) => (
              <form
                key={c.channel}
                action={quotaAction.bind(null, id, c.channel)}
                aria-label={t('quotaForm', { channel: t(`channels.${c.channel}`) })}
                className="flex flex-wrap items-end gap-3"
              >
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`limit-${c.channel}`} className="text-[13px] font-bold text-ink">
                    {t('limitLabel', {
                      channel: t(`channels.${c.channel}`),
                      fallback: num.format(DEFAULT_MONTHLY_QUOTAS[c.channel]),
                    })}
                  </label>
                  <input
                    id={`limit-${c.channel}`}
                    name="limit"
                    inputMode="numeric"
                    defaultValue={c.limit}
                    className={`${field} w-36`}
                  />
                </div>
                <div className="flex min-w-60 flex-1 flex-col gap-1.5">
                  <label htmlFor={`reason-${c.channel}`} className="text-[13px] font-bold text-ink">
                    {t('reasonLabel', { channel: t(`channels.${c.channel}`) })}
                  </label>
                  <input
                    id={`reason-${c.channel}`}
                    name="reason"
                    required
                    minLength={3}
                    maxLength={500}
                    className={field}
                  />
                </div>
                <Button type="submit" name="intent" value="set" variant="secondary">
                  {t('setLimit', { channel: t(`channels.${c.channel}`) })}
                </Button>
                {!c.isDefault ? (
                  <Button type="submit" name="intent" value="reset" variant="ghost">
                    {t('resetLimit', { channel: t(`channels.${c.channel}`) })}
                  </Button>
                ) : null}
              </form>
            ))
          : null}
      </section>
    </Shell>
  );
}
