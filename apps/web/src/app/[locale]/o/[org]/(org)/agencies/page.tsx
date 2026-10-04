import { executeQuery } from '@yayatoh/kernel';
import { listAgencyGrantsQuery, roleCan } from '@yayatoh/tenancy';
import { Alert, Button, buttonClass, EmptyState, PageHeader, StatusPill, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StepUpForm } from '@/components/step-up.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatDate } from '@/lib/format.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { grantAgencyAction, revokeAgencyAction, setAgencyFinanceAction } from './actions.ts';
import { AgencyGrantForm } from './agency-grant-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('agencies');
  return { title: t('title') };
}

/**
 * Agencies (M6.7a): the client gives an agency access (a role ceiling, money only by explicit
 * opt-in), sees who has access, and revokes it at any time. Owners and admins manage; members who
 * may see the team (`members:read`) see the list.
 */
export default async function AgenciesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ revoked?: string }>;
}) {
  const { locale, org } = await params;
  const { revoked } = await searchParams;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations('agencies');
  const tb = await getTranslations('billingPlan');
  if (!roleCan(data.role, 'members:read'))
    return (
      <>
        <PageHeader title={t('title')} description={t('subtitle')} />
        <EmptyState
          title={t('noAccessTitle')}
          description={t('noAccessDescription')}
          action={
            <Link href={`/o/${org}/team`} className={buttonClass('primary', 'md')}>
              {tb('findOwner')}
            </Link>
          }
        />
      </>
    );
  const manage = roleCan(data.role, 'members:manage');
  const grants = await executeQuery(listAgencyGrantsQuery, {}, data.ctx, ports);
  const f = { locale, currency: data.org.currency, timeZone: data.org.timezone };
  const when = (d: Date | null) =>
    d ? formatDate(d.toISOString(), f, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  const nameOf = (g: { agencyName: string | null }) => g.agencyName ?? t('unknownAgency');
  const justRevoked = revoked ? grants.revoked.find((g) => g.id === revoked) : undefined;
  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      {justRevoked ? <Alert tone="success" title={t('revoked', { agency: nameOf(justRevoked) })} /> : null}
      {manage ? <AgencyGrantForm action={grantAgencyAction.bind(null, org)} /> : null}
      <Table
        caption={t('listTitle')}
        captionHidden={false}
        rowKey={(g) => g.id}
        rows={grants.live}
        empty={manage ? t('empty') : t('emptyReadOnly')}
        columns={[
          {
            key: 'agency',
            header: t('agencyColumn'),
            cell: (g) => (
              <span className="flex flex-col">
                <span className="font-semibold">{nameOf(g)}</span>
                {g.agencySlug ? (
                  <span dir="ltr" className="font-mono text-caption text-ink-2">
                    {g.agencySlug}
                  </span>
                ) : null}
              </span>
            ),
          },
          { key: 'role', header: t('roleColumn'), cell: (g) => t('roleLabel', { role: g.role }) },
          {
            key: 'finance',
            header: t('financeColumn'),
            cell: (g) =>
              g.finance ? (
                <StatusPill tone="waiting" label={t('financeOn')} />
              ) : (
                <StatusPill tone="neutral" label={t('financeOff')} />
              ),
          },
          { key: 'since', header: t('grantedColumn'), cell: (g) => when(g.grantedAt), mono: true },
          ...(manage
            ? [
                {
                  key: 'actions',
                  header: t('actions'),
                  align: 'end' as const,
                  cell: (g: (typeof grants.live)[number]) => (
                    <span className="flex flex-wrap justify-end gap-2">
                      <StepUpForm action={setAgencyFinanceAction.bind(null, org, g.id, g.role, !g.finance)}>
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          aria-label={t(g.finance ? 'financeDisableNamed' : 'financeEnableNamed', {
                            agency: nameOf(g),
                          })}
                        >
                          {t(g.finance ? 'financeDisable' : 'financeEnable')}
                        </Button>
                      </StepUpForm>
                      <StepUpForm action={revokeAgencyAction.bind(null, org, g.id)}>
                        <Button
                          type="submit"
                          variant="secondary"
                          size="sm"
                          aria-label={t('revokeNamed', { agency: nameOf(g) })}
                        >
                          {t('revoke')}
                        </Button>
                      </StepUpForm>
                    </span>
                  ),
                },
              ]
            : []),
        ]}
      />
      {grants.revoked.length > 0 ? (
        <Table
          caption={t('historyTitle')}
          captionHidden={false}
          rowKey={(g) => g.id}
          rows={grants.revoked}
          empty=""
          columns={[
            { key: 'agency', header: t('agencyColumn'), cell: (g) => nameOf(g) },
            { key: 'role', header: t('roleColumn'), cell: (g) => t('roleLabel', { role: g.role }) },
            { key: 'since', header: t('grantedColumn'), cell: (g) => when(g.grantedAt), mono: true },
            { key: 'ended', header: t('revokedColumn'), cell: (g) => when(g.revokedAt), mono: true },
          ]}
        />
      ) : null}
    </>
  );
}
