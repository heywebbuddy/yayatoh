import { agencyV2Enabled, clientAgencyBillingQuery, DEFAULT_AGENCY_COMMISSION_BPS } from '@yayatoh/billing';
import { type Ctx, executeQuery } from '@yayatoh/kernel';
import { clientCommissionStatementQuery } from '@yayatoh/payments';
import { Button, Card, SectionHeader, StatusPill } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { StepUpForm } from '@/components/step-up.tsx';
import { formatDate } from '@/lib/format.ts';
import { ports } from '@/server/ports.ts';
import { acceptAgencyBillingAction, endAgencyBillingAction } from './actions.ts';
import { CommissionStatement } from './commission-statement.tsx';

export const ratePct = (bps: number, locale: string) =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(bps / 10_000);

/**
 * M6.8a (flag `agency_v2`): the client's agency billing on its Agencies page. An agency's offer to
 * pay the plan (accept: owners and admins, step-up), the billing in force (stop), and, for finance
 * roles, the commission statement from the client's own ledger.
 */
export async function AgencyBillingSection({
  org,
  ctx,
  locale,
  timeZone,
  names,
  manage,
  finance,
}: {
  org: string;
  ctx: Ctx;
  locale: string;
  timeZone: string;
  /** Agency names by org id (the client's grants, live and past). */
  names: ReadonlyMap<string, string>;
  /** `billing:manage`: accept and stop. */
  manage: boolean;
  /** `finance:read`: the commission statement. */
  finance: boolean;
}) {
  const t = await getTranslations('agencyBilling');
  const state = await executeQuery(clientAgencyBillingQuery, {}, ctx, ports);
  const statement = finance ? await executeQuery(clientCommissionStatementQuery, {}, ctx, ports) : null;
  if (!agencyV2Enabled() && !state.current && (statement?.entries.length ?? 0) === 0) return null;
  const nameOf = (id: string) => names.get(id) ?? t('unknownAgency');
  const when = (d: Date) =>
    formatDate(
      d.toISOString(),
      { locale, currency: 'USD', timeZone },
      { year: 'numeric', month: 'short', day: 'numeric' },
    );
  const current = state.current;
  return (
    <section aria-labelledby="agency-billing" className="flex flex-col gap-4">
      <SectionHeader id="agency-billing" title={t('title')} description={t('clientIntro')} />
      {current ? (
        <Card className="flex flex-col gap-3" data-testid="agency-billing-current">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{t('activeTitle', { agency: nameOf(current.agencyOrgId) })}</h3>
            <StatusPill
              tone={state.inForce ? 'success' : 'waiting'}
              label={t(state.inForce ? 'inForce' : 'paused')}
            />
          </div>
          <p>
            {t('activeBody', {
              rate: ratePct(current.commissionBps, locale),
              date: when(current.acceptedAt),
            })}
          </p>
          {state.inForce ? null : (
            <p className="text-ink-2">{t('pausedBody', { agency: nameOf(current.agencyOrgId) })}</p>
          )}
          {manage ? (
            <StepUpForm action={endAgencyBillingAction.bind(null, org)}>
              <Button type="submit" variant="secondary" size="sm">
                {t('stop')}
              </Button>
            </StepUpForm>
          ) : (
            <p className="text-caption text-ink-2">{t('readOnly')}</p>
          )}
        </Card>
      ) : state.offers.length > 0 ? (
        state.offers.map((o) => (
          <Card key={o.agencyOrgId} className="flex flex-col gap-3" data-testid="agency-billing-offer">
            <h3 className="font-semibold">{t('offerTitle', { agency: nameOf(o.agencyOrgId) })}</h3>
            <p>
              {t('offerBody', {
                agency: nameOf(o.agencyOrgId),
                rate: ratePct(DEFAULT_AGENCY_COMMISSION_BPS, locale),
              })}
            </p>
            {manage ? (
              <StepUpForm action={acceptAgencyBillingAction.bind(null, org, o.agencyOrgId)}>
                <Button
                  type="submit"
                  size="sm"
                  aria-label={t('acceptNamed', { agency: nameOf(o.agencyOrgId) })}
                >
                  {t('accept')}
                </Button>
              </StepUpForm>
            ) : (
              <p className="text-caption text-ink-2">{t('readOnly')}</p>
            )}
          </Card>
        ))
      ) : (
        <p className="text-ink-2">{t('noOffers')}</p>
      )}
      {statement ? (
        <CommissionStatement
          statement={statement}
          names={names}
          side="client"
          locale={locale}
          timeZone={timeZone}
        />
      ) : null}
    </section>
  );
}
