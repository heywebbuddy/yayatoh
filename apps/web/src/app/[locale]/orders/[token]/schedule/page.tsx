import { type PersonalCalendarDto, personalCalendarQuery } from '@yayatoh/integrations';
import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { manageTokenOrg } from '@yayatoh/orders';
import { type MySessionDto, myScheduleQuery } from '@yayatoh/registration';
import { Alert, Button, EmptyState, filterChipClass, Label, PageHeader, StatusPill } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ScheduleSessionActions } from '@/components/my-schedule.tsx';
import { CalendarControls } from '@/components/schedule-calendar.tsx';
import { Link } from '@/i18n/navigation.ts';
import { ports } from '@/server/ports.ts';
import { integrationAuth } from '@/server/integrations.ts';
import { scheduleAction } from './actions.ts';
import { calendarAction, connectCalendarAction } from './calendar-actions.ts';

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
const panel =
  'flex flex-col gap-3 rounded-panel border border-line bg-surface p-5 elevation-card glass md:p-6';

/**
 * "My schedule" (M5.2b), reached from the order page by its manage link (no account needed):
 * the registrant's included sessions, the optional ones they enrolled in, their place on
 * waitlists and open offers, and what they can still add — by day, in the event's timezone.
 * Phone-first: one column, 48 px buttons.
 */
export default async function MySchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ registrant?: string; calendar?: string }>;
}) {
  const { locale, token } = await params;
  const { registrant, calendar: calendarNotice } = await searchParams;
  setRequestLocale(locale);
  const orgId = await manageTokenOrg(token);
  if (!orgId) notFound();
  const wanted = registrant && /^[0-9a-f-]{36}$/.test(registrant) ? registrant : null;
  const data = await executeQuery(
    myScheduleQuery,
    { token, registrantId: wanted },
    createCtx({ orgId }),
    ports,
  ).catch((err) => {
    if (isDomainError(err) && (err.code === 'not_found' || err.code === 'module_not_enabled')) return null;
    throw err;
  });
  if (!data) notFound();
  const t = await getTranslations('mySchedule');
  const day = new Intl.DateTimeFormat(locale, {
    timeZone: data.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: data.timezone,
    hour: 'numeric',
    minute: '2-digit',
  });
  const until = new Intl.DateTimeFormat(locale, {
    timeZone: data.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const days = new Map<string, MySessionDto[]>();
  for (const s of data.sessions) {
    const k = day.format(s.startsAt);
    days.set(k, [...(days.get(k) ?? []), s]);
  }
  const me = data.registrants.find((r) => r.id === data.registrantId);
  // M6.5c: personal Google Calendar push (hidden where integrations are off or not in the plan).
  const calendar: PersonalCalendarDto | null =
    me && integrationAuth()
      ? await executeQuery(personalCalendarQuery, { token, registrantId: me.id }, createCtx({ orgId }), ports).catch(
          (err) => {
            if (isDomainError(err)) return null;
            throw err;
          },
        )
      : null;
  const count = (states: readonly MySessionDto['state'][]) =>
    data.sessions.filter((s) => states.includes(s.state)).length;
  const stateLabel = (s: MySessionDto) =>
    s.state === 'waiting'
      ? t('state.waiting', { position: s.position ?? 1 })
      : s.state === 'offered'
        ? t('state.offered', { until: s.offerExpiresAt ? until.format(s.offerExpiresAt) : '' })
        : t(`state.${s.state}`);
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-10 sm:px-6">
      <PageHeader
        eyebrow={<Label>{t('eyebrow')}</Label>}
        title={data.eventName}
        description={me ? t('for', { name: me.name }) : undefined}
      />
      <Link
        href={`/orders/${token}`}
        className="inline-flex min-h-11 items-center self-start text-body text-ink-2 underline underline-offset-2 hover:text-ink"
      >
        {t('backToOrder')}
      </Link>
      {data.registrants.length > 1 ? (
        <nav aria-label={t('whose')}>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {data.registrants.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/orders/${token}/schedule?registrant=${r.id}`}
                  aria-current={r.id === data.registrantId ? 'page' : undefined}
                  className={`${filterChipClass(r.id === data.registrantId)} min-h-11! px-4! text-body! ${r.id === data.registrantId ? '' : 'bg-surface'}`}
                >
                  {r.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {!me ? (
        <EmptyState title={t('noRegistrantTitle')} description={t('noRegistrantDescription')} />
      ) : data.sessions.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <>
          <p className="m-0 rounded-tile border border-line bg-surface px-4 py-3 text-body font-bold text-ink tabular-nums glass">
            {t('summary', {
              included: count(['included']),
              enrolled: count(['enrolled']),
              waiting: count(['waiting', 'offered']),
            })}
          </p>
          {calendar && me ? (
            <CalendarPanel
              token={token}
              registrantId={me.id}
              calendar={calendar}
              notice={calendarNotice ?? null}
              locale={locale}
              timezone={data.timezone}
            />
          ) : null}
          {[...days].map(([label, list]) => (
            <section key={label} aria-label={label} className="flex flex-col gap-3">
              <h2 className="m-0 text-section text-ink">{label}</h2>
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {list.map((s) => (
                  <li key={s.sessionId} className={panel}>
                    <div className="flex flex-col gap-1">
                      <h3 className="m-0 text-card text-ink">{s.title}</h3>
                      <p className="m-0 text-caption text-ink-2 tabular-nums">
                        <span dir="ltr">
                          {time.format(s.startsAt)}–{time.format(s.endsAt)}
                        </span>
                        {s.roomName ? ` · ${s.roomName}` : ''}
                        {s.groupName ? ` · ${t('pickOne', { group: s.groupName })}` : ''}
                      </p>
                    </div>
                    <StatusPill
                      tone={TONE[s.state]}
                      label={stateLabel(s)}
                      className="self-start whitespace-normal!"
                    />
                    {s.admission === 'optional' ? (
                      <ScheduleSessionActions
                        action={scheduleAction.bind(null, token, me.id, s.sessionId)}
                        title={s.title}
                        state={s.state}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </main>
  );
}

const NOTICE_TONE = {
  connected: 'success',
  denied: 'info',
  expired: 'warning',
  unavailable: 'warning',
  provider_unavailable: 'warning',
  rate_limited: 'warning',
  conflict: 'info',
} as const;

/**
 * M6.5c: keep this schedule in the registrant's own Google Calendar. Off: what it does and the
 * one button; connected: how many sessions are on it, the last update, update now and stop;
 * stopped by Google: connect again. Notices from the consent round trip arrive as `?calendar=`.
 */
async function CalendarPanel({
  token,
  registrantId,
  calendar,
  notice,
  locale,
  timezone,
}: {
  token: string;
  registrantId: string;
  calendar: PersonalCalendarDto;
  notice: string | null;
  locale: string;
  timezone: string;
}) {
  const t = await getTranslations('mySchedule.calendar');
  const when = new Intl.DateTimeFormat(locale, { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' });
  const tone = notice && notice in NOTICE_TONE ? NOTICE_TONE[notice as keyof typeof NOTICE_TONE] : null;
  const connect = (label: string) => (
    <form action={connectCalendarAction.bind(null, token, registrantId)}>
      <Button type="submit" size="lg">
        {label}
      </Button>
    </form>
  );
  return (
    <section id="calendar" aria-labelledby="calendar-heading" className={panel}>
      <h2 id="calendar-heading" className="m-0 text-section text-ink">
        {t('title')}
      </h2>
      {tone ? <Alert tone={tone} title={t(`notice.${notice as keyof typeof NOTICE_TONE}`)} /> : null}
      {calendar.state === 'active' || calendar.state === 'paused' ? (
        <>
          <p className="m-0 text-body text-ink">{t('active', { count: calendar.entries })}</p>
          <p className="m-0 text-caption text-ink-2 tabular-nums">
            {calendar.lastSyncAt ? t('lastSync', { when: when.format(calendar.lastSyncAt) }) : t('neverSynced')}
          </p>
          <CalendarControls action={calendarAction.bind(null, token, registrantId)} syncing={calendar.syncing} />
        </>
      ) : calendar.state === 'revoked' ? (
        <>
          <p className="m-0 text-body text-ink">
            {calendar.revokedBy === 'provider' ? t('revokedByGoogle') : t('stopped')}
          </p>
          {connect(t('reconnect'))}
        </>
      ) : calendar.state === 'pending' ? (
        <>
          <p className="m-0 text-body text-ink">{t('pending')}</p>
          {connect(t('reconnect'))}
        </>
      ) : (
        <>
          <p className="m-0 text-body text-ink">{t('off')}</p>
          <p className="m-0 text-caption text-ink-2">{t('privacy')}</p>
          {connect(t('connect'))}
        </>
      )}
    </section>
  );
}
