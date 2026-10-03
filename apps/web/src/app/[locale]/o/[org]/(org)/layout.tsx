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
  // M6.7a: an agency org's Clients | Events | Marketing | Reports (entitlement `agency`).
  { key: 'agency', path: 'agency', group: 'overview', module: 'agency', icon: 'briefcase' },
  { key: 'commandCenter', path: 'command-center', group: 'overview', module: 'core', icon: 'gauge' },
  // M3.2b: the alert engine's alerts, with the open count as the badge.
  { key: 'alerts', path: 'alerts', group: 'overview', module: 'core', icon: 'bell' },
  { key: 'messages', path: 'messages', group: 'overview', module: 'messaging', icon: 'message' },
  { key: 'audiences', path: 'audiences', group: 'overview', module: 'marketing', icon: 'megaphone' },
  { key: 'campaigns', path: 'campaigns', group: 'overview', module: 'marketing', icon: 'send' },
  { key: 'journeys', path: 'journeys', group: 'overview', module: 'marketing', icon: 'workflow' },
  // M3.8b: campaign → registrations and revenue, and email deliverability.
  {
    key: 'marketingAnalytics',
    path: 'marketing-analytics',
    group: 'overview',
    module: 'marketing',
    icon: 'chart',
  },
  { key: 'refundRequests', path: 'refund-requests', group: 'overview', module: 'ticketing', icon: 'undo' },
  { key: 'disputes', path: 'disputes', group: 'overview', module: 'ticketing', icon: 'shield-alert' },
  { key: 'supportMacros', path: 'macros', group: 'overview', module: 'ticketing', icon: 'zap' },
  { key: 'venues', path: 'venues', group: 'build', module: 'core', icon: 'building' },
  { key: 'team', path: 'team', group: 'build', module: 'core', icon: 'users' },
  // M6.7a: agencies the org gave access to.
  { key: 'agencies', path: 'agencies', group: 'build', module: 'core', icon: 'handshake' },
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
  campaigns: 'marketing:read',
  journeys: 'marketing:read',
  marketingAnalytics: 'marketing:read',
  refundRequests: 'orders:read',
  disputes: 'finance:read',
  supportMacros: 'orders:support',
  finance: 'finance:read',
  activity: 'audit:read',
  privacy: 'privacy:manage',
  agency: 'agency:read',
  agencies: 'members:read',
};

/**
 * M6.7a: what someone acting through an agency grant may open besides `NEEDS`. Org settings,
 * the team, domains, the public site, payouts, sending setup, API keys and the CMS are the
 * client's own: an agency role holds none of these permissions, and the pages refuse it too.
 */
const AGENCY_NEEDS: Readonly<Record<string, string>> = {
  team: 'members:read',
  domains: 'org:update',
  publicSite: 'org:update',
  siteContent: 'org:update',
  helpCenter: 'org:update',
  marketingSite: 'org:update',
  payouts: 'payouts:manage',
  settings: 'org:update',
  emails: 'org:update',
  sendingSetup: 'org:update',
  apiKeys: 'api_keys:manage',
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
            (!data.agency || !AGENCY_NEEDS[i.key] || roleCan(data.role, AGENCY_NEEDS[i.key] as string)) &&
            (i.key !== 'agency' || data.org.kind === 'agency') &&
            (!CONTENT_ORG_ONLY.has(i.key) || isPlatformContentOrg(data.org.slug)),
        ),
        badges: openAlerts > 0 ? { alerts: String(openAlerts) } : {},
      }}
    >
      {children}
    </ConsoleShell>
  );
}
