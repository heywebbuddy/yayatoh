import { type EventViewDto, eventViewQuery, WIDGET_META } from '@yayatoh/command-center';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { EmptyState, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CommandCenterBoard } from '@/components/command-center/board.tsx';
import { ModePanel } from '@/components/command-center/mode-panel.tsx';
import { commandCenterCtx, loadWidget, WIDGETS, widgetChannels } from '@/server/command-center.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { resetLayoutAction, saveLayoutAction, setModeAction } from './actions.ts';

/**
 * The event's Command Center (M3.2a): the member's role layout for the event's current mode,
 * each widget loaded through its registry loader and kept current over its realtime channel.
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
  const initial: Record<string, unknown> = {};
  for (const s of slots.filter((x) => !x.hidden)) {
    try {
      initial[s.key] = await loadWidget(s.key, ev.id, ctx);
    } catch (err) {
      if (!isDomainError(err)) throw err;
      initial[s.key] = null;
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
        eyebrow={<span className="text-caption text-ink-2">{t(`role.${view.role}`)}</span>}
        title={t('title')}
        description={ev.name}
      />
      <ModePanel
        mode={view.mode}
        timeZone={view.timeZone}
        locale={locale}
        canOverride={view.canOverride}
        action={setModeAction.bind(null, org, event)}
      />
      <CommandCenterBoard
        key={`${view.mode.mode}:${slots.map((s) => `${s.key}${s.hidden ? '-' : ''}`).join(',')}`}
        slots={slots}
        channels={Object.fromEntries(slots.map((s) => [s.key, WIDGET_META[s.key].channel]))}
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
      />
    </div>
  );
}
