import { listEventsQuery } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import {
  agreementsQuery,
  legalPagesQuery,
  listInvitationsQuery,
  listMembersQuery,
  roleCan,
} from '@yayatoh/tenancy';
import { buttonClass, Card, EmptyState, Label, PageHeader, Skeleton, StatusDot } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { type ReactNode, Suspense } from 'react';
import { Link } from '@/i18n/navigation.ts';
import { eventPhase, greetingKey } from '@/lib/event-status.ts';
import { formatEventDateRange } from '@/lib/format.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

const STATUS_DOT = {
  draft: 'neutral',
  published: 'success',
  postponed: 'warning',
  cancelled: 'danger',
  completed: 'info',
  archived: 'info',
} as const;

export default async function OrgHome({ params }: { params: Promise<{ locale: string; org: string }> }) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations();
  const firstName = data.session.name.split(' ')[0] ?? data.session.name;
  const canWrite = roleCan(data.role, 'events:write');
  const create = canWrite ? (
    <Link href={`/o/${org}/events/new`} className={buttonClass('primary')}>
      {t('orgHome.create')}
    </Link>
  ) : undefined;
  return (
    <>
      <PageHeader
        title={t(`greeting.${greetingKey(data.org.timezone)}`, { name: firstName })}
        description={data.org.name}
        actions={create}
      />
      {roleCan(data.role, 'org:update') ? <SetupChecklist org={org} /> : null}
      <section aria-labelledby="events-heading" className="flex flex-col gap-3">
        <h2 id="events-heading" className="text-section">
          {t('orgHome.events')}
        </h2>
        <Suspense fallback={<EventsSkeleton label={t('common.loading')} />}>
          <EventList org={org} locale={locale} create={create} />
        </Suspense>
      </section>
    </>
  );
}

function EventsSkeleton({ label }: { label: string }) {
  return (
    <div role="status" className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-52" />
      <Skeleton className="h-52" />
      <Skeleton className="h-52" />
    </div>
  );
}

async function EventList({ org, locale, create }: { org: string; locale: string; create: ReactNode }) {
  const data = await loadConsole(org);
  const t = await getTranslations();
  const events = (await executeQuery(listEventsQuery, {}, data.ctx, ports)).filter(
    (e) => e.status !== 'archived',
  );
  return (
    <>
      {events.length === 0 ? (
        <EmptyState
          title={t('orgHome.emptyTitle')}
          description={t('orgHome.emptyDescription')}
          action={create}
        />
      ) : (
        <ul className="grid list-none grid-cols-1 gap-3.5 p-0 md:grid-cols-2 xl:grid-cols-3">
          {events.map((e) => {
            const phase = eventPhase(e.startsAt.toISOString(), e.endsAt.toISOString());
            return (
              <li key={e.id}>
                <Card className="flex h-full flex-col gap-3">
                  <Label>{t(`profiles.${e.profile}`)}</Label>
                  <h3 className="text-[22px] leading-tight font-light tracking-[-0.03em]">{e.name}</h3>
                  <p className="text-body text-zinc-500">
                    {formatEventDateRange(e.startsAt.toISOString(), e.endsAt.toISOString(), {
                      locale,
                      currency: e.currency,
                      timeZone: e.timezone,
                    })}
                    {e.venueName ? ` · ${e.venueName}` : ''}
                  </p>
                  <StatusDot
                    status={STATUS_DOT[e.status]}
                    label={`${t(`eventStatus.${e.status}`)} · ${t(`phase.${phase.phase}`, { days: phase.days })}`}
                  />
                  <Link
                    href={`/o/${org}/e/${e.slug}`}
                    className={buttonClass('secondary', 'md', 'mt-auto self-start')}
                  >
                    {t('orgHome.open')}
                  </Link>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/**
 * Setup checklist (M1.3): what an organizer still needs before selling. Hidden once everything is
 * done. Payouts join the list with Connect onboarding (M1.3c).
 */
async function SetupChecklist({ org }: { org: string }) {
  const data = await loadConsole(org);
  const t = await getTranslations('setup');
  const [agreements, legal, events, members, invitations] = await Promise.all([
    executeQuery(agreementsQuery, {}, data.ctx, ports),
    executeQuery(legalPagesQuery, {}, data.ctx, ports),
    executeQuery(listEventsQuery, {}, data.ctx, ports),
    executeQuery(listMembersQuery, {}, data.ctx, ports),
    roleCan(data.role, 'members:manage') ? executeQuery(listInvitationsQuery, {}, data.ctx, ports) : [],
  ]);
  const items = [
    { key: 'terms', done: agreements.every((a) => a.acceptedAt !== null), href: `/o/${org}/settings` },
    {
      key: 'legal',
      done: ['privacy', 'refund'].every((k) => legal.some((p) => p.kind === k)),
      href: `/o/${org}/settings`,
    },
    { key: 'brand', done: data.org.brandColor !== null, href: `/o/${org}/settings` },
    { key: 'event', done: events.length > 0, href: `/o/${org}/events/new` },
    { key: 'team', done: members.length > 1 || invitations.length > 0, href: `/o/${org}/team` },
  ];
  const doneCount = items.filter((i) => i.done).length;
  if (doneCount === items.length) return null;
  return (
    <section aria-labelledby="setup-heading" className="flex flex-col gap-3">
      <h2 id="setup-heading" className="text-section">
        {t('title', { done: doneCount, total: items.length })}
      </h2>
      <Card className="flex flex-col">
        <ul className="flex list-none flex-col divide-y divide-zinc-100 p-0">
          {items.map((i) => (
            <li key={i.key} className="flex min-h-11 items-center gap-3 py-2">
              <StatusDot status={i.done ? 'success' : 'neutral'} label={i.done ? t('done') : t('todo')} />
              {i.done ? (
                <span className="text-zinc-500 line-through">{t(`item.${i.key}`)}</span>
              ) : (
                <Link href={i.href} className="underline underline-offset-2">
                  {t(`item.${i.key}`)}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
