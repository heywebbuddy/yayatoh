import { executeQuery } from '@yayatoh/kernel';
import { composeNav, isProfileKey } from '@yayatoh/platform';
import { defaultPaper, EXPORT_FORMATS, EXPORT_KINDS, seatingCardsQuery } from '@yayatoh/seating';
import { buttonClass, Card, EmptyState, filterChipClass, PageHeader, SectionHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SeatingCardsForm } from '@/components/guest-seating/seating-cards-form.tsx';
import { SeatingTabs } from '@/components/seating-tabs.tsx';
import { Link } from '@/i18n/navigation.ts';
import { routing } from '@/i18n/routing.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Cards and exports (M4.3b): print place, escort and table cards for a chart (the event plan or a
 * sub-event's, `?sub=`) on common paper in any of the app's languages, and download the seating
 * chart by table and the caterer's meal counts as CSV or XLSX (for roles that may export).
 */
export default async function SeatingCardsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ sub?: string }>;
}) {
  const { locale, org, event } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'seating');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  if (!composeNav(profile, data.modules).some((i) => i.path === 'seating')) notFound();
  if (!data.modules.has('guests') || !can('guests:read')) notFound();
  const t = await getTranslations('seating');
  const base = `/o/${org}/e/${event}/seating`;
  const here = `${base}/cards`;
  const prefix = locale === routing.defaultLocale ? '' : `/${locale}`;
  const subEventId = sp.sub && UUID.test(sp.sub) ? sp.sub : null;
  const view = await executeQuery(seatingCardsQuery, { eventId: ev.id, subEventId }, data.ctx, ports).catch(
    (err: { code?: string }) => {
      if (err.code === 'not_found') notFound();
      throw err;
    },
  );
  const chartName = subEventId
    ? (view.subEvents.find((s) => s.id === subEventId)?.name ?? '')
    : t('guestSeating.chart.event');
  const subQuery = subEventId ? `&sub=${subEventId}` : '';
  return (
    <>
      <PageHeader title={t('cards.title')} description={t('cards.description')} />
      <SeatingTabs
        base={base}
        active="cards"
        finder={data.modules.has('seat_finder')}
        guests
        selection={data.modules.has('advanced_seating')}
        solver={data.modules.has('ai_seating')}
      />
      {view.subEvents.length ? (
        <nav aria-label={t('guestSeating.chart.label')}>
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {[{ id: null, name: t('guestSeating.chart.event') }, ...view.subEvents].map((s) => {
              const on = s.id === subEventId;
              return (
                <li key={s.id ?? 'event'}>
                  <Link
                    href={s.id ? `${here}?sub=${s.id}` : here}
                    aria-current={on ? 'page' : undefined}
                    className={filterChipClass(on)}
                  >
                    {s.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
      {!view.hasPlan ? (
        <EmptyState
          title={t('guestSeating.noPlan', { chart: chartName })}
          description={t('guestSeating.noPlanHint')}
          action={
            <Link href={base} className={buttonClass('secondary', 'sm')}>
              {t('guestSeating.toPlan')}
            </Link>
          }
        />
      ) : (
        <>
          <section aria-labelledby="cards-print" className="flex flex-col gap-3">
            <SectionHeader
              id="cards-print"
              title={t('cards.print.heading')}
              actions={
                view.counts.place === 0 ? (
                  <Link
                    href={subEventId ? `${base}/guests?sub=${subEventId}` : `${base}/guests`}
                    className={buttonClass('secondary', 'sm')}
                  >
                    {t('cards.print.toSeat')}
                  </Link>
                ) : null
              }
            />
            <Card>
              <SeatingCardsForm
                action={`${prefix}${here}/pdf`}
                sub={subEventId}
                counts={view.counts}
                paper={defaultPaper(ev.timezone.startsWith('America/') ? 'US' : null)}
                lang={locale}
                languages={routing.locales.map((code) => ({ code, name: languageName(code) }))}
              />
            </Card>
          </section>
          {can('attendees:export') ? (
            <section aria-labelledby="cards-exports" className="flex flex-col gap-3">
              <SectionHeader
                id="cards-exports"
                title={t('cards.exports.heading')}
                description={t('cards.exports.note')}
              />
              <Card>
                <ul className="m-0 flex list-none flex-col gap-4 p-0">
                  {EXPORT_KINDS.map((k) => (
                    <li key={k} className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <p className="m-0 font-semibold text-ink">{t(`cards.exports.${k}`)}</p>
                        <p className="m-0 text-caption text-ink-2">{t(`cards.exports.${k}Hint`)}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {EXPORT_FORMATS.map((f) => (
                          <a
                            key={f}
                            href={`${prefix}${here}/export?kind=${k}&format=${f}${subQuery}`}
                            download
                            aria-label={t('cards.exports.download', {
                              name: t(`cards.exports.${k}`),
                              format: t(`cards.exports.${f}`),
                            })}
                            className={buttonClass('secondary', 'sm')}
                          >
                            {t(`cards.exports.${f}`)}
                          </a>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
