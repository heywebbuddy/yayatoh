import type { HubSessionDto } from '@yayatoh/registration';
import { nowAndNext } from '@yayatoh/registration';
import {
  buttonClass,
  EmptyState,
  filterChipClass,
  Label,
  PageHeader,
  StatusPill,
  Tabs,
  tabClass,
} from '@yayatoh/ui';
import { light } from '@yayatoh/ui/tokens';
import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { FavoriteToggle } from '@/components/conference-hub/favorite-toggle.tsx';
import { CalendarFeedTools, HubInstall, HubOffline } from '@/components/conference-hub/hub-client.tsx';
import { ScheduleSessionActions } from '@/components/my-schedule.tsx';
import { TicketQr } from '@/components/ticket-qr.tsx';
import { routing } from '@/i18n/routing.ts';
import { type ConferenceHub, hubHref, loadConferenceHub } from '@/server/conference-hub.ts';
import { requestHost } from '@/server/request-origin.ts';
import { scheduleAction } from '../schedule/actions.ts';
import { favoriteAction, rotateFeedAction } from './actions.ts';

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ registrant?: string; view?: string }>;
};

const VIEWS = ['today', 'schedule', 'agenda', 'badge'] as const;
type View = (typeof VIEWS)[number];

const TONE = {
  included: 'brand',
  enrolled: 'success',
  offered: 'waiting',
  waiting: 'info',
  open: 'neutral',
  full: 'waiting',
  waitlist_closed: 'neutral',
  closed: 'neutral',
  started: 'neutral',
} as const;

/** The public event page's card (ADR 0022). */
const panel = 'flex flex-col gap-3 rounded-panel border border-line bg-surface p-5 elevation-card glass';

const withLocale = (locale: string, path: string) =>
  locale === routing.defaultLocale ? path : `/${locale}${path}`;

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale, token } = await params;
  const { registrant } = await searchParams;
  const t = await getTranslations({ locale, namespace: 'conferenceHub' });
  const q = registrant && /^[0-9a-f-]{36}$/.test(registrant) ? `?registrant=${registrant}` : '';
  return {
    title: t('metaTitle'),
    robots: { index: false, follow: false },
    manifest: withLocale(locale, `/orders/${token}/hub/manifest${q}`),
    icons: { icon: '/conference-hub-icon.svg', apple: '/conference-hub-icon-192.png' },
    appleWebApp: { capable: true, title: t('metaTitle'), statusBarStyle: 'default' },
  };
}

export const viewport: Viewport = { themeColor: light.canvas };

/**
 * The attendee conference hub (M5.10a), reached from the order page by its manage link (no
 * account, no app): today (on now, up next, polls and Q&A, networking, install), the personal
 * schedule (enrolled vs starred, conflicts, the calendar feed), the agenda (star, enrol) and the
 * badge QR. Phone-first: one column, 44 px targets; links leave with full page loads (the hub
 * sends its client components only its own messages).
 */
export default async function ConferenceHubPage({ params, searchParams }: Props) {
  const { locale, token } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const data = await loadConferenceHub(token, sp.registrant);
  if (!data) notFound();
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? '') ? (sp.view as View) : 'today';
  const { hub } = data;
  const t = await getTranslations('conferenceHub');
  const me = hub.registrants.find((r) => r.id === hub.registrantId) ?? null;
  const href = (v: View, registrant = hub.registrantId) => withLocale(locale, hubHref(token, registrant, v));
  const tabs: { view: View; label: string }[] = [
    { view: 'today', label: t('tabs.today') },
    { view: 'schedule', label: t('tabs.schedule') },
    { view: 'agenda', label: t('tabs.agenda') },
    { view: 'badge', label: t('tabs.badge') },
  ];
  const origin = (await requestHost()).origin;
  const scope = withLocale(locale, `/orders/${token}/hub`);
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-5 px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow={<Label>{t('eyebrow')}</Label>}
        title={hub.eventName}
        description={me ? t('for', { name: me.name }) : undefined}
      />
      <HubOffline />
      {hub.registrants.length > 1 ? (
        <nav aria-label={t('whose')}>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {hub.registrants.map((r) => (
              <li key={r.id}>
                <a
                  href={href(view, r.id)}
                  aria-current={r.id === hub.registrantId ? 'page' : undefined}
                  className={`${filterChipClass(r.id === hub.registrantId)} min-h-11! px-4! text-body! ${r.id === hub.registrantId ? '' : 'bg-surface'}`}
                >
                  {r.name}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {!me ? (
        <EmptyState
          title={t('noRegistrantTitle')}
          description={t('noRegistrantDescription')}
          action={
            <a href={withLocale(locale, `/orders/${token}`)} className={buttonClass('secondary', 'md')}>
              {t('backToOrder')}
            </a>
          }
        />
      ) : (
        <>
          <Tabs label={t('tabs.label')} className="self-stretch">
            {tabs.map((tab) => (
              <a
                key={tab.view}
                href={href(tab.view)}
                aria-current={tab.view === view ? 'page' : undefined}
                className={`${tabClass(tab.view === view)} min-h-11 grow justify-center`}
              >
                {tab.label}
              </a>
            ))}
          </Tabs>
          {view === 'today' ? (
            <TodayView data={data} locale={locale} href={href} scope={scope} />
          ) : view === 'schedule' ? (
            <SessionsView
              data={data}
              locale={locale}
              token={token}
              mine
              href={href}
              feedUrl={data.feedPath ? `${origin}${data.feedPath}` : null}
            />
          ) : view === 'agenda' ? (
            <SessionsView data={data} locale={locale} token={token} mine={false} href={href} feedUrl={null} />
          ) : (
            <BadgeView data={data} />
          )}
          <a
            href={withLocale(locale, `/orders/${token}`)}
            className="inline-flex min-h-11 items-center self-start text-body text-ink-2 underline underline-offset-2 hover:text-ink"
          >
            {t('backToOrder')}
          </a>
        </>
      )}
    </main>
  );
}

function formats(locale: string, timeZone: string) {
  return {
    day: new Intl.DateTimeFormat(locale, { timeZone, weekday: 'long', day: 'numeric', month: 'long' }),
    time: new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit' }),
    until: new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' }),
  };
}

/** One session's time and place line (times in the event's time zone). */
function When({ s, fmt }: { s: HubSessionDto; fmt: ReturnType<typeof formats> }) {
  return (
    <p className="m-0 text-caption text-ink-2 tabular-nums">
      <span dir="ltr">
        {fmt.time.format(s.startsAt)}–{fmt.time.format(s.endsAt)}
      </span>
      {s.roomName ? ` · ${s.roomName}` : ''}
    </p>
  );
}

async function TodayView({
  data,
  locale,
  href,
  scope,
}: {
  data: ConferenceHub;
  locale: string;
  href: (v: View) => string;
  scope: string;
}) {
  const t = await getTranslations('conferenceHub');
  const { hub } = data;
  const fmt = formats(locale, hub.timezone);
  const mine = hub.sessions.filter((s) => s.onSchedule);
  // The personal schedule first; with nothing starred or enrolled, what is on for everyone.
  const source = mine.length > 0 ? mine : hub.sessions.filter((s) => s.state === 'included');
  const { now, next } = nowAndNext(source, new Date());
  const liveHref = (s: HubSessionDto) =>
    data.liveSessionIds.has(s.sessionId)
      ? withLocale(locale, `/events/${hub.eventSlug}/live/${s.sessionId}`)
      : null;
  const hasLive = now.some((s) => liveHref(s));
  const card = (s: HubSessionDto, primary: boolean) => {
    const live = liveHref(s);
    return (
      <li key={s.sessionId} className={panel}>
        <div className="flex flex-col gap-1">
          <h3 className="m-0 text-card text-ink">{s.title}</h3>
          <When s={s} fmt={fmt} />
        </div>
        {live ? (
          <a href={live} className={buttonClass(primary ? 'primary' : 'secondary', 'md', 'self-start')}>
            {t('today.pollsAndQa')}
          </a>
        ) : null}
      </li>
    );
  };
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="hub-now" className="flex flex-col gap-3">
        <h2 id="hub-now" className="m-0 text-section text-ink">
          {t('today.now')}
        </h2>
        <p className="m-0 text-caption text-ink-2">
          {mine.length > 0 ? t('today.fromSchedule') : t('today.fromAgenda')}
        </p>
        {now.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">{now.map((s) => card(s, true))}</ul>
        ) : (
          <p className="m-0 rounded-tile border border-line bg-surface px-4 py-3 text-body text-ink glass">
            {t('today.nothingNow')}
          </p>
        )}
      </section>
      <section aria-labelledby="hub-next" className="flex flex-col gap-3">
        <h2 id="hub-next" className="m-0 text-section text-ink">
          {t('today.next')}
        </h2>
        {next.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">{next.map((s) => card(s, false))}</ul>
        ) : (
          <EmptyState
            title={t('today.nothingNextTitle')}
            description={t('today.nothingNextDescription')}
            action={
              <a href={href('agenda')} className={buttonClass('secondary', 'md')}>
                {t('today.openAgenda')}
              </a>
            }
          />
        )}
      </section>
      <section aria-labelledby="hub-more" className="flex flex-col gap-3">
        <h2 id="hub-more" className="m-0 text-section text-ink">
          {t('today.more')}
        </h2>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          <li className={panel}>
            <h3 className="m-0 text-card text-ink">{t('today.badgeTitle')}</h3>
            <p className="m-0 text-body text-ink-2">{t('today.badgeDescription')}</p>
            <a
              href={href('badge')}
              className={buttonClass(hasLive ? 'secondary' : 'primary', 'md', 'self-start')}
            >
              {t('today.showBadge')}
            </a>
          </li>
          {data.networking ? (
            <li className={panel}>
              <h3 className="m-0 text-card text-ink">{t('today.networkingTitle')}</h3>
              <p className="m-0 text-body text-ink-2">{t('today.networkingDescription')}</p>
              <a
                href={withLocale(locale, `/events/${hub.eventSlug}/network`)}
                className={buttonClass('secondary', 'md', 'self-start')}
              >
                {t('today.openNetworking')}
              </a>
            </li>
          ) : null}
          <li className={panel}>
            <h3 className="m-0 text-card text-ink">{t('today.calendarTitle')}</h3>
            <p className="m-0 text-body text-ink-2">{t('today.calendarDescription')}</p>
            <a href={`${href('schedule')}#calendar`} className={buttonClass('secondary', 'md', 'self-start')}>
              {t('today.openCalendar')}
            </a>
          </li>
          <li className={panel}>
            <h3 className="m-0 text-card text-ink">{t('install.title')}</h3>
            <HubInstall scope={scope} />
          </li>
        </ul>
      </section>
      <p className="m-0 text-caption text-ink-2">{t('privateLink')}</p>
    </div>
  );
}

async function SessionsView({
  data,
  locale,
  token,
  mine,
  href,
  feedUrl,
}: {
  data: ConferenceHub;
  locale: string;
  token: string;
  mine: boolean;
  href: (v: View) => string;
  feedUrl: string | null;
}) {
  const t = await getTranslations('conferenceHub');
  const ts = await getTranslations('mySchedule');
  const { hub } = data;
  const registrantId = hub.registrantId as string;
  const fmt = formats(locale, hub.timezone);
  const title = new Map(hub.sessions.map((s) => [s.sessionId, s.title]));
  const list = mine ? hub.sessions.filter((s) => s.onSchedule || s.state === 'waiting') : hub.sessions;
  const days = new Map<string, HubSessionDto[]>();
  for (const s of list) {
    const k = fmt.day.format(s.startsAt);
    days.set(k, [...(days.get(k) ?? []), s]);
  }
  const stateLabel = (s: HubSessionDto) =>
    s.state === 'waiting'
      ? ts('state.waiting', { position: s.position ?? 1 })
      : s.state === 'offered'
        ? ts('state.offered', { until: s.offerExpiresAt ? fmt.until.format(s.offerExpiresAt) : '' })
        : ts(`state.${s.state}`);
  const pills = (s: HubSessionDto): ReactNode[] => [
    <StatusPill key="state" tone={TONE[s.state]} label={stateLabel(s)} className="whitespace-normal!" />,
    ...(s.favorite ? [<StatusPill key="fav" tone="brand" label={t('favorite.pill')} />] : []),
    ...(s.conflicts.length > 0
      ? [
          <StatusPill
            key="conflict"
            tone="waiting"
            className="whitespace-normal!"
            label={t('conflict', { titles: s.conflicts.map((id) => title.get(id) ?? '').join(', ') })}
          />,
        ]
      : []),
  ];
  const counts = {
    enrolled: hub.sessions.filter((s) => s.state === 'enrolled' || s.state === 'offered').length,
    favorites: hub.sessions.filter((s) => s.favorite).length,
    conflicts: hub.sessions.filter((s) => s.conflicts.length > 0).length,
  };
  return (
    <div className="flex flex-col gap-5">
      {mine ? (
        <p className="m-0 rounded-tile border border-line bg-surface px-4 py-3 text-body font-bold text-ink tabular-nums glass">
          {t('summary', counts)}
        </p>
      ) : (
        <p className="m-0 text-body text-ink-2">{t('agendaIntro')}</p>
      )}
      {list.length === 0 ? (
        mine ? (
          <EmptyState
            title={t('emptyScheduleTitle')}
            description={t('emptyScheduleDescription')}
            action={
              <a href={href('agenda')} className={buttonClass('primary', 'md')}>
                {t('today.openAgenda')}
              </a>
            }
          />
        ) : (
          <EmptyState title={t('emptyAgendaTitle')} description={t('emptyAgendaDescription')} />
        )
      ) : (
        [...days].map(([label, sessions]) => (
          <section key={label} aria-label={label} className="flex flex-col gap-3">
            <h2 className="m-0 text-section text-ink">{label}</h2>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {sessions.map((s) => (
                <li key={s.sessionId} className={panel}>
                  <div className="flex flex-col gap-1">
                    <h3 className="m-0 text-card text-ink">{s.title}</h3>
                    <When s={s} fmt={fmt} />
                    {s.groupName ? (
                      <p className="m-0 text-caption text-ink-2">{ts('pickOne', { group: s.groupName })}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">{pills(s)}</div>
                  <FavoriteToggle
                    action={favoriteAction.bind(null, token, registrantId, s.sessionId)}
                    title={s.title}
                    favorite={s.favorite}
                  />
                  {s.admission === 'optional' ? (
                    <ScheduleSessionActions
                      action={scheduleAction.bind(null, token, registrantId, s.sessionId)}
                      title={s.title}
                      state={s.state}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {mine && feedUrl ? (
        <section id="calendar" aria-labelledby="hub-calendar" className={panel}>
          <h2 id="hub-calendar" className="m-0 text-section text-ink">
            {t('calendar.title')}
          </h2>
          <p className="m-0 text-body text-ink-2">{t('calendar.description')}</p>
          <CalendarFeedTools url={feedUrl} rotate={rotateFeedAction.bind(null, token, registrantId)} />
        </section>
      ) : null}
    </div>
  );
}

async function BadgeView({ data }: { data: ConferenceHub }) {
  const t = await getTranslations('conferenceHub.badge');
  const b = data.badge;
  if (!b) return <EmptyState title={t('noneTitle')} description={t('noneDescription')} />;
  return (
    <section aria-labelledby="hub-badge" className={`${panel} items-center text-center`}>
      <h2 id="hub-badge" className="m-0 text-section text-ink">
        {t('title')}
      </h2>
      <TicketQr
        code={b.code}
        label={t('qrLabel', { name: b.holderName })}
        className="aspect-square w-full max-w-72 rounded-tag text-ink"
      />
      <p className="m-0 text-card text-ink">{b.holderName}</p>
      {b.typeName ? <p className="m-0 text-body text-ink-2">{b.typeName}</p> : null}
      <p className="m-0 text-caption text-ink-2">
        {t('shortCode')} <span className="font-mono text-body tracking-[0.2em] text-ink">{b.shortCode}</span>
      </p>
      <p className="m-0 text-caption text-ink-2">{t('hint')}</p>
    </section>
  );
}
