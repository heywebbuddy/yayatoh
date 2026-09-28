import { pricingCurrency, pricingExample, publicFeeSchedules } from '@yayatoh/billing';
import { formatMoney, money, moneyFromDecimal } from '@yayatoh/kernel';
import { buttonClass, Card, Label, PageHeader, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SiteFooter, SiteHeader } from '@/components/marketplace/site-chrome.tsx';
import { Link } from '@/i18n/navigation.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pricingPage' });
  return { title: t('title'), description: t('description') };
}

/** The example ticket's face value, in whole units of the shown currency. */
const EXAMPLE_FACE = '25';

/**
 * Pricing and fees for organizers (M3.11a). Everything shown comes from the fee configuration
 * (`billing.fee_schedules`, the default plan), never from copy: the platform fee per paid ticket
 * in the visitor's currency (their pick, else their country's, else USD) and a worked all-in
 * example with the fee passed on and absorbed.
 */
export default async function PricingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ currency?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pricingPage');
  const fees = await publicFeeSchedules();
  // The hosting edge's country guess only picks a display currency (never tenancy or access).
  const country = (await headers()).get('x-vercel-ip-country');
  const currency = pricingCurrency(
    fees.map((f) => f.currency),
    { requested: (await searchParams).currency, country },
  );
  const fee = fees.find((f) => f.currency === currency) ?? null;
  const fmt = (minor: number) => formatMoney(money(minor, currency ?? 'USD'), locale);
  const percent = fee
    ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(
        fee.percentBps / 10_000,
      )
    : '';
  const example = fee ? pricingExample(fee, moneyFromDecimal(EXAMPLE_FACE, fee.currency).amount) : null;
  const feeSummary = !fee
    ? null
    : fee.percentBps === 0 && fee.fixedMinor === 0
      ? t('feeNone')
      : fee.fixedMinor === 0
        ? t('feePercent', { percent })
        : fee.percentBps === 0
          ? t('feeFixed', { fixed: fmt(fee.fixedMinor) })
          : t('feeBoth', { percent, fixed: fmt(fee.fixedMinor) });
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10 md:px-6">
        <PageHeader
          eyebrow={<Label>{t('eyebrow')}</Label>}
          title={t('title')}
          description={t('description')}
        />
        {fees.length > 1 ? (
          <nav aria-label={t('currencies')}>
            <ul className="flex list-none flex-wrap gap-2 p-0">
              {fees.map((f) => (
                <li key={f.currency}>
                  <Link
                    href={`/pricing?currency=${f.currency}`}
                    aria-current={f.currency === currency ? 'true' : undefined}
                    className={`inline-flex min-h-10 items-center rounded-pill border px-4 text-body ${
                      f.currency === currency
                        ? 'border-zinc-900 bg-zinc-900 text-white'
                        : 'border-zinc-200 bg-white text-zinc-700'
                    }`}
                  >
                    {f.currency}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        {fee && example ? (
          <>
            <section aria-labelledby="fee-heading" className="flex flex-col gap-3">
              <h2 id="fee-heading" className="text-section">
                {t('feeHeading', { currency: fee.currency })}
              </h2>
              <Card className="flex flex-col gap-2">
                <p className="text-[28px] leading-tight font-light tracking-[-0.03em]">{feeSummary}</p>
                <p className="text-body text-zinc-600">{t('freeTickets')}</p>
                <p className="text-body text-zinc-600">{t('noSubscription')}</p>
              </Card>
            </section>
            <section aria-labelledby="allin-heading" className="flex flex-col gap-3">
              <h2 id="allin-heading" className="text-section">
                {t('allInHeading')}
              </h2>
              <p className="text-body">{t('allInBody')}</p>
              <ul className="flex list-disc flex-col gap-1 ps-6 text-body">
                <li>{t('passOnExplained')}</li>
                <li>{t('absorbExplained')}</li>
              </ul>
              <Table
                caption={t('exampleCaption', { face: fmt(example.passOn.face.amount) })}
                rowKey={(r) => r.key}
                rows={[
                  { key: 'passOn', b: example.passOn },
                  { key: 'absorb', b: example.absorb },
                ]}
                columns={[
                  {
                    key: 'mode',
                    header: t('col.mode'),
                    cell: (r) => (r.key === 'passOn' ? t('passOn') : t('absorb')),
                  },
                  { key: 'face', header: t('col.face'), cell: (r) => fmt(r.b.face.amount) },
                  { key: 'fee', header: t('col.fee'), cell: (r) => fmt(r.b.fee.amount) },
                  { key: 'buyer', header: t('col.buyerPays'), cell: (r) => fmt(r.b.allIn.amount) },
                  { key: 'net', header: t('col.youReceive'), cell: (r) => fmt(r.b.organizerNet.amount) },
                ]}
              />
              <p className="text-caption text-zinc-600">{t('exampleNote')}</p>
            </section>
          </>
        ) : (
          <p className="text-body text-zinc-600">{t('unavailable')}</p>
        )}
        <section aria-labelledby="start-heading" className="flex flex-col gap-3">
          <h2 id="start-heading" className="text-section">
            {t('startHeading')}
          </h2>
          <p className="text-body">{t('startBody')}</p>
          <Link href="/signup" className={buttonClass('primary', 'md', 'self-start')}>
            {t('startCta')}
          </Link>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
