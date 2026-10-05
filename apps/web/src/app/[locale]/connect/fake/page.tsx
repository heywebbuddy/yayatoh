import { Button, Card, Label, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { completeFakeOnboarding } from './actions.ts';

/** Stand-in for the provider's hosted payout onboarding (dev/preview/CI only). */
export default async function FakeConnect({
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
  if (!sp.acct || !sp.org || !sp.return) notFound();
  const t = await getTranslations('fakeConnect');
  const p = { acct: sp.acct, org: sp.org, returnUrl: sp.return };
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-16">
      <PageHeader eyebrow={<Label>{t('eyebrow')}</Label>} title={t('title')} description={t('description')} />
      <Card size="panel" className="flex flex-col gap-4">
        <p className="font-mono text-caption text-ink-2">{sp.acct}</p>
        <form action={completeFakeOnboarding.bind(null, p, 'complete')}>
          <Button type="submit" className="w-full">
            {t('complete')}
          </Button>
        </form>
        <form action={completeFakeOnboarding.bind(null, p, 'incomplete')}>
          <Button type="submit" variant="secondary" className="w-full">
            {t('incomplete')}
          </Button>
        </form>
      </Card>
    </main>
  );
}
