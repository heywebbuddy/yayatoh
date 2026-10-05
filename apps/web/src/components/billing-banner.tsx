import { billingStandingOf } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import { organizationBrandTx } from '@yayatoh/tenancy';
import { buttonClass } from '@yayatoh/ui';
import { CreditCard } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/**
 * Dunning (M6.6b): on every console page of an org whose renewal failed. In grace it says writes
 * stop on a date; once read-only it says what still works and links to the plan page to pay.
 * Nothing (and no database read) while billing is switched off.
 */
export async function BillingBanner({
  orgId,
  locale,
  timeZone,
}: {
  orgId: string;
  locale: string;
  timeZone?: string;
}) {
  const s = await billingStandingOf(orgId).catch(() => null);
  if (!s || s.standing === 'good') return null;
  const org = await withTenant(
    createCtx({ orgId, actor: { type: 'system', name: 'billing:banner' } }),
    (tx) => organizationBrandTx(tx, orgId),
  );
  const t = await getTranslations('billingBanner');
  const grace = s.standing === 'grace';
  const date = s.readOnlyFrom
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone }).format(s.readOnlyFrom)
    : '';
  return (
    <section
      aria-label={t('label')}
      data-testid="billing-banner"
      data-standing={s.standing}
      className={
        grace
          ? 'flex flex-wrap items-start gap-3 border-b border-warning/30 bg-warning-soft px-4 py-3 text-ink md:px-8'
          : 'flex flex-wrap items-start gap-3 border-b border-danger/30 bg-danger-soft px-4 py-3 text-ink md:px-8'
      }
    >
      <CreditCard aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <p className="m-0 text-body font-medium">{t(grace ? 'graceTitle' : 'readOnlyTitle')}</p>
        <p className="m-0 text-body">{grace ? t('graceBody', { date }) : t('readOnlyBody')}</p>
      </div>
      {org ? (
        <a href={`/${locale}/o/${org.slug}/plan`} className={buttonClass('secondary', 'sm')}>
          {t('action')}
        </a>
      ) : null}
    </section>
  );
}
