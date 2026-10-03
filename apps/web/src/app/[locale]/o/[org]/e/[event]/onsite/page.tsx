import { getUsersByIds } from '@yayatoh/auth';
import {
  checkinStatusQuery,
  doorStaffQuery,
  listCheckpointsQuery,
  listDevicesQuery,
  myScanScopeQuery,
} from '@yayatoh/checkin';
import { eventRolesOf } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { CHECKINS_CHANNEL, composeNav, isProfileKey, realtimeChannelName } from '@yayatoh/platform';
import { eventRoleCan, roleCan } from '@yayatoh/tenancy';
import { listTicketTypesQuery } from '@yayatoh/ticketing';
import { Button, buttonClass, Card, EmptyState, PageHeader, StatusDot } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AutoRefresh } from '@/components/auto-refresh.tsx';
import { CheckpointForm } from '@/components/checkpoint-form.tsx';
import { DeviceEnrollForm } from '@/components/device-enroll-form.tsx';
import { LiveCheckins } from '@/components/live-checkins.tsx';
import { Scanner } from '@/components/scanner.tsx';
import { SEVERITY_DOT, signalSummary } from '@/components/signal-summary.ts';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { realtimeUrl } from '@/lib/realtime-url.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { CardSavingQr } from '../donations/pledges/card-qr.tsx';
import {
  checkpointArchivedAction,
  createCheckpointAction,
  deviceStateAction,
  enrollDeviceAction,
  scanAction,
  undoAction,
} from './actions.ts';

const DOT = {
  admitted: 'success',
  duplicate: 'warning',
  invalid: 'danger',
  void: 'danger',
  wrong_event: 'danger',
  not_today: 'warning',
  wrong_date: 'warning',
  outside_window: 'warning',
  duplicate_offline: 'danger',
  superseded: 'danger',
  provisional: 'warning',
  granted: 'success',
  no_access: 'danger',
  wrong_checkpoint: 'danger',
  balance_due: 'warning',
} as const;

/** Door check-in: HID scanners and manual entry, entrances and zones, devices and alerts. */
export default async function OnsitePage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'onsite');
  // Same gate as other sections: only when the profile's nav shows it and the org is entitled.
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  if (!composeNav(profile, data.modules).some((i) => i.path === 'onsite')) notFound();
  const t = await getTranslations();
  // Org roles scan every event; event-scoped door staff scan this one. Devices are org-level.
  const manageDevices = roleCan(data.role, 'checkin:scan');
  const canScan = manageDevices || eventRoleCan(await eventRolesOf(data.ctx, ev.id), 'checkin:scan');
  if (!canScan) {
    return (
      <>
        <PageHeader title={t('checkin.title')} />
        <EmptyState title={t('checkin.noAccessTitle')} description={t('checkin.noAccessDescription')} />
      </>
    );
  }
  const status = await executeQuery(checkinStatusQuery, { eventId: ev.id }, data.ctx, ports);
  const devices = manageDevices ? await executeQuery(listDevicesQuery, {}, data.ctx, ports) : [];
  // Setting up the venue is event management; picking where you stand is for every scanner.
  const manageCheckpoints = can('events:write');
  const checkpoints = await executeQuery(
    listCheckpointsQuery,
    { eventId: ev.id, includeArchived: manageCheckpoints },
    data.ctx,
    ports,
  );
  const ticketTypes = manageCheckpoints
    ? await executeQuery(listTicketTypesQuery, { eventId: ev.id }, data.ctx, ports)
    : [];
  const typeName = new Map(ticketTypes.map((tt) => [tt.id, tt.name]));
  // Checkpoint-scoped door staff only see (and may only pick) their checkpoints.
  const scope = await executeQuery(myScanScopeQuery, { eventId: ev.id }, data.ctx, ports);
  const standable = checkpoints.filter(
    (c) => !c.archived && (scope.checkpointIds === null || scope.checkpointIds.includes(c.id)),
  );
  const doorStaff =
    manageDevices && roleCan(data.role, 'events:read')
      ? (await executeQuery(doorStaffQuery, { eventId: ev.id }, data.ctx, ports)).staff
      : [];
  const people = await getUsersByIds([
    ...new Set([
      ...status.staff.flatMap((s) => s.userIds),
      ...status.signals.flatMap((s) => (s.userId ? [s.userId] : [])),
      ...devices.flatMap((d) => (d.assignedUserId ? [d.assignedUserId] : [])),
      ...doorStaff.map((d) => d.userId),
    ]),
  ]);
  const nameOf = (id: string) => people.get(id)?.name ?? t('team.unknownUser');
  const cpName = new Map(checkpoints.map((c) => [c.id, c.name]));
  const base = `/o/${org}/e/${event}/onsite`;
  const seen = new Intl.DateTimeFormat(locale, {
    timeZone: ev.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const time = new Intl.DateTimeFormat(locale, { timeZone: ev.timezone, hour: 'numeric', minute: '2-digit' });
  return (
    <>
      <PageHeader
        title={t('checkin.title')}
        description={t('checkin.progress', {
          admitted: formatNumber(status.admittedToday, locale),
          issued: formatNumber(status.issued, locale),
        })}
      />
      <AutoRefresh seconds={10} />
      <LiveCheckins url={realtimeUrl(realtimeChannelName(CHECKINS_CHANNEL, data.org.id, ev.id))} />
      {status.byCheckpoint.length > 0 ? (
        <ul className="flex list-none flex-wrap gap-2 p-0" aria-label={t('checkpoints.perEntrance')}>
          {status.byCheckpoint.map((c) => (
            <li
              key={c.checkpointId}
              className="rounded-pill border border-line bg-surface px-4 py-1.5 text-caption"
            >
              {c.name} · {formatNumber(c.admittedToday, locale)}
            </li>
          ))}
        </ul>
      ) : null}
      <Scanner
        action={scanAction.bind(null, org, event)}
        timeZone={ev.timezone}
        checkpoints={standable.map((c) => ({ id: c.id, name: c.name }))}
        scoped={scope.checkpointIds !== null}
        presenceUrl={`/api/command-center/${org}/${event}/presence`}
      />
      {/* M4.8e: at a gala with an open campaign, the desk shows guests the card-saving QR code. */}
      {data.modules.has('donations') ? (
        <CardSavingQr orgId={data.org.id} eventId={ev.id} slug={ev.slug} source="checkin" />
      ) : null}
      {status.signals.length > 0 ? (
        <section
          aria-labelledby="signals-heading"
          className="flex flex-col gap-2 rounded-panel border-2 border-primary bg-primary-soft px-5 py-4 text-primary-ink"
        >
          <h2 id="signals-heading" className="text-section">
            {t('checkpoints.signalsTitle', { count: status.signals.length })}
          </h2>
          <ul className="flex list-none flex-col gap-1.5 p-0 text-body">
            {status.signals.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-2">
                <StatusDot status={SEVERITY_DOT[s.severity]} label={t(`signals.severity.${s.severity}`)} />
                <span>
                  {time.format(s.at)} · {t(`checkpoints.signal.${s.kind}`)}
                  {signalSummary(s, t, nameOf)}
                </span>
              </li>
            ))}
          </ul>
          <Link href={`${base}/signals`} className="self-start text-body underline">
            {t('signals.openList')}
          </Link>
        </section>
      ) : (
        <p className="text-caption text-ink-2">
          <Link href={`${base}/signals`} className="underline">
            {t('signals.openList')}
          </Link>
        </p>
      )}
      <section aria-labelledby="door-staff-heading" className="flex flex-col gap-3">
        <h2 id="door-staff-heading" className="text-section">
          {t('doorStaff.byCheckpoint')}
        </h2>
        <ul className="flex list-none flex-col divide-y divide-line rounded-card border border-line bg-surface p-0">
          {status.staff
            .filter((s) => s.checkpointId === null || cpName.has(s.checkpointId))
            .map((s) => (
              <li
                key={s.checkpointId ?? 'event'}
                className="flex flex-wrap items-baseline gap-x-3 px-4 py-2.5"
              >
                <span className="min-w-32 font-medium">
                  {s.checkpointId ? cpName.get(s.checkpointId) : t('doorStaff.anywhere')}
                </span>
                <span className="text-body text-ink-2">
                  {s.userIds.length > 0 ? s.userIds.map(nameOf).join(', ') : t('doorStaff.nobody')}
                </span>
              </li>
            ))}
        </ul>
        {roleCan(data.role, 'events:read') ? (
          <Link href={`${base}/staff`} className={buttonClass('secondary', 'sm', 'self-start')}>
            {t('doorStaff.manage')}
          </Link>
        ) : null}
      </section>
      {status.alerts.length > 0 ? (
        <section
          aria-labelledby="alerts-heading"
          className="flex flex-col gap-2 rounded-panel border-2 border-danger bg-danger-soft px-5 py-4 text-danger"
        >
          <h2 id="alerts-heading" className="text-section">
            {t('checkin.alertsTitle', { count: status.alerts.length })}
          </h2>
          <p className="text-body">{t('checkin.alertsHint')}</p>
          <ul className="flex list-none flex-col gap-1 p-0 text-body">
            {status.alerts.map((a, i) => (
              <li key={`${a.at.toISOString()}-${i}`}>
                {time.format(a.at)} · {a.holderName ?? '—'} ·{' '}
                <span className="font-mono">{a.shortCode ?? ''}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="recent-heading" className="flex flex-col gap-3">
        <h2 id="recent-heading" className="text-section">
          {t('checkin.recent')}
        </h2>
        {status.recent.length === 0 ? (
          <EmptyState title={t('checkin.noScansTitle')} description={t('checkin.noScansDescription')} />
        ) : (
          <Card size="panel">
            <ol className="flex list-none flex-col divide-y divide-line p-0">
              {status.recent.map((r, i) => (
                <li key={`${r.at.toISOString()}-${i}`} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="w-16 font-mono text-caption text-ink-2">{time.format(r.at)}</span>
                  <StatusDot
                    status={r.undone ? 'neutral' : DOT[r.result]}
                    label={r.undone ? t('checkin.undone') : t(`checkin.result.${r.result}`)}
                  />
                  <span className="min-w-0 flex-1 truncate">{r.holderName ?? ''}</span>
                  {r.admissionId && !r.undone ? (
                    <form action={undoAction.bind(null, org, event, r.admissionId)}>
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        aria-label={t('checkin.undoFor', { name: r.holderName ?? '' })}
                      >
                        {t('checkin.undo')}
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ol>
          </Card>
        )}
      </section>
      {manageCheckpoints ? (
        <section aria-labelledby="checkpoints-heading" className="flex flex-col gap-3">
          <h2 id="checkpoints-heading" className="text-section">
            {t('checkpoints.title')}
          </h2>
          <p className="text-caption text-ink-2">{t('checkpoints.description')}</p>
          {checkpoints.length > 0 ? (
            <Card size="panel">
              <ul className="flex list-none flex-col divide-y divide-line p-0">
                {checkpoints.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block">{c.name}</span>
                      <span className="text-caption text-ink-2">
                        {c.archived
                          ? t('checkpoints.archived')
                          : c.kind === 'entrance'
                            ? t('checkpoints.entrance')
                            : c.ticketTypeIds.length === 0
                              ? t('checkpoints.zoneAll')
                              : t('checkpoints.zoneFor', {
                                  types: c.ticketTypeIds.map((id) => typeName.get(id) ?? '—').join(', '),
                                })}
                        {c.capacity !== null ? ` · ${t('checkpoints.holds', { count: c.capacity })}` : ''}
                        {c.latitude !== null && c.longitude !== null
                          ? ` · ${t('checkpoints.located', { lat: c.latitude.toFixed(5), lng: c.longitude.toFixed(5) })}`
                          : ''}
                      </span>
                    </span>
                    <form action={checkpointArchivedAction.bind(null, org, event, c.id, !c.archived)}>
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        aria-label={t(c.archived ? 'checkpoints.restoreFor' : 'checkpoints.archiveFor', {
                          name: c.name,
                        })}
                      >
                        {t(c.archived ? 'checkpoints.restore' : 'checkpoints.archive')}
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Card>
            <CheckpointForm
              ticketTypes={ticketTypes.map((tt) => ({ id: tt.id, name: tt.name }))}
              action={createCheckpointAction.bind(null, org, event)}
            />
          </Card>
        </section>
      ) : null}
      {manageDevices ? (
        <section aria-labelledby="devices-heading" className="flex flex-col gap-3">
          <h2 id="devices-heading" className="text-section">
            {t('devices.title')}
          </h2>
          <p className="text-caption text-ink-2">{t('devices.description')}</p>
          {devices.length > 0 ? (
            <Card size="panel">
              <ul className="flex list-none flex-col divide-y divide-line p-0">
                {devices.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block">
                        {d.label}
                        {d.assignedUserId ? (
                          <span className="text-caption text-ink-2">
                            {' '}
                            · {t('devices.handedToName', { name: nameOf(d.assignedUserId) })}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-caption text-ink-2">
                        {d.revoked
                          ? t('devices.revoked')
                          : d.wipeRequested
                            ? t('devices.wipePending')
                            : d.lastSeenAt
                              ? t('devices.lastSeen', {
                                  when: seen.format(d.lastSeenAt),
                                  battery: d.batteryPct ?? '—',
                                  queue: d.queueDepth ?? 0,
                                })
                              : t('devices.neverSeen')}
                      </span>
                    </span>
                    {d.revoked ? null : (
                      <span className="flex gap-1">
                        {d.wipeRequested ? null : (
                          <form action={deviceStateAction.bind(null, org, event, d.id, 'wipe')}>
                            <Button
                              type="submit"
                              variant="ghost"
                              size="sm"
                              aria-label={t('devices.wipeFor', { label: d.label })}
                            >
                              {t('devices.wipe')}
                            </Button>
                          </form>
                        )}
                        <form action={deviceStateAction.bind(null, org, event, d.id, 'revoke')}>
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            aria-label={t('devices.revokeFor', { label: d.label })}
                          >
                            {t('devices.revoke')}
                          </Button>
                        </form>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <DeviceEnrollForm
            eventId={ev.id}
            action={enrollDeviceAction.bind(null, org, event)}
            staff={doorStaff.map((d) => ({ id: d.userId, name: nameOf(d.userId) }))}
          />
        </section>
      ) : null}
    </>
  );
}
