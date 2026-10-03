import { executeQuery } from '@yayatoh/kernel';
import { composeNav, isProfileKey } from '@yayatoh/platform';
import { eventSeatingQuery, seatChannelsQuery } from '@yayatoh/seating';
import { Alert, Button, buttonClass, Card, EmptyState, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AllotForm, type AllotItem, ChannelForm } from '@/components/seat-channels.tsx';
import { SeatingTabs } from '@/components/seating-tabs.tsx';
import { Link } from '@/i18n/navigation.ts';
import { localizedPath } from '@/lib/seo/urls.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { allotAction, deleteChannelAction, saveChannelAction } from '../channel-actions.ts';

/** `YYYY-MM-DDTHH:mm` of an instant in a time zone (a datetime-local field's value). */
function wallClock(at: Date, timeZone: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * Sales channels and allotments (M6.11b, advanced seating): the event's channels (the public,
 * the box office, sponsors and promoters with a code), the seats allotted to each, and when they
 * go back to every channel. A seat in one channel is never sold through another.
 */
export default async function ChannelsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ edit?: string; saved?: string; deleted?: string }>;
}) {
  const { locale, org, event } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'seating');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  if (
    !composeNav(profile, data.modules).some((i) => i.path === 'seating') ||
    !data.modules.has('advanced_seating')
  )
    notFound();
  const t = await getTranslations('seating.channels');
  const tt = await getTranslations('seating');
  const base = `/o/${org}/e/${event}/seating`;
  const canWrite = can('seating:write');
  const [seating, page] = await Promise.all([
    executeQuery(eventSeatingQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(seatChannelsQuery, { eventId: ev.id }, data.ctx, ports),
  ]);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: ev.timezone,
  });
  const editing = canWrite ? (page.channels.find((c) => c.id === sp.edit) ?? null) : null;
  const names = new Map(page.channels.map((c) => [c.id, c.name]));
  const channelOf = new Map(page.allotments.map((a) => [a.seatUuid, a.channelId]));
  const items: AllotItem[] = (seating?.doc.items ?? []).flatMap((i) => {
    if (i.kind === 'object') return [];
    const per = new Map<string, number>();
    for (const s of i.seats) {
      const c = channelOf.get(s.id);
      if (c) per.set(c, (per.get(c) ?? 0) + 1);
    }
    return [
      {
        id: i.id,
        kind: i.kind,
        label: i.label,
        seats: i.seats.length,
        allotted: [...per].map(([c, count]) => ({ name: names.get(c) ?? '', count })),
      },
    ];
  });
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <SeatingTabs
        base={base}
        active="channels"
        finder={data.modules.has('seat_finder')}
        selection
        guests={data.modules.has('guests')}
      />
      {!seating ? (
        <EmptyState
          title={t('noPlan')}
          action={
            <Link href={base} className={buttonClass('secondary', 'sm')}>
              {tt('assign.toPlan')}
            </Link>
          }
        />
      ) : (
        <>
          {canWrite ? null : <p className="text-body text-ink-2">{t('readOnly')}</p>}
          {sp.saved ? <Alert tone="info" title={t('saved')} /> : null}
          {sp.deleted ? <Alert tone="info" title={t('deleted')} /> : null}
          <section aria-labelledby="channels-heading" className="flex flex-col gap-3">
            <h2 id="channels-heading" className="text-section">
              {t('listTitle')}
            </h2>
            {page.channels.length === 0 ? (
              <EmptyState
                title={t('empty')}
                description={canWrite ? t('emptyHint') : t('emptyReadOnly')}
                action={
                  canWrite ? (
                    <Link href="#channel-form-heading" className={buttonClass('primary', 'md')}>
                      {t('addFirst')}
                    </Link>
                  ) : (
                    <Link href={base} className={buttonClass('secondary', 'md')}>
                      {tt('assign.toPlan')}
                    </Link>
                  )
                }
              />
            ) : (
              <Card className="overflow-x-auto">
                <table className="w-full text-start text-body">
                  <caption className="sr-only">{t('listTitle')}</caption>
                  <thead className="text-caption text-ink-2">
                    <tr>
                      <th scope="col" className="py-2 pe-4 text-start font-normal">
                        {t('col.channel')}
                      </th>
                      <th scope="col" className="py-2 pe-4 text-start font-normal">
                        {t('col.code')}
                      </th>
                      <th scope="col" className="py-2 pe-4 text-start font-normal">
                        {t('col.release')}
                      </th>
                      <th scope="col" className="py-2 pe-4 text-start font-normal">
                        {t('col.seats')}
                      </th>
                      <th scope="col" className="py-2 pe-4 text-start font-normal">
                        {t('col.sold')}
                      </th>
                      {canWrite ? (
                        <th scope="col" className="py-2 text-start font-normal">
                          {t('col.actions')}
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {page.channels.map((c) => (
                      <tr key={c.id} className="border-t border-line align-top" data-testid="channel-row">
                        <td className="py-2 pe-4">
                          <span className="font-medium">{c.name}</span>
                          <span className="block text-caption text-ink-2">{t(`kind.${c.kind}`)}</span>
                        </td>
                        <td className="py-2 pe-4">
                          {c.code ? (
                            <>
                              <code className="font-mono text-caption">{c.code}</code>
                              <input
                                readOnly
                                value={localizedPath(locale, `/events/${ev.slug}?channel=${c.code}`)}
                                aria-label={t('linkFor', { name: c.name })}
                                className="mt-1 block min-h-8 w-56 rounded-pill border border-line bg-surface-solid px-3 text-caption"
                              />
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2 pe-4">
                          {c.releaseAt
                            ? c.released
                              ? t('released', { when: when.format(c.releaseAt) })
                              : when.format(c.releaseAt)
                            : t('neverReleased')}
                        </td>
                        <td className="py-2 pe-4 tabular-nums">{c.seats}</td>
                        <td className="py-2 pe-4">
                          {t('soldCount', { orders: c.orders, seats: c.seatsSold })}
                        </td>
                        {canWrite ? (
                          <td className="py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Link
                                href={`${base}/channels?edit=${c.id}`}
                                className={buttonClass('ghost', 'sm')}
                                aria-label={t('editNamed', { name: c.name })}
                              >
                                {t('edit')}
                              </Link>
                              <form action={deleteChannelAction.bind(null, org, event, c.id)}>
                                <Button
                                  type="submit"
                                  size="sm"
                                  variant="ghost"
                                  aria-label={t('deleteNamed', { name: c.name })}
                                >
                                  {t('delete')}
                                </Button>
                              </form>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </section>
          {canWrite ? (
            <section aria-labelledby="channel-form-heading" className="flex flex-col gap-3">
              <h2 id="channel-form-heading" className="text-section">
                {editing ? t('editTitle', { name: editing.name }) : t('addTitle')}
              </h2>
              <Card>
                <ChannelForm
                  key={editing?.id ?? 'new'}
                  action={saveChannelAction.bind(null, org, event, editing?.id ?? null)}
                  initial={
                    editing
                      ? {
                          kind: editing.kind,
                          name: editing.name,
                          code: editing.code,
                          releaseAt: editing.releaseAt ? wallClock(editing.releaseAt, ev.timezone) : '',
                        }
                      : null
                  }
                  timeZone={ev.timezone}
                  cancelHref={editing ? `${base}/channels` : null}
                />
              </Card>
            </section>
          ) : null}
          {canWrite && page.channels.length ? (
            <section aria-labelledby="allot-heading" className="flex flex-col gap-3">
              <h2 id="allot-heading" className="text-section">
                {t('allotTitle')}
              </h2>
              <p className="text-body text-ink-2">{t('allotDescription')}</p>
              {items.length === 0 ? (
                <EmptyState
                  title={t('noSeats')}
                  description={t('noSeatsHint')}
                  action={
                    <Link href={base} className={buttonClass('primary', 'md')}>
                      {tt('assign.toPlan')}
                    </Link>
                  }
                />
              ) : (
                <Card>
                  <AllotForm
                    channels={page.channels.map((c) => ({ id: c.id, name: c.name }))}
                    items={items}
                    action={allotAction.bind(null, org, event)}
                  />
                </Card>
              )}
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
