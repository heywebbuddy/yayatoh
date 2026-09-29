import { type EventTransition, eventLifecycle } from '@yayatoh/events';
import { Button, buttonClass, Card, PageHeader, ProgressRing } from '@yayatoh/ui';
import { Check } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { greetingKey } from '@/lib/event-status.ts';
import { type FormatCtx, formatEventDateRange } from '@/lib/format.ts';
import { readinessPercent } from '@/lib/readiness.ts';
import { loadEvent } from '@/server/console.ts';
import { demoOverlay } from '@/server/demo.ts';
import { loadReadiness } from '@/server/readiness.ts';
import { transitionAction } from './actions.ts';
import { DemoSections } from './demo-sections.tsx';
import { EventKpis } from './event-kpis.tsx';

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
  const { data, event: ev, can, opens } = await loadEvent(org, event, 'home');
  const demo = demoOverlay(org, event);
  const t = await getTranslations();
  const f: FormatCtx = { locale, currency: ev.currency, timeZone: ev.timezone };
  const firstName = data.session.name.split(' ')[0] ?? data.session.name;
  // Showcase events keep their demo checklist; real events get readiness v1 with deep links.
  // M4.2a: people who can't open the setup guide (planners) don't get its checklist either.
  const guide = opens('setupGuide');
  const rules: readonly { key: string; done: boolean; path?: string; comingSoon?: boolean }[] = demo
    ? demo.readiness
    : guide
      ? await loadReadiness(org, event)
      : [];
  const readiness = readinessPercent(rules);
  const canWrite = can('events:write');
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
      ) : data.modules.has('reports') && can('orders:read') && opens('ticketsOrders') ? (
        <EventKpis eventId={ev.id} base={base} locale={locale} ctx={data.ctx} finance={can('finance:read')} />
      ) : null}

      {rules.length === 0 ? null : (
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-section">{t('dashboard.readiness')}</h2>
            {demo ? null : (
              <Link
                href={`${base}/setup-guide`}
                className="inline-flex min-h-6 items-center text-caption underline"
              >
                {t('setupGuide.open')}
              </Link>
            )}
          </div>
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
                  {r.path !== undefined && !r.done ? (
                    <Link
                      href={r.path ? `${base}/${r.path}` : base}
                      className="inline-flex min-h-6 items-center text-zinc-600 underline underline-offset-2"
                    >
                      {t(`readiness.${r.key}`)}
                      {r.comingSoon ? (
                        <span className="ms-1.5 text-caption text-zinc-500 no-underline">
                          ({t('readiness.comingSoon')})
                        </span>
                      ) : (
                        <span className="sr-only">{t('readiness.todo')}</span>
                      )}
                    </Link>
                  ) : (
                    <span className={r.done ? 'text-zinc-900' : 'text-zinc-500'}>
                      {t(`readiness.${r.key}`)}
                      <span className="sr-only">{r.done ? t('readiness.done') : t('readiness.todo')}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}
    </>
  );
}
