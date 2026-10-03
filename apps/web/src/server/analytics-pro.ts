import 'server-only';
import { getUsersByIds } from '@yayatoh/auth';
import { executeQuery } from '@yayatoh/kernel';
import { listMembersQuery, type OrgRole, roleCan } from '@yayatoh/tenancy';
import type { ConsoleData } from './console.ts';
import { ports } from './ports.ts';

/** The currencies a money alert rule can watch: the org's default and its events' (M6.2b). */
export function ruleCurrencies(data: ConsoleData, events: readonly { currency?: string | null }[]): string[] {
  const all = [data.org.currency, ...events.map((e) => e.currency ?? '')];
  return [...new Set(all.filter((c): c is string => typeof c === 'string' && /^[A-Z]{3}$/.test(c)))].sort();
}

/** Members who can receive a scheduled report (they can read orders), labelled for the form. */
export async function reportRecipients(
  data: ConsoleData,
  youLabel: (name: string) => string,
): Promise<{ id: string; label: string }[]> {
  const members = (await executeQuery(listMembersQuery, {}, data.ctx, ports)).filter((m) =>
    roleCan(m.role as OrgRole, 'orders:read'),
  );
  const people = await getUsersByIds(members.map((m) => m.userId));
  const me = data.ctx.actor.type === 'user' ? data.ctx.actor.userId : null;
  return members
    .map((m) => {
      const p = people.get(m.userId);
      const name = p?.name?.trim() || p?.email || m.userId;
      return { id: m.userId, label: m.userId === me ? youLabel(name) : name };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** "8:00 AM", "08:00"…: the 24 send hours in the viewer's locale. */
export function hourLabels(locale: string): string[] {
  const f = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  return Array.from({ length: 24 }, (_, h) => f.format(new Date(Date.UTC(2026, 0, 1, h))));
}
