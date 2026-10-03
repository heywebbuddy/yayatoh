import {
  type EventViewDto,
  eventViewQuery,
  followedChannels,
  WIDGET_META,
  type WidgetKey,
} from '@yayatoh/command-center';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { buttonClass, EmptyState, PageHeader, Tag } from '@yayatoh/ui';
import { MonitorPlay, ScanLine } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CommandCenterBoard } from '@/components/command-center/board.tsx';
import { ModeOverrideForm } from '@/components/command-center/mode-panel.tsx';
import { Crumbs, eventWhen } from '@/components/crumbs.tsx';
import { Link } from '@/i18n/navigation.ts';
import { commandCenterCtx, loadWidget, WIDGETS, widgetChannels } from '@/server/command-center.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { resetLayoutAction, saveLayoutAction, setModeAction } from './actions.ts';

/**
 * The event's Command Center (M3.2a): the member's role layout for the event's current mode,
 * each widget loaded through its registry loader and kept current over its realtime channel.
 * U4: a hero strip (countdown, mode, the next action) and a KPI row on top, read through the same
 * loaders (so the role rules are the loaders' own), and a grid packed with no empty cells.
 */
export default async function CommandCenterPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event, 'commandCenter');
  const t = await getTranslations('commandCenter');
  const ctx = await commandCenterCtx(data.ctx);
  let view: EventViewDto;
  try {
    view = await executeQuery(eventViewQuery, { eventId: ev.id }, ctx, ports);
  } catch (err) {
    if (!isDomainError(err) || err.code !== 'forbidden') throw err;
    return (
      <>
        <PageHeader title={t('title')} description={ev.name} />
        <EmptyState title={t('noAccess.title')} description={t('noAccess.description')} />
      </>
    );
  }
  // Only widgets the app registered render (the alerts slot is always registered).
  const slots = view.layout.filter((s) => WIDGETS[s.key]);
  const inLayout = new Set(slots.map((s) => s.key as WidgetKey));
  const kpis = view.kpis.filter((k) => WIDGETS[k]);
  // The hero's next action reads readiness (where the mode shows it) and alerts.
  const hero = {
    readiness: inLayout.has('readiness'),
    alerts: inLayout.has('alerts'),
  };
  const read = [
    ...new Set<WidgetKey>([
      ...slots.filter((x) => !x.hidden).map((x) => x.key),
      ...kpis,
      ...(hero.readiness ? (['readiness'] as const) : []),
      ...(hero.alerts ? (['alerts'] as const) : []),
    ]),
  ];
  const initial: Record<string, unknown> = {};
  for (const key of read) {
    try {
      initial[key] = await loadWidget(key, ev.id, ctx);
    } catch (err) {
      if (!isDomainError(err)) throw err;
      initial[key] = null;
    }
  }
  const channels = await widgetChannels({
    ctx,
    orgId: data.org.id,
    eventId: ev.id,
    role: data.role,
    modules: data.modules,
  });
  const base = `/o/${org}/e/${event}`;
  return (
    <div
      className="flex flex-col gap-6"
      data-testid="command-center"
      data-mode={view.mode.mode}
      data-role={view.role}
    >
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: data.org.name, href: `/o/${org}` },
              { label: ev.name, href: base },
              { label: t('title') },
            ]}
          />
        }
        title={t('title')}
        tag={<Tag>{t(`role.${view.role}`)}</Tag>}
        meta={
          <>
            <span>{eventWhen(ev, locale)}</span>
            {ev.venueName ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{ev.venueName}</span>
              </>
            ) : null}
          </>
        }
        actions={
          <>
            {data.modules.has('checkin') ? (
              <Link href={`${base}/command-center/tv`} className={buttonClass('secondary')}>
                <MonitorPlay aria-hidden="true" strokeWidth={2} />
                {t('tv.open')}
              </Link>
            ) : null}
            <Link href="/scan" className={buttonClass('secondary')}>
              <ScanLine aria-hidden="true" strokeWidth={2} />
              {t('openScanner')}
            </Link>
          </>
        }
      />
      <CommandCenterBoard
        key={`${view.mode.mode}:${slots.map((s) => `${s.key}${s.hidden ? '-' : ''}`).join(',')}`}
        slots={slots}
        channels={Object.fromEntries(
          [...new Set([...slots.map((s) => s.key), ...read])].map((k) => [
            k,
            followedChannels(WIDGET_META[k]),
          ]),
        )}
        urls={channels}
        initial={initial}
        widgetUrl={`/api/command-center/${org}/${event}`}
        base={base}
        locale={locale}
        timeZone={view.timeZone}
        serverNow={ctx.now.toISOString()}
        nextChangeAt={view.mode.nextChangeAt}
        save={saveLayoutAction.bind(null, org, event)}
        reset={resetLayoutAction.bind(null, org, event)}
        kpis={kpis}
        hero={{
          mode: view.mode,
          role: view.role,
          canScan: data.modules.has('checkin') && ['owner', 'ops', 'door'].includes(view.role),
          revenue: kpis.includes('sales'),
          ...hero,
        }}
        links={{
          base,
          publicPage: `/events/${ev.slug}`,
          alerts: `/o/${org}/alerts?event=${ev.id}`,
        }}
        heroControls={
          view.canOverride ? (
            <ModeOverrideForm mode={view.mode} action={setModeAction.bind(null, org, event)} />
          ) : null
        }
      />
    </div>
  );
}
