import { FAKE_TEST_CARDS } from '@yayatoh/payments';
import { Button, Card, Label, PageHeader, Select } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { completeFakeSetup } from './actions.ts';

/**
 * Stand-in for the provider's hosted card step (M4.8e, dev/preview/CI only): pick a test card
 * (4242 charges; 0002 always declines; 9995 declines its first charge) and save it, or fail.
 */
export default async function FakeCardSetup({
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
  const { seti, org, ref, acct, email } = sp;
  if (!seti || !org || !ref || !acct || !email || !sp.return) notFound();
  const t = await getTranslations('fakePay');
  const p = { seti, org, ref, acct, email, returnUrl: sp.return };
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-16">
      <PageHeader
        eyebrow={<Label>{t('eyebrow')}</Label>}
        title={t('setupTitle')}
        description={t('setupDescription')}
      />
      <Card size="panel" className="flex flex-col gap-4">
        {sp.desc ? <p className="text-body text-ink-2">{sp.desc}</p> : null}
        <form action={completeFakeSetup.bind(null, p, 'succeeded')} className="flex flex-col gap-4">
          <label htmlFor="test-card" className="flex flex-col gap-1.5 text-body font-semibold text-ink">
            {t('testCard')}
            <Select id="test-card" name="card" defaultValue="4242">
              {Object.keys(FAKE_TEST_CARDS).map((c) => (
                <option key={c} value={c}>
                  {t(`card${c}` as 'card4242')}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" className="w-full">
            {t('saveCard')}
          </Button>
        </form>
        <form action={completeFakeSetup.bind(null, p, 'failed')}>
          <Button type="submit" variant="secondary" className="w-full">
            {t('failSetup')}
          </Button>
        </form>
      </Card>
    </main>
  );
}
