import { catchUpGifts, giftReceipt } from '@yayatoh/donations';
import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { formatMoney, money } from '@yayatoh/kernel';
import { buttonClass, cx, Label } from '@yayatoh/ui';
import { CircleAlert, Clock, HeartHandshake } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AutoRefresh } from '@/components/auto-refresh.tsx';
import { Link } from '@/i18n/navigation.ts';
import { pageLocale } from '@/server/locale.ts';
import { GiveFrame, GiveHero, giveCard } from '../give-frame.tsx';

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
  const icon = 'flex size-12 items-center justify-center rounded-tile [&_svg]:size-6';
  const actions = (
    <div className="flex flex-wrap gap-3">
      {receipt.status === 'paid' || receipt.status === 'pending' ? null : (
        <Link href={`/events/${slug}/give`} className={buttonClass('primary')}>
          {t('tryAgain')}
        </Link>
      )}
      <Link href={`/events/${slug}`} className={buttonClass('secondary')}>
        {t('backToEvent')}
      </Link>
    </div>
  );
  return (
    <GiveFrame organizer={ev.organizerName}>
      {receipt.status === 'paid' ? (
        <GiveHero>
          <span aria-hidden="true" className={cx(icon, 'mb-1 bg-white/15')}>
            <HeartHandshake strokeWidth={2} />
          </span>
          <Label tone="inverse">{ev.name}</Label>
          <h1 className="m-0 text-[34px] leading-[1.05] font-extrabold tracking-[-0.04em] md:text-title">
            {t('title')}
          </h1>
          <p className="m-0 text-[17px] leading-relaxed font-semibold">
            {t('received', { amount: fmt(receipt.amountMinor), campaign: receipt.campaignName })}
          </p>
          {receipt.feeCoverMinor > 0 ? (
            <p className="m-0 text-body text-white/90">
              {t('coveredFee', { fee: fmt(receipt.feeCoverMinor) })}
            </p>
          ) : null}
        </GiveHero>
      ) : (
        <section className={cx(giveCard, 'md:p-6')}>
          {receipt.status === 'pending' ? <AutoRefresh seconds={3} /> : null}
          <span
            aria-hidden="true"
            className={cx(
              icon,
              'mb-1',
              receipt.status === 'pending' ? 'bg-warning-soft text-warning' : 'bg-danger-soft text-danger',
            )}
          >
            {receipt.status === 'pending' ? <Clock strokeWidth={2} /> : <CircleAlert strokeWidth={2} />}
          </span>
          <Label>{ev.name}</Label>
          <h1 className="m-0 text-[30px] leading-[1.08] font-extrabold tracking-[-0.035em] text-ink">
            {receipt.status === 'pending' ? t('pendingTitle') : t('failedTitle')}
          </h1>
          <p
            role={receipt.status === 'pending' ? 'status' : 'alert'}
            className="m-0 text-[15px] leading-relaxed text-ink-2"
          >
            {receipt.status === 'pending' ? t('pending') : t('failed')}
          </p>
        </section>
      )}
      {actions}
    </GiveFrame>
  );
}
