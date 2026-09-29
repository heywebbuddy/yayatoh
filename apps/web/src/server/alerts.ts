import 'server-only';
import { type AlertDto, alertCountQuery, listAlertsQuery } from '@yayatoh/alerts';
import { executeQuery } from '@yayatoh/kernel';
import { countWords } from '@yayatoh/notifications';
import { roleCan } from '@yayatoh/tenancy';
import { getTranslations } from 'next-intl/server';
import type { AlertsListItem } from '@/components/alerts-list.tsx';
import type { ConsoleData } from './console.ts';
import { ports } from './ports.ts';

type T = Awaited<ReturnType<typeof getTranslations<'alerts'>>>;

/** An alert's text in the reader's language: small counts spelled out per the locale's rule. */
export function alertTitle(t: T, locale: string, a: Pick<AlertDto, 'rule' | 'count'>): string {
  return t(`rules.${a.rule}`, { count: a.count, countWords: countWords(a.count, locale) });
}

/** One alert as a compact row (the Alerts widget, the event home). */
export function alertListItem(
  t: T,
  locale: string,
  org: string,
  a: AlertDto,
  timeZone: string,
): AlertsListItem {
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone });
  return {
    id: a.id,
    title: alertTitle(t, locale, a),
    severity: a.severity,
    severityLabel: t(`severity.${a.severity}`),
    context: a.eventName ?? t('orgWide'),
    stateLabel:
      a.state === 'snoozed' && a.snoozedUntil
        ? t('state.snoozed', { until: when.format(a.snoozedUntil) })
        : a.state === 'resolved' && a.resolvedAt
          ? t('state.resolved', { when: when.format(a.resolvedAt) })
          : t(`state.${a.state}`),
    fixHref: `/o/${org}${a.fixPath}`,
    fixLabel: t(`fix.${a.rule}`),
  };
}

/** Active alerts of one event as widget rows (M3.2a's Alerts widget renders `AlertsList` with them). */
export async function eventAlertItems(
  data: ConsoleData,
  org: string,
  locale: string,
  eventId: string,
  timeZone: string,
) {
  if (!roleCan(data.role, 'events:read')) return null;
  const t = await getTranslations('alerts');
  const list = await executeQuery(listAlertsQuery, { eventId, limit: 20 }, data.ctx, ports);
  return list.map((a) => alertListItem(t, locale, org, a, timeZone));
}

/** The console's Alerts badge: open alerts the member may see. */
export async function openAlertCount(data: ConsoleData): Promise<number> {
  if (!roleCan(data.role, 'events:read')) return 0;
  return (await executeQuery(alertCountQuery, {}, data.ctx, ports)).open;
}
