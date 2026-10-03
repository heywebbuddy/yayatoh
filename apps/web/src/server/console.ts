import 'server-only';
import { effectiveModules } from '@yayatoh/billing';
import { type EventDto, eventRolesOf, getEventBySlugQuery, teamEventBySlugQuery } from '@yayatoh/events';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { listMediaQuery } from '@yayatoh/media';
import { isProfileKey, type ProfileKey, profileOpensSection } from '@yayatoh/platform';
import { ssoRequiredFor } from '@yayatoh/sso';
import {
  eventRoleCan,
  eventRolesOpenSection,
  getOrganizationQuery,
  myAgencyClients,
  myOrganizations,
  resolveOrgSlug,
  roleCan,
  roleRequiresTwoFactor,
} from '@yayatoh/tenancy';
import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { cache } from 'react';
import { redirect } from '@/i18n/navigation.ts';
import { orgActor } from './org-actor.ts';
import { ports } from './ports.ts';
import { getSession, sessionOpensOrg, sessionOrgScope } from './session.ts';

/**
 * Everything the console needs for one org, loaded once per request. The org comes from the
 * route param; the user must be a member (RLS + membership check). A non-member gets a 404 so
 * the org's existence is not revealed. Owners, admins and finance (in any org) must turn on
 * two-step verification first: every console sends them to set it up (M1.2c). Server Actions
 * load the console too, so the same rule covers every write.
 *
 * M6.7a: a member of an agency reaches a client org through the client's live grant instead of a
 * membership. `role` is then the grant's console role (`agency_manager`, …), `ctx` carries the
 * grant (`viaAgency`: the authorizer re-checks it, audit rows name it) and `agency` names the
 * agency for the "via Agency" badge. Grants are read on every request: a revoked one is a 404 on
 * the next. `clients` are the client orgs the user reaches this way (the org switcher).
 */
export const loadConsoleBase = cache(async (orgSlug: string) => {
  const locale = await getLocale();
  const session = await getSession();
  if (!session) return redirect({ href: '/sign-in', locale });
  const imp = session.impersonation;
  const allOrgs = await myOrganizations(session.userId);
  // Staff acting as a member (M1.2e) see only the org they started from; their own sign-in asked
  // for the second step, so the member's set-up requirement doesn't apply to them.
  // M6.5a: a session from an org's single sign-on opens that org only.
  const scope = sessionOrgScope(session);
  const orgs = scope ? allOrgs.filter((o) => o.orgId === scope) : allOrgs;
  if (!imp && !session.twoFactorEnabled && orgs.some((o) => roleRequiresTwoFactor(o.role)))
    return redirect({ href: '/account/security?required=1', locale });
  const clients = imp ? [] : await myAgencyClients(session.userId);
  // M6.7a: a client's finance opt-in opens its money to the agency: the same rule as finance members.
  if (!imp && !session.twoFactorEnabled && clients.some((c) => c.finance))
    return redirect({ href: '/account/security?required=1', locale });
  const resolved = await resolveOrgSlug(orgSlug);
  if (!resolved) notFound();
  if (imp && resolved.orgId !== imp.orgId) notFound();
  // Another org than the one whose IdP signed this session in: sign in again to open it.
  if (!sessionOpensOrg(session, resolved.orgId))
    return redirect({
      href: `/sign-in?${new URLSearchParams({ next: `/o/${orgSlug}`, sso: 'other_org' })}`,
      locale,
    });
  const actor = await orgActor(resolved.orgId, session, { locale });
  // A closed org (M1.3f) stays open to its owners only, read-only, so they can take their data out.
  if (!actor || (resolved.status === 'terminated' && actor.role !== 'owner')) notFound();
  const { ctx, role, agency } = actor;
  // M6.5a: the org requires its single sign-on for this member's address (owners are exempt).
  if (
    !imp &&
    session.ssoOrgId !== resolved.orgId &&
    (await ssoRequiredFor({ orgId: resolved.orgId, userId: session.userId, email: session.email }))
  )
    return redirect({ href: '/sign-in/sso?error=sso_required', locale });
  const [org, modules, logos] = await Promise.all([
    executeQuery(getOrganizationQuery, {}, ctx, ports),
    effectiveModules(ctx),
    // The brand kit logo (M1.4e), shown in the console header.
    executeQuery(listMediaQuery, { ownerType: 'org', ownerId: resolved.orgId, slot: 'logo' }, ctx, ports),
  ]);
  const profile: ProfileKey = isProfileKey(org.defaultProfile) ? org.defaultProfile : 'other';
  return {
    session,
    ctx,
    org,
    role,
    modules,
    orgs,
    profile,
    logo: logos[0] ?? null,
    /** The agency the user acts for here (M6.7a "via Agency" badge), or null for a member. */
    agency: agency ? { name: agency.agencyName, slug: agency.agencySlug, finance: agency.finance } : null,
    clients,
  };
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
