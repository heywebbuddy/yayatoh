import { buttonClass, Card, CardLabel, StatusDot } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { devAuthEnabled } from '@/server/session.ts';

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');
  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-24">
      <CardLabel>{t('eyebrow')}</CardLabel>
      <h1 className="text-[44px] leading-none font-light tracking-[-0.045em] md:text-display">
        {t('title')}
      </h1>
      <p className="max-w-xl text-[15px] text-zinc-600">{t('lede')}</p>
      {devAuthEnabled() ? (
        <div className="flex flex-wrap gap-3">
          <Link className={buttonClass('primary')} href="/dev/login">
            {t('demoCta')}
          </Link>
          <Link className={buttonClass('secondary')} href="/events/midwest-leadership-summit-2027">
            {t('eventCta')}
          </Link>
        </div>
      ) : null}
      <Card id="status" className="flex flex-col gap-3">
        <CardLabel>{t('statusLabel')}</CardLabel>
        <StatusDot status="success" label={t('statusOk')} />
      </Card>
      <footer className="flex flex-wrap gap-4 text-caption text-zinc-600">
        <Link href="/privacy" className="underline underline-offset-2">
          {t('privacyLink')}
        </Link>
        <Link href="/sub-processors" className="underline underline-offset-2">
          {t('subProcessorsLink')}
        </Link>
      </footer>
    </main>
  );
}
