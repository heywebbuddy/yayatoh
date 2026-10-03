import { executeQuery } from '@yayatoh/kernel';
import { composeNav, isProfileKey } from '@yayatoh/platform';
import { adaReleaseAt, seatingLiveAccessQuery, seatingRulesQuery } from '@yayatoh/seating';
import { buttonClass, Card, EmptyState, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { SeatingRulesForm } from '@/components/seating-rules-form.tsx';
import { SeatingTabs } from '@/components/seating-tabs.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { seatingRulesAction } from '../actions.ts';

/**
 * Seating rules (M1.7f, decision D18): accessible seats kept back until some days before the
 * event, and a cap on seats per order — each warns buyers, the box office and the organizer
 * (recommended) or is enforced.
 */
export default async function SeatingRulesPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'seating');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  if (!composeNav(profile, data.modules).some((i) => i.path === 'seating')) notFound();
  const t = await getTranslations('seating');
  const format = await getFormatter();
  const base = `/o/${org}/e/${event}/seating`;
  const hasPlan = await executeQuery(seatingLiveAccessQuery, { eventId: ev.id }, data.ctx, ports).then(
    () => true,
    () => false,
  );
  const rules = hasPlan ? await executeQuery(seatingRulesQuery, { eventId: ev.id }, data.ctx, ports) : [];
  const canWrite = can('seating:write');
  const when = (d: Date) =>
    format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short', timeZone: ev.timezone });
  return (
    <>
      <PageHeader title={t('rules.title')} description={t('rules.description')} />
      <SeatingTabs
        base={base}
        active="rules"
        finder={data.modules.has('seat_finder')}
        guests={data.modules.has('guests')}
        solver={data.modules.has('guests') && data.modules.has('ai_seating')}
      />
      {!hasPlan ? (
        <EmptyState
          title={t('rules.noPlan')}
          action={
            <Link href={base} className={buttonClass('secondary', 'sm')}>
              {t('assign.toPlan')}
            </Link>
          }
        />
      ) : (
        <>
          <Card>
            <ul aria-label={t('rules.now')} className="flex list-none flex-col gap-1.5 p-0 text-body">
              {rules.length === 0 ? <li>{t('rules.none')}</li> : null}
              {rules.map((r) => (
                <li key={r.kind}>
                  {r.kind === 'ada_reserved'
                    ? t('rules.summary.ada', {
                        days: r.params.releaseDays,
                        date: when(adaReleaseAt(r.params.releaseDays, ev.startsAt)),
                        severity: t(`rules.severityShort.${r.severity}`),
                      })
                    : t('rules.summary.cap', {
                        max: r.params.max,
                        severity: t(`rules.severityShort.${r.severity}`),
                      })}
                </li>
              ))}
            </ul>
          </Card>
          <section aria-labelledby="rules-settings" className="flex flex-col gap-3">
            <h2 id="rules-settings" className="text-section">
              {t('rules.settingsTitle')}
            </h2>
            {canWrite ? (
              <Card>
                <SeatingRulesForm rules={rules} action={seatingRulesAction.bind(null, org, event)} />
              </Card>
            ) : (
              <p className="text-body text-ink-2">{t('rules.readOnly')}</p>
            )}
          </section>
        </>
      )}
    </>
  );
}
