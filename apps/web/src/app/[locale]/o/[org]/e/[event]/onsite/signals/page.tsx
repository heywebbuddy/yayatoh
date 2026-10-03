import { getUsersByIds } from '@yayatoh/auth';
import {
  detectionSettingsQuery,
  FRAUD_SEVERITIES,
  FRAUD_SIGNAL_KINDS,
  type FraudSeverity,
  type FraudSignalKind,
  listFraudSignalsQuery,
} from '@yayatoh/checkin';
import { eventRolesOf } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { composeNav, isProfileKey } from '@yayatoh/platform';
import { eventRoleCan, roleCan } from '@yayatoh/tenancy';
import { Button, Card, EmptyState, PageHeader, Select } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DetectionForm } from '@/components/detection-form.tsx';
import { SignalItem } from '@/components/signal-item.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { resolveSignalAction, saveDetectionAction } from './actions.ts';

const STATUSES = ['all', 'open', 'acknowledged', 'dismissed'] as const;
type StatusFilter = (typeof STATUSES)[number];

const pick = <T extends string>(list: readonly T[], v: string | string[] | undefined): T | undefined =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined;

/**
 * The event's Signals list (M1.9d fraud list, M1.9e: every source). Filter by kind, severity and
 * status (a GET form: the filter is in the URL); managers acknowledge or dismiss with a note
 * (audited) and tune the velocity rules; door staff read it; others can't open it.
 */
export default async function SignalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const { data, event: ev } = await loadEvent(org, event, 'onsite');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  if (!composeNav(profile, data.modules).some((i) => i.path === 'onsite')) notFound();
  const t = await getTranslations();
  const roles = await eventRolesOf(data.ctx, ev.id);
  const canRead = roleCan(data.role, 'checkin:scan') || eventRoleCan(roles, 'checkin:scan');
  if (!canRead) {
    return (
      <>
        <PageHeader title={t('signals.title')} />
        <EmptyState title={t('checkin.noAccessTitle')} description={t('signals.noAccess')} />
      </>
    );
  }
  const canTriage = roleCan(data.role, 'events:write') || eventRoleCan(roles, 'events:write');
  const kind = pick<FraudSignalKind>(FRAUD_SIGNAL_KINDS, sp.kind);
  const severity = pick<FraudSeverity>(FRAUD_SEVERITIES, sp.severity);
  const status: StatusFilter = pick(STATUSES, sp.status) ?? 'all';
  const filtered = Boolean(kind || severity || status !== 'all');
  const signals = await executeQuery(
    listFraudSignalsQuery,
    { eventId: ev.id, status, ...(kind ? { kind } : {}), ...(severity ? { severity } : {}) },
    data.ctx,
    ports,
  );
  const settings = await executeQuery(detectionSettingsQuery, { eventId: ev.id }, data.ctx, ports);
  const people = await getUsersByIds([...new Set(signals.flatMap((s) => (s.userId ? [s.userId] : [])))]);
  const open = signals.filter((s) => s.status === 'open').length;
  const base = `/o/${org}/e/${event}`;
  const select = 'field';
  return (
    <>
      <PageHeader
        title={t('signals.title')}
        description={
          filtered
            ? t('fraudSignals.filter.showing', { count: signals.length })
            : t('signals.description', { open })
        }
      />
      <Link href={`${base}/onsite`} className="text-body underline">
        {t('doorStaff.back')}
      </Link>
      <form
        method="get"
        aria-label={t('fraudSignals.filter.title')}
        className="flex flex-wrap items-end gap-3"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="signal-kind" className="text-[13px] font-bold text-ink">
            {t('fraudSignals.filter.kind')}
          </label>
          <Select id="signal-kind" name="kind" defaultValue={kind ?? ''} className={select}>
            <option value="">{t('fraudSignals.filter.allKinds')}</option>
            {FRAUD_SIGNAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`checkpoints.signal.${k}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="signal-severity" className="text-[13px] font-bold text-ink">
            {t('fraudSignals.filter.severity')}
          </label>
          <Select id="signal-severity" name="severity" defaultValue={severity ?? ''} className={select}>
            <option value="">{t('fraudSignals.filter.allSeverities')}</option>
            {FRAUD_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {t(`signals.severity.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="signal-status" className="text-[13px] font-bold text-ink">
            {t('fraudSignals.filter.status')}
          </label>
          <Select id="signal-status" name="status" defaultValue={status} className={select}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? t('fraudSignals.filter.allStatuses') : t(`signals.status.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          {t('fraudSignals.filter.apply')}
        </Button>
        {filtered ? (
          <Link href={`${base}/onsite/signals`} className="min-h-6 self-center text-body underline">
            {t('fraudSignals.filter.clear')}
          </Link>
        ) : null}
      </form>
      <section aria-labelledby="signal-list-heading" className="flex flex-col gap-3">
        <h2 id="signal-list-heading" className="text-section">
          {t('signals.listTitle')}
        </h2>
        {signals.length === 0 ? (
          filtered ? (
            <EmptyState
              title={t('fraudSignals.filter.emptyTitle')}
              description={t('fraudSignals.filter.emptyDescription')}
            />
          ) : (
            <EmptyState title={t('signals.emptyTitle')} description={t('signals.emptyDescription')} />
          )
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {signals.map((s) => (
              <li key={s.id}>
                <SignalItem
                  signal={s}
                  timeZone={ev.timezone}
                  people={Object.fromEntries([...people].map(([id, u]) => [id, u.name]))}
                  orderHref={
                    s.orderId && roleCan(data.role, 'orders:read') ? `${base}/orders/${s.orderId}` : null
                  }
                  threadHref={
                    s.threadId && roleCan(data.role, 'messages:read')
                      ? `/o/${org}/messages/${s.threadId}`
                      : null
                  }
                  action={canTriage ? resolveSignalAction.bind(null, org, event, s.id) : null}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="detection-heading" className="flex flex-col gap-3">
        <h2 id="detection-heading" className="text-section">
          {t('signals.settings.title')}
        </h2>
        <p className="text-caption text-ink-2">{t('signals.settings.description')}</p>
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
