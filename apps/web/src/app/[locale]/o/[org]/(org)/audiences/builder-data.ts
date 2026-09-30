import 'server-only';
import { listEventsQuery, listSeriesQuery } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import type { BuilderEvent, BuilderSeries } from '@/components/audience-builder.tsx';
import type { ConsoleData } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

/** Events (newest first, dated in their own timezone) and series the builder can point at. */
export async function builderData(data: ConsoleData, locale: string) {
  const [events, series] = await Promise.all([
    executeQuery(listEventsQuery, {}, data.ctx, ports),
    executeQuery(listSeriesQuery, {}, data.ctx, ports),
  ]);
  const list: BuilderEvent[] = [...events]
    .sort((x, y) => y.startsAt.getTime() - x.startsAt.getTime())
    .map((e) => ({
      id: e.id,
      name: e.name,
      date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: e.timezone }).format(e.startsAt),
    }));
  const s: BuilderSeries[] = series.map((x) => ({ id: x.id, name: x.name }));
  return { events: list, series: s };
}
