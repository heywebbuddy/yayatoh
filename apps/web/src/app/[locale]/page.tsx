import { buttonClass, Card, CardLabel, StatusDot } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-24">
      <CardLabel>{t('eyebrow')}</CardLabel>
      <h1 className="text-display">{t('title')}</h1>
      <p className="max-w-xl text-[15px] text-zinc-600">{t('lede')}</p>
      <div className="flex flex-wrap gap-3">
        <a className={buttonClass('primary')} href="#status">
          {t('primaryCta')}
        </a>
      </div>
      <Card id="status" className="flex flex-col gap-3">
        <CardLabel>{t('statusLabel')}</CardLabel>
        <StatusDot status="success" label={t('statusOk')} />
      </Card>
    </main>
  );
}
