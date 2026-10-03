import { type MeetingDto, myMeetingsQuery } from '@yayatoh/engagement';
import { executeQuery } from '@yayatoh/kernel';
import { buttonClass, Card, EmptyState, StatusPill } from '@yayatoh/ui';
import { CalendarClock, CalendarPlus } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { slotLabel } from '@/components/networking/format.ts';
import { ActionButton } from '@/components/networking/network-forms.tsx';
import { NetworkShell } from '@/components/networking/network-shell.tsx';
import { getPathname, Link } from '@/i18n/navigation.ts';
import { pageLocale } from '@/server/locale.ts';
import { loadNetworkPage, networkPath } from '@/server/networking.ts';
import { ports } from '@/server/ports.ts';
import { cancelMeetingAction, respondMeetingAction } from '../actions.ts';

type Params = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('networking');
  return { title: t('meetings.metaTitle'), robots: { index: false, follow: false } };
}

/**
 * Meetings (M5.8a): requests waiting for you, requests you sent, and your agreed meetings with
 * their place and table, each with a calendar file. Times are in the event's time zone.
 */
export default async function NetworkMeetingsPage({ params }: Params) {
  const { locale, slug } = await params;
  pageLocale(locale);
  const p = await loadNetworkPage(slug);
  if (!p) notFound();
  if (p.kind !== 'member' || !p.home.meetingsEnabled)
    redirect(getPathname({ href: networkPath(slug), locale }));
  const t = await getTranslations('networking');
  const mine = await executeQuery(myMeetingsQuery, p.at, p.ctx, ports);
  const tz = p.target.timeZone;
  const card = (m: MeetingDto, actions: ReactNode) => (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-card">
          <Link
            href={networkPath(slug, `/people/${m.person.id}`)}
            className="inline-flex min-h-6 items-center underline-offset-2 hover:underline"
          >
            {m.person.displayName}
          </Link>
        </h3>
        <p className="text-body font-bold text-ink">
          {slotLabel(locale, tz, m.slot.startsAt, m.slot.endsAt)}
        </p>
        <p className="text-body text-ink-2">
          {m.tableNo
            ? t('meetings.placeTable', { place: m.location.name, table: m.tableNo })
            : t('meetings.place', { place: m.location.name })}
        </p>
        {m.message ? (
          <blockquote className="mt-1 border-s-2 border-line-strong ps-3 text-body text-ink">
            {m.message}
          </blockquote>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </Card>
  );
  const list = (
    id: string,
    title: string,
    items: MeetingDto[],
    empty: string,
    actions: (m: MeetingDto) => ReactNode,
  ) => (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-section">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="text-body text-ink-2">{empty}</p>
      ) : (
        <ul className="flex list-none flex-col gap-3 p-0">
          {items.map((m) => (
            <li key={m.id}>{card(m, actions(m))}</li>
          ))}
        </ul>
      )}
    </section>
  );
  const nothing = mine.incoming.length + mine.outgoing.length + mine.upcoming.length === 0;
  return (
    <NetworkShell
      slug={slug}
      eventName={p.target.eventName}
      title={t('meetings.title')}
      description={t('meetings.intro', { timezone: tz.replace(/_/g, ' ') })}
      active="meetings"
      waiting={p.waiting}
    >
      {nothing ? (
        <EmptyState
          icon={<CalendarClock />}
          title={t('meetings.emptyTitle')}
          description={t('meetings.emptyDescription')}
          action={
            <Link href={networkPath(slug)} className={buttonClass('primary')}>
              {t('connections.browse')}
            </Link>
          }
        />
      ) : (
        <>
          {list('m-incoming', t('meetings.incoming'), mine.incoming, t('meetings.noIncoming'), (m) => (
            <>
              <ActionButton
                action={respondMeetingAction.bind(null, slug, m.id, true)}
                label={t('meetings.accept')}
                accessibleName={t('meetings.acceptFrom', { name: m.person.displayName })}
                done={t('meetings.accepted', { name: m.person.displayName })}
                variant="primary"
              />
              <ActionButton
                action={respondMeetingAction.bind(null, slug, m.id, false)}
                label={t('meetings.decline')}
                accessibleName={t('meetings.declineFrom', { name: m.person.displayName })}
                done={t('meetings.declined')}
              />
            </>
          ))}
          {list('m-outgoing', t('meetings.outgoing'), mine.outgoing, t('meetings.noOutgoing'), (m) => (
            <ActionButton
              action={cancelMeetingAction.bind(null, slug, m.id)}
              label={t('meetings.withdraw')}
              accessibleName={t('meetings.withdrawTo', { name: m.person.displayName })}
              done={t('meetings.withdrawn')}
            />
          ))}
          {list('m-upcoming', t('meetings.upcoming'), mine.upcoming, t('meetings.noUpcoming'), (m) => (
            <>
              <StatusPill tone="success" label={t('meetings.confirmed')} className="self-center" />
              <a
                href={getPathname({ href: networkPath(slug, `/meetings/${m.id}/ics`), locale })}
                download={`meeting-${m.id}.ics`}
                className={buttonClass('secondary')}
                aria-label={t('meetings.addToCalendarWith', { name: m.person.displayName })}
              >
                <CalendarPlus aria-hidden="true" />
                {t('meetings.addToCalendar')}
              </a>
              <ActionButton
                action={cancelMeetingAction.bind(null, slug, m.id)}
                label={t('meetings.cancel')}
                accessibleName={t('meetings.cancelWith', { name: m.person.displayName })}
                done={t('meetings.cancelled')}
                variant="ghost"
              />
            </>
          ))}
        </>
      )}
    </NetworkShell>
  );
}
