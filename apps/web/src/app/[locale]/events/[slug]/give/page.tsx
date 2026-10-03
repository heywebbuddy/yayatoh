import { randomUUID } from 'node:crypto';
import { catchUpGifts, publicGiving, QR_PLACES, savedCardView } from '@yayatoh/donations';
import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { formatMoney, money } from '@yayatoh/kernel';
import { buttonClass, EmptyState, Label, ProgressBar } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { pageLocale } from '@/server/locale.ts';
import { deviceCardToken } from '@/server/saved-card.ts';
import { giveAction } from './actions.ts';
import { GiveForm } from './give-form.tsx';
import { GiveFrame, GiveHero } from './give-frame.tsx';
import { OneTap } from './one-tap.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('donations.give');
  return { title: t('metaTitle'), robots: { index: false } };
}

type Params = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ c?: string; via?: string; tap?: string }>;
};

const UUID = /^[0-9a-f-]{36}$/;

/**
 * The giving page (M4.8a), phone-first: an open campaign of a published, listed event, its goal and
 * what has been raised (totals and gift counts only: never a donor, P4-13), then the giving form.
 * Only for orgs with a connected Stripe account (P4-9): otherwise the page says giving is not open.
 */
export default async function GivePage({ params, searchParams }: Params) {
  const { locale, slug } = await params;
  pageLocale(locale);
  const target = await checkoutTarget(slug);
  const ev = target ? await publicEventBySlug(slug) : null;
  if (!target || !ev) notFound();
  const t = await getTranslations('donations.give');
  await catchUpGifts(target.orgId);
  const giving = await publicGiving(target.orgId, target.eventId);
  const { c, via, tap } = await searchParams;
  // M4.8d: opened from a QR code on the room's screen or a table card (the gift is a QR gift).
  const qr = (QR_PLACES as readonly string[]).includes(via ?? '') ? `&via=${via}` : '';
  // M4.8e: the card this device saved for this event (P4-14), for one-tap gifts.
  const cardToken = await deviceCardToken(target.eventId);
  const saved = cardToken ? await savedCardView(target.orgId, cardToken) : null;
  const card = saved?.status === 'active' && saved.eventId === target.eventId ? saved : null;
  const campaign =
    (c && UUID.test(c) ? giving.campaigns.find((x) => x.id === c) : undefined) ?? giving.campaigns[0] ?? null;
  const fmt = (minor: number, currency: string) => formatMoney(money(minor, currency), locale);
  const chip =
    'inline-flex min-h-11 items-center rounded-pill border border-line bg-surface px-4 text-body font-bold text-ink-2 glass transition-colors duration-150 hover:border-line-strong hover:text-ink aria-[current=page]:border-transparent aria-[current=page]:bg-tag aria-[current=page]:text-tag-ink';
  return (
    <GiveFrame organizer={ev.organizerName}>
      <GiveHero>
        <Label tone="inverse">{ev.name}</Label>
        <h1 className="m-0 text-[34px] leading-[1.05] font-extrabold tracking-[-0.04em] md:text-title">
          {campaign ? campaign.name : t('title')}
        </h1>
        {campaign?.description ? (
          <p className="m-0 text-[15px] leading-relaxed text-white/90">{campaign.description}</p>
        ) : null}
        {giving.available && campaign ? (
          <div className="mt-3 flex flex-col gap-2.5">
            <p className="m-0 text-[22px] leading-tight font-extrabold tracking-[-0.02em] tabular-nums">
              {t('raised', {
                raised: fmt(campaign.raisedMinor, campaign.currency),
                goal: fmt(campaign.goalMinor, campaign.currency),
              })}
            </p>
            <ProgressBar
              value={Math.min(campaign.raisedMinor, campaign.goalMinor)}
              max={campaign.goalMinor}
              label={t('progressLabel')}
              tone="success"
              className="bg-white/25"
            />
            <p className="m-0 text-body font-semibold text-white/90">
              {t('giftCount', { count: campaign.giftCount })}
            </p>
          </div>
        ) : null}
      </GiveHero>
      {!giving.available ? (
        <EmptyState title={t('unavailableTitle')} description={t('unavailableBody')} />
      ) : !campaign ? (
        <EmptyState title={t('noCampaignTitle')} description={t('noCampaignBody')} />
      ) : (
        <>
          {giving.campaigns.length > 1 ? (
            <nav aria-label={t('campaignsNav')} className="flex flex-wrap gap-2">
              {giving.campaigns.map((x) => (
                <Link
                  key={x.id}
                  href={`/events/${slug}/give?c=${x.id}${qr}`}
                  aria-current={x.id === campaign.id ? 'page' : undefined}
                  className={chip}
                >
                  {x.name}
                </Link>
              ))}
            </nav>
          ) : null}
          {card && campaign.levels.length ? (
            <OneTap slug={slug} campaign={campaign} card={card} locale={locale} failed={tap === 'failed'} />
          ) : null}
          <GiveForm
            key={campaign.id}
            campaign={campaign}
            action={giveAction.bind(null, slug, campaign.id, randomUUID(), qr ? 'qr' : 'online')}
          />
        </>
      )}
      <Link href={`/events/${slug}`} className={buttonClass('secondary', 'md', 'self-start')}>
        {t('backToEvent')}
      </Link>
    </GiveFrame>
  );
}
