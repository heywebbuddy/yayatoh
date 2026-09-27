import { formatMoney, money } from '@yayatoh/kernel';
import { Button, Card, Label, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { completeFakePayment } from './actions.ts';

/** Stand-in for the provider's hosted payment page (dev/preview/CI only). */
export default async function FakeCheckout({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!process.env.FAKE_PAYMENTS_SECRET || process.env.VERCEL_ENV === 'production') notFound();
  const sp = await searchParams;
  const { pi, org, order, amount, currency } = sp;
  if (!pi || !org || !order || !amount || !currency || !sp.return) notFound();
  const t = await getTranslations('fakePay');
  const p = { pi, org, order, amount, currency, returnUrl: sp.return };
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-16">
      <PageHeader eyebrow={<Label>{t('eyebrow')}</Label>} title={t('title')} description={t('description')} />
      <Card size="panel" className="flex flex-col gap-4">
        <p className="text-[40px] font-light tracking-[-0.04em]">
          {formatMoney(money(Number(amount), currency), locale)}
        </p>
        <form action={completeFakePayment.bind(null, p, 'succeeded')}>
          <Button type="submit" className="w-full">
            {t('pay')}
          </Button>
        </form>
        <form action={completeFakePayment.bind(null, p, 'failed')}>
          <Button type="submit" variant="secondary" className="w-full">
            {t('decline')}
          </Button>
        </form>
      </Card>
    </main>
  );
}
