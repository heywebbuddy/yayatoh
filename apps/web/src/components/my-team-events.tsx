import { myTeamEventsQuery } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { buttonClass, Card, EmptyState, Label, PageHeader, StatusDot } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { eventPhase } from '@/lib/event-status.ts';
import { formatEventDateRange } from '@/lib/format.ts';
import type { ConsoleData } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

/**
 * M4.2a: the console of someone invited to specific events (a collaborator): just their events,
 * with their role on each. No org sections, no other events.
 */
export async function MyTeamEvents({
  data,
  org,
  locale,
}: {
  data: ConsoleData;
  org: string;
  locale: string;
}) {
  const t = await getTranslations();
  const events = await executeQuery(myTeamEventsQuery, {}, data.ctx, ports);
  return (
    <>
      <PageHeader
        title={t('myEvents.title')}
        description={t('myEvents.description', { org: data.org.name })}
      />
      {events.length === 0 ? (
        <EmptyState
          title={t('myEvents.emptyTitle')}
          description={t('myEvents.emptyDescription')}
          action={
            <Link href="/my-tickets" className={buttonClass('primary', 'md')}>
              {t('myEvents.myTickets')}
            </Link>
          }
        />
      ) : (
        <ul
          aria-label={t('myEvents.title')}
          className="grid list-none grid-cols-1 gap-3.5 p-0 md:grid-cols-2 xl:grid-cols-3"
        >
          {events.map((e) => {
            const phase = eventPhase(e.startsAt.toISOString(), e.endsAt.toISOString());
            return (
              <li key={e.id} data-event={e.slug}>
                <Card className="flex h-full flex-col gap-3">
                  <Label>
                    {t(`profiles.${e.profile}`)} · {e.roles.map((r) => t(`eventRoles.${r}`)).join(', ')}
                  </Label>
                  <h2 className="text-[22px] leading-tight font-extrabold tracking-[-0.03em]">{e.name}</h2>
                  <p className="text-body text-ink-2">
                    {formatEventDateRange(e.startsAt.toISOString(), e.endsAt.toISOString(), {
                      locale,
                      currency: 'USD',
                      timeZone: e.timezone,
                    })}
                  </p>
                  <StatusDot
                    status="neutral"
                    label={`${t(`eventStatus.${e.status}`)} · ${t(`phase.${phase.phase}`, { days: phase.days })}`}
                  />
                  <Link
                    href={`/o/${org}/e/${e.slug}`}
                    className={buttonClass('secondary', 'md', 'mt-auto self-start')}
                  >
                    {t('myEvents.open', { name: e.name })}
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
