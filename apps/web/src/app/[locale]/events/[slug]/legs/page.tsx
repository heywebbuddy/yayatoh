import { checkoutTarget, publicEventBySlug, publicOccurrences } from '@yayatoh/events';
import { publicForm } from '@yayatoh/forms';
import { formatMoney, money } from '@yayatoh/kernel';
import { publicSeatMap } from '@yayatoh/seating';
import { publicTicketTypes } from '@yayatoh/ticketing';
import { EmptyState, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { CheckoutForm } from '@/components/checkout-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { pageLocale } from '@/server/locale.ts';
import { checkoutAction, previewOrderAction } from '../actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legs');
  return { title: t('metaTitle'), robots: { index: false } };
}

type Params = { params: Promise<{ locale: string; slug: string }> };

/**
 * One seat per date ("airplane style"): a multi-date event whose dates have their own seat charts
 * lets one order take a seat on each date the buyer chooses. Every chosen date becomes its own
 * ticket (for that date, with its own seat). The ordinary one-date checkout on the event page is
 * unchanged.
 */
export default async function LegsPage({ params }: Params) {
  const { locale, slug } = await params;
  pageLocale(locale);
  const target = await checkoutTarget(slug);
  const ev = target ? await publicEventBySlug(slug) : null;
  if (!target || !ev) notFound();
  const t = await getTranslations('legs');
  const now = new Date();
  const dates = (await publicOccurrences(slug)).filter(
    (d) => d.status === 'scheduled' && !d.soldOut && d.endsAt > now,
  );
  const maps = await Promise.all(
    dates.map(async (d) => ({
      date: d,
      map: await publicSeatMap(target.orgId, target.eventId, { occurrenceId: d.id }),
    })),
  );
  const legs = maps.flatMap((m) => (m.map && m.map.seats.length > 0 ? [{ date: m.date, map: m.map }] : []));
  const when = new Intl.DateTimeFormat(locale, {
    timeZone: ev.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });
  const price = (minor: number) => formatMoney(money(minor, ev.currency), locale).replace(/\.00$/, '');
  const seatedTypes = new Set(legs.flatMap((l) => l.map.seats.map((s) => s.ticketTypeId)));
  const passes = (await publicTicketTypes(slug, now))
    .filter((p) => seatedTypes.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      priceLabel: price(p.allInMinor),
      description: p.description ?? '',
      featured: false,
      availability: p.availability,
      fewLeft: p.fewLeft,
      maxPerOrder: p.maxPerOrder,
      regularPriceLabel: null,
      earlyUntil: null,
      isDonation: false,
      accessDates: [],
      tableSize: p.tableSize,
      waitlistHref: null,
    }));
  const questions = (
    await publicForm(target.orgId, {
      kind: 'checkout_questions',
      subjectType: 'event',
      subjectId: target.eventId,
    })
  )?.fields;
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-6 py-16">
      <PageHeader eyebrow={<Label>{ev.name}</Label>} title={t('title')} description={t('description')} />
      <Link href={`/events/${slug}`} className="self-start text-body underline underline-offset-2">
        {t('back')}
      </Link>
      {legs.length < 2 ? (
        <EmptyState title={t('unavailableTitle')} description={t('unavailableDescription')} />
      ) : (
        <CheckoutForm
          passes={passes}
          organizer={ev.organizerName}
          questions={questions ?? []}
          legs={legs.map((l) => ({ id: l.date.id, label: when.format(l.date.startsAt), map: l.map }))}
          timeZone={ev.timezone}
          action={checkoutAction.bind(null, slug)}
          preview={previewOrderAction.bind(null, slug)}
        />
      )}
    </main>
  );
}
