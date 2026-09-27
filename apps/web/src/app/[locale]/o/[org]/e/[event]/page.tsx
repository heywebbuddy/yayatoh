import { type EventTransition, eventLifecycle } from '@yayatoh/events';
import { roleCan } from '@yayatoh/tenancy';
import { Button, buttonClass, Card, EmptyState, PageHeader, ProgressRing } from '@yayatoh/ui';
import { Check } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { greetingKey } from '@/lib/event-status.ts';
import { type FormatCtx, formatEventDateRange } from '@/lib/format.ts';
import { readinessRules } from '@/lib/readiness.ts';
import { loadEvent } from '@/server/console.ts';
import { demoOverlay } from '@/server/demo.ts';
import { transitionAction } from './actions.ts';
import { DemoSections } from './demo-sections.tsx';

/** Lifecycle actions offered in the header, in order of importance. */
const ACTIONS: readonly EventTransition[] = [
  'publish',
  'reschedule',
  'complete',
  'postpone',
  'unpublish',
  'cancel',
  'archive',
];

export default async function EventDashboard({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event);
  const demo = demoOverlay(org, event);
  const t = await getTranslations();
  const f: FormatCtx = { locale, currency: ev.currency, timeZone: ev.timezone };
  const firstName = data.session.name.split(' ')[0] ?? data.session.name;
  const rules = demo ? demo.readiness : readinessRules(ev);
  const readiness = Math.round((rules.filter((r) => r.done).length / rules.length) * 100);
  const canWrite = roleCan(data.role, 'events:write');
  const actions = ACTIONS.filter((a) =>
    eventLifecycle.can(ev.status as (typeof eventLifecycle.states)[number], a),
  );
  const isPublic =
    ['published', 'postponed', 'cancelled', 'completed'].includes(ev.status) && ev.visibility !== 'private';
  const place = [ev.venueName, ev.city].filter(Boolean).join(', ');
  const base = `/o/${org}/e/${event}`;

  return (
    <>
      <PageHeader
        title={t(`greeting.${greetingKey(ev.timezone)}`, { name: firstName })}
        description={[
          ev.name,
          formatEventDateRange(ev.startsAt.toISOString(), ev.endsAt.toISOString(), f),
          place,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            {isPublic ? (
              <Link href={`/events/${ev.slug}`} className={buttonClass('secondary')}>
                {t('dashboard.previewPage')}
              </Link>
            ) : null}
            {canWrite
              ? actions.slice(0, 3).map((a, i) => (
                  <form key={a} action={transitionAction.bind(null, org, event, a)}>
                    <Button type="submit" variant={i === 0 && a !== 'cancel' ? 'primary' : 'secondary'}>
                      {t(`eventActions.${a}`)}
                    </Button>
                  </form>
                ))
              : null}
          </>
        }
      />

      {demo ? (
        <DemoSections demo={demo} base={base} locale={locale} f={f} />
      ) : (
        <EmptyState title={t('dashboard.noSalesTitle')} description={t('dashboard.noSalesDescription')} />
      )}

      <Card className="flex flex-col gap-3">
        <h2 className="text-section">{t('dashboard.readiness')}</h2>
        <div className="flex items-center gap-[18px]">
          <ProgressRing value={readiness} label={t('dashboard.readinessPercent', { value: readiness })} />
          <ul className="flex list-none flex-col p-0">
            {rules.map((r) => (
              <li key={r.key} className="flex items-center gap-2.5 py-1 text-[13px]">
                <span
                  className={`flex size-[18px] items-center justify-center rounded-full ${r.done ? 'bg-green-500 text-white' : 'border border-zinc-300'}`}
                >
                  {r.done ? <Check aria-hidden="true" className="size-3" strokeWidth={2.5} /> : null}
                </span>
                <span className={r.done ? 'text-zinc-900' : 'text-zinc-500'}>
                  {t(`readiness.${r.key}`)}
                  <span className="sr-only">{r.done ? t('readiness.done') : t('readiness.todo')}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </>
  );
}
