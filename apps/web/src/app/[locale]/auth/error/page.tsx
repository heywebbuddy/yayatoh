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
  const t = await getTranslations({ locale, namespace: 'authError' });
  return { title: t('metaTitle'), robots: { index: false } };
}

/**
 * A handoff code that can't be used (M1.2d): expired, used already, meant for another site or
 * another browser. One message for all of them (the reason is only in the audit log).
 */
export default async function AuthErrorPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('authError');
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-16">
      <PageHeader eyebrow={<Label>{t('eyebrow')}</Label>} title={t('title')} />
      <Card size="panel" className="flex flex-col gap-4">
        <p className="text-body text-ink-2">{t('description')}</p>
        <div className="flex flex-wrap gap-2">
          <Link href="/sign-in" className={buttonClass('primary')}>
            {t('signInAgain')}
          </Link>
          <Link href="/" className={buttonClass('secondary')}>
            {t('home')}
          </Link>
        </div>
      </Card>
    </main>
  );
}
