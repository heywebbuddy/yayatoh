import { LOCALES } from '@yayatoh/contracts';
import { guestSiteTarget, type PublicSiteBlockDto, publicGuestSiteQuery } from '@yayatoh/guests';
import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Markdown } from '@/components/markdown.tsx';
import { Link } from '@/i18n/navigation.ts';
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
const linkClass =
  'inline-flex min-h-11 items-center gap-1 font-bold text-primary-ink underline underline-offset-2';

/**
 * An event's guest website (M4.5a): `/w/{code}`, shared with the invitations. Until the visitor
 * types the password it shows the event's name and the gate, nothing else; then the hosts'
 * blocks: their words, the program (sub-events everyone is invited to, in the event's time
 * zone), travel, registry links and an FAQ. Phone first, every locale (the hosts' own words keep
 * their language). Unpublished or unknown: not found.
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

  const languages = (
    <nav aria-label={t('languages')} className="border-t border-line pt-6">
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-caption">
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
      <main
        id="main"
        className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-14"
      >
        <PageHeader
          eyebrow={<Label>{view.eventName}</Label>}
          title={t('gateTitle')}
          description={t('gateIntro')}
        />
        <SiteGateForm action={unlockSiteAction.bind(null, code)} challenge={humanCheckWidget()} />
        {languages}
      </main>
    );

  const when = (start: Date, end: Date) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: view.timezone,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).formatRange(start, end);
  const headingOf = (b: PublicSiteBlockDto) =>
    b.heading ?? (b.kind === 'text' ? null : t(`headings.${b.kind}`));
  const sections = view.blocks.map((b, i) => ({ b, id: `section-${i + 1}`, heading: headingOf(b) }));
  const named = sections.filter((s) => s.heading);

  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-14"
    >
      <div lang={view.contentLocale} dir="auto">
        <PageHeader
          eyebrow={<Label>{view.eventName}</Label>}
          title={view.title}
          description={view.intro ?? undefined}
        />
      </div>
      {named.length > 1 ? (
        <nav aria-label={t('onThisPage')}>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0" lang={view.contentLocale} dir="auto">
            {named.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="inline-flex min-h-11 items-center rounded-pill border border-line bg-surface px-4 text-body font-bold text-ink"
                >
                  {s.heading}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {view.blocks.length === 0 ? <p className="m-0 text-body text-ink-2">{t('empty')}</p> : null}
      {sections.map(({ b, id, heading }) => (
        <section
          key={id}
          id={id}
          aria-labelledby={heading ? `${id}-heading` : undefined}
          aria-label={heading ? undefined : t('headings.text')}
          className="flex scroll-mt-6 flex-col gap-4"
        >
          {heading ? (
            <h2
              id={`${id}-heading`}
              className="m-0 text-section text-ink"
              lang={view.contentLocale}
              dir="auto"
            >
              {heading}
            </h2>
          ) : null}
          {b.kind === 'text' ? (
            <div lang={view.contentLocale} dir="auto">
              <Markdown source={b.body} />
            </div>
          ) : b.kind === 'program' ? (
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {b.items.map((s) => (
                <li
                  key={`${s.name}-${s.startsAt.toISOString()}`}
                  className="flex flex-col gap-1 rounded-panel border border-line bg-surface p-5 elevation-card"
                >
                  <h3 className="m-0 text-card text-ink" lang={view.contentLocale} dir="auto">
                    {s.name}
                  </h3>
                  <p className="m-0 text-body font-semibold text-ink-2">
                    <time dateTime={s.startsAt.toISOString()}>{when(s.startsAt, s.endsAt)}</time>
                  </p>
                  {s.place || s.venueName ? (
                    <p className="m-0 text-body text-ink-2" lang={view.contentLocale} dir="auto">
                      {[s.place, [s.venueName, s.venueCity].filter(Boolean).join(', ')]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : b.kind === 'travel' ? (
            <ul className="m-0 flex list-none flex-col gap-3 p-0" lang={view.contentLocale} dir="auto">
              {b.items.map((item, j) => (
                <li
                  key={`${item.title}-${j}`}
                  className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-5 elevation-card"
                >
                  <h3 className="m-0 text-card text-ink">{item.title}</h3>
                  {item.details ? <Markdown source={item.details} /> : null}
                  {item.url ? (
                    <a href={item.url} target="_blank" rel={external} className={`${linkClass} self-start`}>
                      {t('visit', { name: item.title })}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : b.kind === 'registry' ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0" lang={view.contentLocale} dir="auto">
              {b.items.map((item, j) => (
                <li key={`${item.url}-${j}`}>
                  <a href={item.url} target="_blank" rel={external} className={linkClass}>
                    {item.label}
                    <span className="sr-only"> {t('newTab')}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col gap-2" lang={view.contentLocale} dir="auto">
              {b.items.map((item, j) => (
                <details
                  key={`${item.question}-${j}`}
                  className="rounded-panel border border-line bg-surface px-5 py-2 elevation-card"
                >
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
        </section>
      ))}
      {languages}
    </main>
  );
}
