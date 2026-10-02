import { executeQuery } from '@yayatoh/kernel';
import { listDomainsQuery, managedHostname, roleCan } from '@yayatoh/tenancy';
import { Button, Card, PageHeader, StatusDot } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SettingsForm } from '@/components/settings-form.tsx';
import { StepUpForm } from '@/components/step-up.tsx';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import {
  addDomainAction,
  checkDomainAction,
  ensureManagedDomainAction,
  removeDomainAction,
  setPrimaryDomainAction,
} from './actions.ts';

const DOT = { pending_dns: 'info', verifying: 'info', active: 'success', failed: 'danger' } as const;

/**
 * Domains (M1.3d): the managed `{slug}` subdomain every org gets, plus custom domains taken from
 * "waiting for DNS" to active. Tenant sites are served on them from M1.11.
 */
export default async function DomainsPage({ params }: { params: Promise<{ locale: string; org: string }> }) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations('domains');
  const domains = await executeQuery(listDomainsQuery, {}, data.ctx, ports);
  const canManage = roleCan(data.role, 'org:update');
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: data.org.timezone,
  });
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {canManage && !domains.some((d) => d.managed) ? (
        <Card className="flex flex-col gap-3">
          <p className="text-body">{t('managedMissing', { host: managedHostname(org) })}</p>
          <form action={ensureManagedDomainAction.bind(null, org)}>
            <Button type="submit">{t('managedCreate')}</Button>
          </form>
        </Card>
      ) : null}
      <ul aria-label={t('listLabel')} className="flex list-none flex-col gap-3 p-0">
        {domains.map((d) => (
          <li key={d.id}>
            <Card className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <h2 className="font-mono text-body break-all">{d.hostname}</h2>
                <StatusDot status={DOT[d.status]} label={t(`status.${d.status}`)} />
                {d.isPrimary ? <span className="text-caption text-ink-2">{t('primary')}</span> : null}
                {d.managed ? <span className="text-caption text-ink-2">{t('managed')}</span> : null}
              </div>
              {d.status === 'active' ? (
                <p className="text-caption text-ink-2">
                  {d.walletsReady ? t('walletsReady') : t('walletsPending')}
                </p>
              ) : null}
              {d.status === 'failed' ? (
                <p className="text-caption text-ink-2">{t(`reason.${d.failureReason ?? 'unknown'}`)}</p>
              ) : null}
              {d.status !== 'active' && d.records.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-caption text-ink-2">{t('recordsIntro')}</p>
                  {d.status === 'pending_dns' || d.status === 'verifying' ? (
                    <p className="text-caption text-ink-2">{t('autoCheck')}</p>
                  ) : null}
                  <div className="overflow-x-auto">
                    <table className="w-full text-start text-caption">
                      <caption className="sr-only">{t('recordsCaption', { host: d.hostname })}</caption>
                      <thead>
                        <tr className="text-ink-2">
                          <th scope="col" className="py-1 pe-4 text-start font-normal">
                            {t('recordType')}
                          </th>
                          <th scope="col" className="py-1 pe-4 text-start font-normal">
                            {t('recordName')}
                          </th>
                          <th scope="col" className="py-1 text-start font-normal">
                            {t('recordValue')}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="font-mono">
                        {d.records.map((r) => (
                          <tr key={`${r.type}:${r.name}`} className="border-t border-line">
                            <td className="py-1.5 pe-4 align-top">{r.type}</td>
                            <td className="py-1.5 pe-4 align-top break-all">{r.name}</td>
                            <td className="py-1.5 align-top break-all">{r.value}</td>
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
              {canManage ? (
                <div className="flex flex-wrap gap-2">
                  {d.status !== 'active' || !d.walletsReady ? (
                    <form action={checkDomainAction.bind(null, org, d.id)}>
                      <Button type="submit" variant="secondary" size="sm">
                        {t('check')}
                        <span className="sr-only"> {d.hostname}</span>
                      </Button>
                    </form>
                  ) : null}
                  {d.status === 'active' && !d.isPrimary ? (
                    <StepUpForm action={setPrimaryDomainAction.bind(null, org, d.id)}>
                      <Button type="submit" variant="secondary" size="sm">
                        {t('makePrimary')}
                        <span className="sr-only"> {d.hostname}</span>
                      </Button>
                    </StepUpForm>
                  ) : null}
                  {!d.managed ? (
                    <StepUpForm action={removeDomainAction.bind(null, org, d.id)}>
                      <Button type="submit" variant="secondary" size="sm">
                        {t('remove')}
                        <span className="sr-only"> {d.hostname}</span>
                      </Button>
                    </StepUpForm>
                  ) : null}
                </div>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>
      {canManage ? (
        <section aria-labelledby="add-domain-heading" className="flex flex-col gap-3">
          <h2 id="add-domain-heading" className="text-section">
            {t('addTitle')}
          </h2>
          <Card>
            <SettingsForm
              action={addDomainAction.bind(null, org)}
              submitLabel={t('add')}
              savedLabel={t('added')}
            >
              <div className="flex flex-col gap-1.5">
                <label htmlFor="domain-hostname" className="text-[13px] font-bold text-ink">
                  {t('hostname')}
                </label>
                <input
                  id="domain-hostname"
                  name="hostname"
                  required
                  maxLength={253}
                  autoComplete="off"
                  spellCheck={false}
                  dir="ltr"
                  aria-describedby="domain-hostname-hint"
                  className="field font-mono"
                />
                <p id="domain-hostname-hint" className="text-caption text-ink-2">
                  {t('hostnameHint')}
                </p>
              </div>
            </SettingsForm>
          </Card>
        </section>
      ) : (
        <p className="text-caption text-ink-2">{t('noAccess')}</p>
      )}
    </>
  );
}
