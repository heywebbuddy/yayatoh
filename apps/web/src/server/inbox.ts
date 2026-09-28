import 'server-only';
import { executeQuery, formatMoney, money } from '@yayatoh/kernel';
import { type InboxItemDto, inboxQuery } from '@yayatoh/notifications';
import { getTranslations } from 'next-intl/server';
import type { ConsoleData } from './console.ts';
import { ports } from './ports.ts';

export interface InboxEntry {
  readonly id: string;
  readonly title: string;
  /** Absolute console path, or null. */
  readonly href: string | null;
  readonly read: boolean;
  readonly when: string;
}

export interface InboxView {
  readonly unread: number;
  readonly items: readonly InboxEntry[];
  readonly more: boolean;
}

/** The member's inbox, rendered to display strings in their locale and the org's timezone. */
export async function loadInbox(
  data: NonNullable<ConsoleData>,
  opts: { limit?: number; before?: string } = {},
): Promise<InboxView> {
  const r = await executeQuery(
    inboxQuery,
    { limit: opts.limit ?? 8, ...(opts.before ? { before: opts.before } : {}) },
    data.ctx,
    ports,
  );
  const t = await getTranslations('notifications.items');
  const locale = data.ctx.locale;
  const fmt = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: data.org.timezone,
  });
  const title = (i: InboxItemDto) => {
    const p = { ...i.params };
    if (typeof p.amountMinor === 'number' && typeof p.currency === 'string')
      p.amount = formatMoney(money(p.amountMinor, p.currency), locale);
    if (typeof p.holdUntil === 'string') p.until = fmt.format(new Date(p.holdUntil));
    if (typeof p.rateBps === 'number')
      p.rate = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(
        p.rateBps / 10_000,
      );
    return t.has(i.kind) ? t(i.kind, p) : t('other');
  };
  return {
    unread: r.unread,
    more: r.more,
    items: r.items.map((i) => ({
      id: i.id,
      title: title(i),
      href: i.href ? `/o/${data.org.slug}${i.href}` : null,
      read: i.read,
      when: fmt.format(i.createdAt),
    })),
  };
}
