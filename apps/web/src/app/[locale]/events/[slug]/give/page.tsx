import { randomUUID } from 'node:crypto';
import { catchUpGifts, publicGiving } from '@yayatoh/donations';
import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { formatMoney, money } from '@yayatoh/kernel';
import { Card, EmptyState, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { pageLocale } from '@/server/locale.ts';
import { giveAction } from './actions.ts';
import { GiveForm } from './give-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('donations.give');
  return { title: t('metaTitle'), robots: { index: false } };
}

type Params = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ c?: string }>;
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
  const { c } = await searchParams;
  const campaign =
    (c && UUID.test(c) ? giving.campaigns.find((x) => x.id === c) : undefined) ?? giving.campaigns[0] ?? null;
  const fmt = (minor: number, currency: string) => formatMoney(money(minor, currency), locale);
  const back = (
    <Link
      href={`/events/${slug}`}
      className="inline-flex min-h-11 items-center self-start text-body underline underline-offset-2"
    >
      {t('backToEvent')}
    </Link>
  );
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-14"
    >
      <PageHeader
        eyebrow={<Label>{ev.name}</Label>}
        title={campaign ? campaign.name : t('title')}
        description={campaign?.description ?? undefined}
      />
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
                  href={`/events/${slug}/give?c=${x.id}`}
                  aria-current={x.id === campaign.id ? 'page' : undefined}
                  className="inline-flex min-h-11 items-center rounded-pill border border-zinc-200 bg-white px-4 text-body aria-[current=page]:border-zinc-900"
                >
                  {x.name}
                </Link>
              ))}
            </nav>
          ) : null}
          <Card className="flex flex-col gap-2">
            <p className="text-body">
              {t('raised', {
                raised: fmt(campaign.raisedMinor, campaign.currency),
                goal: fmt(campaign.goalMinor, campaign.currency),
              })}
            </p>
            <progress
              className="h-2 w-full accent-zinc-900"
              max={campaign.goalMinor}
              value={Math.min(campaign.raisedMinor, campaign.goalMinor)}
              aria-label={t('progressLabel')}
            />
            <p className="text-caption text-zinc-600">{t('giftCount', { count: campaign.giftCount })}</p>
          </Card>
          <GiveForm
            key={campaign.id}
            campaign={campaign}
            action={giveAction.bind(null, slug, campaign.id, randomUUID())}
          />
        </>
      )}
      {back}
    </main>
  );
}
