import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { composeNav, isProfileKey } from '@yayatoh/platform';
import { selectionPageQuery } from '@yayatoh/seating';
import { buttonClass, Card, EmptyState, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BestAvailableSettingsForm, CompanionSeatsForm } from '@/components/seat-selection-settings.tsx';
import { SeatingTabs } from '@/components/seating-tabs.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { companionSeatsAction, selectionSettingsAction } from '../actions.ts';

/**
 * Best available and companion seats (M6.11a, advanced seating): whether buyers and the box office
 * may ask for the best seats, how sections rank, and which seats next to accessible seats are kept
 * for companions. The rule that sells them only with an accessible seat is on the Rules tab.
 */
export default async function BestAvailablePage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'seating');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  if (
    !composeNav(profile, data.modules).some((i) => i.path === 'seating') ||
    !data.modules.has('advanced_seating')
  )
    notFound();
  const t = await getTranslations('seating');
  const base = `/o/${org}/e/${event}/seating`;
  const page = await executeQuery(selectionPageQuery, { eventId: ev.id }, data.ctx, ports).catch((err) => {
    if (isDomainError(err) && err.code === 'not_found') return null;
    throw err;
  });
  const canWrite = can('seating:write');
  const companions =
    page?.groups.flatMap((g) => g.seats.filter((s) => s.companion).map((s) => s.label)) ?? [];
  return (
    <>
      <PageHeader title={t('selection.title')} description={t('selection.description')} />
      <SeatingTabs
        base={base}
        active="selection"
        finder={data.modules.has('seat_finder')}
        selection
        guests={data.modules.has('guests')}
        solver={data.modules.has('guests') && data.modules.has('ai_seating')}
      />
      {!page ? (
        <EmptyState
          title={t('selection.noPlan')}
          action={
            <Link href={base} className={buttonClass('secondary', 'sm')}>
              {t('assign.toPlan')}
            </Link>
          }
        />
      ) : (
        <>
          {canWrite ? null : <p className="text-body text-ink-2">{t('selection.readOnly')}</p>}
          <section aria-labelledby="best-heading" className="flex flex-col gap-3">
            <h2 id="best-heading" className="text-section">
              {t('selection.bestTitle')}
            </h2>
            <Card>
              {canWrite ? (
                <BestAvailableSettingsForm
                  settings={page.settings}
                  sections={page.sections}
                  action={selectionSettingsAction.bind(null, org, event)}
                />
              ) : (
                <p className="text-body">
                  {page.settings.bestAvailable ? t('selection.bestOnSummary') : t('selection.bestOffSummary')}
                </p>
              )}
            </Card>
          </section>
          <section aria-labelledby="companions-heading" className="flex flex-col gap-3">
            <h2 id="companions-heading" className="text-section">
              {t('selection.companionsTitle')}
            </h2>
            <p className="text-body text-ink-2">
              {t('selection.companionsDescription')}{' '}
              <Link href={`${base}/rules`} className="underline underline-offset-2">
                {t('selection.rulesLink')}
              </Link>
            </p>
            {page.groups.length === 0 ? (
              <EmptyState
                title={t('selection.noAccessible')}
                action={
                  <Link href={base} className={buttonClass('secondary', 'sm')}>
                    {t('assign.toPlan')}
                  </Link>
                }
              />
            ) : (
              <Card>
                {canWrite ? (
                  <CompanionSeatsForm
                    groups={page.groups}
                    action={companionSeatsAction.bind(null, org, event)}
                  />
                ) : (
                  <p className="text-body">
                    {companions.length
                      ? t('selection.companionList', {
                          count: companions.length,
                          seats: companions.join(', '),
                        })
                      : t('selection.companionNone')}
                  </p>
                )}
              </Card>
            )}
          </section>
        </>
      )}
    </>
  );
}
