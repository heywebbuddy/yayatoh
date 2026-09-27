import { buttonClass, Card, EmptyState, Label, PageHeader, StatusDot } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { demoEventsFor } from '@/demo/events.ts';
import { Link } from '@/i18n/navigation.ts';
import { eventPhase, greetingKey } from '@/lib/event-status.ts';
import { formatEventDateRange } from '@/lib/format.ts';
import { loadConsole } from '@/server/console.ts';

export default async function OrgHome({ params }: { params: Promise<{ locale: string; org: string }> }) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations();
  const events = demoEventsFor(org);
  const firstName = data.session.name.split(' ')[0] ?? data.session.name;
  return (
    <>
      <PageHeader
        title={t(`greeting.${greetingKey(data.org.timezone)}`, { name: firstName })}
        description={t('orgHome.subtitle', { org: data.org.name, count: events.length })}
      />
      <section aria-labelledby="events-heading" className="flex flex-col gap-3">
        <h2 id="events-heading" className="text-section">
          {t('orgHome.events')}
        </h2>
        {events.length === 0 ? (
          <EmptyState title={t('orgHome.emptyTitle')} description={t('orgHome.emptyDescription')} />
        ) : (
          <ul className="grid list-none grid-cols-1 gap-3.5 p-0 md:grid-cols-2 xl:grid-cols-3">
            {events.map((e) => {
              const phase = eventPhase(e.startsAt, e.endsAt);
              return (
                <li key={e.slug}>
                  <Card className="flex h-full flex-col gap-3">
                    <Label>{t(`profiles.${e.profile}`)}</Label>
                    <h3 className="text-[22px] leading-tight font-light tracking-[-0.03em]">{e.name}</h3>
                    <p className="text-body text-zinc-500">
                      {formatEventDateRange(e.startsAt, e.endsAt, {
                        locale,
                        currency: e.currency,
                        timeZone: e.timezone,
                      })}
                      {' · '}
                      {e.venue}
                    </p>
                    <StatusDot
                      status={phase.phase === 'live' ? 'success' : 'warning'}
                      label={t(`phase.${phase.phase}`, { days: phase.days })}
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
      </section>
    </>
  );
}
