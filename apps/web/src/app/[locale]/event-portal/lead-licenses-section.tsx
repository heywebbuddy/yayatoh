import { randomUUID } from 'node:crypto';
import { formatMoney, money } from '@yayatoh/kernel';
import type { PortalLeadLicensesDto } from '@yayatoh/program';
import { Alert, Button, Card, SectionHeader, StatusPill } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { ProgramForm } from '@/components/program-form.tsx';
import { assignLicenseAction, releaseLicenseAction } from './exhibitor-actions.ts';
import { buyLicensesAction } from './sponsor-actions.ts';

/**
 * Lead licenses in the exhibitor portal (M5.4b, P5-4): how many the exhibitor has (included,
 * from its sponsor package, bought) and who holds one. The admin gives and takes back licenses
 * and buys extra ones (the organizer's add-on, paid on the provider's page); staff see their own.
 */
export async function LeadLicensesSection({
  leads,
  locale,
  eventName,
  paid,
}: {
  leads: PortalLeadLicensesDto;
  locale: string;
  eventName: string;
  paid: boolean;
}) {
  const t = await getTranslations('leadLicenses');
  const l = leads.licenses;
  const admin = leads.role === 'exhibitor_admin';
  return (
    <section aria-labelledby="licenses-heading" className="flex flex-col gap-3">
      <SectionHeader id="licenses-heading" title={t('portalHeading')} />
      {paid ? <Alert tone="info" title={t('paidTitle')} /> : null}
      <p className="m-0 text-body tabular-nums" role="status">
        {t('portalSummary', { used: l.used, allowance: l.allowance })}
      </p>
      <p className="m-0 text-caption text-ink-2 tabular-nums">
        {t('portalBreakdown', { included: l.included, packages: l.fromPackages, purchased: l.purchased })}
      </p>
      {!admin ? (
        <p className="m-0 text-body">{leads.mine ? t('youHaveOne') : t('youHaveNone')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {leads.people.map((p) => (
            <li key={p.accountId}>
              <Card className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate text-body font-bold text-ink">{p.email}</span>
                  <StatusPill
                    tone={p.licensed ? 'success' : 'neutral'}
                    label={p.licensed ? t('licensed') : t('notLicensed')}
                  />
                </span>
                {p.licensed ? (
                  <form action={releaseLicenseAction.bind(null, p.accountId)}>
                    <Button type="submit" variant="ghost" size="sm">
                      {t('takeBack', { email: p.email })}
                    </Button>
                  </form>
                ) : (
                  <ProgramForm
                    action={assignLicenseAction.bind(null, p.accountId)}
                    idPrefix={`license-${p.accountId}`}
                    fields={[]}
                    submitLabel={t('give', { email: p.email })}
                    successLabel={t('given')}
                    errors={{ licenses_used: t('errors.used'), already_licensed: t('errors.already') }}
                  />
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {admin && leads.pendingUntil ? <Alert tone="info" title={t('pendingTitle')} /> : null}
      {admin && leads.price && !leads.pendingUntil ? (
        <Card size="panel" className="flex flex-col gap-3">
          <h3 className="m-0 text-card text-ink">{t('buyHeading')}</h3>
          <p className="m-0 text-caption text-ink-2">
            {t('buyHint', { price: formatMoney(money(leads.price.unitMinor, leads.price.currency), locale) })}
          </p>
          <ProgramForm
            action={buyLicensesAction.bind(null, `${t('orderName')} · ${eventName}`, randomUUID())}
            idPrefix="buy-licenses"
            fields={[
              { kind: 'number', name: 'quantity', label: t('quantity'), required: true, defaultValue: '1' },
            ]}
            submitLabel={t('buy')}
            successLabel={t('redirecting')}
            errors={{
              quantity: t('errors.quantity'),
              too_many: t('errors.tooMany'),
              not_for_sale: t('errors.notForSale'),
              purchase_pending: t('errors.pending'),
            }}
          />
        </Card>
      ) : null}
    </section>
  );
}
