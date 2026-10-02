import {
  accessTarget,
  checkoutTarget,
  type PublicEventContentDto,
  pageTarget,
  publicEventBySlug,
  publicEventContent,
  publicOccurrences,
} from '@yayatoh/events';
import { publicForm } from '@yayatoh/forms';
import { formatMoney, money } from '@yayatoh/kernel';
import { listingBySlug } from '@yayatoh/marketplace';
import { publicMedia, publicProgramMedia } from '@yayatoh/media';
import { publicRefundPolicy, waitlistHeldBack } from '@yayatoh/orders';
import { type PublicProgramDto, publicProgram } from '@yayatoh/program';
import { hasRegistration } from '@yayatoh/registration';
import { MIN_REVIEWS_FOR_RATING } from '@yayatoh/reviews';
import { publicSeatMap } from '@yayatoh/seating';
import { publicOrgProfile } from '@yayatoh/tenancy';
import { publicTicketTypes } from '@yayatoh/ticketing';
import { Alert, brandPalette, buttonClass, cx, EmptyState } from '@yayatoh/ui';
import { CalendarDays, MapPin } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  checkoutAction,
  redeemAccessCodeAction,
  requestHolderLinkAction,
} from '@/app/[locale]/events/[slug]/actions.ts';
import { AccessCodeEntry } from '@/components/access-code-entry.tsx';
import { Announcements } from '@/components/announcements.tsx';
import { BrandLink } from '@/components/brand-styled.tsx';
import { CheckoutForm } from '@/components/checkout-form.tsx';
import { DatePicker } from '@/components/date-picker.tsx';
import { EventSections } from '@/components/event-sections.tsx';
import { HolderLinkForm } from '@/components/holder-link-form.tsx';
import { fallbackOf, MediaPicture } from '@/components/media-picture.tsx';
import { ProgramSections } from '@/components/program-sections.tsx';
import { EventReviews } from '@/components/reviews/event-reviews.tsx';
import { TenantAccount } from '@/components/tenant-account.tsx';
import { ThemeSwitch } from '@/components/theme-switch.tsx';
import { VenueGuide } from '@/components/venue-guide.tsx';
import { VenueMap } from '@/components/venue-map.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatEventDateRange, formatNumber } from '@/lib/format.ts';
import { refundPolicyLines } from '@/lib/refund-policy-text.ts';
import { aggregateRatingJsonLd, eventJsonLd, jsonLdScript } from '@/lib/seo/jsonld.ts';
import { localizedPath } from '@/lib/seo/urls.ts';
import { publicDemoOverlay } from '@/server/demo.ts';
import { cachedReviews } from '@/server/public-data.ts';
import { requestHost } from '@/server/request-origin.ts';
import { openVenueMap } from '@/server/seat-finder.ts';
import { apexOrigin, eventOrigin } from '@/server/seo.ts';
import { currentTheme } from '@/server/theme.ts';
import { currentAccess } from '@/server/visitor.ts';

/**
 * The public event page, shared by the marketplace (`/events/{slug}`) and tenant sites
 * (`{org host}/events/{slug}`). On a tenant site `orgId` is the host's org (a route param set by
 * the proxy): another org's event is a 404 there, never served.
 */
export async function PublicEventView({
  locale,
  slug,
  orgId = null,
  embedded = false,
  date = null,
}: {
  locale: string;
  slug: string;
  orgId?: string | null;
  /** The chosen date of a multi-date event (`?date=`, M1.4b). */
  date?: string | null;
  /** The ticket widget (M1.11c): passes and checkout only. */
  embedded?: boolean;
}) {
  // M1.4d: an access code (signed cookie, re-checked here) may open a private event and hidden
  // passes. The ticket widget is a third-party frame without the visitor's cookie: public only.
  const live = embedded ? null : await accessTarget(slug);
  const grant = live ? await currentAccess(live.orgId, live.eventId) : null;
  let pub = await publicEventBySlug(slug);
  if (!pub) {
    // Private events are a 404 until a code opened them (codes are entered at /events/{slug}/unlock).
    if (live?.visibility !== 'private' || !grant?.unlocksEvent) notFound();
    pub = await publicEventBySlug(slug, { includePrivate: true });
    if (!pub) notFound();
  }
  const unlockedPrivate = pub.visibility === 'private';
  // Passes, stats and agenda arrive with ticketing and sessions; showcase events get a dev overlay.
  const demo = publicDemoOverlay(slug);
  const access = { unlocked: grant?.ticketTypeIds ?? [], privateOk: grant?.unlocksEvent === true };
  // Multi-date events (M1.4b): the buyer picks a date first; passes are those valid for it.
  const now = new Date();
  const dates = await publicOccurrences(slug, { includePrivate: access.privateOk });
  const chosen =
    dates.find((d) => d.id === date && d.status === 'scheduled' && !d.soldOut && d.endsAt > now) ?? null;
  const real = (await publicTicketTypes(slug, now, access)).filter(
    (p) => !chosen || p.occurrenceIds.length === 0 || p.occurrenceIds.includes(chosen.id),
  );
  const needsDate = dates.length > 0 && !chosen;
  const target = (await checkoutTarget(slug)) ?? (unlockedPrivate && live ? live : null);
  const contentTarget = (await pageTarget(slug)) ?? (unlockedPrivate && live ? live : null);
  // M5.1a: a conference sells through registration types (its own page).
  const registrationOpen = target ? await hasRegistration(target.orgId, target.eventId) : false;
  // On a tenant site the event must be the host's org's. Ownership comes from the page target
  // (published or postponed), not the checkout one: a postponed event has no checkout but is
  // still listed in its site's sitemap (M1.11d noindex guard found it 404ing there).
  if (orgId && (target ?? contentTarget)?.orgId !== orgId) notFound();
  const content: PublicEventContentDto = contentTarget
    ? await publicEventContent(contentTarget)
    : { sections: [], announcements: [] };
  // Cover and gallery (M1.4e): public events, or a private one this visitor's code opened.
  const images = contentTarget
    ? await publicMedia('event', contentTarget.eventId, { privateOk: unlockedPrivate })
    : [];
  const cover = images.find((m) => m.slot === 'cover') ?? null;
  const gallery = images.filter((m) => m.slot === 'gallery');
  // M1.4f: the real program (agenda, speakers, exhibitors, sponsors). With a date chosen, the
  // agenda shows that date's sessions and the sessions that belong to no date.
  const fullProgram: PublicProgramDto = contentTarget
    ? await publicProgram(contentTarget)
    : { sessions: [], speakers: [], exhibitors: [], sponsorTiers: [] };
  // M1.4h: speaker photos, exhibitor and sponsor logos (same visibility as the event's images).
  const programImages = contentTarget
    ? Object.fromEntries(
        await publicProgramMedia(contentTarget.orgId, contentTarget.eventId, { privateOk: unlockedPrivate }),
      )
    : {};
  const program: PublicProgramDto = chosen
    ? {
        ...fullProgram,
        sessions: fullProgram.sessions.filter((x) => x.occurrenceId === null || x.occurrenceId === chosen.id),
      }
    : fullProgram;
  const programStats = [
    { key: 'sessions', value: fullProgram.sessions.length },
    { key: 'speakers', value: fullProgram.speakers.length },
    { key: 'exhibitors', value: fullProgram.exhibitors.length },
    { key: 'sponsors', value: fullProgram.sponsorTiers.reduce((n, x) => n + x.sponsors.length, 0) },
  ].filter((x) => x.value > 0);
  const unlockedPasses = real.some((p) => p.unlocked);
  const orgProfile = target ? await publicOrgProfile(target.orgId) : null;
  // The event's refund policy (M1.6e), in the buyer's words, before they buy.
  const refundPolicy = target ? await publicRefundPolicy(target.orgId, target.eventId) : null;
  // Per-date charts (M1.7g): the chosen date's own chart when it has one, else the event plan.
  const seatMap = target
    ? await publicSeatMap(target.orgId, target.eventId, { occurrenceId: chosen?.id ?? null })
    : null;
  // M3.10a: passes whose remaining stock is kept for their waitlist read as sold out, and sold-out
  // passes (not seated, not choose-your-amount, not code-unlocked) offer "Join the waitlist".
  const heldBack = target && !embedded ? await waitlistHeldBack(target.orgId, target.eventId) : [];
  const seatedIds = new Set(seatMap?.seats.map((s) => s.ticketTypeId) ?? []);
  const waitlistHref = (p: { id: string; isDonation: boolean; unlocked: boolean }) =>
    target && !embedded && !unlockedPrivate && !p.isDonation && !p.unlocked && !seatedIds.has(p.id)
      ? `/events/${slug}/waitlist?pass=${p.id}${chosen ? `&date=${chosen.id}` : ''}`
      : null;
  // The venue map and seat finder, once the organizer opened them (M1.7e).
  const venue = target ? await openVenueMap(target.orgId, target.eventId, chosen?.id ?? null) : null;
  const brand = orgProfile?.brandColor ? brandPalette(orgProfile.brandColor) : null;
  const questions = target
    ? ((
        await publicForm(target.orgId, {
          kind: 'checkout_questions',
          subjectType: 'event',
          subjectId: target.eventId,
        })
      )?.fields ?? [])
    : [];
  const passes =
    real.length > 0
      ? real.map((p) => ({
          id: p.id,
          name: p.name,
          price: p.allInMinor,
          description: p.description ?? '',
          featured: false,
          availability:
            p.availability === 'available' && heldBack.includes(p.id)
              ? ('sold_out' as const)
              : p.availability,
          fewLeft: p.fewLeft && !heldBack.includes(p.id),
          waitlistHref:
            p.availability === 'sold_out' || (p.availability === 'available' && heldBack.includes(p.id))
              ? waitlistHref(p)
              : null,
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
          waitlistHref: null,
          maxPerOrder: 0,
          regularPrice: null,
          earlyEndsAt: null,
          isDonation: false,
          accessDates: [],
        }));
  const ev = {
    ...pub,
    passes,
    // Real data wins; showcase events keep their dev overlay until they have a program.
    stats: programStats.length > 0 ? programStats : (demo?.stats ?? []),
    agenda: program.sessions.length > 0 ? [] : (demo?.agenda ?? []),
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
  const passesSection = (
    <section
      id="passes"
      aria-labelledby="passes-heading"
      className="flex scroll-mt-4 flex-col gap-4 rounded-panel border border-line bg-surface p-5 elevation-card glass md:p-6"
    >
      <div className="flex flex-col gap-1.5">
        <h2 id="passes-heading" className="m-0 text-section text-ink">
          {t('publicEvent.choosePass')}
        </h2>
        <p className="m-0 text-body text-ink-2">{t('publicEvent.allIn', { org: ev.organizerName })}</p>
        {registrationOpen ? (
          <Link href={`/events/${slug}/register`} className={buttonClass('primary', 'md', 'self-start')}>
            {t('publicEvent.register')}
          </Link>
        ) : null}
        {chosen ? (
          <p className="m-0 text-body font-bold text-ink">
            {t('publicEvent.ticketsFor', {
              date: new Intl.DateTimeFormat(locale, {
                timeZone: ev.timezone,
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                hour: 'numeric',
                minute: '2-digit',
              }).format(chosen.startsAt),
            })}
          </p>
        ) : null}
      </div>
      {orgProfile?.checkoutPaused ? (
        <EmptyState
          className="min-w-0 flex-1"
          title={t('publicEvent.salesPausedTitle')}
          description={t('publicEvent.salesPausedDescription')}
        />
      ) : needsDate ? (
        <EmptyState
          className="min-w-0 flex-1"
          title={t('publicEvent.pickDateTitle')}
          description={t('publicEvent.pickDateDescription')}
        />
      ) : ev.passes.length === 0 && registrationOpen ? null : ev.passes.length === 0 ? (
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
          brand={brand ? { background: brand.background, text: brand.text } : null}
          questions={questions}
          seatMap={seatMap}
          occurrenceId={chosen?.id ?? null}
          // Live availability (M1.7f): the page's own host serves it (a tenant site rewrites it
          // to its org), so the stream is always this event's. Since M3.1b this URL is an alias of
          // the event's public seat channel on the shared realtime core.
          seatStream={
            seatMap
              ? {
                  url: localizedPath(
                    locale,
                    `/events/${slug}/seats/stream${chosen ? `?date=${chosen.id}` : ''}`,
                  ),
                  kind: 'public',
                }
              : null
          }
          timeZone={ev.timezone}
          action={checkoutAction.bind(null, slug)}
        />
      )}
    </section>
  );
  if (embedded) {
    // The ticket widget (M1.11c): the passes, and checkout opens on the event page in a new tab
    // (a top-level page: payment wallets and the buyer's cookies need it; third-party iframes
    // lose both).
    const req = await requestHost();
    const listing = await listingBySlug(slug);
    const eventUrl = `${eventOrigin(req, listing?.canonicalHost ?? null)}${localizedPath(locale, `/events/${slug}`)}#passes`;
    return (
      <main id="main" className="flex flex-col gap-4 bg-surface p-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] leading-7 font-extrabold tracking-[-0.02em]">{ev.name}</h1>
          <p className="text-caption text-ink-2">{[range, ev.city].filter(Boolean).join(' · ')}</p>
        </div>
        {orgProfile?.checkoutPaused ? (
          <p className="text-body text-ink-2">{t('publicEvent.salesPausedTitle')}</p>
        ) : ev.passes.length === 0 ? (
          <p className="text-body text-ink-2">{t('publicEvent.noTicketsTitle')}</p>
        ) : (
          <ul
            aria-label={t('widget.passes')}
            className="flex list-none flex-col divide-y divide-line rounded-card border border-line p-0"
          >
            {ev.passes.map((p) => (
              <li
                key={p.id ?? p.name}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <span className="text-body">{p.name}</span>
                <span className="flex items-center gap-3 text-body">
                  {p.availability === 'available' ? null : (
                    <span className="text-caption text-ink-2">
                      {t(`publicEvent.availability.${p.availability}`)}
                    </span>
                  )}
                  <span className="font-medium">{price(p.price)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <BrandLink
          href={eventUrl}
          target="_blank"
          rel="noopener"
          className={buttonClass('primary')}
          brand={brand ? { background: brand.background, text: brand.text } : null}
        >
          {t('widget.getTickets')}
          <span className="sr-only"> {t('widget.newTab')}</span>
        </BrandLink>
        {ev.poweredByVisible ? <p className="text-caption text-ink-2">{t('publicEvent.poweredBy')}</p> : null}
      </main>
    );
  }
  const listing = await listingBySlug(slug);
  const req = await requestHost();
  // M1.4g: holders' reviews (visible only); the rating reaches JSON-LD from MIN_REVIEWS_FOR_RATING.
  const reviews = target ? await cachedReviews(target.orgId, target.eventId) : null;
  const rating = reviews ? aggregateRatingJsonLd(reviews, MIN_REVIEWS_FOR_RATING) : null;
  const canonical = `${eventOrigin(req, listing?.canonicalHost ?? null)}/events/${slug}`;
  const baseLd = eventJsonLd({
    name: ev.name,
    description: ev.tagline,
    status: ev.status,
    startsAt: ev.startsAt,
    endsAt: ev.endsAt,
    venueName: ev.venueName,
    city: ev.city,
    country: listing?.country ?? null,
    attendanceMode: ev.attendanceMode,
    url: canonical,
    image: cover ? `${req.origin}${fallbackOf(cover)?.url}` : `${req.origin}/api/og/event/${slug}`,
    // M1.4h: speakers as performers, with their photo (the email/OG-safe fallback, absolute).
    performers: fullProgram.speakers.map((p) => {
      const photo = programImages[p.id];
      const url = photo ? fallbackOf(photo)?.url : undefined;
      return { name: p.name, image: url ? `${req.origin}${url}` : null };
    }),
    organizer: {
      name: ev.organizerName,
      url: `${apexOrigin(req)}/o/${orgProfile?.slug ?? listing?.orgSlug ?? ''}`,
    },
    offers: real.map((p) => ({
      name: p.name,
      priceMinor: p.allInMinor,
      currency: p.currency,
      availability: p.availability,
    })),
  });
  const ld = rating ? { ...baseLd, aggregateRating: rating } : baseLd;
  const theme = await currentTheme();
  const hasAgenda = program.sessions.length > 0 || ev.agenda.length > 0;
  // A seated checkout needs the full width for its seat map; otherwise the ticket box sits beside.
  const wide = Boolean(seatMap);
  const initials = ev.organizerName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  const navLink =
    'inline-flex min-h-10 items-center rounded-[10px] px-3 text-body font-bold text-ink-2 hover:bg-surface-3 hover:text-ink';
  const chip =
    'inline-flex min-h-8 items-center gap-2 rounded-pill border border-white/30 bg-white/15 px-3 text-[13px] font-bold';
  return (
    <div className="min-h-dvh">
      {ev.visibility === 'public' ? (
        <script
          type="application/ld+json"
          // JSON-LD must be inline; jsonLdScript escapes `<` so the text cannot close the script.
          dangerouslySetInnerHTML={{ __html: jsonLdScript(ld) }}
        />
      ) : null}
      <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-3 pt-3 pb-12 sm:px-5 sm:pt-5">
        <header className="relative z-20 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[22px] border border-line bg-surface p-2.5 ps-4 elevation-card glass">
          <span className="flex min-w-0 items-center gap-2.5 text-ink">
            <span
              aria-hidden="true"
              className="flex size-[34px] shrink-0 items-center justify-center rounded-[11px] bg-brand-strong text-[13px] font-extrabold text-white"
            >
              {initials}
            </span>
            <span className="truncate text-[17px] font-extrabold tracking-[-0.02em]">{ev.organizerName}</span>
          </span>
          <nav aria-label={t('publicEvent.nav')} className="flex grow flex-wrap gap-1">
            <a href="#passes" className={navLink}>
              {t('publicEvent.passes')}
            </a>
            {hasAgenda ? (
              <a href="#agenda" className={navLink}>
                {t('publicEvent.agenda')}
              </a>
            ) : null}
          </nav>
          <div className="flex flex-wrap items-center gap-2">
            {orgId ? (
              // M1.2f: the account corner on the org's own site (this host's session; no other org shown).
              <TenantAccount locale={locale} path={`/events/${slug}`} orgId={orgId} />
            ) : null}
            <ThemeSwitch initial={theme} />
            <a href="#passes" className={buttonClass('dark')}>
              {t('publicEvent.getTickets')}
            </a>
          </div>
        </header>

        <main id="main" className="flex flex-col gap-6">
          <section className="relative isolate flex min-h-[380px] flex-col justify-end gap-4 overflow-hidden rounded-[32px] bg-hero px-6 pt-16 pb-8 text-white elevation-card md:px-10 md:pb-10">
            {cover ? (
              // Dimmed under a dark scrim so the white text keeps its contrast.
              <div data-testid="event-cover" className="absolute inset-0 -z-10">
                <MediaPicture image={cover} sizes="100vw" eager className="size-full object-cover" />
                <div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/55 to-black/25" />
              </div>
            ) : (
              <>
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute end-[6%] -top-20 -z-10 h-[460px] w-[180px] rotate-[32deg] rounded-full bg-white/45 blur-[34px]"
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -end-16 -bottom-16 -z-10 h-[300px] w-[420px] -rotate-[16deg] rounded-[64px] bg-linear-135 from-white/50 via-primary to-primary-pressed opacity-90"
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute end-40 bottom-28 -z-10 hidden h-[140px] w-[200px] -rotate-[16deg] rounded-[40px] border border-white/40 bg-white/15 backdrop-blur-sm md:block"
                />
              </>
            )}
            <ul aria-label={t('publicEvent.facts')} className="m-0 flex list-none flex-wrap gap-2 p-0">
              <li className={chip}>
                <CalendarDays aria-hidden="true" className="size-3.5" strokeWidth={2.2} />
                {range}
              </li>
              {ev.venueSlug && ev.venueName ? (
                <li>
                  <Link
                    href={`/venues/${ev.venueSlug}`}
                    className={cx(chip, 'underline-offset-2 hover:underline')}
                  >
                    <MapPin aria-hidden="true" className="size-3.5" strokeWidth={2.2} />
                    {ev.venueName}
                  </Link>
                </li>
              ) : ev.city ? (
                <li className={chip}>
                  <MapPin aria-hidden="true" className="size-3.5" strokeWidth={2.2} />
                  {ev.city}
                </li>
              ) : null}
              {ev.category ? <li className={chip}>{t(`categories.${ev.category}`)}</li> : null}
              {ev.attendanceMode !== 'in_person' ? (
                <li className={chip}>{t(`publicEvent.mode.${ev.attendanceMode}`)}</li>
              ) : null}
              {ev.status !== 'published' ? (
                <li className="inline-flex min-h-8 items-center rounded-pill bg-brand-strong px-3 text-[13px] font-extrabold">
                  {t(`eventStatus.${ev.status}`)}
                </li>
              ) : null}
            </ul>
            <h1 className="m-0 max-w-[680px] text-[40px] leading-[1.02] font-extrabold tracking-[-0.045em] md:text-display">
              {ev.name}
            </h1>
            {ev.tagline ? (
              <p className="m-0 max-w-[540px] text-[17px] leading-relaxed text-white/90">{ev.tagline}</p>
            ) : null}
            <div className="flex flex-wrap gap-2.5 pt-1">
              <a href="#passes" className={buttonClass('inverse')}>
                {t('publicEvent.getTickets')}
              </a>
              {hasAgenda ? (
                <a href="#agenda" className={buttonClass('inverse')}>
                  {t('publicEvent.seeAgenda')}
                </a>
              ) : null}
            </div>
            {ev.stats.length > 0 ? (
              <dl className="m-0 mt-4 flex flex-wrap gap-x-12 gap-y-4">
                {ev.stats.map((s) => (
                  <div key={s.key} className="flex flex-col-reverse gap-1">
                    <dt className="text-label text-white/85 uppercase">{t(`publicEvent.stats.${s.key}`)}</dt>
                    <dd className="m-0 text-[32px] leading-none font-extrabold tracking-[-0.04em] tabular-nums">
                      {formatNumber(s.value, locale)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </section>

          <div className={cx('grid items-start gap-6', !wide && 'lg:grid-cols-[minmax(0,1fr)_400px]')}>
            <div
              className={cx(
                'flex min-w-0 flex-col gap-4',
                !wide && 'lg:sticky lg:top-4 lg:col-start-2 lg:row-start-1',
              )}
            >
              {dates.length > 0 ? (
                <section className="flex scroll-mt-4 flex-col gap-4 rounded-panel border border-line bg-surface p-5 elevation-card glass md:p-6">
                  <DatePicker
                    slug={slug}
                    dates={dates}
                    chosen={chosen?.id ?? null}
                    locale={locale}
                    timeZone={ev.timezone}
                    now={now}
                    waitlist={Boolean(target) && !unlockedPrivate && !embedded}
                  />
                </section>
              ) : null}
              {passesSection}
              {live ? (
                <section
                  aria-labelledby="access-code-heading"
                  className="flex scroll-mt-4 flex-col gap-4 rounded-panel border border-line bg-surface p-5 elevation-card glass md:p-6"
                >
                  <h2 id="access-code-heading" className="m-0 text-card">
                    {t('accessEntry.title')}
                  </h2>
                  {unlockedPasses || unlockedPrivate ? (
                    <Alert tone="info" title={t('accessEntry.active')} />
                  ) : (
                    <p className="m-0 text-body text-ink-2">{t('accessEntry.hint')}</p>
                  )}
                  <AccessCodeEntry action={redeemAccessCodeAction.bind(null, slug)} />
                </section>
              ) : null}
            </div>

            <div className="flex min-w-0 flex-col gap-5 lg:col-start-1 lg:row-start-1">
              {content.announcements.length > 0 ? (
                <section
                  aria-labelledby="announcements-heading"
                  className="flex scroll-mt-4 flex-col gap-4 rounded-panel border border-line bg-surface p-5 elevation-card glass md:p-6"
                >
                  <h2 id="announcements-heading" className="m-0 text-section">
                    {t('publicEvent.announcements')}
                  </h2>
                  <Announcements items={content.announcements} locale={locale} timeZone={ev.timezone} />
                </section>
              ) : null}

              <EventSections sections={content.sections} />

              {gallery.length > 0 ? (
                <section
                  aria-labelledby="gallery-heading"
                  className="flex scroll-mt-4 flex-col gap-4 rounded-panel border border-line bg-surface p-5 elevation-card glass md:p-6"
                >
                  <h2 id="gallery-heading" className="m-0 text-section">
                    {t('publicEvent.gallery')}
                  </h2>
                  <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
                    {gallery.map((g) => (
                      <li key={g.id}>
                        <MediaPicture
                          image={g}
                          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                          className="aspect-[4/3] w-full rounded-tile bg-surface-2 object-cover"
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <ProgramSections
                program={program}
                slug={slug}
                locale={locale}
                timeZone={ev.timezone}
                images={programImages}
              />

              {ev.agenda.length > 0 ? (
                <section
                  id="agenda"
                  aria-label={t('publicEvent.agenda')}
                  className="flex scroll-mt-4 flex-col gap-4 rounded-panel border border-line bg-surface p-5 elevation-card glass md:p-6"
                >
                  <h2 id="agenda-heading" className="m-0 text-section">
                    {t('publicEvent.agenda')}
                  </h2>
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {ev.agenda.map((s) => (
                      <li
                        key={s.time}
                        className="flex items-center gap-4 rounded-tile border border-line bg-surface-2 px-3.5 py-3"
                      >
                        <span className="w-16 shrink-0 text-[16px] font-extrabold text-ink tabular-nums">
                          {s.time}
                        </span>
                        <span className="grow text-[15px] font-bold text-ink">{s.title}</span>
                        <span className="text-caption text-ink-2">{s.room}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {reviews ? (
                <EventReviews slug={slug} summary={reviews} locale={locale} timeZone={ev.timezone} />
              ) : null}

              {venue ? (
                <section
                  id="venue"
                  aria-labelledby="venue-heading"
                  className="flex scroll-mt-4 flex-col gap-4 rounded-panel border border-line bg-surface p-5 elevation-card glass md:p-6"
                >
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <h2 id="venue-heading" className="m-0 text-section">
                        {t('venueMap.title')}
                      </h2>
                      <p className="m-0 text-body text-ink-2">{t('venueMap.description')}</p>
                    </div>
                    <Link href={`/events/${slug}/seat-finder`} className={buttonClass('primary')}>
                      {t('venueMap.findSeat')}
                    </Link>
                  </div>
                  <VenueMap doc={venue.doc} />
                  <VenueGuide doc={venue.doc} />
                </section>
              ) : null}

              <section
                aria-labelledby="hosted-heading"
                className="flex scroll-mt-4 flex-col gap-4 rounded-panel border border-line bg-surface p-5 elevation-card glass md:p-6 flex-row! flex-wrap items-center"
              >
                <span
                  aria-hidden="true"
                  className="flex size-[52px] shrink-0 items-center justify-center rounded-[16px] bg-brand-strong text-[16px] font-extrabold text-white"
                >
                  {initials}
                </span>
                <div className="flex min-w-0 grow flex-col gap-0.5">
                  <h2 id="hosted-heading" className="m-0 text-[13px] font-bold tracking-normal text-ink-2">
                    {t('publicEvent.hostedBy')}
                  </h2>
                  <p className="m-0 text-[17px] font-extrabold text-ink">{ev.organizerName}</p>
                </div>
              </section>

              {target ? (
                <section
                  aria-labelledby="have-tickets-heading"
                  className="flex scroll-mt-4 flex-col gap-4 rounded-panel border border-line bg-surface p-5 elevation-card glass md:p-6"
                >
                  <h2 id="have-tickets-heading" className="m-0 text-card">
                    {t('myTickets.requestTitle')}
                  </h2>
                  <HolderLinkForm action={requestHolderLinkAction.bind(null, slug)} />
                </section>
              ) : null}

              {refundPolicy || (orgProfile && orgProfile.legalPages.length > 0) || ev.poweredByVisible ? (
                <footer className="flex flex-col gap-3 px-1">
                  {refundPolicy ? (
                    <section aria-labelledby="refund-policy-heading" className="flex flex-col gap-2">
                      <h2 id="refund-policy-heading" className="m-0 text-card">
                        {t('refundPolicy.buyerTitle')}
                      </h2>
                      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-body text-ink-2">
                        {refundPolicyLines((k, v) => t(`refundPolicy.${k}`, v), refundPolicy, locale).map(
                          (line) => (
                            <li key={line}>{line}</li>
                          ),
                        )}
                      </ul>
                    </section>
                  ) : null}
                  {orgProfile && orgProfile.legalPages.length > 0 ? (
                    <nav aria-label={t('legal.organizerPages', { org: ev.organizerName })}>
                      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-caption">
                        {orgProfile.legalPages.map((k) => (
                          <li key={k}>
                            <Link href={`/legal/${orgProfile.slug}/${k}`} className="text-ink-2 underline">
                              {t(`settings.legal.kind.${k}`)}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </nav>
                  ) : null}
                  {ev.poweredByVisible ? (
                    <Link href="/" className="self-start text-caption text-ink-2 underline">
                      {t('publicEvent.poweredBy')}
                    </Link>
                  ) : null}
                </footer>
              ) : null}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
