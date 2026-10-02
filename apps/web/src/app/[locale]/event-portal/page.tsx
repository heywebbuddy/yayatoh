import { Card, EmptyState } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PortalChangeStatus } from '@/components/portal-change-status.tsx';
import { PortalShell, PortalSignedOut } from '@/components/portal-shell.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatMoment, formatSessionTime } from '@/lib/portal-format.ts';
import { currentPortalPrincipal, loadSpeakerPortal } from '@/server/portal.ts';
import { ExhibitorPortal } from './exhibitor-portal.tsx';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const exhibitor = (await currentPortalPrincipal())?.subjectKind === 'exhibitor';
  const t = await getTranslations({ locale, namespace: exhibitor ? 'exhibitorPortal' : 'speakerPortal' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * The portal's home (one sign-in for every portal role, M5.3a): the speaker portal's overview
 * (their sessions in the event time zone and open tasks), or for an exhibitor admin or staff
 * member the exhibitor portal (M5.4a).
 */
export default async function SpeakerPortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ signedOut?: string; logo?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const principal = await currentPortalPrincipal();
  if (principal?.subjectKind === 'exhibitor')
    return <ExhibitorPortal principal={principal} locale={locale} logoParam={(await searchParams).logo} />;
  const portal = await loadSpeakerPortal();
  if (!portal) return <PortalSignedOut signedOut={Boolean((await searchParams).signedOut)} />;
  const { data } = portal;
  const t = await getTranslations('speakerPortal');
  const open = data.tasks.filter((x) => x.status === 'open');
  const tz = data.event.timezone;
  return (
    <PortalShell data={data} active="overview" title={t('welcome', { name: data.speaker.name })}>
      <section aria-labelledby="sessions-heading" className="flex flex-col gap-3">
        <h2 id="sessions-heading" className="text-section">
          {t('sessionsHeading')}
        </h2>
        {data.sessions.length === 0 ? (
          <EmptyState title={t('noSessionsTitle')} description={t('noSessionsDescription')} />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {data.sessions.map((s) => (
              <li key={s.id}>
                <Card className="flex flex-col gap-2">
                  <h3 className="text-body font-medium">
                    <Link href={`/event-portal/sessions/${s.id}`} className="underline underline-offset-2">
                      {s.title}
                    </Link>
                  </h3>
                  <p className="text-caption text-zinc-600">
                    {formatSessionTime(s.startsAt, s.endsAt, locale, tz)} ·{' '}
                    {s.room ? t('room', { room: s.room }) : t('roomTba')}
                    {s.track ? ` · ${t('track', { track: s.track })}` : ''}
                  </p>
                  {s.coSpeakers.length ? (
                    <p className="text-caption text-zinc-600">
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
        <h2 id="tasks-heading" className="text-section">
          {t('openTasksHeading', { count: open.length })}
        </h2>
        {open.length === 0 ? (
          <p className="text-body text-zinc-600">{t('noOpenTasks')}</p>
        ) : (
          <ul className="flex list-none flex-col gap-2 p-0">
            {open.map((x) => (
              <li key={x.assigneeId} className="text-body">
                <Link href="/event-portal/tasks" className="underline underline-offset-2">
                  {x.title}
                </Link>{' '}
                <span className="text-caption text-zinc-600">
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
