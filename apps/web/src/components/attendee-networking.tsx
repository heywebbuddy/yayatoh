import { buttonClass, Card, EmptyState } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import type { AttendeeNetworkingEvent } from '@/server/attendee-networking.ts';

/** The portal's Networking section: each event with networking open and links into it. */
export async function AttendeeNetworking({
  events,
  preview = false,
}: {
  events: readonly AttendeeNetworkingEvent[];
  /** Organizer preview: sample data, links stay inert. */
  preview?: boolean;
}) {
  const t = await getTranslations('attendeeDashboard.networking');
  if (events.length === 0) return <EmptyState title={t('emptyTitle')} description={t('emptyHint')} />;
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      {events.map((e) => {
        const links: { key: string; href: string; count: number }[] = [
          { key: 'people', href: `/events/${e.slug}/network`, count: 0 },
          { key: 'connections', href: `/events/${e.slug}/network/connections`, count: e.waiting.connections },
          ...(e.meetings
            ? [{ key: 'meetings', href: `/events/${e.slug}/network/meetings`, count: e.waiting.meetings }]
            : []),
          { key: 'chats', href: `/events/${e.slug}/network/chat`, count: e.waiting.chats },
          ...(e.lobby
            ? [{ key: 'lobby', href: `/events/${e.slug}/network/lobby`, count: e.waiting.lobby }]
            : []),
        ];
        return (
          <Card key={e.eventId} className="flex min-w-0 flex-col gap-3">
            <h2 className="break-words text-section">{e.name}</h2>
            {e.optedIn ? (
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {links.map((l) => (
                  <li key={l.key}>
                    {preview ? (
                      <span className={buttonClass('secondary', 'sm')}>
                        {t(`links.${l.key}`)}
                        {l.count ? ` (${l.count})` : ''}
                      </span>
                    ) : (
                      <Link href={l.href} className={buttonClass('secondary', 'sm')}>
                        {t(`links.${l.key}`)}
                        {l.count ? <span className="sr-only">{t('unread', { count: l.count })}</span> : null}
                        {l.count ? <span aria-hidden="true"> ({l.count})</span> : null}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <p className="m-0 text-body text-ink-2">{t('optInHint')}</p>
                {preview ? null : (
                  <Link
                    href={`/events/${e.slug}/network`}
                    className={buttonClass('primary', 'sm', 'self-start')}
                  >
                    {t('optIn')}
                  </Link>
                )}
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
}
