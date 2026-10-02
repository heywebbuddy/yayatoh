import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { composeNav, isProfileKey } from '@yayatoh/platform';
import { layoutRevisionQuery, layoutRevisionsQuery, type RevisionDetailDto } from '@yayatoh/seating';
import { Alert, buttonClass, Card, EmptyState, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { RestoreForm } from '@/components/seat-channels.tsx';
import { SeatingDatePicker } from '@/components/seating-dates.tsx';
import { SeatingTabs } from '@/components/seating-tabs.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { seatingDates } from '@/server/seating-dates.ts';
import { restoreRevisionAction } from '../channel-actions.ts';

type Diff = NonNullable<RevisionDetailDto['changes']>;

/**
 * Layout revisions (M6.11b, advanced seating): every save of the chart's plan, what each changed
 * (seats added, removed, renumbered), and restoring one. Restoring keeps held and sold seats; when
 * it can't, the page names the seats in the way and nothing changes.
 */
export default async function RevisionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ date?: string; rev?: string; restored?: string }>;
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
  const t = await getTranslations('seating.revisions');
  const tt = await getTranslations('seating');
  const base = `/o/${org}/e/${event}/seating`;
  const { dates, date } = await seatingDates(data, ev.id, sp.date);
  const dateId = date?.id ?? null;
  const list = await executeQuery(
    layoutRevisionsQuery,
    { eventId: ev.id, occurrenceId: dateId },
    data.ctx,
    ports,
  );
  const chosen = /^\d{1,6}$/.test(sp.rev ?? '') ? Number(sp.rev) : (list?.current ?? null);
  const detail =
    list && chosen
      ? await executeQuery(
          layoutRevisionQuery,
          { eventId: ev.id, occurrenceId: dateId, number: chosen },
          data.ctx,
          ports,
        ).catch((err) => {
          if (isDomainError(err) && err.code === 'not_found') return null;
          throw err;
        })
      : null;
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: ev.timezone,
  });
  const q = (rev: number) =>
    `${base}/revisions?${new URLSearchParams({ ...(dateId ? { date: dateId } : {}), rev: String(rev) })}`;
  const summary = (c: { added: number; removed: number; renumbered: number; moved: number } | null) =>
    c
      ? [
          c.added ? t('added', { count: c.added }) : null,
          c.removed ? t('removed', { count: c.removed }) : null,
          c.renumbered ? t('renumbered', { count: c.renumbered }) : null,
          c.moved ? t('moved', { count: c.moved }) : null,
        ]
          .filter(Boolean)
          .join(' · ') || t('noSeatChanges')
      : t('first');
  const seatList = (title: string, seats: readonly string[], total: number) =>
    total ? (
      <details className="text-body">
        <summary className="min-h-6 cursor-pointer">{t('listOf', { title, count: total })}</summary>
        <ul className="mt-1 flex list-none flex-wrap gap-x-4 gap-y-1 ps-0 text-caption text-zinc-700">
          {seats.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        {total > seats.length ? (
          <p className="text-caption text-zinc-500">{t('more', { count: total - seats.length })}</p>
        ) : null}
      </details>
    ) : null;
  const diffBlock = (d: Diff) => (
    <div className="flex flex-col gap-1.5">
      <p className="text-body">{summary(d)}</p>
      {seatList(
        t('addedTitle'),
        d.addedSeats.map((s) => s.label),
        d.added,
      )}
      {seatList(
        t('removedTitle'),
        d.removedSeats.map((s) => s.label),
        d.removed,
      )}
      {seatList(
        t('renumberedTitle'),
        d.renumberedSeats.map((s) => t('renumberedSeat', { from: s.from, to: s.to })),
        d.renumbered,
      )}
    </div>
  );
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <SeatingTabs
        base={base}
        active="revisions"
        finder={data.modules.has('seat_finder')}
        selection
        date={dateId}
      />
      <SeatingDatePicker
        base={`${base}/revisions`}
        dates={dates}
        selected={dateId}
        timeZone={ev.timezone}
        locale={locale}
      />
      {!list ? (
        <EmptyState
          title={t('noPlan')}
          action={
            <Link href={base} className={buttonClass('secondary', 'sm')}>
              {tt('assign.toPlan')}
            </Link>
          }
        />
      ) : list.revisions.length === 0 ? (
        <EmptyState title={t('none')} description={t('noneHint')} />
      ) : (
        <>
          {sp.restored && /^\d+$/.test(sp.restored) ? (
            <Alert
              tone="info"
              title={t('restoredNotice', { number: Number(sp.restored), now: chosen ?? 0 })}
            />
          ) : null}
          {detail ? (
            <section aria-labelledby="revision-heading" className="flex flex-col gap-3">
              <h2 id="revision-heading" className="text-section">
                {t('detailTitle', { number: detail.number })}
              </h2>
              <Card className="flex flex-col gap-4">
                <p className="text-body text-zinc-700">
                  {detail.kind === 'restore'
                    ? t('kindRestore', { number: detail.restoredFrom ?? 0 })
                    : t('kindSave')}{' '}
                  · {when.format(detail.createdAt)} · {t('seats', { count: detail.seatCount })}
                  {detail.number === detail.current ? ` · ${t('currentBadge')}` : ''}
                </p>
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-body font-medium">{t('changedTitle')}</h3>
                  {detail.changes ? diffBlock(detail.changes) : <p className="text-body">{t('first')}</p>}
                </div>
                {detail.number !== detail.current ? (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <h3 className="text-body font-medium">{t('restoreWouldTitle')}</h3>
                      {diffBlock(detail.restore)}
                    </div>
                    <div className="flex flex-col gap-1.5" data-testid="restore-sold">
                      <h3 className="text-body font-medium">{t('inUseTitle')}</h3>
                      <p className="text-body">
                        {detail.inUse.kept + detail.inUse.remapped.length + detail.inUse.conflicts.length ===
                        0
                          ? t('inUseNone')
                          : t('inUseKept', { count: detail.inUse.kept })}
                      </p>
                      {detail.inUse.remapped.length ? (
                        <>
                          <p className="text-body">
                            {t('inUseRemapped', { count: detail.inUse.remapped.length })}
                          </p>
                          <ul className="flex list-none flex-wrap gap-x-4 ps-0 text-caption text-zinc-700">
                            {detail.inUse.remapped.map((s) => (
                              <li key={s.seatUuid}>{s.label}</li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                      {detail.inUse.conflicts.length ? (
                        <Alert title={t('conflictsTitle', { count: detail.inUse.conflicts.length })}>
                          <ul className="flex list-none flex-col gap-1 ps-0">
                            {detail.inUse.conflicts.map((s) => (
                              <li key={s.seatUuid}>
                                {s.reason === 'renumbered'
                                  ? t(`conflict.renumbered.${s.status}`, {
                                      label: s.label,
                                      to: s.newLabel ?? '',
                                    })
                                  : t(`conflict.removed.${s.status}`, { label: s.label })}
                              </li>
                            ))}
                          </ul>
                        </Alert>
                      ) : null}
                    </div>
                    {can('seating:write') && detail.canRestore ? (
                      <RestoreForm
                        number={detail.number}
                        action={restoreRevisionAction.bind(null, org, event, dateId, detail.number)}
                      />
                    ) : can('seating:write') ? null : (
                      <p className="text-caption text-zinc-600">{t('readOnly')}</p>
                    )}
                  </>
                ) : (
                  <p className="text-caption text-zinc-600">{t('isCurrent')}</p>
                )}
              </Card>
            </section>
          ) : null}
          <section aria-labelledby="revisions-heading" className="flex flex-col gap-3">
            <h2 id="revisions-heading" className="text-section">
              {t('listTitle')}
            </h2>
            <Card className="overflow-x-auto">
              <table className="w-full text-start text-body">
                <caption className="sr-only">{t('listTitle')}</caption>
                <thead className="text-caption text-zinc-500">
                  <tr>
                    <th scope="col" className="py-2 pe-4 text-start font-normal">
                      {t('col.revision')}
                    </th>
                    <th scope="col" className="py-2 pe-4 text-start font-normal">
                      {t('col.when')}
                    </th>
                    <th scope="col" className="py-2 pe-4 text-start font-normal">
                      {t('col.what')}
                    </th>
                    <th scope="col" className="py-2 text-start font-normal">
                      {t('col.changes')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.revisions.map((r) => (
                    <tr
                      key={r.number}
                      className="border-t border-zinc-100 align-top"
                      aria-current={r.number === chosen ? 'true' : undefined}
                    >
                      <td className="py-2 pe-4">
                        <Link
                          href={q(r.number)}
                          className="inline-flex min-h-6 items-center underline underline-offset-2"
                        >
                          {t('revision', { number: r.number })}
                        </Link>
                        {r.number === list.current ? (
                          <span className="block text-caption text-zinc-600">{t('currentBadge')}</span>
                        ) : null}
                      </td>
                      <td className="py-2 pe-4">{when.format(r.createdAt)}</td>
                      <td className="py-2 pe-4">
                        {r.kind === 'restore'
                          ? t('kindRestore', { number: r.restoredFrom ?? 0 })
                          : t('kindSave')}
                        <span className="block text-caption text-zinc-600">
                          {t('seats', { count: r.seatCount })}
                        </span>
                      </td>
                      <td className="py-2">{summary(r.changes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>
        </>
      )}
    </>
  );
}
