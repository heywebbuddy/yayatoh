import { agencyClientsQuery } from '@yayatoh/agency';
import { agencyBilledClientsQuery, agencyV2Enabled, DEFAULT_AGENCY_COMMISSION_BPS } from '@yayatoh/billing';
import { executeQuery } from '@yayatoh/kernel';
import { agencyCommissionStatementQuery } from '@yayatoh/payments';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Button, EmptyState, SectionHeader, StatusPill, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StepUpForm } from '@/components/step-up.tsx';
import { ports } from '@/server/ports.ts';
import { ratePct } from '../../agencies/agency-billing-section.tsx';
import { CommissionStatement } from '../../agencies/commission-statement.tsx';
import { offerAgencyBillingAction, withdrawAgencyBillingAction } from '../actions.ts';
import { loadAgency } from '../load.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('agency');
  return { title: t('tab.billing') };
}

/**
 * Agency billing (M6.8a, flag `agency_v2`): offer to pay a client's plan (owners and admins,
 * step-up) or withdraw the offer; see which clients accepted and at what commission; and, for the
 * agency's finance roles, the commission statement from the agency's own ledger.
 */
export default async function AgencyBillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ offered?: string; withdrawn?: string }>;
}) {
  const { locale, org } = await params;
  const { offered, withdrawn } = await searchParams;
  setRequestLocale(locale);
  if (!agencyV2Enabled()) notFound();
  const { data, canRead } = await loadAgency(org);
  if (!canRead) return null;
  const t = await getTranslations('agencyBilling');
  const manage = roleCan(data.role, 'billing:manage');
  const finance = roleCan(data.role, 'finance:read');
  const clients = await executeQuery(agencyClientsQuery, {}, data.ctx, ports);
  const billed = new Map(
    (await executeQuery(agencyBilledClientsQuery, {}, data.ctx, ports)).map((b) => [b.clientOrgId, b]),
  );
  const names = new Map(clients.map((c) => [c.clientOrgId, c.name]));
  const statement = finance ? await executeQuery(agencyCommissionStatementQuery, {}, data.ctx, ports) : null;
  const confirmed = offered ?? withdrawn;
  const confirmedName = confirmed ? names.get(confirmed) : undefined;
  return (
    <div className="flex flex-col gap-6">
      {confirmedName ? (
        <Alert tone="success" title={t(offered ? 'offered' : 'withdrawn', { client: confirmedName })} />
      ) : null}
      <section aria-labelledby="agency-billing-clients" className="flex flex-col gap-4">
        <SectionHeader
          id="agency-billing-clients"
          title={t('clientsTitle')}
          description={t('agencyIntro', { rate: ratePct(DEFAULT_AGENCY_COMMISSION_BPS, locale) })}
        />
        {!manage ? <p className="text-caption text-ink-2">{t('managerReadOnly')}</p> : null}
        {clients.length === 0 ? (
          <EmptyState title={t('noClientsTitle')} description={t('noClients', { address: data.org.slug })} />
        ) : (
          <Table
            caption={t('clientsTitle')}
            rowKey={(c) => c.clientOrgId}
            rows={clients}
            empty=""
            columns={[
              {
                key: 'client',
                header: t('clientColumn'),
                cell: (c) => <span className="font-semibold">{c.name}</span>,
              },
              {
                key: 'status',
                header: t('statusColumn'),
                cell: (c) => {
                  const b = billed.get(c.clientOrgId);
                  return b?.acceptedAt && b.commissionBps !== null ? (
                    <StatusPill
                      tone="success"
                      label={t('statusActive', { rate: ratePct(b.commissionBps, locale) })}
                    />
                  ) : b?.offeredAt ? (
                    <StatusPill tone="waiting" label={t('statusOffered')} />
                  ) : (
                    <StatusPill tone="neutral" label={t('statusNone')} />
                  );
                },
              },
              ...(manage
                ? [
                    {
                      key: 'actions',
                      header: t('actionsColumn'),
                      align: 'end' as const,
                      cell: (c: (typeof clients)[number]) =>
                        billed.get(c.clientOrgId)?.offeredAt ? (
                          <StepUpForm action={withdrawAgencyBillingAction.bind(null, org, c.clientOrgId)}>
                            <Button
                              type="submit"
                              variant="secondary"
                              size="sm"
                              aria-label={t('withdrawNamed', { client: c.name })}
                            >
                              {t('withdraw')}
                            </Button>
                          </StepUpForm>
                        ) : (
                          <StepUpForm action={offerAgencyBillingAction.bind(null, org, c.clientOrgId)}>
                            <Button type="submit" size="sm" aria-label={t('offerNamed', { client: c.name })}>
                              {t('offer')}
                            </Button>
                          </StepUpForm>
                        ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </section>
      {statement ? (
        <CommissionStatement
          statement={statement}
          names={names}
          side="agency"
          locale={locale}
          timeZone={data.org.timezone}
        />
      ) : (
        <p className="text-caption text-ink-2">{t('noStatementAccess')}</p>
      )}
    </div>
  );
}
