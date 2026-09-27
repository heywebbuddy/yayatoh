import { publicEventBySlug } from '@yayatoh/events';
import { formatMoney, money } from '@yayatoh/kernel';
import { publicTicketTypes } from '@yayatoh/ticketing';
import { buttonClass, EmptyState } from '@yayatoh/ui';
import { Check } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CheckoutForm } from '@/components/checkout-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatEventDateRange, formatNumber } from '@/lib/format.ts';
import { publicDemoOverlay } from '@/server/demo.ts';
import { checkoutAction } from './actions.ts';

export default async function PublicEventPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const pub = await publicEventBySlug(slug);
  if (!pub) notFound();
  // Passes, stats and agenda arrive with ticketing and sessions; showcase events get a dev overlay.
  const demo = publicDemoOverlay(slug);
  const real = await publicTicketTypes(slug);
  const passes =
    real.length > 0
      ? real.map((p) => ({
          id: p.id,
          name: p.name,
          price: p.allInMinor,
          description: p.description ?? '',
          featured: false,
          availability: p.availability,
          fewLeft: p.fewLeft,
          maxPerOrder: p.maxPerOrder,
          regularPrice: p.regularAllInMinor,
          earlyEndsAt: p.earlyEndsAt,
          isDonation: p.isDonation,
          accessDates: p.accessDates,
        }))
      : (demo?.passes ?? []).map((p) => ({
          ...p,
          id: null,
          featured: Boolean(p.featured),
          availability: 'available' as const,
          fewLeft: false,
          maxPerOrder: 0,
          regularPrice: null,
          earlyEndsAt: null,
          isDonation: false,
          accessDates: [],
        }));
  const ev = {
    ...pub,
    passes,
    stats: demo?.stats ?? [],
    agenda: demo?.agenda ?? [],
  };
  const t = await getTranslations();
  const f = { locale, currency: ev.currency, timeZone: ev.timezone };
  const range = formatEventDateRange(ev.startsAt.toISOString(), ev.endsAt.toISOString(), f);
  const price = (minor: number) => formatMoney(money(minor, ev.currency), locale).replace(/\.00$/, '');
  const day = new Intl.DateTimeFormat(locale, { timeZone: ev.timezone, month: 'short', day: 'numeric' });
  const calendarDay = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return (
    <div className="min-h-dvh bg-white">
      <section className="relative m-2 overflow-hidden rounded-panel bg-black px-6 pt-28 pb-10 text-white md:px-16 md:pt-32">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -end-24 -top-10 size-[560px] rounded-full bg-[radial-gradient(circle,var(--color-accent-900)_0%,var(--color-accent-700)_38%,transparent_70%)] opacity-50 md:end-[120px]"
        />
        <header className="absolute start-1/2 top-[18px] flex -translate-x-1/2 items-center gap-5 rounded-pill bg-nav-glass py-[7px] ps-[22px] pe-[7px] text-[13px] backdrop-blur-md rtl:translate-x-1/2">
          <nav aria-label={t('publicEvent.nav')} className="hidden gap-[18px] md:flex">
            <a href="#passes" className="text-white">
              {t('publicEvent.passes')}
            </a>
            <a href="#agenda" className="text-white">
              {t('publicEvent.agenda')}
            </a>
          </nav>
          <span className="text-[19px] font-semibold tracking-[-0.04em] md:px-10">{t('brand.wordmark')}</span>
          <a href="#passes" className={buttonClass('on-dark', 'sm')}>
            {t('publicEvent.getTickets')}
          </a>
        </header>
        <div className="relative flex max-w-[620px] flex-col gap-[18px]">
          <p className="inline-flex items-center gap-2 text-[13px]">
            <Check aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
            {[range, ev.city].filter(Boolean).join(' · ')}
          </p>
          <h1 className="text-[44px] leading-none font-normal tracking-[-0.03em] md:text-[64px]">
            {ev.name}
          </h1>
          {ev.tagline ? <p className="text-[16px] leading-6 text-white/80">{ev.tagline}</p> : null}
          {ev.status !== 'published' ? (
            <p className="inline-flex self-start rounded-pill bg-glass px-3 py-1 text-caption">
              {t(`eventStatus.${ev.status}`)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2.5 pt-2">
            <a href="#passes" className={buttonClass('on-dark')}>
              {t('publicEvent.getTickets')}
            </a>
            <a href="#agenda" className={buttonClass('glass')}>
              {t('publicEvent.seeAgenda')}
            </a>
          </div>
        </div>
        {ev.stats.length > 0 ? (
          <dl className="relative mt-16 flex flex-wrap gap-x-14 gap-y-6">
            {ev.stats.map((s) => (
              <div key={s.key} className="flex flex-col-reverse gap-1">
                <dt className="font-mono text-label uppercase text-white/75">
                  {t(`publicEvent.stats.${s.key}`)}
                </dt>
                <dd className="m-0 text-[32px] font-light tracking-[-0.04em]">
                  {formatNumber(s.value, locale)}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </section>

      <section
        id="passes"
        aria-labelledby="passes-heading"
        className="flex flex-col gap-8 px-6 py-10 md:px-16 xl:flex-row"
      >
        <div className="flex max-w-[330px] shrink-0 flex-col gap-3">
          <h2 id="passes-heading" className="text-[38px] leading-[44px] font-normal tracking-[-0.03em]">
            {t('publicEvent.choosePass')}
          </h2>
          <p className="text-[15px] leading-[22px] text-zinc-500">
            {t('publicEvent.allIn', { org: ev.organizerName })}
          </p>
        </div>
        {ev.passes.length === 0 ? (
          <EmptyState
            className="min-w-0 flex-1"
            title={t('publicEvent.noTicketsTitle')}
            description={t('publicEvent.noTicketsDescription')}
          />
        ) : (
          <CheckoutForm
            passes={ev.passes.map((p) => ({
              ...p,
              priceLabel: price(p.price),
              regularPriceLabel: p.regularPrice === null ? null : price(p.regularPrice),
              // The early-bird ends at an instant; show its day in the event's timezone.
              earlyUntil: p.earlyEndsAt ? day.format(p.earlyEndsAt) : null,
              accessDates: p.accessDates.map((d) => ({
                key: d.date,
                // Access dates are calendar days (no time): format them as UTC dates.
                label: `${d.name} · ${calendarDay.format(new Date(`${d.date}T00:00:00Z`))}`,
              })),
            }))}
            organizer={ev.organizerName}
            action={checkoutAction.bind(null, slug)}
          />
        )}
      </section>

      <section
        id="agenda"
        aria-label={t('publicEvent.agenda')}
        className="flex flex-col gap-4 px-6 pb-16 md:px-16"
      >
        {ev.agenda.length > 0 ? (
          <>
            <h2 id="agenda-heading" className="text-[28px] font-normal tracking-[-0.03em]">
              {t('publicEvent.agenda')}
            </h2>
            <ul className="list-none divide-y divide-zinc-100 rounded-card border border-zinc-200 p-0">
              {ev.agenda.map((s) => (
                <li key={s.time} className="flex gap-6 px-5 py-4">
                  <span className="w-14 font-mono text-caption text-zinc-500">{s.time}</span>
                  <span className="flex-1">{s.title}</span>
                  <span className="text-caption text-zinc-500">{s.room}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {ev.poweredByVisible ? (
          <Link href="/" className="self-start text-caption text-zinc-500 underline">
            {t('publicEvent.poweredBy')}
          </Link>
        ) : null}
      </section>
    </div>
  );
}
