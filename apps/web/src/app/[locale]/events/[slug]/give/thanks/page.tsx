import { catchUpGifts, giftReceipt } from '@yayatoh/donations';
import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { formatMoney, money } from '@yayatoh/kernel';
import { Alert, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AutoRefresh } from '@/components/auto-refresh.tsx';
import { Link } from '@/i18n/navigation.ts';
import { pageLocale } from '@/server/locale.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('donations.thanks');
  return { title: t('metaTitle'), robots: { index: false } };
}

/**
 * Where the provider's payment page returns (M4.8a): the gift's status from the signed link (no
 * donor data on the page). A payment still being confirmed refreshes itself.
 */
export default async function GiveThanksPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ g?: string }>;
}) {
  const { locale, slug } = await params;
  pageLocale(locale);
  const { g } = await searchParams;
  const target = await checkoutTarget(slug);
  const ev = target ? await publicEventBySlug(slug) : null;
  if (!target || !ev || !g) notFound();
  await catchUpGifts(target.orgId);
  const receipt = await giftReceipt(target.orgId, target.eventId, g);
  if (!receipt) notFound();
  const t = await getTranslations('donations.thanks');
  const fmt = (minor: number) => formatMoney(money(minor, receipt.currency), locale);
  const link = 'inline-flex min-h-11 items-center self-start text-body underline underline-offset-2';
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-14"
    >
      <PageHeader
        eyebrow={<Label>{ev.name}</Label>}
        title={
          receipt.status === 'paid'
            ? t('title')
            : receipt.status === 'pending'
              ? t('pendingTitle')
              : t('failedTitle')
        }
      />
      {receipt.status === 'paid' ? (
        <Alert
          tone="info"
          title={t('received', { amount: fmt(receipt.amountMinor), campaign: receipt.campaignName })}
        >
          {receipt.feeCoverMinor > 0 ? t('coveredFee', { fee: fmt(receipt.feeCoverMinor) }) : null}
        </Alert>
      ) : receipt.status === 'pending' ? (
        <>
          <AutoRefresh seconds={3} />
          <Alert tone="info" title={t('pending')} />
        </>
      ) : (
        <Alert title={t('failed')} />
      )}
      {receipt.status === 'paid' || receipt.status === 'pending' ? null : (
        <Link href={`/events/${slug}/give`} className={link}>
          {t('tryAgain')}
        </Link>
      )}
      <Link href={`/events/${slug}`} className={link}>
        {t('backToEvent')}
      </Link>
    </main>
  );
}
