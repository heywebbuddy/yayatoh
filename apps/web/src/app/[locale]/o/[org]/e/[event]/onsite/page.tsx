import { checkinStatusQuery, listDevicesQuery } from '@yayatoh/checkin';
import { executeQuery } from '@yayatoh/kernel';
import { composeNav, isProfileKey } from '@yayatoh/platform';
import { roleCan } from '@yayatoh/tenancy';
import { Button, Card, EmptyState, PageHeader, StatusDot } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DeviceEnrollForm } from '@/components/device-enroll-form.tsx';
import { Scanner } from '@/components/scanner.tsx';
import { formatNumber } from '@/lib/format.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { deviceStateAction, enrollDeviceAction, scanAction, undoAction } from './actions.ts';

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
} as const;

/** Door check-in: HID scanners and manual entry (camera and offline arrive in M1.9b). */
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
  if (!roleCan(data.role, 'checkin:scan')) {
    return (
      <>
        <PageHeader title={t('checkin.title')} />
        <EmptyState title={t('checkin.noAccessTitle')} description={t('checkin.noAccessDescription')} />
      </>
    );
  }
  const status = await executeQuery(checkinStatusQuery, { eventId: ev.id }, data.ctx, ports);
  const devices = await executeQuery(listDevicesQuery, {}, data.ctx, ports);
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
      <Scanner action={scanAction.bind(null, org, event)} timeZone={ev.timezone} />
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
        <DeviceEnrollForm action={enrollDeviceAction.bind(null, org, event)} />
      </section>
    </>
  );
}
