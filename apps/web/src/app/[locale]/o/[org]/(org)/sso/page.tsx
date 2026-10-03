import { executeQuery } from '@yayatoh/kernel';
import { ssoSettingsQuery } from '@yayatoh/sso';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Card, EmptyState, PageHeader, StatusPill, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ConnectionForm } from '@/components/sso/connection-form.tsx';
import {
  ActionButton,
  AddDomainForm,
  CopyField,
  EnforceSwitch,
  GroupRoleSelect,
  ScimTokenPanel,
} from '@/components/sso/sso-controls.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatDate } from '@/lib/format.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { serviceProvider, ssoAvailable } from '@/server/sso.ts';
import { appOrigin } from '@/server/tenant-return.ts';
import {
  addDomainAction,
  checkDomainAction,
  createScimTokenAction,
  deleteConnectionAction,
  removeDomainAction,
  revokeScimTokenAction,
  saveConnectionAction,
  setConnectionStatusAction,
  setEnforcementAction,
  setGroupRoleAction,
  testConnectionAction,
} from './actions.ts';

const STATUS_TONE = { active: 'success', draft: 'waiting', disabled: 'neutral' } as const;
const DOMAIN_TONE = { verified: 'success', pending: 'waiting', failed: 'danger' } as const;

/**
 * Settings → Single sign-on (M6.5a): the org's identity provider (SAML or OIDC) and its test
 * sign-in, verified email domains (and requiring SSO for them), and SCIM provisioning (token,
 * groups mapped to roles). Owners and admins, with the `enterprise` module.
 */
export default async function SsoPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ test?: string; reason?: string; domain?: string }>;
}) {
  const { locale, org } = await params;
  const { test, reason, domain: domainFlag } = await searchParams;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations('sso');
  const tr = await getTranslations('roles');
  const header = <PageHeader title={t('title')} description={t('subtitle')} />;
  const help = (
    <Link href="/help/search?q=single%20sign-on" className="underline underline-offset-2">
      {t('help')}
    </Link>
  );
  if (!roleCan(data.role, 'sso:manage'))
    return (
      <>
        {header}
        <EmptyState title={t('noAccessTitle')} description={t('noAccessDescription')} action={help} />
      </>
    );
  if (!data.modules.has('enterprise'))
    return (
      <>
        {header}
        <EmptyState
          title={t('noModuleTitle')}
          description={t('noModuleDescription')}
          action={
            <Link href={`/o/${org}/plan`} className="underline underline-offset-2">
              {t('seePlan')}
            </Link>
          }
        />
      </>
    );
  if (!ssoAvailable())
    return (
      <>
        {header}
        <EmptyState title={t('unavailableTitle')} description={t('unavailableDescription')} action={help} />
      </>
    );
  const s = await executeQuery(ssoSettingsQuery, {}, data.ctx, ports);
  const f = { locale, currency: data.org.currency, timeZone: data.org.timezone };
  const day = (d: Date | null) =>
    d ? formatDate(d.toISOString(), f, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  const conn = s.connection;
  const sp = serviceProvider();
  const scimBase = `${appOrigin()}/api/scim/v2`;
  const reasonText =
    reason && /^[a-z_]{1,40}$/.test(reason) ? t(`reasons.${reason}` as 'reasons.wrong_audience') : null;
  const verifiedDomains = s.domains.filter((d) => d.status === 'verified').length;
  return (
    <>
      {header}
      {test === 'passed' ? (
        <Alert tone="success" title={t('testPassed')}>
          {domainFlag === 'unverified' ? t('testPassedDomainUnverified') : t('testPassedNext')}
        </Alert>
      ) : null}
      {test === 'failed' ? <Alert title={t('testFailed')}>{reasonText}</Alert> : null}

      <section aria-labelledby="sso-idp" className="flex flex-col gap-4">
        <h2 id="sso-idp" className="text-section">
          {t('idpTitle')}
        </h2>
        {conn ? (
          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-body font-semibold">{conn.name}</span>
              <StatusPill tone={STATUS_TONE[conn.status]} label={t(`status.${conn.status}`)} />
              <span className="text-caption text-ink-2">
                {conn.protocol === 'saml' ? t('protocolSaml') : t('protocolOidc')}
              </span>
            </div>
            <dl className="grid gap-x-6 gap-y-2 text-body sm:grid-cols-[max-content_1fr]">
              {conn.saml ? (
                <>
                  <dt className="text-ink-2">{t('entityId')}</dt>
                  <dd className="break-all font-mono text-caption">{conn.saml.entityId}</dd>
                  <dt className="text-ink-2">{t('ssoUrl')}</dt>
                  <dd className="break-all font-mono text-caption">{conn.saml.ssoUrl}</dd>
                  <dt className="text-ink-2">{t('certificate')}</dt>
                  <dd>
                    {t('certificateSummary', {
                      subject: conn.saml.certificateSubject ?? '—',
                      expires: day(conn.saml.certificateExpires),
                    })}
                  </dd>
                </>
              ) : null}
              {conn.oidc ? (
                <>
                  <dt className="text-ink-2">{t('issuer')}</dt>
                  <dd className="break-all font-mono text-caption">{conn.oidc.issuer}</dd>
                  <dt className="text-ink-2">{t('clientId')}</dt>
                  <dd className="break-all font-mono text-caption">{conn.oidc.clientId}</dd>
                </>
              ) : null}
              <dt className="text-ink-2">{t('defaultRole')}</dt>
              <dd>{tr(conn.defaultRole)}</dd>
              <dt className="text-ink-2">{t('jitShort')}</dt>
              <dd>{conn.jit ? t('on') : t('off')}</dd>
              <dt className="text-ink-2">{t('lastTest')}</dt>
              <dd>
                {conn.testedAt
                  ? conn.lastTestOk
                    ? t('lastTestPassed', { date: day(conn.testedAt) })
                    : t('lastTestFailed', { date: day(conn.testedAt) })
                  : t('neverTested')}
                {conn.testedAt && !conn.testPassed && conn.lastTestOk
                  ? ` ${t('settingsChangedSinceTest')}`
                  : ''}
              </dd>
            </dl>
            <div className="flex flex-wrap items-start gap-3">
              <ActionButton
                action={testConnectionAction.bind(null, org)}
                variant={conn.testPassed ? 'secondary' : 'primary'}
              >
                {t('testSignIn')}
              </ActionButton>
              {conn.status === 'active' ? (
                <ActionButton
                  action={setConnectionStatusAction.bind(null, org)}
                  fields={{ status: 'disabled' }}
                  saved={t('disabled')}
                >
                  {t('disable')}
                </ActionButton>
              ) : (
                <ActionButton
                  action={setConnectionStatusAction.bind(null, org)}
                  fields={{ status: 'active' }}
                  variant={conn.testPassed ? 'primary' : 'secondary'}
                  saved={t('activated')}
                >
                  {t('activate')}
                </ActionButton>
              )}
              <ActionButton action={deleteConnectionAction.bind(null, org)} variant="danger">
                {t('deleteConnection')}
              </ActionButton>
            </div>
          </Card>
        ) : (
          <EmptyState
            title={t('emptyTitle')}
            description={t('emptyDescription')}
            action={
              <a href="#sso-connection-form" className="underline underline-offset-2">
                {t('emptyAction')}
              </a>
            }
          />
        )}
        <details className="rounded-card border border-line bg-surface p-4" open={!conn}>
          <summary className="cursor-pointer text-body font-semibold">{t('spTitle')}</summary>
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-caption text-ink-2">{t('spDescription')}</p>
            <CopyField id="sp-entity" label={t('spEntityId')} value={sp.entityId} />
            <CopyField id="sp-acs" label={t('spAcs')} value={sp.acsUrl} />
            <CopyField id="sp-redirect" label={t('spRedirect')} value={sp.redirectUri} />
          </div>
        </details>
        <div id="sso-connection-form">
          <ConnectionForm
            key={conn ? `${conn.id}-${conn.testedAt?.getTime() ?? 0}` : 'new'}
            action={saveConnectionAction.bind(null, org)}
            initial={
              conn
                ? {
                    protocol: conn.protocol,
                    name: conn.name,
                    defaultRole: conn.defaultRole,
                    jit: conn.jit,
                    entityId: conn.saml?.entityId ?? '',
                    ssoUrl: conn.saml?.ssoUrl ?? '',
                    metadataUrl: conn.saml?.metadataUrl ?? '',
                    issuer: conn.oidc?.issuer ?? '',
                    clientId: conn.oidc?.clientId ?? '',
                  }
                : null
            }
          />
        </div>
      </section>

      <section aria-labelledby="sso-domains" className="flex flex-col gap-4">
        <h2 id="sso-domains" className="text-section">
          {t('domainsTitle')}
        </h2>
        <p className="text-body text-ink-2">{t('domainsDescription')}</p>
        <Card className="flex flex-col gap-4">
          <AddDomainForm action={addDomainAction.bind(null, org)} />
        </Card>
        {s.domains.length === 0 ? (
          <EmptyState
            title={t('noDomainsTitle')}
            description={t('noDomainsDescription')}
            action={
              <a href="#domain" className="underline underline-offset-2">
                {t('addDomain')}
              </a>
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {s.domains.map((d) => (
              <li key={d.id}>
                <Card className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="font-mono text-body font-semibold">{d.domain}</h3>
                    <StatusPill tone={DOMAIN_TONE[d.status]} label={t(`domainStatus.${d.status}`)} />
                    {d.enforced ? <StatusPill tone="info" label={t('enforced')} /> : null}
                  </div>
                  {d.status !== 'verified' ? (
                    <div className="flex flex-col gap-2">
                      <p className="text-caption text-ink-2">{t('recordInstructions')}</p>
                      <CopyField id={`rec-name-${d.id}`} label={t('recordName')} value={d.record.name} />
                      <CopyField id={`rec-value-${d.id}`} label={t('recordValue')} value={d.record.value} />
                      {d.failureReason ? (
                        <Alert
                          tone="warning"
                          title={t(`reasons.${d.failureReason}` as 'reasons.record_not_found')}
                        />
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-caption text-ink-2">{t('verifiedOn', { date: day(d.verifiedAt) })}</p>
                  )}
                  <div className="flex flex-wrap items-start gap-3">
                    {d.status !== 'verified' ? (
                      <ActionButton action={checkDomainAction.bind(null, org, d.id)} variant="primary">
                        {t('checkDomain', { domain: d.domain })}
                      </ActionButton>
                    ) : (
                      <EnforceSwitch
                        action={setEnforcementAction.bind(null, org, d.id)}
                        enforced={d.enforced}
                        domain={d.domain}
                      />
                    )}
                    <ActionButton action={removeDomainAction.bind(null, org, d.id)} variant="ghost">
                      {t('removeDomain', { domain: d.domain })}
                    </ActionButton>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
        {conn && conn.status !== 'active' && verifiedDomains === 0 ? (
          <p className="text-caption text-ink-2">{t('activateNeedsDomain')}</p>
        ) : null}
      </section>

      <section aria-labelledby="sso-scim" className="flex flex-col gap-4">
        <h2 id="sso-scim" className="text-section">
          {t('scimTitle')}
        </h2>
        <p className="text-body text-ink-2">{t('scimDescription')}</p>
        <Card className="flex flex-col gap-4">
          <CopyField id="scim-base" label={t('scimBaseUrl')} value={scimBase} />
          <p className="text-body">
            {s.scimToken
              ? t('tokenStatus', {
                  prefix: s.scimToken.prefix,
                  created: day(s.scimToken.createdAt),
                  used: s.scimToken.lastUsedAt ? day(s.scimToken.lastUsedAt) : t('neverUsed'),
                })
              : t('noToken')}
          </p>
          <ScimTokenPanel
            create={createScimTokenAction.bind(null, org)}
            revoke={revokeScimTokenAction.bind(null, org)}
            hasToken={s.scimToken !== null}
          />
          <p className="text-body">
            {t('scimUsers', { active: s.scimUsers.active, deprovisioned: s.scimUsers.deprovisioned })}
          </p>
        </Card>
        <h3 className="text-body font-semibold">{t('groupsTitle')}</h3>
        {s.groups.length === 0 ? (
          <EmptyState
            title={t('noGroupsTitle')}
            description={t('noGroupsDescription')}
            action={
              <a href="#scim-base" className="underline underline-offset-2">
                {t('noGroupsAction')}
              </a>
            }
          />
        ) : (
          <Table
            caption={t('groupsTitle')}
            rowKey={(g) => g.id}
            rows={s.groups}
            empty={t('noGroupsTitle')}
            columns={[
              { key: 'name', header: t('groupName'), cell: (g) => g.displayName },
              { key: 'members', header: t('groupMembers'), cell: (g) => String(g.members), mono: true },
              {
                key: 'role',
                header: t('groupRole'),
                cell: (g) => (
                  <GroupRoleSelect
                    action={setGroupRoleAction.bind(null, org, g.id)}
                    role={g.role}
                    group={g.displayName}
                  />
                ),
              },
            ]}
          />
        )}
      </section>
    </>
  );
}
