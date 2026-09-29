import type { NavItem } from '@yayatoh/platform';
import { roleCan } from '@yayatoh/tenancy';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ConsoleShell } from '@/components/console-shell.tsx';
import { loadConsole } from '@/server/console.ts';

const ORG_NAV: readonly NavItem[] = [
  { key: 'home', path: '', group: 'overview', module: 'core', icon: 'home' },
  { key: 'messages', path: 'messages', group: 'overview', module: 'messaging', icon: 'message' },
  { key: 'audiences', path: 'audiences', group: 'overview', module: 'marketing', icon: 'megaphone' },
  { key: 'refundRequests', path: 'refund-requests', group: 'overview', module: 'ticketing', icon: 'undo' },
  { key: 'venues', path: 'venues', group: 'build', module: 'core', icon: 'building' },
  { key: 'team', path: 'team', group: 'build', module: 'core', icon: 'users' },
  { key: 'series', path: 'series', group: 'build', module: 'core', icon: 'layers' },
  { key: 'templates', path: 'templates', group: 'build', module: 'core', icon: 'copy' },
  { key: 'domains', path: 'domains', group: 'build', module: 'core', icon: 'globe' },
  { key: 'publicSite', path: 'site', group: 'build', module: 'core', icon: 'store' },
  { key: 'siteContent', path: 'content', group: 'build', module: 'core', icon: 'file-text' },
  { key: 'payouts', path: 'payouts', group: 'build', module: 'core', icon: 'landmark' },
  { key: 'finance', path: 'finance', group: 'build', module: 'core', icon: 'scale' },
  { key: 'settings', path: 'settings', group: 'build', module: 'core', icon: 'settings' },
  { key: 'emails', path: 'emails', group: 'build', module: 'core', icon: 'mail-check' },
  { key: 'messagingHealth', path: 'messaging', group: 'build', module: 'messaging', icon: 'gauge' },
  { key: 'apiKeys', path: 'api-keys', group: 'build', module: 'core', icon: 'key' },
  { key: 'activity', path: 'activity', group: 'build', module: 'core', icon: 'history' },
  { key: 'privacy', path: 'privacy', group: 'build', module: 'core', icon: 'shield' },
];

/** Items only some roles may open (the pages refuse everyone else too). */
const NEEDS: Readonly<Record<string, string>> = {
  messages: 'messages:read',
  messagingHealth: 'messages:read',
  audiences: 'messages:read',
  refundRequests: 'orders:read',
  finance: 'finance:read',
  activity: 'audit:read',
  privacy: 'privacy:manage',
};

export default async function OrgLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations('shell');
  return (
    <ConsoleShell
      data={data}
      context={{ eyebrow: t('organization'), title: data.org.name, href: `/o/${org}` }}
      nav={{
        base: `/o/${org}`,
        profile: data.profile,
        items: ORG_NAV.filter(
          (i) => data.modules.has(i.module) && (!NEEDS[i.key] || roleCan(data.role, NEEDS[i.key] as string)),
        ),
      }}
    >
      {children}
    </ConsoleShell>
  );
}
