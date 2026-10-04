import { nextProgramItem, type PartyHubView } from '@yayatoh/guests';
import {
  buttonClass,
  Card,
  CardLabel,
  EmptyState,
  Label,
  type LaneItem,
  PageHeader,
  ScheduleLane,
  SectionHeader,
  StatusPill,
} from '@yayatoh/ui';
import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { TicketQr } from '@/components/ticket-qr.tsx';
import { hubPath, loadPartyHub, localePath } from '@/server/guest-hub.ts';
import { HubInstall, HubOffline } from './install.tsx';

type Params = Promise<{ locale: string; token: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, token: raw } = await params;
  const t = await getTranslations({ locale, namespace: 'hub' });
  const path = hubPath(decodeURIComponent(raw), locale);
  // A party's page is theirs alone: never indexed, never followed. Installable (its own manifest).
  return {
    title: t('metaTitle'),
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
    manifest: `${path}/manifest`,
    appleWebApp: { capable: true, title: t('metaTitle'), statusBarStyle: 'default' },
    icons: {
      icon: [{ url: '/hub-icon-192.png', sizes: '192x192', type: 'image/png' }],
      apple: [{ url: '/hub-icon-192.png', sizes: '192x192' }],
    },
  };
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

const linkClass =
  'inline-flex min-h-11 items-center gap-1 font-bold text-primary-ink underline underline-offset-2';

/**
 * A party's guest hub (M4.7a): one mobile page with the party's RSVP, program, seats and tickets,
 * reached by the party's RSVP link (same token: resetting the link closes both). It installs to
 * the home screen (its own manifest; a service worker keeps the last copy for the day of, when the
 * venue has no signal) and offers a wallet pass. Nothing private, nobody outside the party (P4-3).
 */
export default async function PartyHubPage({ params }: { params: Params }) {
  const { locale, token: raw } = await params;
  setRequestLocale(locale);
  const token = decodeURIComponent(raw);
  const hub = await loadPartyHub(token, locale, { markViewed: true });
  if (!hub) notFound();
  const t = await getTranslations('hub');

  if (hub.state === 'expired')
    return (
      <main id="main" className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-8 sm:px-6">
        <PageHeader
          eyebrow={<Label>{hub.eventName}</Label>}
          title={t('expiredTitle')}
          description={t('expired')}
        />
      </main>
    );

  return renderHub(hub, token, locale, t);
}

function renderHub(
  hub: PartyHubView,
  token: string,
  locale: string,
  t: Awaited<ReturnType<typeof getTranslations<'hub'>>>,
) {
  const now = new Date();
  const range = (start: Date, end: Date, withDay = true) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: hub.timezone,
      ...(withDay ? { weekday: 'short', month: 'short', day: 'numeric' } : {}),
      hour: 'numeric',
      minute: '2-digit',
    }).formatRange(start, end);
  const day = (d: Date) =>
    new Intl.DateTimeFormat(locale, { timeZone: hub.timezone, dateStyle: 'long' }).format(d);
  const at = (d: Date) =>
    new Intl.DateTimeFormat(locale, { timeZone: hub.timezone, dateStyle: 'long', timeStyle: 'short' }).format(
      d,
    );
  const eventDates = new Intl.DateTimeFormat(locale, {
    timeZone: hub.timezone,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).formatRange(hub.startsAt, hub.endsAt);

  const next = nextProgramItem(hub.program, now);
  // Plain links (full page loads): this page's layout carries only its own messages (intl-scope.ts),
  // so a client-side navigation to another page would find none.
  const rsvpPath = localePath(`/rsvp/${encodeURIComponent(token)}`, locale);
  const rsvpState = !hub.rsvp.open
    ? ({ tone: 'neutral', label: t('rsvpClosed') } as const)
    : hub.rsvp.awaiting === 0 && hub.program.length > 0
      ? ({ tone: 'success', label: t('rsvpResponded') } as const)
      : ({ tone: 'waiting', label: t('rsvpWaiting') } as const);

  const lane: LaneItem[] = hub.program.map((p) => {
    const going = p.answers.filter((a) => a.status === 'attending').length;
    const answered = p.answers.some((a) => a.status !== null);
    const live = p.startsAt <= now && now < p.endsAt;
    const done = p.endsAt <= now;
    return {
      id: p.id,
      title: p.name,
      time: range(p.startsAt, p.endsAt),
      where: p.place ?? undefined,
      state: live ? 'now' : done ? 'done' : next?.item.id === p.id ? 'next' : 'plain',
      chip: live
        ? t('chipNow')
        : done
          ? t('chipDone')
          : answered
            ? t('chipGoing', { count: going })
            : t('chipNoAnswer'),
    };
  });

  const seatLine = (s: { itemKind: 'row' | 'table'; itemLabel: string; seatLabel: string }) =>
    t(s.itemKind === 'table' ? 'tableLine' : 'rowLine', { table: s.itemLabel, seat: s.seatLabel });
  const sections = [
    { id: 'rsvp', label: t('rsvpTitle') },
    { id: 'program', label: t('programTitle') },
    { id: 'seats', label: t('seatsTitle') },
    { id: 'tickets', label: t('ticketsTitle') },
    { id: 'keep', label: t('keepTitle') },
  ];
  const sectionClass = 'flex scroll-mt-4 flex-col gap-3';

  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-7 px-4 pt-8 pb-16 sm:px-6 sm:pt-12"
    >
      <HubOffline />
      <PageHeader
        eyebrow={<Label>{hub.eventName}</Label>}
        title={t('title', { party: hub.partyName })}
        description={eventDates}
      />

      <nav aria-label={t('sectionsLabel')}>
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className={buttonClass('secondary', 'md')}>
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {next ? (
        <Card size="panel" className="flex flex-col gap-1" data-testid="hub-next">
          <CardLabel>{next.live ? t('happeningNow') : t('upNext')}</CardLabel>
          <p className="m-0 text-section text-ink">{next.item.name}</p>
          <p className="m-0 text-body font-semibold text-ink-2">
            {[range(next.item.startsAt, next.item.endsAt), next.item.place].filter(Boolean).join(' · ')}
          </p>
        </Card>
      ) : null}

      <section id="rsvp" aria-labelledby="rsvp-title" className={sectionClass}>
        <SectionHeader id="rsvp-title" title={t('rsvpTitle')} />
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={rsvpState.tone} label={rsvpState.label} />
          </div>
          {hub.program.length ? (
            <p className="m-0 text-body text-ink" data-testid="hub-rsvp-counts">
              {t('rsvpCounts', {
                attending: hub.rsvp.attending,
                declined: hub.rsvp.declined,
                awaiting: hub.rsvp.awaiting,
              })}
            </p>
          ) : null}
          {hub.rsvp.respondedAt ? (
            <p className="m-0 text-caption font-semibold text-ink-2">
              {t('rsvpAnsweredOn', { date: day(hub.rsvp.respondedAt) })}
            </p>
          ) : null}
          {hub.rsvp.open ? (
            hub.rsvp.deadline ? (
              <p className="m-0 text-caption font-semibold text-ink-2">
                {t('rsvpDeadline', { deadline: at(hub.rsvp.deadline) })}
              </p>
            ) : null
          ) : (
            <p className="m-0 text-body text-ink-2">{t('rsvpLocked')}</p>
          )}
          {hub.program.length ? (
            <div>
              <a
                href={rsvpPath}
                className={buttonClass(
                  hub.rsvp.open && !hub.rsvp.respondedAt ? 'primary' : 'secondary',
                  'md',
                )}
              >
                {!hub.rsvp.open ? t('rsvpView') : hub.rsvp.respondedAt ? t('rsvpChange') : t('rsvpAnswer')}
              </a>
            </div>
          ) : null}
        </Card>
      </section>

      <section id="program" aria-labelledby="program-title" className={sectionClass}>
        <SectionHeader id="program-title" title={t('programTitle')} />
        {lane.length ? (
          <ScheduleLane items={lane} label={t('programLabel')} />
        ) : (
          <EmptyState title={t('programEmptyTitle')} description={t('programEmpty')} />
        )}
      </section>

      <section id="seats" aria-labelledby="seats-title" className={sectionClass}>
        <SectionHeader id="seats-title" title={t('seatsTitle')} />
        {!hub.seating ? (
          <EmptyState title={t('seatsHiddenTitle')} description={t('seatsHidden')} />
        ) : hub.seating.seats.length === 0 ? (
          <EmptyState title={t('seatsNoneTitle')} description={t('seatsNone')} />
        ) : (
          <Card className="flex flex-col gap-3">
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {hub.seating.seats.map((s) => (
                <li key={`${s.itemLabel}-${s.seatLabel}`} className="flex flex-col">
                  <span className="text-card text-ink">{seatLine(s)}</span>
                  {s.sponsor ? (
                    <span className="text-caption text-ink-2">
                      {t('sponsoredBy', { sponsor: s.sponsor })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {hub.seating.unseated > 0 ? (
              <p className="m-0 text-caption font-semibold text-ink-2">
                {t('unseated', { count: hub.seating.unseated })}
              </p>
            ) : null}
          </Card>
        )}
      </section>

      <section id="tickets" aria-labelledby="tickets-title" className={sectionClass}>
        <SectionHeader id="tickets-title" title={t('ticketsTitle')} />
        {hub.tickets.length === 0 ? (
          <EmptyState title={t('ticketsNoneTitle')} description={t('ticketsNone')} />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {hub.tickets.map((tk) => (
              <li key={tk.id}>
                <Card className="flex flex-wrap items-center gap-5">
                  <TicketQr
                    code={tk.code}
                    label={t('ticketQr', { name: tk.holderName })}
                    className="size-40 shrink-0 rounded-tag text-black"
                  />
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="m-0 text-section text-ink">{tk.typeName}</p>
                    <p className="m-0 text-body text-ink">{tk.holderName}</p>
                    <p className="m-0 font-mono text-body tracking-[0.2em] text-ink-2">
                      <span className="sr-only">{t('ticketCode', { code: tk.shortCode })}</span>
                      <span aria-hidden="true">{tk.shortCode}</span>
                    </p>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="keep" aria-labelledby="keep-title" className={sectionClass}>
        <SectionHeader id="keep-title" title={t('keepTitle')} description={t('keepIntro')} />
        <Card className="flex flex-col gap-4">
          <HubInstall scope={hubPath(token, locale)} />
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <div className="flex flex-wrap gap-2">
              <a
                href={`${hubPath(token, locale)}/pass/apple`}
                className={buttonClass('dark', 'md')}
                download
                rel="nofollow"
              >
                {t('walletApple')}
              </a>
              <a
                href={`${hubPath(token, locale)}/pass/google`}
                className={buttonClass('secondary', 'md')}
                download
                rel="nofollow"
              >
                {t('walletGoogle')}
              </a>
            </div>
            <p className="m-0 text-caption text-ink-2">{t('walletHint')}</p>
          </div>
        </Card>
        {hub.siteCode ? (
          <p className="m-0">
            <a href={localePath(`/w/${hub.siteCode}`, locale)} className={linkClass}>
              {t('website')}
            </a>
          </p>
        ) : null}
        <p className="m-0 text-caption text-ink-2">{t('privacy')}</p>
      </section>
    </main>
  );
}
