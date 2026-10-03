import type { ModuleKey } from '@yayatoh/platform';

/**
 * U2 (UX review 1, principle 2 "find it in two clicks"): the org console's grouped sidebar.
 * Five sections, in this order; every org page lands in exactly one item of one section
 * (`tests/org-nav.test.ts` sweeps the routes). Labels are `nav.<key>`; section titles are
 * `shell.sections.<key>`.
 */
export const ORG_SECTION_KEYS = ['events', 'audience', 'money', 'site', 'settings'] as const;
export type OrgSectionKey = (typeof ORG_SECTION_KEYS)[number];

export interface OrgNavItem {
  readonly key: string;
  /** Relative to `/o/{org}`; '' is the org home. */
  readonly path: string;
  readonly icon: string;
  readonly module: ModuleKey;
  /** The permission the page needs to be useful; the item is hidden from everyone else. */
  readonly needs?: string;
  /** M3.11b: the platform CMS (help center, marketing site) lives in the content org only. */
  readonly contentOrgOnly?: boolean;
  /** Other first path segments this item owns (pages reached from it, e.g. `contacts`). */
  readonly owns?: readonly string[];
}

export interface OrgNavSection {
  readonly key: OrgSectionKey;
  readonly items: readonly OrgNavItem[];
}

export const ORG_SECTIONS: readonly OrgNavSection[] = [
  {
    key: 'events',
    items: [
      // The home lists the org's events; creating one (`events/new`) starts there or in Create.
      { key: 'home', path: '', icon: 'home', module: 'core', owns: ['events'] },
      { key: 'commandCenter', path: 'command-center', icon: 'gauge', module: 'core', needs: 'events:read' },
      // M3.2b: the alert engine's alerts, with the open count as the badge.
      { key: 'alerts', path: 'alerts', icon: 'bell', module: 'core', needs: 'events:read' },
      { key: 'series', path: 'series', icon: 'layers', module: 'core', needs: 'events:read' },
      { key: 'templates', path: 'templates', icon: 'copy', module: 'core', needs: 'events:read' },
      { key: 'venues', path: 'venues', icon: 'building', module: 'core', needs: 'events:read' },
      {
        key: 'seatingLibrary',
        path: 'seating-library',
        icon: 'armchair',
        module: 'seating',
        needs: 'events:read',
      },
    ],
  },
  {
    key: 'audience',
    items: [
      { key: 'messages', path: 'messages', icon: 'message', module: 'messaging', needs: 'messages:read' },
      {
        key: 'audiences',
        path: 'audiences',
        icon: 'megaphone',
        module: 'marketing',
        needs: 'messages:read',
        // A contact's page and the contact statistics open from Audiences.
        owns: ['contacts'],
      },
      { key: 'campaigns', path: 'campaigns', icon: 'send', module: 'marketing', needs: 'marketing:read' },
      { key: 'journeys', path: 'journeys', icon: 'workflow', module: 'marketing', needs: 'marketing:read' },
      // M3.8b: campaign → registrations and revenue, and email deliverability.
      {
        key: 'marketingAnalytics',
        path: 'marketing-analytics',
        icon: 'chart',
        module: 'marketing',
        needs: 'marketing:read',
      },
      { key: 'supportMacros', path: 'macros', icon: 'zap', module: 'ticketing', needs: 'orders:support' },
    ],
  },
  {
    key: 'money',
    items: [
      { key: 'finance', path: 'finance', icon: 'scale', module: 'core', needs: 'finance:read' },
      { key: 'payouts', path: 'payouts', icon: 'landmark', module: 'core', needs: 'finance:read' },
      // M6.2a: cross-event dashboards from the analytics warehouse.
      {
        key: 'orgAnalytics',
        path: 'analytics',
        icon: 'chart',
        module: 'analytics_pro',
        needs: 'orders:read',
      },
      { key: 'coupons', path: 'coupons', icon: 'ticket', module: 'ticketing', needs: 'events:read' },
      {
        key: 'refundRequests',
        path: 'refund-requests',
        icon: 'undo',
        module: 'ticketing',
        needs: 'orders:read',
      },
      { key: 'disputes', path: 'disputes', icon: 'shield-alert', module: 'ticketing', needs: 'finance:read' },
      { key: 'charity', path: 'charity', icon: 'heart', module: 'donations', needs: 'org:update' },
    ],
  },
  {
    key: 'site',
    items: [
      { key: 'publicSite', path: 'site', icon: 'store', module: 'core', needs: 'org:update' },
      { key: 'siteContent', path: 'content', icon: 'file-text', module: 'core', needs: 'marketing:read' },
      { key: 'domains', path: 'domains', icon: 'globe', module: 'core', needs: 'org:update' },
      { key: 'emails', path: 'emails', icon: 'mail-check', module: 'core', needs: 'org:update' },
      {
        key: 'helpCenter',
        path: 'help-center',
        icon: 'life-buoy',
        module: 'core',
        needs: 'marketing:write',
        contentOrgOnly: true,
      },
      {
        key: 'marketingSite',
        path: 'marketing',
        icon: 'megaphone',
        module: 'core',
        needs: 'marketing:write',
        contentOrgOnly: true,
      },
    ],
  },
  {
    key: 'settings',
    items: [
      { key: 'settings', path: 'settings', icon: 'settings', module: 'core', needs: 'org:update' },
      { key: 'team', path: 'team', icon: 'users', module: 'core', needs: 'members:read' },
      { key: 'plan', path: 'plan', icon: 'credit-card', module: 'core', needs: 'billing:read' },
      { key: 'sendingSetup', path: 'sending', icon: 'send', module: 'core', needs: 'org:update' },
      {
        key: 'messagingHealth',
        path: 'messaging',
        icon: 'gauge',
        module: 'messaging',
        needs: 'messages:read',
      },
      { key: 'apiKeys', path: 'api-keys', icon: 'key', module: 'core', needs: 'api_keys:manage' },
      { key: 'webhooks', path: 'webhooks', icon: 'webhook', module: 'api_access', needs: 'webhooks:manage' },
      // M6.4a: connectors, field mapping, sync history and the errors inbox.
      {
        key: 'integrations',
        path: 'integrations',
        icon: 'link',
        module: 'integrations',
        needs: 'integrations:read',
      },
      // M6.5a: the identity provider, verified domains and SCIM provisioning.
      { key: 'sso', path: 'sso', icon: 'lock', module: 'enterprise', needs: 'sso:manage' },
      { key: 'sandboxes', path: 'sandboxes', icon: 'flask', module: 'core', needs: 'sandbox:manage' },
      { key: 'activity', path: 'activity', icon: 'history', module: 'core', needs: 'audit:read' },
      { key: 'privacy', path: 'privacy', icon: 'shield', module: 'core', needs: 'privacy:manage' },
      // Your own notification inbox and preferences (the bell links here too).
      { key: 'notifications', path: 'notifications', icon: 'bell-ring', module: 'core' },
    ],
  },
];

/**
 * Org pages reached from the top bar rather than the sidebar: the search results page (the
 * search box, ⌘K or /) needs a query and has no page of its own to open.
 */
export const TOP_BAR_ROUTES: ReadonlySet<string> = new Set(['search']);

export interface OrgNavAccess {
  readonly role: string;
  readonly can: (permission: string) => boolean;
  readonly modules: ReadonlySet<string>;
  readonly contentOrg: boolean;
}

/**
 * The sections this member sees: items for modules the org has, permissions the role holds and
 * (for the platform CMS) the content org. Empty sections disappear. A collaborator (M4.2a, people
 * invited to specific events) sees only the home with their events.
 */
export function visibleOrgSections(access: OrgNavAccess): OrgNavSection[] {
  return ORG_SECTIONS.map((s) => ({
    key: s.key,
    items: s.items.filter(
      (i) =>
        access.modules.has(i.module) &&
        (access.role !== 'collaborator' || i.key === 'home') &&
        (!i.needs || access.can(i.needs)) &&
        (!i.contentOrgOnly || access.contentOrg),
    ),
  })).filter((s) => s.items.length > 0);
}

/** The item (and its section) that owns an org path relative to `/o/{org}` (`venues/abc`). */
export function orgNavOwner(
  relPath: string,
  sections: readonly OrgNavSection[] = ORG_SECTIONS,
): { section: OrgSectionKey; item: OrgNavItem } | null {
  const first = relPath.replace(/^\/+/, '').split('/')[0] ?? '';
  for (const s of sections)
    for (const item of s.items)
      if (item.path === first || item.owns?.includes(first)) return { section: s.key, item };
  return null;
}

/** The sidebar's cookie: the sections a member closed (the current page's section always opens). */
export const NAV_COOKIE = 'yy_nav_closed';

export function parseClosedSections(raw: string | undefined): Set<OrgSectionKey> {
  const keys = new Set<string>(ORG_SECTION_KEYS);
  return new Set(
    (raw ?? '')
      .split('.')
      .filter((k): k is OrgSectionKey => keys.has(k))
      .slice(0, ORG_SECTION_KEYS.length),
  );
}

export function serializeClosedSections(closed: Iterable<OrgSectionKey>): string {
  return ORG_SECTION_KEYS.filter((k) => new Set(closed).has(k)).join('.');
}
