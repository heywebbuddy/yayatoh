import type { NavItem } from '@yayatoh/platform';
import { roleCan } from '@yayatoh/tenancy';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ConsoleShell } from '@/components/console-shell.tsx';
import { openAlertCount } from '@/server/alerts.ts';
import { isPlatformContentOrg } from '@/server/cms.ts';
import { loadConsoleBase } from '@/server/console.ts';

const ORG_NAV: readonly NavItem[] = [
  { key: 'home', path: '', group: 'overview', module: 'core', icon: 'home' },
  { key: 'commandCenter', path: 'command-center', group: 'overview', module: 'core', icon: 'gauge' },
  // M3.2b: the alert engine's alerts, with the open count as the badge.
  { key: 'alerts', path: 'alerts', group: 'overview', module: 'core', icon: 'bell' },
  { key: 'messages', path: 'messages', group: 'overview', module: 'messaging', icon: 'message' },
  { key: 'audiences', path: 'audiences', group: 'overview', module: 'marketing', icon: 'megaphone' },
  // M3.8b: campaign → registrations and revenue, and email deliverability.
  {
    key: 'marketingAnalytics',
    path: 'marketing-analytics',
    group: 'overview',
    module: 'marketing',
    icon: 'chart',
  },
  { key: 'refundRequests', path: 'refund-requests', group: 'overview', module: 'ticketing', icon: 'undo' },
  { key: 'venues', path: 'venues', group: 'build', module: 'core', icon: 'building' },
  { key: 'team', path: 'team', group: 'build', module: 'core', icon: 'users' },
  { key: 'series', path: 'series', group: 'build', module: 'core', icon: 'layers' },
  { key: 'templates', path: 'templates', group: 'build', module: 'core', icon: 'copy' },
  { key: 'domains', path: 'domains', group: 'build', module: 'core', icon: 'globe' },
  { key: 'publicSite', path: 'site', group: 'build', module: 'core', icon: 'store' },
  { key: 'siteContent', path: 'content', group: 'build', module: 'core', icon: 'file-text' },
  { key: 'helpCenter', path: 'help-center', group: 'build', module: 'core', icon: 'life-buoy' },
  { key: 'marketingSite', path: 'marketing', group: 'build', module: 'core', icon: 'megaphone' },
  { key: 'payouts', path: 'payouts', group: 'build', module: 'core', icon: 'landmark' },
  { key: 'finance', path: 'finance', group: 'build', module: 'core', icon: 'scale' },
  { key: 'settings', path: 'settings', group: 'build', module: 'core', icon: 'settings' },
  { key: 'emails', path: 'emails', group: 'build', module: 'core', icon: 'mail-check' },
  { key: 'messagingHealth', path: 'messaging', group: 'build', module: 'messaging', icon: 'gauge' },
  { key: 'sendingSetup', path: 'sending', group: 'build', module: 'core', icon: 'send' },
  { key: 'apiKeys', path: 'api-keys', group: 'build', module: 'core', icon: 'key' },
  { key: 'activity', path: 'activity', group: 'build', module: 'core', icon: 'history' },
  { key: 'privacy', path: 'privacy', group: 'build', module: 'core', icon: 'shield' },
];

/** M3.11b: the platform CMS (help center, marketing site) lives in the marketplace content org only. */
const CONTENT_ORG_ONLY = new Set(['helpCenter', 'marketingSite']);

/** Items only some roles may open (the pages refuse everyone else too). */
const NEEDS: Readonly<Record<string, string>> = {
  commandCenter: 'events:read',
  alerts: 'events:read',
  messages: 'messages:read',
  messagingHealth: 'messages:read',
  audiences: 'messages:read',
  marketingAnalytics: 'marketing:read',
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
  // The org home serves collaborators too (their events); every other org page refuses them.
  const data = await loadConsoleBase(org);
  const t = await getTranslations('shell');
  const openAlerts = await openAlertCount(data);
  return (
    <ConsoleShell
      data={data}
      context={{ eyebrow: t('organization'), title: data.org.name, href: `/o/${org}` }}
      nav={{
        base: `/o/${org}`,
        profile: data.profile,
        items: ORG_NAV.filter(
          (i) =>
            data.modules.has(i.module) &&
            (data.role !== 'collaborator' || i.key === 'home') &&
            (!NEEDS[i.key] || roleCan(data.role, NEEDS[i.key] as string)) &&
            (!CONTENT_ORG_ONLY.has(i.key) || isPlatformContentOrg(data.org.slug)),
        ),
        badges: openAlerts > 0 ? { alerts: String(openAlerts) } : {},
      }}
    >
      {children}
    </ConsoleShell>
  );
}
