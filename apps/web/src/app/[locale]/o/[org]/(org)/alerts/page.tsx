import { type AlertDto, alertHistoryQuery, listAlertsQuery } from '@yayatoh/alerts';
import { listEventsQuery } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { ALERTS_CHANNEL, realtimeChannelName } from '@yayatoh/platform';
import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, Card, EmptyState, PageHeader, StatusDot } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AlertActions } from '@/components/alert-actions.tsx';
import { SEVERITY_DOT } from '@/components/alerts-list.tsx';
import { AlertsLive } from '@/components/alerts-live.tsx';
import { Link } from '@/i18n/navigation.ts';
import { realtimeUrl } from '@/lib/realtime-url.ts';
import { alertTitle } from '@/server/alerts.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { alertAction } from './actions.ts';

const UUID = /^[0-9a-f-]{36}$/;

/**
 * The organizer's alerts (M3.2b): what the alert engine found across the org's events, most
 * severe first, each with the page (bulk action) that fixes it, its history, and — for people who
 * may act on alerts — acknowledge and snooze. Updates live over the org's alerts channel. Anyone
 * who can read events sees the alerts their role may see.
 */
export default async function AlertsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ status?: string; event?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!roleCan(data.role, 'events:read')) notFound();
  const sp = await searchParams;
  const status = sp.status === 'resolved' ? 'resolved' : 'active';
  const eventId = sp.event && UUID.test(sp.event) ? sp.event : null;
  const t = await getTranslations('alerts');
  const [alerts, events] = await Promise.all([
    executeQuery(listAlertsQuery, { status, eventId, limit: 100 }, data.ctx, ports),
    executeQuery(listEventsQuery, {}, data.ctx, ports).catch(() => []),
  ]);
  const histories = new Map(
    await Promise.all(
      alerts
        .slice(0, 50)
        .map(
          async (a) =>
            [a.id, await executeQuery(alertHistoryQuery, { alertId: a.id }, data.ctx, ports)] as const,
        ),
    ),
  );
  const tz = data.org.timezone;
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: tz });
  const canManage = roleCan(data.role, 'alerts:manage');
  const base = `/o/${org}/alerts`;
  const tab = (s: 'active' | 'resolved') => {
    const q = new URLSearchParams();
    if (s === 'resolved') q.set('status', 'resolved');
    if (eventId) q.set('event', eventId);
    const str = q.toString();
    return str ? `${base}?${str}` : base;
  };
  const stateLabel = (a: AlertDto) =>
    a.state === 'snoozed' && a.snoozedUntil
      ? t('state.snoozed', { until: when.format(a.snoozedUntil) })
      : a.state === 'resolved' && a.resolvedAt
        ? t('state.resolved', { when: when.format(a.resolvedAt) })
        : t(`state.${a.state}`);

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Link href={`${base}/settings`} className={buttonClass('secondary')}>
            {t('settingsLink')}
          </Link>
        }
      />
      <AlertsLive url={realtimeUrl(realtimeChannelName(ALERTS_CHANNEL, data.org.id))} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <nav aria-label={t('statusLabel')} className="flex flex-wrap gap-2">
          {(['active', 'resolved'] as const).map((s) => (
            <Link
              key={s}
              href={tab(s)}
              aria-current={s === status ? 'page' : undefined}
              className={`inline-flex min-h-10 items-center rounded-pill border px-4 text-body ${
                s === status ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white'
              }`}
            >
              {t(s)}
            </Link>
          ))}
        </nav>
        <form method="get" action={base} className="flex flex-wrap items-end gap-2">
          {status === 'resolved' ? <input type="hidden" name="status" value="resolved" /> : null}
          <div className="flex flex-col gap-1">
            <label htmlFor="alerts-event" className="text-caption text-zinc-600">
              {t('eventLabel')}
            </label>
            <select
              id="alerts-event"
              name="event"
              defaultValue={eventId ?? ''}
              className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
            >
              <option value="">{t('allEvents')}</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={buttonClass('secondary')}>
            {t('apply')}
          </button>
        </form>
      </div>
      {alerts.length === 0 ? (
        <EmptyState
          title={status === 'active' ? t('empty.activeTitle') : t('empty.resolvedTitle')}
          description={status === 'active' ? t('empty.activeDescription') : t('empty.resolvedDescription')}
        />
      ) : (
        <ul className="flex list-none flex-col gap-3 p-0" aria-label={t(status)}>
          {alerts.map((a) => {
            const title = alertTitle(t, locale, a);
            const history = histories.get(a.id) ?? [];
            return (
              <li key={a.id}>
                <Card
                  className="flex flex-col gap-3"
                  data-alert={a.rule}
                  data-state={a.state}
                  aria-labelledby={`alert-${a.id}`}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <StatusDot status={SEVERITY_DOT[a.severity]} label={t(`severity.${a.severity}`)} />
                    <span className="text-caption text-zinc-600" data-testid="alert-state">
                      {stateLabel(a)}
                    </span>
                    {a.reopenCount > 0 && a.state !== 'resolved' ? (
                      <span className="text-caption text-zinc-600">{t('reopened')}</span>
                    ) : null}
                    <span className="text-caption text-zinc-600">
                      {t('since', { when: when.format(a.openedAt) })}
                    </span>
                  </div>
                  <h2 id={`alert-${a.id}`} className="text-section">
                    {title}
                  </h2>
                  <p className="text-caption text-zinc-600">
                    {a.eventName && a.eventSlug ? (
                      <Link
                        href={`/o/${org}/e/${a.eventSlug}`}
                        className="inline-flex min-h-6 items-center underline"
                      >
                        {a.eventName}
                      </Link>
                    ) : (
                      t('orgWide')
                    )}
                  </p>
                  {a.state !== 'resolved' ? (
                    <p>
                      <Link href={`/o/${org}${a.fixPath}`} className={buttonClass('primary')}>
                        {t(`fix.${a.rule}`)}
                      </Link>
                    </p>
                  ) : null}
                  {a.state !== 'resolved' && canManage ? (
                    <AlertActions
                      key={`${a.id}:${a.state}`}
                      alertId={a.id}
                      title={title}
                      canAcknowledge={a.state === 'open'}
                      canSnooze={a.state === 'open' || a.state === 'acknowledged'}
                      timeZone={tz}
                      action={alertAction.bind(null, org, a.id)}
                    />
                  ) : null}
                  {history.length ? (
                    <details className="text-caption">
                      <summary className="inline-flex min-h-6 cursor-pointer items-center text-zinc-700 underline">
                        {t('history.title')}
                      </summary>
                      <ol className="mt-2 flex list-none flex-col gap-1 p-0">
                        {history.map((h, i) => (
                          <li
                            key={`${h.at.toISOString()}-${i}`}
                            className="flex flex-wrap gap-x-2 text-zinc-600"
                          >
                            <span>{when.format(h.at)}</span>
                            <span>
                              {h.action === 'acknowledged' || h.action === 'snoozed'
                                ? t(`history.${h.action}${h.byYou ? 'You' : ''}`)
                                : t(`history.${h.action}`, { count: h.count })}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
