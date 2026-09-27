import { listEventsQuery } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
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
