import { checkoutTarget, publicEventBySlug, publicOccurrences } from '@yayatoh/events';
import { formatMoney, money } from '@yayatoh/kernel';
import { waitlistHeldBack } from '@yayatoh/orders';
import { publicSeatMap } from '@yayatoh/seating';
import { publicTicketTypes } from '@yayatoh/ticketing';
import { EmptyState, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { WaitlistJoinForm } from '@/components/waitlist-join-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { pageLocale } from '@/server/locale.ts';
import { joinWaitlistAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('waitlist');
  return { title: t('metaTitle'), robots: { index: false } };
}

type Params = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ pass?: string; date?: string }>;
};

/**
 * Join the waitlist of a sold-out pass (M3.10a), from the event page's "Join the waitlist" (a pass,
 * or a sold-out date). Only public passes that can't be bought now, are on sale, not seated and not
 * choose-your-amount are offered here; no counts or other people's details are shown.
 */
export default async function WaitlistJoinPage({ params, searchParams }: Params) {
  const { locale, slug } = await params;
  const { pass, date } = await searchParams;
  pageLocale(locale);
  const target = await checkoutTarget(slug);
  const ev = target ? await publicEventBySlug(slug) : null;
  if (!target || !ev) notFound();
  const now = new Date();
  const dates = await publicOccurrences(slug);
  const chosen = date
    ? (dates.find((d) => d.id === date && d.status === 'scheduled' && d.endsAt > now) ?? null)
    : null;
  if (dates.length > 0 && !chosen) notFound();
  const [types, heldBack, seatMap] = await Promise.all([
    publicTicketTypes(slug, now),
    waitlistHeldBack(target.orgId, target.eventId),
    publicSeatMap(target.orgId, target.eventId),
  ]);
  const seated = new Set(seatMap?.seats.map((s) => s.ticketTypeId) ?? []);
  const passes = types
    .filter((p) => !p.unlocked && !p.isDonation && !seated.has(p.id))
    .filter((p) => !chosen || p.occurrenceIds.length === 0 || p.occurrenceIds.includes(chosen.id))
    .filter(
      (p) =>
        p.availability === 'sold_out' ||
        (p.availability === 'available' && (heldBack.includes(p.id) || chosen?.soldOut === true)),
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      priceLabel: formatMoney(money(p.allInMinor, ev.currency), locale).replace(/\.00$/, ''),
      minPerOrder: p.minPerOrder,
      maxPerOrder: p.maxPerOrder,
    }));
  const t = await getTranslations('waitlist');
  const when = chosen
    ? new Intl.DateTimeFormat(locale, {
        timeZone: ev.timezone,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: 'numeric',
        minute: '2-digit',
      }).format(chosen.startsAt)
    : null;
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-16"
    >
      <PageHeader
        eyebrow={<Label>{ev.name}</Label>}
        title={t('joinTitle')}
        description={when ? t('joinDescriptionDate', { date: when }) : t('joinDescription')}
      />
      {passes.length === 0 ? (
        <EmptyState title={t('nothingToJoinTitle')} description={t('nothingToJoin')} />
      ) : (
        <WaitlistJoinForm
          passes={passes}
          initialPass={passes.some((p) => p.id === pass) ? (pass ?? null) : null}
          date={chosen?.id ?? null}
          action={joinWaitlistAction.bind(null, slug)}
        />
      )}
      <Link
        href={`/events/${slug}${chosen ? `?date=${chosen.id}` : ''}`}
        className="self-start text-body underline underline-offset-2"
      >
        {t('backToEvent')}
      </Link>
    </main>
  );
}
