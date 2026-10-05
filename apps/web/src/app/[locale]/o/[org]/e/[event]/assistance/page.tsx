import { ASSISTANCE_CHANNEL, assigneesQuery, queueQuery, type RequestDto } from '@yayatoh/assistance';
import { getUsersByIds } from '@yayatoh/auth';
import { executeQuery } from '@yayatoh/kernel';
import { realtimeChannelName } from '@yayatoh/platform';
import {
  Alert,
  buttonClass,
  Card,
  EmptyState,
  PageHeader,
  StatCard,
  StatusPill,
  Tabs,
  tabClass,
} from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AssistanceLive, RequestActions } from '@/components/assistance-queue.tsx';
import { SlaTimer } from '@/components/assistance-sla.tsx';
import { Crumbs } from '@/components/crumbs.tsx';
import { Link } from '@/i18n/navigation.ts';
import { realtimeUrl } from '@/lib/realtime-url.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { assistanceAction } from './actions.ts';

const PRIORITY_TONE = { urgent: 'danger', high: 'waiting', normal: 'neutral' } as const;
const STATE_TONE = {
  new: 'waiting',
  assigned: 'info',
  in_progress: 'brand',
  resolved: 'success',
  cancelled: 'neutral',
} as const;

/**
 * The event's help queue (M3.3b): guests' "Need help" requests from the seat finder and door
 * staff's requests from the Scan PWA, most urgent first, each with its SLA timer, where it is,
 * what was asked, who has it and what happened. People who work the queue take, assign, start,
 * resolve or cancel requests and add notes; viewers read. Updates live over the event's
 * assistance channel.
 */
export default async function AssistancePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can, opens } = await loadEvent(org, event, 'assistance');
  if (!data.modules.has('checkin')) notFound();
  const t = await getTranslations('assistance');
  const crumbs = (
    <Crumbs
      items={[
        { label: data.org.name, href: `/o/${org}` },
        { label: ev.name, href: `/o/${org}/e/${event}` },
        { label: t('pageTitle') },
      ]}
    />
  );
  if (!can('assistance:read'))
    return (
      <>
        <PageHeader breadcrumb={crumbs} title={t('pageTitle')} />
        <EmptyState
          title={t('noAccessTitle')}
          description={t('noAccess')}
          action={
            <Link href={`/o/${org}/e/${event}`} className={buttonClass('primary', 'md')}>
              {t('backToEvent')}
            </Link>
          }
        />
      </>
    );
  const status = (await searchParams).status === 'closed' ? 'closed' : 'open';
  const canManage = can('assistance:manage');
  const [requests, staff] = await Promise.all([
    executeQuery(queueQuery, { eventId: ev.id, status }, data.ctx, ports),
    canManage ? executeQuery(assigneesQuery, { eventId: ev.id }, data.ctx, ports) : Promise.resolve([]),
  ]);
  const userIds = new Set<string>(staff.map((s) => s.userId));
  for (const r of requests) {
    if (r.assignee?.kind === 'user') userIds.add(r.assignee.id);
    for (const a of r.activity) {
      if (a.actorUserId) userIds.add(a.actorUserId);
      if (a.assigneeUserId) userIds.add(a.assigneeUserId);
    }
  }
  const people = await getUsersByIds([...userIds]);
  const me = data.session.userId;
  const nameOf = (id: string) => (id === me ? t('you') : (people.get(id)?.name ?? t('unknownPerson')));
  const options = staff
    .map((s) => ({ id: s.userId, name: nameOf(s.userId) }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  const when = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: ev.timezone });
  const base = `/o/${org}/e/${event}/assistance`;
  const serverNow = new Date().toISOString();

  const assigneeText = (r: RequestDto) =>
    !r.assignee
      ? t('unassigned')
      : r.assignee.kind === 'user'
        ? t('assignedTo', { name: nameOf(r.assignee.id) })
        : t('assignedTo', { name: r.assignee.label ?? t('aDevice') });
  const actorText = (a: RequestDto['activity'][number]) =>
    a.actor === 'member' && a.actorUserId
      ? nameOf(a.actorUserId)
      : a.actor === 'device'
        ? (a.actorDevice ?? t('aDevice'))
        : t(`actor.${a.actor}`);
  const activityText = (a: RequestDto['activity'][number]) =>
    a.kind === 'assigned'
      ? t('activity.assigned', {
          who: actorText(a),
          to: a.assigneeUserId ? nameOf(a.assigneeUserId) : (a.assigneeDevice ?? t('aDevice')),
        })
      : a.kind === 'note'
        ? t('activity.note', { who: actorText(a), note: a.body })
        : t(`activity.${a.kind}`, { who: actorText(a) });

  return (
    <>
      <PageHeader
        breadcrumb={crumbs}
        title={t('pageTitle')}
        description={t('description', { event: ev.name })}
      />
      <AssistanceLive url={realtimeUrl(realtimeChannelName(ASSISTANCE_CHANNEL, data.org.id, ev.id))} />
      {status === 'open' ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="assistance-stats">
          <StatCard label={t('stats.open')} value={requests.length} />
          <StatCard
            label={t('stats.urgent')}
            value={requests.filter((r) => r.priority === 'urgent').length}
          />
          <StatCard label={t('stats.waiting')} value={requests.filter((r) => r.state === 'new').length} />
          <StatCard label={t('stats.unassigned')} value={requests.filter((r) => !r.assignee).length} />
        </div>
      ) : null}
      <Tabs label={t('statusLabel')} className="self-start">
        {(['open', 'closed'] as const).map((s) => (
          <Link
            key={s}
            href={s === 'open' ? base : `${base}?status=closed`}
            aria-current={s === status ? 'page' : undefined}
            className={tabClass(s === status)}
          >
            {t(`tab.${s}`)}
          </Link>
        ))}
      </Tabs>
      {!canManage ? <Alert tone="info" title={t('readOnly')} /> : null}
      {requests.length === 0 ? (
        <EmptyState
          title={status === 'open' ? t('empty.openTitle') : t('empty.closedTitle')}
          description={status === 'open' ? t('empty.openDescription') : t('empty.closedDescription')}
          action={
            status === 'closed' ? (
              <Link href={base} className={buttonClass('primary', 'md')}>
                {t('empty.showOpen')}
              </Link>
            ) : opens('commandCenter') ? (
              <Link href={`/o/${org}/e/${event}/command-center`} className={buttonClass('primary', 'md')}>
                {t('empty.toCommandCenter')}
              </Link>
            ) : (
              <Link href={`/o/${org}/e/${event}`} className={buttonClass('primary', 'md')}>
                {t('backToEvent')}
              </Link>
            )
          }
        />
      ) : (
        <ul className="flex list-none flex-col gap-4 p-0" aria-label={t(`tab.${status}`)}>
          {requests.map((r) => {
            const title = t('title', { number: r.number, reason: t(`reason.${r.reason}`) });
            const where = [
              r.location ? t('where', { place: r.location }) : null,
              r.checkpoint ? t('atEntrance', { name: r.checkpoint }) : null,
              r.device ? t('fromDevice', { device: r.device }) : null,
            ].filter(Boolean);
            return (
              <li key={r.id} data-request={r.number}>
                <Card size="panel" className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="m-0 text-card text-ink">{title}</h2>
                    <span className="flex flex-wrap items-center gap-2 text-caption">
                      <StatusPill tone={PRIORITY_TONE[r.priority]} label={t(`priority.${r.priority}`)} />
                      <span data-testid="request-state" className="inline-flex">
                        <StatusPill tone={STATE_TONE[r.state]} label={t(`state.${r.state}`)} />
                      </span>
                      <SlaTimer
                        dueAt={r.dueAt.toISOString()}
                        running={r.state === 'new'}
                        serverNow={serverNow}
                      />
                    </span>
                  </div>
                  <p className="m-0 text-caption text-ink-2 tabular-nums">
                    {[
                      t(`source.${r.source}`),
                      t('askedAt', { time: when.format(r.createdAt) }),
                      assigneeText(r),
                    ].join(' · ')}
                  </p>
                  {r.guest ? (
                    <p className="m-0 text-body font-bold text-ink">{t('guestLine', r.guest)}</p>
                  ) : null}
                  {where.length ? <p className="m-0 text-body text-ink">{where.join(' · ')}</p> : null}
                  {r.note ? (
                    <blockquote className="m-0 rounded-tile border-s-4 border-primary bg-surface-2 px-4 py-3 text-body text-ink">
                      {r.note}
                    </blockquote>
                  ) : null}
                  <details className="text-caption text-ink-2">
                    <summary className="min-h-6 cursor-pointer font-bold text-primary-ink">
                      {t('activityTitle', { count: r.activity.length })}
                    </summary>
                    <ol className="mt-2 flex list-none flex-col gap-1.5 border-s-2 border-line p-0 ps-3">
                      {r.activity.map((a, i) => (
                        <li key={`${r.id}-${i}`}>
                          <span className="font-bold text-ink tabular-nums">{when.format(a.at)}</span> ·{' '}
                          {activityText(a)}
                        </li>
                      ))}
                    </ol>
                  </details>
                  {canManage && status === 'open' ? (
                    <RequestActions
                      key={r.id}
                      requestId={r.id}
                      title={title}
                      state={r.state}
                      mine={r.mine}
                      staff={options}
                      action={assistanceAction.bind(null, org, event, r.id)}
                    />
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
