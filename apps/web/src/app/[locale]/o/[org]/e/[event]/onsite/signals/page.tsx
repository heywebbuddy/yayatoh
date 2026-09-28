import { getUsersByIds } from '@yayatoh/auth';
import { detectionSettingsQuery, listFraudSignalsQuery } from '@yayatoh/checkin';
import { eventRolesOf } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { composeNav, isProfileKey } from '@yayatoh/platform';
import { eventRoleCan, roleCan } from '@yayatoh/tenancy';
import { Card, EmptyState, PageHeader, StatusDot } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DetectionForm } from '@/components/detection-form.tsx';
import { SignalActions } from '@/components/signal-actions.tsx';
import { SEVERITY_DOT, signalSummary } from '@/components/signal-summary.ts';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { resolveSignalAction, saveDetectionAction } from './actions.ts';

/**
 * The event's fraud list (M1.9d): every signal with its severity and status. Managers acknowledge
 * or dismiss (audited) and tune the velocity rules; door staff read it; others can't open it.
 */
export default async function SignalsPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event);
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  if (!composeNav(profile, data.modules).some((i) => i.path === 'onsite')) notFound();
  const t = await getTranslations();
  const canRead =
    roleCan(data.role, 'checkin:scan') || eventRoleCan(await eventRolesOf(data.ctx, ev.id), 'checkin:scan');
  if (!canRead) {
    return (
      <>
        <PageHeader title={t('signals.title')} />
        <EmptyState title={t('checkin.noAccessTitle')} description={t('signals.noAccess')} />
      </>
    );
  }
  const canTriage =
    roleCan(data.role, 'events:write') || eventRoleCan(await eventRolesOf(data.ctx, ev.id), 'events:write');
  const signals = await executeQuery(listFraudSignalsQuery, { eventId: ev.id }, data.ctx, ports);
  const settings = await executeQuery(detectionSettingsQuery, { eventId: ev.id }, data.ctx, ports);
  const people = await getUsersByIds([...new Set(signals.flatMap((s) => (s.userId ? [s.userId] : [])))]);
  const nameOf = (id: string) => people.get(id)?.name ?? t('team.unknownUser');
  const when = new Intl.DateTimeFormat(locale, {
    timeZone: ev.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const open = signals.filter((s) => s.status === 'open').length;
  return (
    <>
      <PageHeader title={t('signals.title')} description={t('signals.description', { open })} />
      <Link href={`/o/${org}/e/${event}/onsite`} className="text-body underline">
        {t('doorStaff.back')}
      </Link>
      <section aria-labelledby="signal-list-heading" className="flex flex-col gap-3">
        <h2 id="signal-list-heading" className="text-section">
          {t('signals.listTitle')}
        </h2>
        {signals.length === 0 ? (
          <EmptyState title={t('signals.emptyTitle')} description={t('signals.emptyDescription')} />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {signals.map((s) => {
              const what = `${t(`checkpoints.signal.${s.kind}`)}${signalSummary(s, t, nameOf)}`;
              return (
                <li key={s.id}>
                  <Card className="flex flex-col gap-2" data-signal={s.kind}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <StatusDot
                        status={SEVERITY_DOT[s.severity]}
                        label={t(`signals.severity.${s.severity}`)}
                      />
                      <span className="text-caption text-zinc-600">{when.format(s.at)}</span>
                      <span className="text-caption text-zinc-600">{t(`signals.status.${s.status}`)}</span>
                    </div>
                    <p className="text-body">{what}</p>
                    {canTriage ? (
                      <SignalActions
                        key={s.id}
                        open={s.status === 'open'}
                        label={what}
                        acknowledge={resolveSignalAction.bind(null, org, event, s.id, 'acknowledged')}
                        dismiss={resolveSignalAction.bind(null, org, event, s.id, 'dismissed')}
                      />
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section aria-labelledby="detection-heading" className="flex flex-col gap-3">
        <h2 id="detection-heading" className="text-section">
          {t('signals.settings.title')}
        </h2>
        <p className="text-caption text-zinc-500">{t('signals.settings.description')}</p>
        {canTriage ? (
          <Card>
            <DetectionForm
              action={saveDetectionAction.bind(null, org, event)}
              maxScansPerMinute={settings.maxScansPerMinute}
              maxTravelKmh={settings.maxTravelKmh}
            />
          </Card>
        ) : (
          <p className="text-body">
            {t('signals.settings.current', {
              rate: settings.maxScansPerMinute,
              kmh: settings.maxTravelKmh,
            })}
          </p>
        )}
      </section>
    </>
  );
}
