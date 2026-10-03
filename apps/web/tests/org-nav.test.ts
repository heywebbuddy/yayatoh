import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { MODULE_KEYS } from '@yayatoh/platform';
import { GRANTABLE_ORG_ROLES, type OrgRole, PERMISSIONS, roleCan } from '@yayatoh/tenancy';
import { describe, expect, it } from 'vitest';
import {
  ORG_SECTION_KEYS,
  ORG_SECTIONS,
  type OrgSectionKey,
  orgNavOwner,
  parseClosedSections,
  serializeClosedSections,
  TOP_BAR_ROUTES,
  visibleOrgSections,
} from '../src/lib/org-nav.ts';

/**
 * U2 route sweep: every org console page belongs to exactly one item of one sidebar section, so
 * a new page that nobody can find from the grouped navigation fails here.
 */
const ORG_DIR = join(__dirname, '../src/app/[locale]/o/[org]/(org)');
const en = JSON.parse(readFileSync(join(__dirname, '../messages/en.json'), 'utf8'));

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? pages(p) : f === 'page.tsx' ? [p] : [];
  });
}

const routes = pages(ORG_DIR).map((p) => relative(ORG_DIR, p).split(sep).slice(0, -1).join('/'));
const allModules = new Set<string>(MODULE_KEYS);
const access = (role: OrgRole | 'collaborator', contentOrg = false, agencyOrg = false) => ({
  role,
  can: (p: string) => role !== 'collaborator' && roleCan(role, p),
  modules: allModules,
  contentOrg,
  agencyOrg,
});
const keysOf = (role: OrgRole | 'collaborator', contentOrg = false, agencyOrg = false) =>
  visibleOrgSections(access(role, contentOrg, agencyOrg)).flatMap((s) => s.items.map((i) => i.key));
const sectionsOf = (role: OrgRole | 'collaborator') => visibleOrgSections(access(role)).map((s) => s.key);

describe('org navigation route sweep', () => {
  it('finds the org pages', () => {
    expect(routes.length).toBeGreaterThan(40);
    expect(routes).toContain('');
    expect(routes).toContain('venues/[venue]');
  });

  it.each(routes)('/o/{org}/%s is reachable from the grouped navigation', (route) => {
    const first = route.split('/')[0] ?? '';
    if (TOP_BAR_ROUTES.has(first)) return;
    const owners = ORG_SECTIONS.flatMap((s) =>
      s.items.filter((i) => i.path === first || i.owns?.includes(first)).map((i) => `${s.key}.${i.key}`),
    );
    expect(owners, `${route} must land in exactly one nav item`).toHaveLength(1);
    expect(orgNavOwner(route)).not.toBeNull();
  });

  it('has the five sections in the review order', () => {
    expect(ORG_SECTIONS.map((s) => s.key)).toEqual(['events', 'audience', 'money', 'site', 'settings']);
  });

  it('gives every item one place, a label and a real page', () => {
    const keys = ORG_SECTIONS.flatMap((s) => s.items.map((i) => i.key));
    expect(new Set(keys).size).toBe(keys.length);
    const firsts = new Set(routes.map((r) => r.split('/')[0]));
    for (const s of ORG_SECTIONS) {
      expect(en.shell.sections[s.key], `shell.sections.${s.key}`).toBeTruthy();
      for (const i of s.items) {
        expect(en.nav[i.key], `nav.${i.key}`).toBeTruthy();
        expect(firsts.has(i.path), `${i.key} → /${i.path} has a page`).toBe(true);
        expect(MODULE_KEYS).toContain(i.module);
        if (i.needs) expect(PERMISSIONS as readonly string[]).toContain(i.needs);
      }
    }
  });
});

describe('who sees which sections', () => {
  it('shows the owner every section and item (the CMS only in the content org)', () => {
    expect(sectionsOf('owner')).toEqual([...ORG_SECTION_KEYS]);
    const all = ORG_SECTIONS.flatMap((s) => s.items.map((i) => i.key));
    expect(keysOf('owner', true, true)).toEqual(all);
    // M6.7a: the agency's Clients pages show in agency orgs only.
    expect(keysOf('owner', true)).not.toContain('agency');
    expect(keysOf('owner')).not.toContain('helpCenter');
    expect(keysOf('owner')).not.toContain('marketingSite');
  });

  it('shows the door role (scanner) only the home and their own notifications', () => {
    expect(sectionsOf('scanner')).toEqual(['events', 'settings']);
    expect(keysOf('scanner')).toEqual(['home', 'notifications']);
  });

  it('shows a collaborator only the home with their events', () => {
    expect(keysOf('collaborator')).toEqual(['home']);
  });

  it('keeps money away from roles without finance access', () => {
    for (const role of ['marketing', 'box_office', 'scanner', 'viewer'] as const) {
      expect(keysOf(role)).not.toContain('finance');
      expect(keysOf(role)).not.toContain('payouts');
      expect(keysOf(role)).not.toContain('disputes');
    }
    expect(keysOf('finance')).toEqual(expect.arrayContaining(['finance', 'payouts', 'disputes']));
  });

  it('keeps org settings to the roles that can change them', () => {
    for (const role of GRANTABLE_ORG_ROLES) {
      const keys = keysOf(role);
      expect(keys.includes('settings')).toBe(roleCan(role, 'org:update'));
      expect(keys.includes('domains')).toBe(roleCan(role, 'org:update'));
      expect(keys.includes('apiKeys')).toBe(roleCan(role, 'api_keys:manage'));
    }
  });

  it('hides items for modules the org is not entitled to', () => {
    const sections = visibleOrgSections({ ...access('owner'), modules: new Set(['core']) });
    const keys = sections.flatMap((s) => s.items.map((i) => i.key));
    expect(keys).not.toContain('campaigns');
    expect(keys).not.toContain('coupons');
    expect(keys).toContain('venues');
  });
});

describe('remembered sections', () => {
  it('round-trips the closed sections and ignores junk', () => {
    const closed = new Set<OrgSectionKey>(['money', 'audience']);
    expect(serializeClosedSections(closed)).toBe('audience.money');
    expect([...parseClosedSections('audience.money')].sort()).toEqual(['audience', 'money']);
    expect([...parseClosedSections('nope.site.<script>')]).toEqual(['site']);
    expect(parseClosedSections(undefined).size).toBe(0);
  });

  it('maps a deep page to its section', () => {
    expect(orgNavOwner('venues/abc')?.section).toBe('events');
    expect(orgNavOwner('contacts/stats')?.item.key).toBe('audiences');
    expect(orgNavOwner('payouts')?.section).toBe('money');
    expect(orgNavOwner('')?.item.key).toBe('home');
  });
});
