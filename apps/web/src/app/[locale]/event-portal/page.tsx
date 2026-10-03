import { Card, EmptyState, SectionHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PortalChangeStatus } from '@/components/portal-change-status.tsx';
import { PortalShell, PortalSignedOut } from '@/components/portal-shell.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatMoment, formatSessionTime } from '@/lib/portal-format.ts';
import { currentPortalPrincipal, loadSpeakerPortal } from '@/server/portal.ts';
import { ExhibitorPortal } from './exhibitor-portal.tsx';
import { SponsorPortal } from './sponsor-portal.tsx';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const kind = (await currentPortalPrincipal())?.subjectKind;
  const t = await getTranslations({
    locale,
    namespace:
      kind === 'exhibitor' ? 'exhibitorPortal' : kind === 'sponsor' ? 'sponsorPortal' : 'speakerPortal',
  });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * The portal's home (one sign-in for every portal role, M5.3a): the speaker portal's overview
 * (their sessions in the event time zone and open tasks), or for an exhibitor admin or staff
 * member the exhibitor portal (M5.4a), for a sponsor contact the sponsor portal (M5.4b).
 */
export default async function SpeakerPortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ signedOut?: string; logo?: string; paid?: string; export?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const principal = await currentPortalPrincipal();
  if (principal?.subjectKind === 'exhibitor')
    return (
      <ExhibitorPortal
        principal={principal}
        locale={locale}
        logoParam={(await searchParams).logo}
        paid={(await searchParams).paid === '1'}
        exportReady={(await searchParams).export === 'ready'}
      />
    );
  // M5.4b: a sponsor contact sees the sponsor portal.
  if (principal?.subjectKind === 'sponsor' && principal.role === 'sponsor_contact')
    return <SponsorPortal principal={principal} locale={locale} paid={(await searchParams).paid === '1'} />;
  const portal = await loadSpeakerPortal();
  if (!portal) return <PortalSignedOut signedOut={Boolean((await searchParams).signedOut)} />;
  const { data } = portal;
  const t = await getTranslations('speakerPortal');
  const open = data.tasks.filter((x) => x.status === 'open');
  const tz = data.event.timezone;
  return (
    <PortalShell data={data} active="overview" title={t('welcome', { name: data.speaker.name })}>
      <section aria-labelledby="sessions-heading" className="flex flex-col gap-3">
        <SectionHeader id="sessions-heading" title={t('sessionsHeading')} count={data.sessions.length} />
        {data.sessions.length === 0 ? (
          <EmptyState title={t('noSessionsTitle')} description={t('noSessionsDescription')} />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {data.sessions.map((s) => (
              <li key={s.id}>
                <Card className="flex flex-col gap-2">
                  <h3 className="m-0 text-card">
                    <Link
                      href={`/event-portal/sessions/${s.id}`}
                      className="text-ink underline-offset-4 transition-colors duration-150 hover:text-primary-ink hover:underline"
                    >
                      {s.title}
                    </Link>
                  </h3>
                  <p className="m-0 text-body text-ink-2 tabular-nums">
                    {formatSessionTime(s.startsAt, s.endsAt, locale, tz)} ·{' '}
                    {s.room ? t('room', { room: s.room }) : t('roomTba')}
                    {s.track ? ` · ${t('track', { track: s.track })}` : ''}
                  </p>
                  {s.coSpeakers.length ? (
                    <p className="text-caption text-ink-2">
                      {t('withCoSpeakers', { names: s.coSpeakers.join(', ') })}
                    </p>
                  ) : null}
                  {s.change ? <PortalChangeStatus change={s.change} /> : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="tasks-heading" className="flex flex-col gap-3">
        <SectionHeader id="tasks-heading" title={t('openTasksHeading', { count: open.length })} />
        {open.length === 0 ? (
          <EmptyState title={t('noOpenTasks')} />
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y divide-line rounded-card border border-line bg-surface p-0 glass">
            {open.map((x) => (
              <li
                key={x.assigneeId}
                className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5"
              >
                <Link
                  href="/event-portal/tasks"
                  className="text-body font-bold text-ink underline underline-offset-2"
                >
                  {x.title}
                </Link>
                <span className="text-caption text-ink-2 tabular-nums">
                  {t('due', { date: formatMoment(x.dueAt, locale, tz) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PortalShell>
  );
}
