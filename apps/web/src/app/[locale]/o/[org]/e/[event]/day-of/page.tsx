import { type DayOfDto, dayOfQuery } from '@yayatoh/checkin';
import { executeQuery } from '@yayatoh/kernel';
import { composeNav, isProfileKey, navLabelKey } from '@yayatoh/platform';
import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, Card, EmptyState, PageHeader, StatCard, StatusPill, Table } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AutoRefresh } from '@/components/auto-refresh.tsx';
import { DayOfActionButton, DayOfFeedback, KioskStartForm } from '@/components/day-of.tsx';
import { DeviceEnrollForm } from '@/components/device-enroll-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { supervisorView } from '@/server/scan-staff.ts';
import {
  enrollDayOfDeviceAction,
  markArrivedAction,
  startKioskAction,
  stopKioskAction,
  undoArrivalAction,
} from './actions.ts';

type Place = DayOfDto['arrivals'][number]['places'][number];

/**
 * The day-of host view (M4.4b): who has arrived (checked in on a scanner, at the guest kiosk or
 * here), who still has no table, and the meal counts for the kitchen. The host can check a guest in
 * or undo a mistake, and set up a tablet as the guest kiosk or a TV as the A–Z table board.
 */
export default async function DayOfPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, profile, can } = await loadEvent(org, event, 'dayOf');
  const item = composeNav(isProfileKey(ev.profile) ? ev.profile : 'other', data.modules).find(
    (i) => i.key === 'dayOf',
  );
  if (!item) notFound();
  const t = await getTranslations('dayOf');
  const tt = await getTranslations();
  if (!can('guests:read'))
    return (
      <>
        <PageHeader title={tt(navLabelKey(profile, item))} />
        <EmptyState title={t('noAccessTitle')} description={t('noAccessDescription')} />
      </>
    );
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim().slice(0, 80) ?? '';
  const day = await executeQuery(dayOfQuery, { eventId: ev.id, q }, data.ctx, ports);
  const canCheckIn = can('checkin:scan');
  const canKiosk = can('checkin:kiosk');
  const manageDevices = roleCan(data.role, 'checkin:scan');
  const devices = canKiosk
    ? (await executeQuery(supervisorView, { eventId: ev.id }, data.ctx, ports)).devices.filter(
        (d) => d.where !== 'elsewhere',
      )
    : [];
  const base = `/o/${org}/e/${event}`;
  const time = new Intl.DateTimeFormat(locale, { timeZone: ev.timezone, hour: 'numeric', minute: '2-digit' });
  const n = (v: number) => formatNumber(v, locale);
  const place = (p: Place) => {
    const at = t(p.kind === 'row' ? 'placeRow' : 'placeTable', { label: p.label });
    return p.chart ? t('placeOnChart', { chart: p.chart, place: at }) : at;
  };
  const places = (ps: readonly Place[]) => (ps.length ? ps.map(place).join(' · ') : t('noPlace'));
  const who = (g: { name: string | null; guestOf: string | null }) =>
    g.name ?? t('guestOf', { name: g.guestOf ?? '?' });
  const source = { scanner: t('sourceScanner'), kiosk: t('sourceKiosk'), host: t('sourceHost') } as const;

  return (
    <>
      <PageHeader
        title={tt(navLabelKey(profile, item))}
        description={t('description')}
        actions={
          canKiosk ? (
            <a href="#kiosks" className={buttonClass('primary')}>
              {t('setUpKiosk')}
            </a>
          ) : undefined
        }
      />
      <AutoRefresh seconds={15} />
      <DayOfFeedback>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="day-of-stats">
          <StatCard
            testId="stat-arrived"
            label={t('arrived')}
            value={n(day.counts.arrived)}
            progress={{
              value: Math.min(day.counts.arrived, day.counts.expected),
              max: Math.max(1, day.counts.expected),
              label: t('arrivedOf', { arrived: day.counts.arrived, expected: day.counts.expected }),
            }}
            sub={t('arrivedOf', { arrived: day.counts.arrived, expected: day.counts.expected })}
          />
          <StatCard testId="stat-waiting" label={t('notArrived')} value={n(day.counts.notArrived)} />
          <StatCard testId="stat-unseated" label={t('unseated')} value={n(day.counts.unseated)} />
          <StatCard testId="stat-declined" label={t('declined')} value={n(day.counts.declined)} />
        </div>

        {canCheckIn ? (
          <section aria-labelledby="dayof-find" className="flex flex-col gap-3">
            <h2 id="dayof-find" className="text-section">
              {t('findTitle')}
            </h2>
            <form method="get" className="flex flex-wrap items-end gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <label htmlFor="dayof-q" className="text-[13px] font-bold text-ink">
                  {t('searchLabel')}
                </label>
                <input
                  id="dayof-q"
                  name="q"
                  type="search"
                  defaultValue={q}
                  maxLength={80}
                  autoComplete="off"
                  className="field w-full"
                />
              </div>
              <button type="submit" className={buttonClass('secondary')}>
                {t('search')}
              </button>
            </form>
            {q ? (
              day.matches.length === 0 ? (
                <EmptyState title={t('noMatchTitle')} description={t('noMatchDescription')} />
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t('matches')}>
                  {day.matches.map((g) => (
                    <li
                      key={g.guestId}
                      data-match={who(g)}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3"
                    >
                      <div className="flex flex-col">
                        <span className="text-body font-medium">{who(g)}</span>
                        <span className="text-caption text-ink-2">
                          {g.partyName} · {places(g.places)}
                        </span>
                      </div>
                      {g.arrivedAt ? (
                        <StatusPill
                          tone="success"
                          label={t('arrivedAt', { time: time.format(g.arrivedAt) })}
                        />
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          {g.status === 'declined' ? (
                            <StatusPill tone="danger" label={t('declinedOne')} />
                          ) : null}
                          <DayOfActionButton
                            variant="primary"
                            action={markArrivedAction.bind(null, org, event, g.guestId)}
                            label={t('checkIn')}
                            ariaLabel={t('checkInGuest', { name: who(g) })}
                            done={t('checkedIn', { name: who(g) })}
                          />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </section>
        ) : null}

        <section aria-labelledby="dayof-arrivals" className="flex flex-col gap-3">
          <h2 id="dayof-arrivals" className="text-section">
            {t('arrivalsTitle')}
          </h2>
          <Table
            caption={t('arrivalsTitle')}
            stackOnPhone
            rows={day.arrivals}
            rowKey={(r) => r.guestId}
            empty={<EmptyState title={t('noArrivalsTitle')} description={t('noArrivalsDescription')} />}
            columns={[
              { key: 'time', header: t('colTime'), cell: (r) => time.format(r.arrivedAt) },
              {
                key: 'guest',
                header: t('colGuest'),
                cell: (r) => <span data-arrival={who(r)}>{who(r)}</span>,
              },
              { key: 'party', header: t('colParty'), cell: (r) => r.partyName },
              { key: 'place', header: t('colPlace'), cell: (r) => places(r.places) },
              { key: 'how', header: t('colHow'), cell: (r) => source[r.source] },
              ...(canCheckIn
                ? [
                    {
                      key: 'undo',
                      header: t('colActions'),
                      cell: (r: DayOfDto['arrivals'][number]) => (
                        <DayOfActionButton
                          action={undoArrivalAction.bind(null, org, event, r.guestId)}
                          label={t('undo')}
                          ariaLabel={t('undoGuest', { name: who(r) })}
                          done={t('undone')}
                        />
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </section>

        <section aria-labelledby="dayof-unseated" className="flex flex-col gap-3">
          <h2 id="dayof-unseated" className="text-section">
            {t('unseatedTitle')}
          </h2>
          {!day.hasChart ? (
            <EmptyState
              title={t('noChartTitle')}
              description={t('noChartDescription')}
              action={
                <Link href={`${base}/seating`} className={buttonClass('secondary', 'sm')}>
                  {t('toSeating')}
                </Link>
              }
            />
          ) : day.unseated.length === 0 ? (
            <EmptyState title={t('allSeatedTitle')} description={t('allSeatedDescription')} />
          ) : (
            <Card className="flex flex-col gap-3">
              <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="unseated">
                {day.unseated.map((g) => (
                  <li key={g.guestId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium">{who(g)}</span>
                    <span className="text-caption text-ink-2">{g.partyName}</span>
                    <StatusPill
                      tone={g.status === 'attending' ? 'success' : 'waiting'}
                      label={g.status === 'attending' ? t('attending') : t('noAnswer')}
                    />
                    {g.arrived ? <StatusPill tone="info" label={t('here')} /> : null}
                  </li>
                ))}
              </ul>
              <Link href={`${base}/seating/guests`} className={buttonClass('secondary', 'sm', 'self-start')}>
                {t('seatThem')}
              </Link>
            </Card>
          )}
        </section>

        <section aria-labelledby="dayof-meals" className="flex flex-col gap-3">
          <h2 id="dayof-meals" className="text-section">
            {t('mealsTitle')}
          </h2>
          <p className="text-caption text-ink-2">{t('mealsHint')}</p>
          <Table
            caption={t('mealsTitle')}
            stackOnPhone
            rows={day.meals}
            rowKey={(r) => r.meal ?? '∅'}
            empty={<EmptyState title={t('noMealsTitle')} description={t('noMealsDescription')} />}
            columns={[
              { key: 'meal', header: t('colMeal'), cell: (r) => r.meal ?? t('noMeal') },
              { key: 'guests', header: t('colGuests'), align: 'end', cell: (r) => n(r.guests) },
              { key: 'arrived', header: t('colArrived'), align: 'end', cell: (r) => n(r.arrived) },
            ]}
          />
        </section>

        {canKiosk ? (
          <section id="kiosks" aria-labelledby="dayof-kiosks" className="flex flex-col gap-3">
            <h2 id="dayof-kiosks" className="text-section">
              {t('kiosksTitle')}
            </h2>
            <p className="text-body text-ink-2">{t('kiosksHint')}</p>
            {devices.length === 0 ? (
              <EmptyState title={t('noDevicesTitle')} description={t('noDevicesDescription')} />
            ) : (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {devices.map((d) => (
                  <li
                    key={d.id}
                    data-device={d.label}
                    className="flex flex-col gap-3 rounded-card border border-line px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-body font-bold">{d.label}</h3>
                      <StatusPill
                        tone={d.online ? 'success' : 'neutral'}
                        label={d.online ? t('online') : t('offline')}
                      />
                      {d.mode === 'kiosk' ? (
                        <StatusPill
                          tone="info"
                          label={
                            d.kioskKind === 'board'
                              ? t('kindBoard')
                              : d.kioskKind === 'guests'
                                ? t('kindGuests')
                                : t('kindTickets')
                          }
                        />
                      ) : null}
                    </div>
                    {d.mode === 'kiosk' ? (
                      <DayOfActionButton
                        action={stopKioskAction.bind(null, org, event, d.id)}
                        label={t('kioskStop')}
                        ariaLabel={t('kioskStopDevice', { device: d.label })}
                        done={t('kioskStopped', { device: d.label })}
                      />
                    ) : (
                      <KioskStartForm
                        action={startKioskAction.bind(null, org, event, d.id)}
                        device={d.label}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
            {manageDevices ? (
              <DeviceEnrollForm
                eventId={ev.id}
                action={enrollDayOfDeviceAction.bind(null, org, event)}
                staff={[]}
              />
            ) : null}
          </section>
        ) : null}
      </DayOfFeedback>
    </>
  );
}
