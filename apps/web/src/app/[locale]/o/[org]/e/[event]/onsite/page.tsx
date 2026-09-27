import { checkinStatusQuery, listCheckpointsQuery, listDevicesQuery } from '@yayatoh/checkin';
import { eventRolesOf } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { composeNav, isProfileKey } from '@yayatoh/platform';
import { eventRoleCan, roleCan } from '@yayatoh/tenancy';
import { listTicketTypesQuery } from '@yayatoh/ticketing';
import { Button, Card, EmptyState, PageHeader, StatusDot } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AutoRefresh } from '@/components/auto-refresh.tsx';
import { CheckpointForm } from '@/components/checkpoint-form.tsx';
import { DeviceEnrollForm } from '@/components/device-enroll-form.tsx';
import { Scanner } from '@/components/scanner.tsx';
import { formatNumber } from '@/lib/format.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
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
  outside_window: 'warning',
  duplicate_offline: 'danger',
  superseded: 'danger',
  provisional: 'warning',
  granted: 'success',
  no_access: 'danger',
} as const;

/** Door check-in: HID scanners and manual entry, entrances and zones, devices and alerts. */
export default async function OnsitePage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event);
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
  const manageCheckpoints = roleCan(data.role, 'events:write');
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
      {status.byCheckpoint.length > 0 ? (
        <ul className="flex list-none flex-wrap gap-2 p-0" aria-label={t('checkpoints.perEntrance')}>
          {status.byCheckpoint.map((c) => (
            <li
              key={c.checkpointId}
              className="rounded-pill border border-zinc-200 bg-white px-4 py-1.5 text-caption"
            >
              {c.name} · {formatNumber(c.admittedToday, locale)}
            </li>
          ))}
        </ul>
      ) : null}
      <Scanner
        action={scanAction.bind(null, org, event)}
        timeZone={ev.timezone}
        checkpoints={checkpoints.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name }))}
      />
      {status.signals.length > 0 ? (
        <section
          aria-labelledby="signals-heading"
          className="flex flex-col gap-2 rounded-panel border-2 border-accent-700 bg-accent-50 px-5 py-4 text-accent-text"
        >
          <h2 id="signals-heading" className="text-section">
            {t('checkpoints.signalsTitle', { count: status.signals.length })}
          </h2>
          <ul className="flex list-none flex-col gap-1 p-0 text-body">
            {status.signals.map((s, i) => (
              <li key={`${s.at.toISOString()}-${i}`}>
                {time.format(s.at)} · {t(`checkpoints.signal.${s.kind}`)}
                {s.holderName ? ` · ${s.holderName}` : ''}
                {s.checkpointName ? ` · ${s.checkpointName}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {status.alerts.length > 0 ? (
        <section
          aria-labelledby="alerts-heading"
          className="flex flex-col gap-2 rounded-panel border-2 border-pink-700 bg-pink-50 px-5 py-4 text-pink-700"
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
            <ol className="flex list-none flex-col divide-y divide-zinc-100 p-0">
              {status.recent.map((r, i) => (
                <li key={`${r.at.toISOString()}-${i}`} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="w-16 font-mono text-caption text-zinc-500">{time.format(r.at)}</span>
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
          <p className="text-caption text-zinc-500">{t('checkpoints.description')}</p>
          {checkpoints.length > 0 ? (
            <Card size="panel">
              <ul className="flex list-none flex-col divide-y divide-zinc-100 p-0">
                {checkpoints.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block">{c.name}</span>
                      <span className="text-caption text-zinc-500">
                        {c.archived
                          ? t('checkpoints.archived')
                          : c.kind === 'entrance'
                            ? t('checkpoints.entrance')
                            : c.ticketTypeIds.length === 0
                              ? t('checkpoints.zoneAll')
                              : t('checkpoints.zoneFor', {
                                  types: c.ticketTypeIds.map((id) => typeName.get(id) ?? '—').join(', '),
                                })}
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
          <p className="text-caption text-zinc-500">{t('devices.description')}</p>
          {devices.length > 0 ? (
            <Card size="panel">
              <ul className="flex list-none flex-col divide-y divide-zinc-100 p-0">
                {devices.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block">{d.label}</span>
                      <span className="text-caption text-zinc-500">
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
          <DeviceEnrollForm eventId={ev.id} action={enrollDeviceAction.bind(null, org, event)} />
        </section>
      ) : null}
    </>
  );
}
