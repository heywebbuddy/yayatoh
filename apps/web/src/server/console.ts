import 'server-only';
import { effectiveModules } from '@yayatoh/billing';
import { type EventDto, eventRolesOf, getEventBySlugQuery, teamEventBySlugQuery } from '@yayatoh/events';
import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { listMediaQuery } from '@yayatoh/media';
import { isProfileKey, type ProfileKey, profileOpensSection } from '@yayatoh/platform';
import {
  eventRoleCan,
  eventRolesOpenSection,
  getOrganizationQuery,
  memberRole,
  myOrganizations,
  resolveOrgSlug,
  roleCan,
  roleRequiresTwoFactor,
} from '@yayatoh/tenancy';
import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { cache } from 'react';
import { redirect } from '@/i18n/navigation.ts';
import { ports } from './ports.ts';
import { getSession } from './session.ts';

/**
 * Everything the console needs for one org, loaded once per request. The org comes from the
 * route param; the user must be a member (RLS + membership check). A non-member gets a 404 so
 * the org's existence is not revealed. Owners, admins and finance (in any org) must turn on
 * two-step verification first: every console sends them to set it up (M1.2c). Server Actions
 * load the console too, so the same rule covers every write.
 */
export const loadConsoleBase = cache(async (orgSlug: string) => {
  const locale = await getLocale();
  const session = await getSession();
  if (!session) return redirect({ href: '/sign-in', locale });
  const imp = session.impersonation;
  const allOrgs = await myOrganizations(session.userId);
  // Staff acting as a member (M1.2e) see only the org they started from; their own sign-in asked
  // for the second step, so the member's set-up requirement doesn't apply to them.
  const orgs = imp ? allOrgs.filter((o) => o.orgId === imp.orgId) : allOrgs;
  if (!imp && !session.twoFactorEnabled && orgs.some((o) => roleRequiresTwoFactor(o.role)))
    return redirect({ href: '/account/security?required=1', locale });
  const resolved = await resolveOrgSlug(orgSlug);
  if (!resolved) notFound();
  if (imp && resolved.orgId !== imp.orgId) notFound();
  const ctx = createCtx({
    orgId: resolved.orgId,
    actor: { type: 'user', userId: session.userId },
    locale,
    stepUpAt: session.stepUpAt,
    impersonatedBy: imp ? { staffUserId: imp.staffUserId, impersonationId: imp.id } : null,
  });
  const role = await memberRole(ctx);
  // A closed org (M1.3f) stays open to its owners only, read-only, so they can take their data out.
  if (!role || (resolved.status === 'terminated' && role !== 'owner')) notFound();
  const [org, modules, logos] = await Promise.all([
    executeQuery(getOrganizationQuery, {}, ctx, ports),
    effectiveModules(ctx),
    // The brand kit logo (M1.4e), shown in the console header.
    executeQuery(listMediaQuery, { ownerType: 'org', ownerId: resolved.orgId, slot: 'logo' }, ctx, ports),
  ]);
  const profile: ProfileKey = isProfileKey(org.defaultProfile) ? org.defaultProfile : 'other';
  return { session, ctx, org, role, modules, orgs, profile, logo: logos[0] ?? null };
});

export type ConsoleData = Awaited<ReturnType<typeof loadConsoleBase>>;

/**
 * The console for org pages. A collaborator (M4.2a: someone invited to specific events only) has
 * no org pages: every one of them is a 404 for them, and so is every org-level Server Action.
 * Only the org home (their events) and the org layout use `loadConsoleBase` directly.
 */
export const loadConsole = cache(async (orgSlug: string) => {
  const data = await loadConsoleBase(orgSlug);
  if (data.role === 'collaborator') notFound();
  return data;
});

/**
 * The event for the console route, under the org's RLS, with the actor's live event roles
 * (M4.2a) and `can`, their permissions on this event (org role ∪ event roles). Unknown or
 * foreign slugs are a 404, and so is an event a collaborator holds no team role on.
 */
export const loadEventBase = cache(async (orgSlug: string, eventSlug: string) => {
  const data = await loadConsoleBase(orgSlug);
  const orgWide = roleCan(data.role, 'events:read');
  let event: EventDto;
  try {
    event = orgWide
      ? await executeQuery(getEventBySlugQuery, { slug: eventSlug }, data.ctx, ports)
      : await executeQuery(teamEventBySlugQuery, { slug: eventSlug }, data.ctx, ports);
  } catch (err) {
    // A member whose role cannot read events (e.g. a scanner) gets the not-found page, which
    // says they may not have access, instead of an error page.
    if (isDomainError(err) && (err.code === 'not_found' || err.code === 'forbidden')) notFound();
    throw err;
  }
  const eventRoles = await eventRolesOf(data.ctx, event.id);
  const profile: ProfileKey = isProfileKey(event.profile) ? event.profile : 'other';
  const can = (permission: string) => roleCan(data.role, permission) || eventRoleCan(eventRoles, permission);
  /**
   * Whether this actor may open an event section (a nav key): the profile must show it (strict
   * profiles, M4.2a), and a collaborator's team roles must list it. Members with an org role keep
   * what their role gives (each page still checks its own permissions).
   */
  const opens = (section: string) =>
    profileOpensSection(profile, data.modules, section) &&
    (data.role !== 'collaborator' || eventRolesOpenSection(eventRoles, section));
  return { data, event, eventRoles, profile, can, opens };
});

export type EventData = Awaited<ReturnType<typeof loadEventBase>>;

/** The event for a console page or action in `section` (a nav key): a 404 unless `opens(section)`. */
export async function loadEvent(orgSlug: string, eventSlug: string, section: string): Promise<EventData> {
  const loaded = await loadEventBase(orgSlug, eventSlug);
  if (!loaded.opens(section)) notFound();
  return loaded;
}
