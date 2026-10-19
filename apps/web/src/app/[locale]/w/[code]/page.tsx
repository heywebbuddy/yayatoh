import { LOCALES } from '@yayatoh/contracts';
import { guestSlideshowOpen } from '@yayatoh/gallery';
import { guestSiteTarget, type PublicSiteBlockDto, publicGuestSiteQuery } from '@yayatoh/guests';
import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { publicMedia } from '@yayatoh/media';
import { Label } from '@yayatoh/ui';
import { CalendarDays, Camera, Gift, MapPin } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { GalleryLightbox } from '@/components/gallery-lightbox.tsx';
import { Markdown } from '@/components/markdown.tsx';
import { MediaPicture } from '@/components/media-picture.tsx';
import { Link } from '@/i18n/navigation.ts';
import { galleryLabels } from '@/lib/gallery-labels.ts';
import { humanCheckWidget } from '@/server/human-check.ts';
import { ports } from '@/server/ports.ts';
import { siteAccess } from './access.ts';
import { unlockSiteAction } from './actions.ts';
import { SiteGateForm } from './gate-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('guestSite');
  // For the hosts' guests only (P4-3c): never indexed, never followed, never on the marketplace.
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

const external = 'noopener noreferrer nofollow';
/** The hosts' names and headings: an elegant serif (system fonts only, no extra download). */
const serif = '[font-family:Georgia,Cambria,"Times_New_Roman",serif]';
const pill =
  'inline-flex min-h-11 items-center gap-2 rounded-pill border border-line bg-surface px-4 text-body font-bold text-ink';
const heroChip =
  'inline-flex min-h-9 items-center gap-1.5 rounded-pill bg-white/15 px-3.5 text-[14px] font-bold text-white backdrop-blur-sm';
const card = 'rounded-panel border border-line bg-surface p-5 elevation-card';

/**
 * An event's guest website (M4.5a): `/w/{code}`, shared with the invitations. Until the visitor
 * types the password it shows the event's name and the gate, nothing else; then the hosts'
 * pages: a photo hero with the dates and place, their words, the program as a timeline (the
 * sub-events everyone is invited to, in the event's time zone), a photo strip, travel, registry
 * links and an FAQ. Phone first, every locale (the hosts' own words keep their language).
 * Unpublished or unknown: not found.
 */
export default async function GuestSitePage({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const { locale, code: raw } = await params;
  setRequestLocale(locale);
  const code = decodeURIComponent(raw).toUpperCase();
  const target = await guestSiteTarget(code);
  if (!target) notFound();
  const view = await executeQuery(
    publicGuestSiteQuery,
    { eventId: target.eventId, access: await siteAccess(code) },
    createCtx({ orgId: target.orgId, locale }),
    ports,
  ).catch((err) => {
    if (isDomainError(err) && (err.code === 'not_found' || err.code === 'module_not_enabled')) return null;
    throw err;
  });
  if (!view) notFound();
  const t = await getTranslations('guestSite');
  const lightbox = galleryLabels(await getTranslations('publicEvent.lightbox'));

  const languages = (
    <nav aria-label={t('languages')} className="border-t border-line pt-6">
      <ul className="m-0 flex list-none flex-wrap justify-center gap-x-4 gap-y-1 p-0 text-caption">
        {LOCALES.map((l) => (
          <li key={l}>
            <Link
              href={`/w/${code}`}
              locale={l}
              lang={l}
              hrefLang={l}
              aria-current={l === locale ? 'true' : undefined}
              className={`inline-flex min-h-11 items-center ${l === locale ? 'font-bold text-ink' : 'text-ink-2 underline underline-offset-2'}`}
            >
              {new Intl.DisplayNames([l], { type: 'language' }).of(l) ?? l}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );

  if (view.state === 'locked')
    return (
      <main id="main" className="flex min-h-dvh flex-col bg-canvas">
        <section className="relative isolate overflow-hidden bg-hero px-4 pt-20 pb-24 text-center text-white sm:px-6">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 start-1/2 -z-10 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-white/20 blur-[80px]"
          />
          <Label className="text-white/80">{t('invited')}</Label>
          <h1 className={`m-0 mt-3 text-[40px] leading-[1.05] font-normal sm:text-[56px] ${serif}`}>
            {view.eventName}
          </h1>
        </section>
        <div className="relative z-10 mx-auto -mt-14 flex w-full max-w-md flex-col gap-6 px-4 pb-10 sm:px-6">
          <div className={`${card} flex flex-col gap-4 p-6`}>
            <h2 className="m-0 text-section text-ink">{t('gateTitle')}</h2>
            <p className="m-0 text-body text-ink-2">{t('gateIntro')}</p>
            <SiteGateForm action={unlockSiteAction.bind(null, code)} challenge={humanCheckWidget()} />
          </div>
          {languages}
        </div>
      </main>
    );

  // M4.5b: the photo gallery, when the hosts turned it on.
  const galleryOpen =
    (await ports.entitlements.has(createCtx({ orgId: target.orgId }), 'gallery')) &&
    (await guestSlideshowOpen(target.orgId, target.eventId, await siteAccess(code)));
  // The event's own pictures: the cover becomes the hero, the gallery a photo strip. Guests who
  // passed the gate see them even when the event itself is private.
  const images = await publicMedia('event', target.eventId, { privateOk: true });
  const cover = images.find((m) => m.slot === 'cover') ?? null;
  const photos = images.filter((m) => m.slot === 'gallery').slice(0, 6);

  const tz = view.timezone;
  const when = (start: Date, end: Date) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).formatRange(start, end);
  const dayLabel = (d: Date) =>
    new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(
      d,
    );
  const dates = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).formatRange(view.startsAt, view.endsAt);
  const daysLeft = Math.ceil((view.startsAt.getTime() - Date.now()) / 86_400_000);
  const place = [view.venueName, view.city].filter(Boolean).join(', ');

  const headingOf = (b: PublicSiteBlockDto) =>
    b.heading ?? (b.kind === 'text' ? null : t(`headings.${b.kind}`));
  const sections = view.blocks.map((b, i) => ({ b, id: `section-${i + 1}`, heading: headingOf(b) }));
  const named = sections.filter((s) => s.heading);
  const programId = sections.find((s) => s.b.kind === 'program')?.id;

  return (
    <main id="main" className="flex min-h-dvh flex-col bg-canvas">
      <section
        className="relative isolate flex min-h-[520px] flex-col items-center justify-end overflow-hidden bg-hero px-4 pt-24 pb-14 text-center text-white sm:min-h-[600px] sm:px-6"
        lang={view.contentLocale}
        dir="auto"
      >
        {cover ? (
          // Dimmed under a scrim so the white names keep their contrast.
          <div className="absolute inset-0 -z-10" data-testid="guest-site-cover">
            <MediaPicture image={cover} sizes="100vw" eager className="size-full object-cover" />
            <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/40 to-black/20" />
          </div>
        ) : (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 start-1/2 -z-10 h-[460px] w-[460px] -translate-x-1/2 rounded-full bg-white/20 blur-[80px]"
          />
        )}
        <Label className="text-white/85">{view.eventName}</Label>
        <h1 className={`m-0 mt-3 max-w-3xl text-[44px] leading-[1.02] font-normal sm:text-[72px] ${serif}`}>
          {view.title}
        </h1>
        {view.intro ? (
          <p className="m-0 mt-4 max-w-xl text-[18px] leading-relaxed text-white/90">{view.intro}</p>
        ) : null}
        <ul className="m-0 mt-6 flex list-none flex-wrap justify-center gap-2 p-0">
          <li className={heroChip}>
            <CalendarDays aria-hidden="true" className="size-4" strokeWidth={2.2} />
            <time dateTime={view.startsAt.toISOString()}>{dates}</time>
          </li>
          {place ? (
            <li className={heroChip}>
              <MapPin aria-hidden="true" className="size-4" strokeWidth={2.2} />
              {place}
            </li>
          ) : null}
          <li className={heroChip}>{daysLeft > 0 ? t('daysToGo', { count: daysLeft }) : t('celebrated')}</li>
        </ul>
        <div className="mt-7 flex flex-wrap justify-center gap-2.5">
          {programId ? (
            <a
              href={`#${programId}`}
              className="inline-flex min-h-11 items-center rounded-pill bg-white px-5 text-body font-bold text-ink"
            >
              {t('seeProgram')}
            </a>
          ) : null}
          {galleryOpen ? (
            <Link
              href={`/w/${code}/gallery`}
              className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-white/60 px-5 text-body font-bold text-white"
            >
              <Camera aria-hidden="true" className="size-4" strokeWidth={2.2} />
              {t('galleryLink')}
            </Link>
          ) : null}
        </div>
      </section>

      {named.length > 1 ? (
        <nav
          aria-label={t('onThisPage')}
          className="sticky top-0 z-10 border-b border-line bg-canvas/90 backdrop-blur-md"
        >
          <ul
            className="mx-auto m-0 flex max-w-3xl list-none gap-2 overflow-x-auto p-0 px-4 py-3 sm:justify-center"
            lang={view.contentLocale}
            dir="auto"
          >
            {named.map((s) => (
              <li key={s.id} className="shrink-0">
                <a href={`#${s.id}`} className={pill}>
                  {s.heading}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-14 px-4 py-12 sm:px-6 sm:py-16">
        {view.blocks.length === 0 ? (
          <p className="m-0 text-center text-body text-ink-2">{t('empty')}</p>
        ) : null}
        {sections.map(({ b, id, heading }, index) => (
          <section
            key={id}
            id={id}
            aria-labelledby={heading ? `${id}-heading` : undefined}
            aria-label={heading ? undefined : t('headings.text')}
            className="flex scroll-mt-20 flex-col gap-6"
          >
            {heading ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <span aria-hidden="true" className="h-px w-16 bg-primary" />
                <h2
                  id={`${id}-heading`}
                  className={`m-0 text-[30px] leading-tight font-normal text-ink sm:text-[36px] ${serif}`}
                  lang={view.contentLocale}
                  dir="auto"
                >
                  {heading}
                </h2>
              </div>
            ) : null}
            {b.kind === 'text' ? (
              <div
                lang={view.contentLocale}
                dir="auto"
                className="mx-auto max-w-2xl text-center text-[17px] leading-8"
              >
                <Markdown source={b.body} className="flex flex-col gap-4 text-[17px] leading-8 text-ink-2" />
              </div>
            ) : b.kind === 'program' ? (
              <ol className="relative m-0 flex list-none flex-col gap-5 p-0 ps-8 before:absolute before:inset-y-2 before:start-3 before:w-px before:bg-line">
                {b.items.map((s, j) => {
                  const day = dayLabel(s.startsAt);
                  const newDay = j === 0 || dayLabel(b.items[j - 1]?.startsAt ?? s.startsAt) !== day;
                  return (
                    <li
                      key={`${s.name}-${s.startsAt.toISOString()}`}
                      className="relative flex flex-col gap-2"
                    >
                      {newDay ? (
                        <p className="m-0 -ms-8 ps-8 text-caption font-extrabold tracking-wide text-primary-ink uppercase">
                          {day}
                        </p>
                      ) : null}
                      <div className={`${card} relative`}>
                        <span
                          aria-hidden="true"
                          className="absolute top-6 -start-[26px] size-3 rounded-full bg-primary ring-4 ring-canvas"
                        />
                        <h3
                          className={`m-0 text-[22px] leading-tight font-normal text-ink ${serif}`}
                          lang={view.contentLocale}
                          dir="auto"
                        >
                          {s.name}
                        </h3>
                        <p className="m-0 mt-1 text-body font-semibold text-ink-2">
                          <time dateTime={s.startsAt.toISOString()}>{when(s.startsAt, s.endsAt)}</time>
                        </p>
                        {s.place || s.venueName ? (
                          <p
                            className="m-0 mt-1 flex items-center gap-1.5 text-body text-ink-2"
                            lang={view.contentLocale}
                            dir="auto"
                          >
                            <MapPin aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
                            {[s.place, [s.venueName, s.venueCity].filter(Boolean).join(', ')]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : b.kind === 'travel' ? (
              <ul
                className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2"
                lang={view.contentLocale}
                dir="auto"
              >
                {b.items.map((item, j) => (
                  <li key={`${item.title}-${j}`} className={`${card} flex flex-col gap-2`}>
                    <h3 className="m-0 text-card text-ink">{item.title}</h3>
                    {item.details ? <Markdown source={item.details} /> : null}
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel={external}
                        className="mt-auto inline-flex min-h-11 items-center self-start font-bold text-primary-ink underline underline-offset-2"
                      >
                        {t('visit', { name: item.title })}
                        <span className="sr-only"> {t('newTab')}</span>
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : b.kind === 'registry' ? (
              <ul
                className="m-0 flex list-none flex-wrap justify-center gap-3 p-0"
                lang={view.contentLocale}
                dir="auto"
              >
                {b.items.map((item, j) => (
                  <li key={`${item.url}-${j}`}>
                    <a
                      href={item.url}
                      target="_blank"
                      rel={external}
                      className="inline-flex min-h-12 items-center gap-2 rounded-pill bg-primary px-6 text-body font-bold text-on-primary"
                    >
                      <Gift aria-hidden="true" className="size-4" strokeWidth={2.2} />
                      {item.label}
                      <span className="sr-only"> {t('newTab')}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <div
                className="mx-auto flex w-full max-w-2xl flex-col gap-3"
                lang={view.contentLocale}
                dir="auto"
              >
                {b.items.map((item, j) => (
                  <details key={`${item.question}-${j}`} className={`${card} px-5 py-2`}>
                    <summary className="flex min-h-11 cursor-pointer items-center text-body font-bold text-ink">
                      {item.question}
                    </summary>
                    <div className="pb-3">
                      <Markdown source={item.answer} />
                    </div>
                  </details>
                ))}
              </div>
            )}
            {/* The photo strip follows the hosts' first block (their story). */}
            {index === 0 && photos.length > 0 ? (
              <div className="mt-4">
                <h3 className="sr-only">{t('photos')}</h3>
                <GalleryLightbox
                  images={photos}
                  labels={lightbox}
                  featureFirst
                  sizes="(min-width: 640px) 33vw, 50vw"
                  gridClassName="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3"
                  imageClassName="aspect-[4/3] size-full object-cover"
                />
              </div>
            ) : null}
          </section>
        ))}
        {languages}
      </div>
    </main>
  );
}
