import { buttonClass, Card, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'accountDeleted' });
  return { title: t('metaTitle'), robots: { index: false } };
}

/** After an account deletion (M1.14e): what happened, and that the person can come back. */
export default async function AccountDeletedPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('accountDeleted');
  return (
    <main id="main" className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12 md:px-6">
      <PageHeader eyebrow={<Label>{t('eyebrow')}</Label>} title={t('title')} description={t('description')} />
      <Card className="flex flex-col gap-3">
        <ul className="flex list-disc flex-col gap-1 ps-5 text-body text-ink-2">
          <li>{t('email')}</li>
          <li>{t('orders')}</li>
          <li>{t('comeBack')}</li>
        </ul>
        <div className="flex flex-wrap gap-2">
          <Link href="/" className={buttonClass('secondary', 'sm')}>
            {t('home')}
          </Link>
          <Link href="/sign-in" className={buttonClass('ghost', 'sm')}>
            {t('signIn')}
          </Link>
        </div>
      </Card>
    </main>
  );
}
