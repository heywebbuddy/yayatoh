import { fakeBillingCatalog, fakePortalSignature } from '@yayatoh/billing';
import { Alert, Button, buttonClass, Card, Label, PageHeader, Radio } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { testBillingSecret } from '@/server/billing.ts';
import { changeTestPlan, simulateRenewal } from './actions.ts';

/**
 * Stand-in for the billing provider's portal (M6.6a; development and CI only, a 404 elsewhere).
 * Reached only through the signed link the plan page mints; choosing a plan sends the provider's
 * webhooks to our endpoint, so the plan change reaches the org through the webhook alone.
 */
export default async function FakeBillingPortal({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const secret = testBillingSecret();
  const sp = await searchParams;
  if (!secret || !sp.customer || !sp.return || !sp.sig) notFound();
  if (!/^\/[a-z-]+\/o\/[a-z0-9-]+\/plan$/.test(sp.return)) notFound();
  if (fakePortalSignature(secret, sp.customer, sp.return) !== sp.sig) notFound();
  const t = await getTranslations('billingPortal');
  const tp = await getTranslations('billingPlan');
  const p = { locale, customer: sp.customer, returnPath: sp.return, sig: sp.sig };
  const plans = fakeBillingCatalog().products;
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-16">
      <PageHeader eyebrow={<Label>{t('eyebrow')}</Label>} title={t('title')} description={t('description')} />
      {sp.error === 'choose' ? <Alert tone="danger" title={t('chooseError')} /> : null}
      {sp.error === 'nosub' ? <Alert tone="danger" title={t('noSubscriptionError')} /> : null}
      <Card size="panel" className="flex flex-col gap-4">
        <form action={changeTestPlan.bind(null, p, 'switch')} className="flex flex-col gap-4">
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
            <legend className="mb-2 text-label uppercase text-ink-2">{t('planLegend')}</legend>
            {plans.map((x) => (
              <Radio
                key={x.id}
                name="plan"
                value={x.planKey ?? ''}
                label={tp.has(`planName.${x.planKey}`) ? tp(`planName.${x.planKey}`) : x.name}
                hint={tp('modules.count', { count: x.features.length })}
              />
            ))}
          </fieldset>
          <Button type="submit" className="w-full">
            {t('switch')}
          </Button>
        </form>
        <form action={changeTestPlan.bind(null, p, 'cancel')}>
          <Button type="submit" variant="secondary" className="w-full">
            {t('cancel')}
          </Button>
        </form>
        {/* M6.6b: what the provider sends when a renewal's payment fails, then after its last retry. */}
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 text-label uppercase text-ink-2">{t('renewalLegend')}</legend>
          <form action={simulateRenewal.bind(null, p, 'fail')}>
            <Button type="submit" variant="secondary" className="w-full">
              {t('failRenewal')}
            </Button>
          </form>
          <form action={simulateRenewal.bind(null, p, 'give_up')}>
            <Button type="submit" variant="secondary" className="w-full">
              {t('stopRetrying')}
            </Button>
          </form>
        </fieldset>
        <a href={sp.return} className={buttonClass('ghost', 'md', 'w-full')}>
          {t('back')}
        </a>
      </Card>
    </main>
  );
}
