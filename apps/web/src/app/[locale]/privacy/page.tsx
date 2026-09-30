import { Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PRIVACY_SECTIONS, PRIVACY_UPDATED } from '@/content/sub-processors.ts';
import { Link } from '@/i18n/navigation.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'privacyNotice' });
  return { title: t('title') };
}

/**
 * Yayatoh's own privacy notice (M1.14c): the platform as controller (accounts, marketplace,
 * fraud prevention) and as processor for organizers. DRAFT text marked for counsel.
 */
export default async function PrivacyNoticePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('privacyNotice');
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-6 py-16">
      <PageHeader
        eyebrow={<Label>{t('eyebrow')}</Label>}
        title={t('title')}
        description={t('updated', {
          date: new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
            new Date(`${PRIVACY_UPDATED}T00:00:00Z`),
          ),
        })}
      />
      <p
        role="note"
        className="rounded-card border border-accent-700 bg-accent-50 px-4 py-3 text-body text-accent-text"
      >
        {t('draft')}
      </p>
      <p className="text-body">{t('intro')}</p>
      {PRIVACY_SECTIONS.map((s) => (
        <section key={s} aria-labelledby={`privacy-${s}`} className="flex flex-col gap-2">
          <h2 id={`privacy-${s}`} className="text-section">
            {t(`sections.${s}.title`)}
          </h2>
          <p className="text-body whitespace-pre-line">{t(`sections.${s}.body`)}</p>
        </section>
      ))}
      <p className="text-body">
        <Link href="/sub-processors" className="underline underline-offset-2">
          {t('subProcessorsLink')}
        </Link>
      </p>
    </main>
  );
}
